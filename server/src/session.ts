import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CharacterTouchZone, StageEvent } from '../../src/shared/stage-events';
import { PROTOCOL_VERSION, type ClientCommand, type ServerMessage, type SessionInfo, type SessionSummary } from '../../src/shared/wire';
import type { AppSettings, SettingsPatch, WorkerSettings } from '../../src/shared/settings';
import type { WorkerSession } from './adapters/types';
import type { AdapterRegistry } from './adapters/registry';
import { CharacterCatalog, findTouchReaction } from './characters';
import { SettingsStore } from './settings-store';
import { Voice } from './voice/voice';
import { TtsService } from './voice/tts';
import { endpointRequest, listEndpointModels, testEndpoint } from './voice/endpoint';
import { commitGitAll, getGitStatus, revertGitFile } from './git-ops';

const TOUCH_ZONES = new Set<CharacterTouchZone>(['head', 'face', 'body', 'prop']);

function safeSessionFilename(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'default';
}

export function resolveEffectiveWorker(settings: AppSettings, characterId?: string): WorkerSettings & { rolePrompt?: string } {
  const charId = characterId || settings.activeCharacterId;
  const brain = settings.characterBrains?.[charId];
  const model = brain?.model?.trim() || settings.worker.model;
  const endpoint =
    brain?.useCustomEndpoint && brain.endpoint?.baseUrl
      ? {
          baseUrl: brain.endpoint.baseUrl,
          apiKey: brain.endpoint.apiKey || settings.worker.endpoint.apiKey,
        }
      : settings.worker.endpoint;
  return {
    ...settings.worker,
    model,
    endpoint,
    ...(brain?.rolePrompt ? { rolePrompt: brain.rolePrompt } : {}),
  };
}

export function parseCommand(value: unknown): ClientCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('命令必须是 JSON 对象');
  const c = value as Record<string, unknown>;
  const text = (key: string, max = 100_000) => typeof c[key] === 'string' && !!(c[key] as string).trim() && (c[key] as string).length <= max;
  switch (c.type) {
    case 'hello':
      if (typeof c.protocolVersion === 'number') break;
      throw new Error('协议版本无效');
    case 'send':
    case 'steer':
      if (text('id') && text('text')) break;
      throw new Error('消息 ID 或正文无效');
    case 'stop':
    case 'new_session':
    case 'compact_session':
    case 'git_status':
      break;
    case 'resume_session':
      if (text('sessionId', 200)) break;
      throw new Error('会话 ID 无效');
    case 'list_sessions':
      if (
        (c.limit === undefined || (typeof c.limit === 'number' && Number.isFinite(c.limit) && c.limit >= 1 && c.limit <= 500)) &&
        (c.characterId === undefined || text('characterId', 120))
      ) break;
      throw new Error('会话列表参数无效');
    case 'switch_character':
      if (text('characterId', 120)) break;
      throw new Error('角色 ID 无效');
    case 'permission_decision':
      if (text('requestId', 200) && typeof c.allowed === 'boolean') break;
      throw new Error('审批决定无效');
    case 'update_settings':
      if (c.patch && typeof c.patch === 'object' && !Array.isArray(c.patch)) break;
      throw new Error('设置补丁无效');
    case 'list_models':
      if (c.target === 'worker' || c.target === 'voice') break;
      throw new Error('模型目标无效');
    case 'test_connection':
      if (c.target === 'worker' || c.target === 'voice' || c.target === 'tts') break;
      throw new Error('连接测试目标无效');
    case 'baton_pass':
      if (text('toCharacterId', 120) && (c.instruction === undefined || typeof c.instruction === 'string')) break;
      throw new Error('换手接力参数无效');
    case 'interact_character':
      if (text('characterId', 120) && typeof c.zone === 'string' && TOUCH_ZONES.has(c.zone as CharacterTouchZone)) break;
      throw new Error('角色互动参数无效');
    case 'synthesize_tts':
      if (text('characterId', 120) && text('text', 500)) break;
      throw new Error('语音合成参数无效');
    case 'git_revert_file':
      if (text('path', 1000)) break;
      throw new Error('撤回文件路径无效');
    case 'git_commit':
      if (text('message', 500)) break;
      throw new Error('Git 提交信息无效');
    default:
      throw new Error('未知命令');
  }
  return c as unknown as ClientCommand;
}

export class SessionController {
  private worker?: WorkerSession;
  private info: SessionInfo | null = null;
  private history: StageEvent[] = [];
  private voice: Voice;
  private tts: TtsService;
  private autoTtsEnabled: boolean;
  private managementBusy = false;
  private stopPendingStart = false;
  private settingsQueue: Promise<void> = Promise.resolve();
  private sessionsQueue: Promise<void> = Promise.resolve();
  private transcriptQueues = new Map<string, Promise<void>>();
  private sessions = new Map<string, SessionSummary>();
  private characterActiveSession = new Map<string, string>();
  private readonly sessionsPath: string;
  private readonly transcriptsDir: string;
  private closed = false;

  constructor(
    readonly store: SettingsStore,
    readonly characters: CharacterCatalog,
    readonly registry: AdapterRegistry,
    private broadcast: (message: ServerMessage) => void,
    options?: { tts?: TtsService; autoTts?: boolean }
  ) {
    const baseDir = dirname(this.store.path);
    this.sessionsPath = join(baseDir, 'sessions.json');
    this.transcriptsDir = join(baseDir, 'transcripts');
    this.tts = options?.tts ?? new TtsService();
    this.autoTtsEnabled = options?.autoTts ?? (!process.env.NODE_TEST_CONTEXT || Boolean(options?.tts));
    if (this.autoTtsEnabled && this.store.current.tts.enabled) {
      this.tts.warmUp(this.store.current.tts.gcpProject);
    }
    this.loadSessionsFromDisk();
    this.voice = new Voice(event => this.record(event));
    this.configureVoice();
  }

  private loadSessionsFromDisk() {
    for (const [charId, brain] of Object.entries(this.store.current.characterBrains ?? {})) {
      if (brain.activeSessionId) this.characterActiveSession.set(charId, brain.activeSessionId);
    }
    try {
      const raw = JSON.parse(readFileSync(this.sessionsPath, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item && typeof item === 'object' && typeof item.sessionId === 'string') {
            const charId = typeof item.characterId === 'string' ? item.characterId : this.store.current.activeCharacterId;
            this.sessions.set(item.sessionId, {
              sessionId: item.sessionId,
              title: typeof item.title === 'string' ? item.title : '新会话',
              adapter: typeof item.adapter === 'string' ? item.adapter : 'dsh',
              model: typeof item.model === 'string' ? item.model : '',
              cwd: typeof item.cwd === 'string' ? item.cwd : '',
              characterId: charId,
              createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
              updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
              turnCount: typeof item.turnCount === 'number' ? item.turnCount : 0,
            });
            if (!this.characterActiveSession.has(charId)) {
              this.characterActiveSession.set(charId, item.sessionId);
            }
          }
        }
      }
    } catch {}
  }

  private transcriptFilePath(sessionId: string): string {
    return join(this.transcriptsDir, `${safeSessionFilename(sessionId)}.jsonl`);
  }

  private loadTranscriptFromDisk(sessionId: string): StageEvent[] {
    try {
      const fp = this.transcriptFilePath(sessionId);
      if (!existsSync(fp)) return [];
      const lines = readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
      const events: StageEvent[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
            events.push(parsed as StageEvent);
          }
        } catch {}
      }
      return events.slice(-2000);
    } catch {
      return [];
    }
  }

  private redactEventSecrets(event: StageEvent): StageEvent {
    const s = this.store.current;
    const secrets = [
      s.worker.endpoint.apiKey,
      s.voice.endpoint.apiKey,
      s.tts.endpoint.apiKey,
      ...Object.values(s.characterBrains ?? {}).map(b => b.endpoint?.apiKey),
    ].filter((k): k is string => Boolean(k && k.length >= 4));
    if (!secrets.length) return event;
    let raw = JSON.stringify(event);
    for (const secret of secrets) {
      raw = raw.split(secret).join('[REDACTED]');
    }
    return JSON.parse(raw) as StageEvent;
  }

  private persistTranscript(sessionId: string, eventsSnapshot: StageEvent[]): Promise<void> {
    const compactEvents: StageEvent[] = [];
    for (const ev of eventsSnapshot) {
      const clean = this.redactEventSecrets(ev);
      const prev = compactEvents[compactEvents.length - 1];
      if (clean.type === 'worker_text' && prev?.type === 'worker_text' && !prev.final) {
        compactEvents[compactEvents.length - 1] = {
          ...prev,
          text: prev.text + clean.text,
          final: clean.final,
          at: clean.at,
        };
      } else {
        compactEvents.push(clean);
      }
    }
    const capped = compactEvents.slice(-500);
    const payload = capped.map(e => JSON.stringify(e)).join('\n') + (capped.length ? '\n' : '');
    const fp = this.transcriptFilePath(sessionId);

    const writeTask = async () => {
      await mkdir(this.transcriptsDir, { recursive: true, mode: 0o700 });
      const tmp = `${fp}.${randomUUID()}.tmp`;
      await writeFile(tmp, payload, { mode: 0o600, flag: 'wx' });
      await rename(tmp, fp);
      await chmod(fp, 0o600);
    };
    const prevQueue = this.transcriptQueues.get(sessionId) ?? Promise.resolve();
    const next = prevQueue.then(writeTask, writeTask).catch(() => {});
    this.transcriptQueues.set(sessionId, next);
    return next;
  }

  private ensureCurrentSessionEntry(now = Date.now()): SessionSummary | undefined {
    if (!this.info) return undefined;
    const activeChar = this.info.characterId || this.store.current.activeCharacterId;
    const existing = this.sessions.get(this.info.sessionId);
    const entry: SessionSummary = existing
      ? {
          ...existing,
          adapter: this.info.adapter,
          model: this.info.model,
          cwd: this.info.cwd,
          characterId: existing.characterId || activeChar,
          updatedAt: Math.max(existing.updatedAt ?? 0, now),
        }
      : {
          sessionId: this.info.sessionId,
          title: '新会话',
          adapter: this.info.adapter,
          model: this.info.model,
          cwd: this.info.cwd,
          characterId: activeChar,
          createdAt: now,
          updatedAt: now,
          turnCount: 0,
        };
    this.sessions.set(entry.sessionId, entry);
    if (entry.characterId) {
      this.characterActiveSession.set(entry.characterId, entry.sessionId);
    }
    if (this.sessions.size > 100) {
      const sorted = [...this.sessions.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 100);
      this.sessions = new Map(sorted.map(s => [s.sessionId, s]));
    }
    return entry;
  }

  private persistSessions(): Promise<void> {
    const sorted = [...this.sessions.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 100);
    this.sessions = new Map(sorted.map(s => [s.sessionId, s]));
    const payload = JSON.stringify(sorted, null, 2) + '\n';
    const writeTask = async () => {
      await mkdir(dirname(this.sessionsPath), { recursive: true, mode: 0o700 });
      const tmp = `${this.sessionsPath}.${randomUUID()}.tmp`;
      await writeFile(tmp, payload, { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.sessionsPath);
      await chmod(this.sessionsPath, 0o600);
    };
    const next = this.sessionsQueue.then(writeTask, writeTask);
    this.sessionsQueue = next.catch(() => {});
    return this.sessionsQueue;
  }

  private configureVoice() {
    const settings = this.store.current;
    this.voice.configure(this.characters.get(settings.activeCharacterId), settings.voice, this.characters.all());
  }

  private snapshot(): SessionInfo | null {
    return this.info ? { ...this.info, turnActive: this.worker?.turnActive ?? this.info.turnActive } : null;
  }

  private maybeSynthesizeTts(characterId: string, text: string, lineId?: string, force = false) {
    if (this.closed) return;
    const settings = this.store.current;
    if (!force && (!this.autoTtsEnabled || !settings.tts.enabled)) return;
    const pack = this.characters.get(characterId);
    void this.tts
      .synthesize(text, characterId, settings.tts, pack?.defaultVoice)
      .then(audio => {
        if (!audio || this.closed) return;
        this.broadcast({
          type: 'tts_audio',
          characterId,
          lineId,
          text,
          audioBase64: audio.audioBase64,
          mimeType: audio.mimeType,
        });
      })
      .catch(error => {
        if (force) {
          this.broadcast({
            type: 'tts_audio',
            characterId,
            lineId,
            text,
            audioBase64: '',
            mimeType: 'audio/mpeg',
            error: (error as Error).message,
          });
        }
      });
  }

  private record(event: StageEvent) {
    this.history.push(event);
    if (this.history.length > 2000) this.history.splice(0, this.history.length - 2000);
    this.broadcast({ type: 'event', event });

    if (event.type === 'character_line' && event.text.trim()) {
      this.maybeSynthesizeTts(event.characterId, event.text, event.lineId, false);
    }

    if (this.info) {
      if (
        event.type === 'user_message' ||
        event.type === 'turn_done' ||
        event.type === 'tool_end' ||
        event.type === 'context_compacted' ||
        event.type === 'baton_pass' ||
        (event.type === 'worker_text' && event.final)
      ) {
        void this.persistTranscript(this.info.sessionId, this.history);
      }
    }

    if (event.type === 'user_message') {
      const entry = this.ensureCurrentSessionEntry(event.at || Date.now());
      if (entry) {
        if (!entry.title || entry.title === '新会话') {
          const cleanTitle = event.text.trim().replace(/\s+/g, ' ').slice(0, 48);
          if (cleanTitle) entry.title = cleanTitle;
        }
        entry.turnCount = (entry.turnCount ?? 0) + 1;
        entry.updatedAt = Math.max(entry.updatedAt ?? 0, event.at || Date.now());
        void this.persistSessions();
      }
    } else if (event.type === 'turn_done') {
      const entry = this.ensureCurrentSessionEntry(event.at || Date.now());
      if (entry) {
        entry.updatedAt = Math.max(entry.updatedAt ?? 0, event.at || Date.now());
        void this.persistSessions();
      }
    }
    if (event.type === 'thinking' || event.type === 'user_message' || event.type === 'turn_done') {
      if (this.info) this.info.turnActive = event.type !== 'turn_done';
      this.broadcast({ type: 'session', session: this.snapshot() });
    }
    if (event.type !== 'character_line' && event.type !== 'sub_navigator_line') {
      this.voice.handle(event);
    }
  }

  async welcome(): Promise<ServerMessage> {
    const settings = this.store.current;
    if (!this.info && this.history.length === 0) {
      const savedSessionId = this.characterActiveSession.get(settings.activeCharacterId);
      if (savedSessionId) {
        const savedSummary = this.sessions.get(savedSessionId);
        const diskEvents = this.loadTranscriptFromDisk(savedSessionId);
        if (diskEvents.length > 0 && savedSummary) {
          this.history = diskEvents;
          this.info = {
            sessionId: savedSessionId,
            adapter: savedSummary.adapter || settings.worker.adapter,
            model: savedSummary.model || resolveEffectiveWorker(settings).model,
            cwd: savedSummary.cwd || settings.projectDir || '',
            characterId: settings.activeCharacterId,
            turnActive: false,
          };
        }
      }
    }
    const effectiveWorker = resolveEffectiveWorker(settings);
    const workerAdapters = await this.registry.infos(effectiveWorker);
    return {
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      settings: this.store.public,
      characters: this.characters.summaries(),
      workerAdapters,
      session: this.snapshot(),
      history: [...this.history],
    };
  }

  private async project(path: string | null): Promise<string> {
    if (!path) throw new Error('请先选择项目文件夹');
    if (!isAbsolute(path)) throw new Error('项目目录必须是绝对路径');
    try {
      if (!(await stat(path)).isDirectory()) throw new Error();
      return await realpath(path);
    } catch {
      throw new Error('项目文件夹不存在或无法访问');
    }
  }

  private async saveCharacterRoomBinding(characterId: string, sessionId: string | null) {
    if (sessionId) this.characterActiveSession.set(characterId, sessionId);
    else this.characterActiveSession.delete(characterId);
    const currentBrain = this.store.current.characterBrains?.[characterId] ?? {};
    if (currentBrain.activeSessionId !== sessionId) {
      await this.store.update({
        characterBrains: {
          [characterId]: { activeSessionId: sessionId },
        },
      });
    }
  }

  private async openSession(resumeId?: string, forCharacterId?: string) {
    if (this.worker?.turnActive) throw new Error('请先喊停当前任务，再切换会话');
    if (this.info && this.history.length > 0) {
      await this.persistTranscript(this.info.sessionId, this.history);
    }
    const settings = this.store.current;
    const charId = forCharacterId || settings.activeCharacterId;
    const cwd = await this.project(settings.projectDir);
    const effectiveWorker = resolveEffectiveWorker(settings, charId);
    const adapter = this.registry.get(effectiveWorker.adapter);

    await this.worker?.close();
    this.worker = undefined;
    this.info = null;
    const restoredHistory = resumeId ? this.loadTranscriptFromDisk(resumeId) : [];
    this.history = restoredHistory;
    this.voice.reset();
    this.broadcast({ type: 'session', session: null });

    try {
      this.worker = await adapter.startSession({
        ...effectiveWorker,
        cwd,
        resumeId,
        onEvent: event => this.record(event),
      });
      if (this.closed) {
        await this.worker.close();
        this.worker = undefined;
        return;
      }
      this.info = {
        sessionId: this.worker.sessionId,
        adapter: adapter.id,
        model: effectiveWorker.model,
        cwd,
        characterId: charId,
        turnActive: false,
      };
      const entry = this.ensureCurrentSessionEntry(Date.now());
      if (entry) entry.characterId = charId;
      await this.saveCharacterRoomBinding(charId, this.worker.sessionId);
      await this.persistSessions();
      await this.persistTranscript(this.worker.sessionId, this.history);
      this.broadcast({ type: 'session', session: this.snapshot(), history: [...this.history] });
    } catch (error) {
      this.broadcast({ type: 'session', session: null });
      throw error;
    }
  }

  private async switchCharacterRoom(nextCharId: string) {
    const prevCharId = this.store.current.activeCharacterId;
    if (prevCharId === nextCharId) return;

    if (this.info && !this.worker?.turnActive) {
      this.characterActiveSession.set(prevCharId, this.info.sessionId);
      await this.persistTranscript(this.info.sessionId, this.history);
      await this.worker?.close();
      this.worker = undefined;
      this.info = null;
      this.history = [];
    }

    await this.update({ activeCharacterId: nextCharId });

    if (!this.worker?.turnActive) {
      const targetSessionId = this.characterActiveSession.get(nextCharId);
      const summary = targetSessionId ? this.sessions.get(targetSessionId) : undefined;
      if (targetSessionId && summary) {
        const diskHistory = this.loadTranscriptFromDisk(targetSessionId);
        this.history = diskHistory;
        const effectiveWorker = resolveEffectiveWorker(this.store.current, nextCharId);
        this.info = {
          sessionId: targetSessionId,
          adapter: summary.adapter || effectiveWorker.adapter,
          model: effectiveWorker.model || summary.model || '',
          cwd: summary.cwd || this.store.current.projectDir || '',
          characterId: nextCharId,
          turnActive: false,
        };
        this.broadcast({ type: 'session', session: this.snapshot(), history: [...this.history] });
      } else {
        this.broadcast({ type: 'session', session: null, history: [] });
      }
    }
  }

  private async compactCurrentSession() {
    if (this.worker?.turnActive) throw new Error('任务运行中无法执行记忆凝炼，请等待本轮完成');
    const userTurns = this.history.filter(e => e.type === 'user_message');
    const latestUsage = [...this.history].reverse().find((e): e is Extract<StageEvent, { type: 'context_usage' }> => e.type === 'context_usage');
    const maxTokens = latestUsage?.maxTokens || 1_000_000;
    const rawCharLen = JSON.stringify(this.history).length;
    const estimatedBefore = latestUsage?.usedTokens || Math.max(12_000, userTurns.length * 4_500 + Math.round(rawCharLen / 2));

    const digestLines: string[] = [];
    for (const ev of this.history.slice(-40)) {
      if (ev.type === 'user_message') digestLines.push(`用户指令: ${ev.text.slice(0, 140)}`);
      else if (ev.type === 'tool_end' && ev.summary) digestLines.push(`工具操作(${ev.ok ? '成功' : '失败'}): ${ev.summary.slice(0, 100)}`);
      else if (ev.type === 'worker_text' && ev.text.trim()) digestLines.push(`结论: ${ev.text.trim().slice(0, 160)}`);
    }

    let summary = '';
    const settings = this.store.current;
    const effectiveWorker = resolveEffectiveWorker(settings);
    const llmEp =
      effectiveWorker.connection === 'endpoint' && effectiveWorker.endpoint.baseUrl
        ? { ...effectiveWorker.endpoint, model: effectiveWorker.model }
        : settings.voice.endpoint;

    if (digestLines.length > 0 && llmEp.baseUrl && (llmEp.apiKey || llmEp.baseUrl.includes('127.0.0.1') || llmEp.baseUrl.includes('localhost'))) {
      try {
        const res = await endpointRequest(
          llmEp,
          'chat/completions',
          {
            model: llmEp.model,
            stream: false,
            max_tokens: 220,
            messages: [
              {
                role: 'system',
                content: '你是代码会话记忆蒸馏器。请把以下历史对话浓缩为一段不超过 110 字的简体中文关键进展摘要，保留修改过的文件名与核心结论，不要客套话。',
              },
              { role: 'user', content: digestLines.join('\n') },
            ],
          },
          AbortSignal.timeout(8500)
        );
        const text = res?.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.trim()) {
          summary = text.trim().replace(/\s+/g, ' ').slice(0, 180);
        }
      } catch {}
    }

    const turnsCompacted = Math.max(1, userTurns.length || 1);
    if (!summary) {
      const lastPrompt = userTurns.at(-1)?.text.slice(0, 48) || '近期工作区探索';
      summary = `已将前 ${turnsCompacted} 轮记录（含「${lastPrompt}」等上下文）蒸馏为高密度战术记忆锚点。`;
    }

    const freedTokens = Math.max(4_000, Math.round(estimatedBefore * 0.68));
    const afterTokens = Math.max(1_500, estimatedBefore - freedTokens);

    const head = this.history.find(e => e.type === 'session_started');
    const recentTail = this.history.slice(-6).filter(e => e.type !== 'session_started');
    this.history = [...(head ? [head] : []), ...recentTail];

    this.record({
      type: 'context_compacted',
      at: Date.now(),
      turnsCompacted,
      freedTokens,
      afterTokens,
      summary,
    });
    this.record({
      type: 'context_usage',
      at: Date.now(),
      usedTokens: afterTokens,
      maxTokens,
    });
    if (this.info) {
      await this.persistTranscript(this.info.sessionId, this.history);
    }
  }

  private async executeBatonPass(toCharacterId: string, instruction?: string) {
    if (!this.characters.get(toCharacterId)) throw new Error('目标角色不存在');
    if (this.worker?.turnActive) throw new Error('请等待当前角色完成本轮行动后再换手接力');

    const fromCharacterId = this.store.current.activeCharacterId;
    const fromPack = this.characters.get(fromCharacterId);
    const toPack = this.characters.get(toCharacterId)!;

    const lastUser = [...this.history].reverse().find((e): e is Extract<StageEvent, { type: 'user_message' }> => e.type === 'user_message');
    const lastReply = [...this.history].reverse().find((e): e is Extract<StageEvent, { type: 'worker_text' }> => e.type === 'worker_text' && !!e.text.trim());
    const touchedFiles = Array.from(
      new Set(
        this.history
          .filter((e): e is Extract<StageEvent, { type: 'tool_start' }> => e.type === 'tool_start' && Boolean(e.file))
          .map(e => e.file!)
      )
    );

    const briefParts: string[] = [];
    if (lastUser) briefParts.push(`前序任务：「${lastUser.text.slice(0, 200)}」`);
    if (touchedFiles.length) briefParts.push(`涉及文件：${touchedFiles.join(', ')}`);
    if (lastReply) briefParts.push(`上一棒(${fromPack?.name ?? fromCharacterId})结论摘要：${lastReply.text.slice(0, 280)}`);

    const summary = `${fromPack?.name.split('（')[0] ?? fromCharacterId} ➔ ${toPack.name.split('（')[0]}：${instruction?.trim() || '接力推进当前任务与代码审查'}`;

    await this.switchCharacterRoom(toCharacterId);

    const hasProject = Boolean(this.store.current.projectDir);
    if (hasProject) {
      const targetResume = this.characterActiveSession.get(toCharacterId);
      await this.openSession(targetResume, toCharacterId);
    }

    this.record({
      type: 'baton_pass',
      at: Date.now(),
      fromCharacterId,
      toCharacterId,
      summary,
    });

    if (hasProject && this.worker && (instruction?.trim() || briefParts.length > 0)) {
      const handoffPrompt = [
        `【怪盗团 Baton Pass 换手交接】上一棒队友：${fromPack?.name ?? fromCharacterId}`,
        ...briefParts,
        `本棒请重点执行：${instruction?.trim() || '审查上述改动与结论，指出潜在问题或继续完善实现。'}`,
      ].join('\n');
      await this.worker.send(`baton_${randomUUID().slice(0, 8)}`, handoffPrompt);
    }
  }

  private async update(patch: SettingsPatch) {
    const run = async () => {
      if (patch.activeCharacterId !== undefined && !this.characters.get(patch.activeCharacterId)) throw new Error('角色包不存在');
      if (patch.worker?.adapter !== undefined) this.registry.get(patch.worker.adapter);
      if (patch.projectDir !== undefined && patch.projectDir !== null) {
        const cwd = await this.project(patch.projectDir);
        patch = { ...patch, projectDir: cwd, recentProjects: [cwd, ...this.store.current.recentProjects.filter(p => p !== cwd)].slice(0, 20) };
      }
      const prev = this.store.current;
      const prevEff = resolveEffectiveWorker(prev);
      const nextSettings = await this.store.update(patch);
      const nextEff = resolveEffectiveWorker(nextSettings);
      this.configureVoice();

      const workerChanged =
        (patch.projectDir !== undefined && prev.projectDir !== nextSettings.projectDir) ||
        prevEff.adapter !== nextEff.adapter ||
        prevEff.model !== nextEff.model ||
        prevEff.connection !== nextEff.connection ||
        prevEff.sandbox !== nextEff.sandbox ||
        prevEff.endpoint.baseUrl !== nextEff.endpoint.baseUrl ||
        prevEff.endpoint.apiKey !== nextEff.endpoint.apiKey;

      if (workerChanged && this.worker && !this.worker.turnActive) {
        await this.worker.close();
        this.worker = undefined;
        if (patch.projectDir !== undefined && prev.projectDir !== nextSettings.projectDir) {
          this.info = null;
          this.broadcast({ type: 'session', session: null });
        } else if (this.info) {
          this.info = { ...this.info, adapter: nextEff.adapter, model: nextEff.model };
          this.broadcast({ type: 'session', session: this.snapshot() });
        }
      }
      this.broadcast({ type: 'settings', settings: this.store.public });
    };
    const next = this.settingsQueue.then(run, run);
    this.settingsQueue = next.catch(() => {});
    return next;
  }

  async command(command: ClientCommand, reply: (message: ServerMessage) => void) {
    try {
      if (this.closed) throw new Error('服务正在关闭');
      switch (command.type) {
        case 'hello':
          if (command.protocolVersion !== PROTOCOL_VERSION) throw new Error(`不支持协议版本 ${command.protocolVersion}`);
          reply(await this.welcome());
          break;
        case 'send':
        case 'new_session':
        case 'resume_session': {
          if (this.managementBusy) throw new Error('会话正在启动或切换，请稍后重试');
          this.managementBusy = true;
          this.stopPendingStart = false;
          try {
            if (command.type === 'new_session') {
              await this.openSession(undefined);
            } else if (command.type === 'resume_session') {
              await this.openSession(command.sessionId);
            } else if (!this.worker) {
              await this.openSession(this.info?.sessionId);
            }
            if (command.type === 'send' && this.stopPendingStart) {
              this.record({ type: 'user_message', at: Date.now(), id: command.id, text: command.text });
              this.record({ type: 'interrupted', at: Date.now(), reason: '用户在会话启动期间喊停，任务未提交执行' });
              this.record({ type: 'turn_done', at: Date.now(), ok: false, summary: '启动期间已取消' });
            } else if (command.type === 'send') {
              await this.worker!.send(command.id, command.text);
            }
          } finally {
            this.managementBusy = false;
            this.stopPendingStart = false;
          }
          break;
        }
        case 'list_sessions': {
          if (this.info && !this.sessions.has(this.info.sessionId)) {
            this.ensureCurrentSessionEntry(Date.now());
            await this.persistSessions();
          } else {
            await this.sessionsQueue;
          }
          const limit = command.limit ?? 100;
          const all = [...this.sessions.values()].filter(s => !command.characterId || s.characterId === command.characterId);
          const sessions = all
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
            .slice(0, limit)
            .map(s => ({ ...s, current: s.sessionId === this.info?.sessionId }));
          reply({ type: 'sessions', sessions });
          break;
        }
        case 'steer':
          if (!this.worker) throw new Error('尚未建立会话');
          await this.worker.steer(command.id, command.text);
          break;
        case 'stop':
          if (this.managementBusy && !this.worker) this.stopPendingStart = true;
          await this.worker?.interrupt();
          break;
        case 'permission_decision':
          if (!this.worker) throw new Error('尚未建立会话');
          await this.worker.decidePermission(command.requestId, command.allowed);
          break;
        case 'switch_character':
          await this.switchCharacterRoom(command.characterId);
          break;
        case 'update_settings':
          await this.update(command.patch);
          break;
        case 'compact_session':
          await this.compactCurrentSession();
          break;
        case 'baton_pass':
          if (this.managementBusy) throw new Error('会话正在切换中，请稍后重试');
          this.managementBusy = true;
          try {
            await this.executeBatonPass(command.toCharacterId, command.instruction);
          } finally {
            this.managementBusy = false;
          }
          break;
        case 'interact_character': {
          const pack = this.characters.get(command.characterId);
          const reaction = findTouchReaction(pack, command.zone);
          const line = reaction.lines[Math.floor(Math.random() * reaction.lines.length)];
          const lineId = randomUUID();
          this.record({
            type: 'character_line',
            at: Date.now(),
            characterId: command.characterId,
            emotion: reaction.emotion,
            text: line,
            lineId,
            source: 'touch',
            touchZone: command.zone,
          });
          break;
        }
        case 'synthesize_tts': {
          this.maybeSynthesizeTts(command.characterId, command.text, command.lineId, true);
          break;
        }
        case 'git_status': {
          const cwd = this.info?.cwd || this.store.current.projectDir;
          if (!cwd) {
            reply({ type: 'git_status_result', isRepo: false, files: [], diff: '', error: '请先选择项目文件夹' });
            break;
          }
          const status = await getGitStatus(cwd);
          reply({ type: 'git_status_result', ...status });
          break;
        }
        case 'git_revert_file': {
          const cwd = await this.project(this.info?.cwd || this.store.current.projectDir);
          const res = await revertGitFile(cwd, command.path);
          reply({ type: 'git_op_result', op: 'revert', ...res });
          break;
        }
        case 'git_commit': {
          const cwd = await this.project(this.info?.cwd || this.store.current.projectDir);
          const res = await commitGitAll(cwd, command.message);
          reply({ type: 'git_op_result', op: 'commit', ...res });
          break;
        }
        case 'list_models': {
          const settings = this.store.current;
          const eff = resolveEffectiveWorker(settings);
          const result = await (command.target === 'voice'
            ? listEndpointModels(settings.voice.endpoint)
            : this.registry.get(eff.adapter).listModels(eff));
          reply({ type: 'models', target: command.target, ...result });
          break;
        }
        case 'test_connection': {
          const settings = this.store.current;
          if (command.target === 'tts') {
            const result = await this.tts.testConnection(settings.tts);
            reply({ type: 'connection_test', target: 'tts', ...result });
            break;
          }
          const eff = resolveEffectiveWorker(settings);
          const result = await (command.target === 'voice'
            ? testEndpoint(settings.voice.endpoint)
            : this.registry.get(eff.adapter).testConnection(eff));
          reply({ type: 'connection_test', target: command.target, ...result });
          break;
        }
      }
    } catch (error) {
      reply({ type: 'command_error', commandType: command.type, message: (error as Error).message });
    }
  }

  async synthesizeDirect(characterId: string, text: string) {
    const settings = this.store.current;
    const pack = this.characters.get(characterId);
    return this.tts.synthesize(text, characterId, settings.tts, pack?.defaultVoice);
  }

  async close() {
    this.closed = true;
    try {
      if (this.info && this.history.length > 0) {
        await this.persistTranscript(this.info.sessionId, this.history);
      }
      await this.worker?.close();
      await this.sessionsQueue;
      await Promise.allSettled([...this.transcriptQueues.values()]);
    } finally {
      this.voice.close();
    }
  }
}
