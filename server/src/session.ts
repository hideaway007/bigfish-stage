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
import { listEndpointModels, testEndpoint } from './voice/endpoint';
import { commitGitAll, getGitStatus, revertGitFile } from './git-ops';

const TOUCH_ZONES = new Set<CharacterTouchZone>(['head', 'face', 'body', 'prop']);

function safeSessionFilename(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'default';
}

function touchesRuntimeSettings(patch: SettingsPatch): boolean {
  return (
    patch.activeCharacterId !== undefined ||
    patch.projectDir !== undefined ||
    patch.worker !== undefined ||
    patch.characterBrains !== undefined
  );
}

function sameExtra(a?: Record<string, string>, b?: Record<string, string>): boolean {
  const keysA = Object.keys(a ?? {}).sort();
  const keysB = Object.keys(b ?? {}).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k, idx) => k === keysB[idx] && a?.[k] === b?.[k]);
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
      if (c.target === 'worker' || c.target === 'voice') break;
      throw new Error('连接测试目标无效');
    case 'baton_pass':
      if (text('toCharacterId', 120) && (c.instruction === undefined || typeof c.instruction === 'string')) break;
      throw new Error('换手接力参数无效');
    case 'interact_character':
      if (text('characterId', 120) && typeof c.zone === 'string' && TOUCH_ZONES.has(c.zone as CharacterTouchZone)) break;
      throw new Error('角色互动参数无效');
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
    private broadcast: (message: ServerMessage) => void
  ) {
    const baseDir = dirname(this.store.path);
    this.sessionsPath = join(baseDir, 'sessions.json');
    this.transcriptsDir = join(baseDir, 'transcripts');
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

  private record(event: StageEvent) {
    this.history.push(event);
    if (this.history.length > 2000) this.history.splice(0, this.history.length - 2000);
    this.broadcast({ type: 'event', event });

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

  private enqueueStoreUpdate(patch: SettingsPatch): Promise<AppSettings> {
    const run = () => this.store.update(patch);
    const next = this.settingsQueue.then(run, run);
    this.settingsQueue = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  private async saveCharacterRoomBinding(characterId: string, sessionId: string | null) {
    if (sessionId) this.characterActiveSession.set(characterId, sessionId);
    else this.characterActiveSession.delete(characterId);
    const currentBrain = this.store.current.characterBrains?.[characterId] ?? {};
    if (currentBrain.activeSessionId !== sessionId) {
      await this.enqueueStoreUpdate({
        characterBrains: {
          [characterId]: { activeSessionId: sessionId },
        },
      });
    }
  }

  private async openSession(resumeId?: string, forCharacterId?: string) {
    if (this.worker?.turnActive) throw new Error('请先喊停当前任务，再切换会话');
    const previousInMemory =
      resumeId && this.info?.sessionId === resumeId && this.history.length > 0 ? [...this.history] : undefined;
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
    const diskHistory = resumeId ? this.loadTranscriptFromDisk(resumeId) : [];
    const restoredHistory =
      previousInMemory && previousInMemory.length > diskHistory.length ? previousInMemory : diskHistory;
    this.history = restoredHistory;
    this.voice.reset();
    this.broadcast({ type: 'session', session: null });

    try {
      this.worker = await adapter.startSession({
        ...effectiveWorker,
        cwd,
        resumeId,
        ...(resumeId && restoredHistory.length > 0 ? { restoredEvents: [...restoredHistory] } : {}),
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

  private async performCharacterSwitch(nextCharId: string) {
    if (!this.characters.get(nextCharId)) throw new Error('角色包不存在');
    if (this.worker?.turnActive) {
      throw new Error('任务运行中无法切换角色，请先停止或等待本轮完成');
    }
    const prevCharId = this.store.current.activeCharacterId;
    if (prevCharId === nextCharId) return;

    if (this.info) {
      this.characterActiveSession.set(prevCharId, this.info.sessionId);
      await this.persistTranscript(this.info.sessionId, this.history);
    }
    if (this.worker) {
      await this.worker?.close();
      this.worker = undefined;
    }
    this.info = null;
    this.history = [];

    await this.enqueueStoreUpdate({ activeCharacterId: nextCharId });
    this.configureVoice();
    this.broadcast({ type: 'settings', settings: this.store.public });

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

  private async switchCharacterRoom(nextCharId: string) {
    if (!this.characters.get(nextCharId)) throw new Error('角色包不存在');
    if (this.worker?.turnActive) {
      throw new Error('任务运行中无法切换角色，请先停止或等待本轮完成');
    }
    if (this.managementBusy) {
      throw new Error('会话正在启动或切换，请稍后重试');
    }
    this.managementBusy = true;
    try {
      await this.settingsQueue;
      await this.performCharacterSwitch(nextCharId);
    } finally {
      this.managementBusy = false;
    }
  }

  private async compactCurrentSession() {
    await this.settingsQueue;
    if (this.worker?.turnActive) throw new Error('任务运行中无法执行记忆凝炼，请等待本轮完成');
    if (!this.worker && !this.info) {
      throw new Error('当前尚未建立会话，无法执行记忆凝炼');
    }

    if (!this.worker && this.info) {
      const settings = this.store.current;
      const charId = this.info.characterId || settings.activeCharacterId;
      const effectiveWorker = resolveEffectiveWorker(settings, charId);
      const adapterId = this.info.adapter || effectiveWorker.adapter;
      const adapter = this.registry.get(adapterId);
      if (adapter.supportsCompact === false) {
        throw new Error(`当前执行器 (${adapter.id}) 不支持手动上下文压缩，未修改任何会话历史`);
      }
      await this.openSession(this.info.sessionId, charId);
    }

    if (!this.worker) {
      throw new Error('当前尚未建立会话，无法执行记忆凝炼');
    }
    if (this.worker.turnActive) {
      throw new Error('任务运行中无法执行记忆凝炼，请等待本轮完成');
    }
    if (typeof this.worker.compact !== 'function') {
      throw new Error(`当前执行器 (${this.info?.adapter || 'unknown'}) 不支持手动上下文压缩，未修改任何会话历史`);
    }

    const result = await this.worker.compact();
    const turnsCompacted =
      typeof result.turnsCompacted === 'number' && Number.isFinite(result.turnsCompacted) && result.turnsCompacted >= 0
        ? Math.trunc(result.turnsCompacted)
        : 0;
    const hasFreed =
      typeof result.freedTokens === 'number' && Number.isFinite(result.freedTokens) && result.freedTokens > 0;
    const freedTokens = hasFreed ? Math.trunc(result.freedTokens) : 0;
    const afterTokens =
      typeof result.afterTokens === 'number' && Number.isFinite(result.afterTokens) && result.afterTokens >= 0
        ? Math.trunc(result.afterTokens)
        : undefined;
    const rawSummary = typeof result.summary === 'string' ? result.summary.trim() : '';
    const summary = rawSummary
      ? hasFreed || rawSummary.includes('未提供')
        ? rawSummary
        : `${rawSummary}（未提供释放 Token 统计）`
      : hasFreed
        ? `已完成上下文压缩（压缩 ${turnsCompacted} 轮，引擎报告释放 ${freedTokens} Tokens）。`
        : '已完成上下文压缩（未提供释放 Token 统计）。';

    this.record({
      type: 'context_compacted',
      at: Date.now(),
      turnsCompacted,
      freedTokens,
      ...(afterTokens !== undefined ? { afterTokens } : {}),
      summary,
    });
    if (afterTokens !== undefined && typeof result.maxTokens === 'number' && Number.isFinite(result.maxTokens) && result.maxTokens > 0) {
      this.record({
        type: 'context_usage',
        at: Date.now(),
        usedTokens: afterTokens,
        maxTokens: Math.trunc(result.maxTokens),
      });
    }
    if (this.info) {
      await this.persistTranscript(this.info.sessionId, this.history);
    }
  }

  private async executeBatonPass(toCharacterId: string, instruction?: string) {
    if (!this.characters.get(toCharacterId)) throw new Error('目标角色不存在');
    await this.settingsQueue;
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

    await this.performCharacterSwitch(toCharacterId);

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

    if (hasProject && this.worker && !this.stopPendingStart && (instruction?.trim() || briefParts.length > 0)) {
      const handoffPrompt = [
        `【角色换手交接 · Agent Relay】上一棒队友：${fromPack?.name ?? fromCharacterId}`,
        ...briefParts,
        `本棒请重点执行：${instruction?.trim() || '审查上述改动与结论，指出潜在问题或继续完善实现。'}`,
      ].join('\n');
      await this.worker.send(`baton_${randomUUID().slice(0, 8)}`, handoffPrompt);
    }
  }

  private async update(patch: SettingsPatch) {
    const runtimeTouched = touchesRuntimeSettings(patch);
    if (runtimeTouched) {
      if (this.worker?.turnActive) {
        throw new Error('任务运行中无法切换角色、模型或项目配置，请先停止或等待本轮完成');
      }
      if (this.managementBusy) {
        throw new Error('会话正在启动或切换，无法修改角色、模型或项目配置，请稍后重试');
      }
    }

    if (patch.activeCharacterId !== undefined) {
      if (!this.characters.get(patch.activeCharacterId)) throw new Error('角色包不存在');
      const { activeCharacterId, ...restPatch } = patch;
      if (Object.keys(restPatch).length > 0) {
        await this.update(restPatch);
      }
      if (activeCharacterId !== this.store.current.activeCharacterId) {
        await this.switchCharacterRoom(activeCharacterId);
      } else if (Object.keys(restPatch).length === 0) {
        this.broadcast({ type: 'settings', settings: this.store.public });
      }
      return;
    }

    const run = async () => {
      if (runtimeTouched && this.worker?.turnActive) {
        throw new Error('任务运行中无法切换角色、模型或项目配置，请先停止或等待本轮完成');
      }
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

      const projectChanged = patch.projectDir !== undefined && prev.projectDir !== nextSettings.projectDir;
      const adapterChanged = prevEff.adapter !== nextEff.adapter;
      const workerChanged =
        projectChanged ||
        adapterChanged ||
        prevEff.model !== nextEff.model ||
        prevEff.connection !== nextEff.connection ||
        prevEff.sandbox !== nextEff.sandbox ||
        prevEff.agentPreset !== nextEff.agentPreset ||
        prevEff.reasoningEffort !== nextEff.reasoningEffort ||
        prevEff.rolePrompt !== nextEff.rolePrompt ||
        prevEff.endpoint.baseUrl !== nextEff.endpoint.baseUrl ||
        prevEff.endpoint.apiKey !== nextEff.endpoint.apiKey ||
        !sameExtra(prevEff.extra, nextEff.extra);

      if (workerChanged && !this.worker?.turnActive) {
        if (this.worker) {
          await this.worker.close();
          this.worker = undefined;
        }
        if (projectChanged || adapterChanged) {
          if (this.info && this.history.length > 0) {
            await this.persistTranscript(this.info.sessionId, this.history);
          }
          this.info = null;
          this.history = [];
          this.broadcast({ type: 'session', session: null, history: [] });
        } else if (this.info) {
          this.info = { ...this.info, adapter: nextEff.adapter, model: nextEff.model };
          this.ensureCurrentSessionEntry(Date.now());
          await this.persistSessions();
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
          if (command.type === 'send' && this.worker?.turnActive) {
            throw new Error('任务运行中，请使用插话');
          }
          if (command.type !== 'send' && this.worker?.turnActive) {
            throw new Error('请先喊停当前任务，再切换会话');
          }
          this.managementBusy = true;
          this.stopPendingStart = false;
          try {
            await this.settingsQueue;
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
          if (this.worker?.turnActive) throw new Error('任务运行中无法执行记忆凝炼，请等待本轮完成');
          if (this.managementBusy) throw new Error('会话正在启动或切换，请稍后重试');
          this.managementBusy = true;
          try {
            await this.compactCurrentSession();
          } finally {
            this.managementBusy = false;
          }
          break;
        case 'baton_pass':
          if (this.worker?.turnActive) throw new Error('请等待当前角色完成本轮行动后再换手接力');
          if (this.managementBusy) throw new Error('会话正在切换中，请稍后重试');
          this.managementBusy = true;
          this.stopPendingStart = false;
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
