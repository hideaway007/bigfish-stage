import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  KNOWN_CHARACTER_IDS,
  pickReactionForEvent,
  preloadCharacterPacks,
  toCharacterSummary,
} from '../../../../src/stage/characterLoader';
import { DEFAULT_SETTINGS, type PublicSettings, type SettingsPatch } from '../../../../src/shared/settings';
import type { StageEvent, ToolKind } from '../../../../src/shared/stage-events';
import { PROTOCOL_VERSION, type ServerMessage, type SessionInfo, type SessionSummary } from '../../../../src/shared/wire';
import type { SessionListState } from '../../../../src/stage/sources/SessionListFeed';
import type {
  ConnectionStatus,
  StageDataSource,
  StageDataSourceCallbacks,
} from '../../../../src/stage/sources/types';

const ACTIVE_CHAR_STORAGE_KEY = 'bigfish.activeCharacterId';
const ACTIVE_PRESET_STORAGE_KEY = 'bigfish.activeAgentPreset';
const PRESET_LISTENERS = new Set<(presetId: string) => void>();

export function getStoredAgentPreset(): string {
  try {
    const saved = window.localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // ignore
  }
  return 'standard';
}

export function setStoredAgentPreset(presetId: string): void {
  const clean = presetId.trim() || 'standard';
  try {
    window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, clean);
  } catch {
    // ignore
  }
  for (const fn of PRESET_LISTENERS) {
    fn(clean);
  }
}

export function subscribeStoredAgentPreset(fn: (presetId: string) => void): () => void {
  PRESET_LISTENERS.add(fn);
  return () => {
    PRESET_LISTENERS.delete(fn);
  };
}
const CHARACTER_LISTENERS = new Set<(charId: string) => void>();
const ACTIVE_STAGE_SOURCES = new Map<string, DshStageSource>();
let currentStageSessionId: string | null = null;
const STAGE_SESSION_LISTENERS = new Set<(id: string | null) => void>();

export function getActiveStageSessionId(): string | null {
  return currentStageSessionId;
}

export function notifyActiveStageSessionId(id: string | null): void {
  if (currentStageSessionId === id) return;
  currentStageSessionId = id;
  for (const fn of STAGE_SESSION_LISTENERS) {
    fn(id);
  }
}

export function subscribeActiveStageSession(fn: (id: string | null) => void): () => void {
  STAGE_SESSION_LISTENERS.add(fn);
  return () => {
    STAGE_SESSION_LISTENERS.delete(fn);
  };
}

export function getActiveStageSource(sessionId: string): DshStageSource | undefined {
  return ACTIVE_STAGE_SOURCES.get(sessionId);
}

export function getStoredCharacterId(): string {
  try {
    const saved = window.localStorage.getItem(ACTIVE_CHAR_STORAGE_KEY);
    if (saved && (KNOWN_CHARACTER_IDS as readonly string[]).includes(saved)) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_CHARACTER_ID;
}

export function setStoredCharacterId(charId: string): void {
  try {
    window.localStorage.setItem(ACTIVE_CHAR_STORAGE_KEY, charId);
  } catch {
    // ignore storage errors
  }
  for (const listener of CHARACTER_LISTENERS) {
    listener(charId);
  }
}

export function subscribeStoredCharacterId(listener: (charId: string) => void): () => void {
  CHARACTER_LISTENERS.add(listener);
  return () => {
    CHARACTER_LISTENERS.delete(listener);
  };
}

function mapToolKind(name: string): ToolKind {
  const lower = name.toLowerCase();
  if (lower.includes('bash') || lower.includes('terminal') || lower.includes('pwsh') || lower.includes('cmd')) {
    return 'bash';
  }
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep') || lower.includes('glob')) {
    return 'search';
  }
  if (lower.includes('read') || lower.includes('view') || lower.includes('cat')) {
    return 'read';
  }
  if (lower.includes('write') || lower.includes('create') || lower.includes('save')) {
    return 'write';
  }
  if (lower.includes('edit') || lower.includes('replace') || lower.includes('patch') || lower.includes('str_replace')) {
    return 'edit';
  }
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('http') || lower.includes('browse')) {
    return 'web';
  }
  if (lower.includes('task') || lower.includes('subagent') || lower.includes('workflow') || lower.includes('agent')) {
    return 'task';
  }
  return 'other';
}

function parseArgsObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // ignore partial json
    }
  }
  return {};
}

function shortenPath(p: string, cwd: string): string {
  if (!p) return '';
  const cleanCwd = cwd.replace(/\/+$/, '');
  if (cleanCwd && p.startsWith(cleanCwd + '/')) {
    return p.slice(cleanCwd.length + 1);
  }
  return p;
}

function summarizeToolCall(rawName: string, args: Record<string, any>, cwd: string): { summary: string; file?: string } {
  const kind = mapToolKind(rawName);
  if (kind === 'bash') {
    const cmd = String(args.command ?? args.cmd ?? args.script ?? '').trim();
    return { summary: cmd ? cmd.slice(0, 96) : rawName };
  }
  const rawPath = String(args.path ?? args.file_path ?? args.file ?? args.target ?? '').trim();
  if (rawPath) {
    const shortFile = shortenPath(rawPath, cwd);
    return { summary: `${rawName} ${shortFile}`, file: shortFile };
  }
  const query = String(args.query ?? args.pattern ?? args.description ?? '').trim();
  if (query) {
    return { summary: `${rawName} "${query.slice(0, 60)}"` };
  }
  return { summary: rawName };
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, any>;
    if ((b.type === 'text' || b.kind === 'text') && typeof b.text === 'string') {
      parts.push(b.text);
    }
  }
  return parts.join('\n').trim();
}

function isHumanUserMessageEvent(rawEv: any, evData: Record<string, any>): boolean {
  if (rawEv?.surfaceOp && rawEv.surfaceOp !== 'append') return false;
  const source = evData?.source ?? evData?.message?.source;
  if (!source || typeof source !== 'object') return true;
  const kind = String((source as Record<string, any>).kind ?? '');
  if (!kind) return true;
  return kind === 'user' || kind === 'user-rpc';
}

interface PendingStageApproval {
  resolve: (outcome: { outcome: 'allowed-once' | 'rejected' | 'cancelled' }) => void;
  cleanup: () => void;
}

export class DshStageSource implements StageDataSource {
  public readonly mode = 'native' as const;
  private callbacks: StageDataSourceCallbacks | null = null;
  private disposers: Array<() => void> = [];
  private sessionListeners = new Set<(state: SessionListState) => void>();
  private processedDurableSeq = -1;
  private initialized = false;
  private activeCharacterId: string = getStoredCharacterId();
  private activeAgentPreset: string = getStoredAgentPreset();
  private reactionSeed = 0;
  private openTools = new Map<string, { tool: ToolKind; summary: string; file?: string }>();
  private pendingApprovals = new Map<string, PendingStageApproval>();
  private modelProviderMap = new Map<string, string>();
  private defaultModelSelection: { provider: string; model: string } | null = null;
  private catalogModels: string[] = [];
  private turnStartAt = 0;
  private liveStreamingText = '';
  private lastEmittedLiveLen = 0;
  private approvalSeq = 0;

  constructor(
    private readonly ctx: any,
    private readonly sessionId: string
  ) {}

  public bindCallbacks(callbacks: StageDataSourceCallbacks): void {
    this.callbacks = callbacks;
  }

  private emitMessage(msg: ServerMessage): void {
    this.callbacks?.onServerMessage(msg);
  }

  private emitConnection(status: ConnectionStatus): void {
    this.callbacks?.onConnectionChange(status);
  }

  private resolveCwd(): string {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const projCwd = binding?.session?.projections?.faceOf?.('workingDirectory')?.getSnapshot?.();
    if (typeof projCwd === 'string' && projCwd) return projCwd;
    const summaryCwd = this.ctx.sessions?.list?.getSnapshot?.()?.byId?.[this.sessionId]?.cwd;
    if (typeof summaryCwd === 'string' && summaryCwd) return summaryCwd;
    return String(this.ctx.remote?.$host?.home ?? '~');
  }

  private resolveAgentPreset(): string {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const projPreset = binding?.session?.projections?.faceOf?.('agentPreset')?.getSnapshot?.();
    if (typeof projPreset === 'string' && projPreset.trim()) {
      return projPreset.trim();
    }
    return this.activeAgentPreset || getStoredAgentPreset();
  }

  private resolveModelName(): string {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const modelSel = binding?.session?.projections?.faceOf?.('modelSelection')?.getSnapshot?.() as
      | Record<string, any>
      | string
      | undefined;
    if (typeof modelSel === 'string' && modelSel) return modelSel;
    if (modelSel && typeof modelSel === 'object') {
      const active = modelSel.next ?? modelSel.pending ?? modelSel.lastUsed ?? modelSel;
      const m = active?.model ?? active?.modelId ?? active?.id;
      if (typeof m === 'string' && m) return m;
    }
    if (this.defaultModelSelection?.model) {
      return this.defaultModelSelection.model;
    }
    return 'dsh/default';
  }

  private isSessionRunning(): boolean {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const snapRunning = binding?.session?.getSnapshot?.()?.running;
    if (typeof snapRunning === 'boolean') return snapRunning;
    const summary = this.ctx.sessions?.list?.getSnapshot?.()?.byId?.[this.sessionId];
    return Boolean(summary?.running);
  }

  private buildPublicSettings(): PublicSettings {
    const cwd = this.resolveCwd();
    const model = this.resolveModelName();
    return {
      version: 1,
      activeCharacterId: this.activeCharacterId,
      projectDir: cwd,
      recentProjects: [cwd],
      worker: {
        ...DEFAULT_SETTINGS.worker,
        adapter: 'dsh',
        model,
        agentPreset: this.resolveAgentPreset(),
        endpoint: {
          baseUrl: 'http://127.0.0.1:3425/v1',
          apiKeySet: true,
        },
      },
      characterBrains: Object.fromEntries(
        Object.entries(DEFAULT_SETTINGS.characterBrains).map(([cid, brain]) => [
          cid,
          {
            rolePrompt: brain.rolePrompt,
            ...(cid === this.activeCharacterId ? { model } : {}),
          },
        ])
      ),
      voice: {
        enabled: false,
        endpoint: {
          baseUrl: DEFAULT_SETTINGS.voice.endpoint.baseUrl,
          model: DEFAULT_SETTINGS.voice.endpoint.model,
          apiKeySet: false,
        },
        maxLinesPerMinute: DEFAULT_SETTINGS.voice.maxLinesPerMinute,
      },
      tts: {
        enabled: DEFAULT_SETTINGS.tts.enabled,
        provider: DEFAULT_SETTINGS.tts.provider,
        characterVoices: { ...DEFAULT_SETTINGS.tts.characterVoices },
        endpoint: {
          baseUrl: DEFAULT_SETTINGS.tts.endpoint.baseUrl,
          apiKeySet: false,
        },
        speakingRate: DEFAULT_SETTINGS.tts.speakingRate,
      },
      performance: { ...DEFAULT_SETTINGS.performance },
    };
  }

  private buildSessionInfo(): SessionInfo {
    return {
      sessionId: this.sessionId,
      adapter: 'dsh',
      model: this.resolveModelName(),
      cwd: this.resolveCwd(),
      turnActive: this.isSessionRunning(),
    };
  }

  private maybeCharacterReaction(ev: StageEvent): StageEvent | null {
    const pack = getCachedCharacterPack(this.activeCharacterId);
    const picked = pickReactionForEvent(pack, ev, this.reactionSeed++);
    if (!picked) return null;
    return {
      at: ev.at,
      type: 'character_line',
      characterId: this.activeCharacterId,
      emotion: picked.emotion,
      text: picked.text,
      source: 'preset',
      lineId: `line_${ev.at}_${this.reactionSeed}`,
    };
  }

  private emitStageEventWithReaction(stageEv: StageEvent): void {
    this.emitMessage({ type: 'event', event: stageEv });
    const line = this.maybeCharacterReaction(stageEv);
    if (line) {
      this.emitMessage({ type: 'event', event: line });
    }
  }

  public handleApprovalRequest(request: any): Promise<{ outcome: 'allowed-once' | 'rejected' | 'cancelled' }> {
    const reqId = `dsh_perm_${this.sessionId}_${++this.approvalSeq}`;
    const rawName = String(request?.toolName ?? 'tool');
    const tool = mapToolKind(rawName);
    const reason =
      typeof request?.reason === 'string' && request.reason.trim()
        ? request.reason.trim()
        : `工具 ${rawName} 请求执行权限`;
    const knownCall = request?.callId ? this.openTools.get(String(request.callId)) : undefined;
    const detail = knownCall?.summary ? `${knownCall.summary}\ncwd: ${this.resolveCwd()}` : `tool: ${rawName}\ncwd: ${this.resolveCwd()}`;

    return new Promise((resolve) => {
      const onAbort = () => {
        if (!this.pendingApprovals.has(reqId)) return;
        this.pendingApprovals.delete(reqId);
        this.emitMessage({
          type: 'event',
          event: {
            at: Date.now(),
            type: 'permission_resolved',
            requestId: reqId,
            allowed: false,
          },
        });
        resolve({ outcome: 'cancelled' });
      };
      if (request?.signal) {
        if (request.signal.aborted) {
          resolve({ outcome: 'cancelled' });
          return;
        }
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
      const cleanup = () => {
        if (request?.signal) {
          request.signal.removeEventListener('abort', onAbort);
        }
      };
      this.pendingApprovals.set(reqId, { resolve, cleanup });
      this.emitStageEventWithReaction({
        at: Date.now(),
        type: 'permission_request',
        requestId: reqId,
        tool,
        rawName,
        summary: reason,
        detail,
      });
    });
  }

  private async refreshModelCatalog(emitModels = false): Promise<void> {
    try {
      const res = await this.ctx.remote?.session?.modelCatalog?.();
      if (res?.ok && res.value) {
        const cat = res.value;
        if (cat.default?.provider && cat.default?.model) {
          this.defaultModelSelection = {
            provider: String(cat.default.provider),
            model: String(cat.default.model),
          };
        }
        const found: string[] = [];
        this.modelProviderMap.clear();
        if (Array.isArray(cat.groups)) {
          for (const g of cat.groups) {
            const provId = String(g?.id ?? '');
            if (!provId || !Array.isArray(g?.models)) continue;
            for (const m of g.models) {
              const modelId = String(m?.id ?? '');
              if (!modelId) continue;
              if (!this.modelProviderMap.has(modelId)) {
                this.modelProviderMap.set(modelId, provId);
                found.push(modelId);
              }
            }
          }
        }
        this.catalogModels = found;
        this.emitMessage({ type: 'session', session: this.buildSessionInfo() });
        this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
      }
    } catch {
      // ignore catalog errors
    }
    if (emitModels) {
      const list = this.catalogModels.length > 0 ? this.catalogModels : [this.resolveModelName()];
      this.emitMessage({
        type: 'models',
        target: 'worker',
        models: list,
      });
    }
  }

  private translateDurableEvent(rawEv: any, cwd: string): StageEvent[] {
    if (!rawEv || typeof rawEv !== 'object') return [];
    const type = String(rawEv.type ?? '');
    const data = (rawEv.data ?? {}) as Record<string, any>;
    const at = typeof rawEv.time === 'number' ? rawEv.time : Date.now();
    const out: StageEvent[] = [];

    const pushWithReaction = (stageEv: StageEvent, withReaction = true) => {
      out.push(stageEv);
      if (withReaction) {
        const line = this.maybeCharacterReaction(stageEv);
        if (line) out.push(line);
      }
    };

    if (type === 'user/message') {
      if (!isHumanUserMessageEvent(rawEv, data)) {
        return out;
      }
      const content = data.message?.content ?? data.content;
      const text = extractContentText(content);
      if (text) {
        pushWithReaction({
          at,
          type: 'user_message',
          id: String(data.message?.id ?? `u_${rawEv.seq ?? at}`),
          text,
        });
      }
      return out;
    }

    if (type === 'turn/start') {
      this.turnStartAt = at;
      this.liveStreamingText = '';
      this.lastEmittedLiveLen = 0;
      pushWithReaction({ at, type: 'thinking' });
      return out;
    }

    if (type === 'assistant/message') {
      this.liveStreamingText = '';
      this.lastEmittedLiveLen = 0;
      const content = data.message?.content ?? data.content ?? [];
      const text = extractContentText(content);
      if (text) {
        out.push({
          at,
          type: 'worker_text',
          text,
          final: true,
        });
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, any>;
          if (b.type === 'tool-call' || b.type === 'tool_use' || b.kind === 'tool-call') {
            const callId = String(b.id ?? b.callId ?? b.toolCallId ?? `tc_${at}`);
            if (!this.openTools.has(callId)) {
              const rawName = String(b.name ?? 'tool');
              const args = parseArgsObject(b.input ?? b.arguments ?? b.argsRaw);
              const { summary, file } = summarizeToolCall(rawName, args, cwd);
              const tool = mapToolKind(rawName);
              this.openTools.set(callId, { tool, summary, file });
              pushWithReaction({
                at,
                type: 'tool_start',
                toolUseId: callId,
                tool,
                rawName,
                summary,
                file,
              });
            }
          }
        }
      }
      if (data.usage && typeof data.usage === 'object') {
        const total = Number(
          data.usage.totalTokens ??
            (Number(data.usage.inputTokens ?? 0) + Number(data.usage.outputTokens ?? 0))
        );
        if (total > 0) {
          out.push({
            at,
            type: 'context_usage',
            usedTokens: total,
            maxTokens: 1000000,
          });
        }
      }
      return out;
    }

    if (type === 'tool/call') {
      const callId = String(data.callId ?? data.id ?? `tc_${rawEv.seq ?? at}`);
      if (!this.openTools.has(callId)) {
        const rawName = String(data.name ?? 'tool');
        const args = parseArgsObject(data.arguments ?? data.input ?? data.args);
        const { summary, file } = summarizeToolCall(rawName, args, cwd);
        const tool = mapToolKind(rawName);
        this.openTools.set(callId, { tool, summary, file });
        pushWithReaction({
          at,
          type: 'tool_start',
          toolUseId: callId,
          tool,
          rawName,
          summary,
          file,
        });
      }
      return out;
    }

    if (type === 'tool/result') {
      const callId = String(data.callId ?? data.message?.toolCallId ?? `tc_${rawEv.seq ?? at}`);
      const known = this.openTools.get(callId);
      this.openTools.delete(callId);
      const isError = Boolean(data.error || data.isError || data.message?.isError);
      const output =
        extractContentText(data.message?.content ?? data.content) ||
        (typeof data.meta === 'string' ? data.meta : '');
      const diff =
        typeof data.meta?.diff === 'string'
          ? data.meta.diff
          : typeof data.diff === 'string'
          ? data.diff
          : undefined;
      pushWithReaction({
        at,
        type: 'tool_end',
        toolUseId: callId,
        ok: !isError,
        summary: known?.summary,
        diff,
        output: output.slice(0, 4000),
      });
      return out;
    }

    if (type === 'compaction/summary') {
      const summaryText =
        typeof data.summary === 'string' && data.summary.trim()
          ? data.summary.trim().slice(0, 180)
          : 'DSH 已将较早对话凝炼为摘要卡！';
      const freed = Number(data.shadowedTokenCount ?? data.freedTokens ?? 80000);
      const turns = Number(data.shadowedItemCount ?? 8);
      out.push({
        at,
        type: 'context_compacted',
        turnsCompacted: turns,
        freedTokens: freed > 0 ? freed : 80000,
        summary: summaryText,
      });
      return out;
    }

    if (type === 'turn/end') {
      const reason = data.reason ?? {};
      const kind = typeof reason === 'string' ? reason : String(reason.kind ?? 'completed');
      const isError = kind === 'error';
      const isAborted = kind === 'aborted' || kind === 'interrupted' || kind === 'cancelled';
      const durationMs = this.turnStartAt > 0 ? Math.max(100, at - this.turnStartAt) : undefined;
      if (isAborted) {
        pushWithReaction({ at, type: 'interrupted', reason: '任务已停止' });
      } else if (isError) {
        const errMsg = String(reason?.error?.message ?? '本轮执行遇到错误');
        pushWithReaction({ at, type: 'error', message: errMsg });
      }
      pushWithReaction({
        at,
        type: 'turn_done',
        ok: !isError && !isAborted,
        summary: isError ? '执行异常' : isAborted ? '已中断' : '本轮完成',
        durationMs,
      });
      return out;
    }

    return out;
  }

  private buildFullHistoryFromWindow(entries: readonly any[]): StageEvent[] {
    this.openTools.clear();
    this.reactionSeed = 0;
    this.processedDurableSeq = -1;
    this.liveStreamingText = '';
    this.lastEmittedLiveLen = 0;
    const cwd = this.resolveCwd();
    const model = this.resolveModelName();

    const history: StageEvent[] = [];
    const startEv: StageEvent = {
      at: Date.now(),
      type: 'session_started',
      sessionId: this.sessionId,
      model,
      cwd,
    };
    history.push(startEv);
    const greet = this.maybeCharacterReaction(startEv);
    if (greet) history.push(greet);

    let streamingBuf = '';
    for (const item of entries) {
      if (!item) continue;
      if (item.type === 'event' && item.event) {
        const seq = typeof item.event.seq === 'number' ? item.event.seq : -1;
        if (seq > this.processedDurableSeq) {
          this.processedDurableSeq = seq;
        }
        if (item.event.type === 'assistant/message') {
          streamingBuf = '';
        }
        history.push(...this.translateDurableEvent(item.event, cwd));
      } else if (item.type === 'transient' && item.event?.type === 'assistant/live-chunk') {
        const chunk = item.event.data?.chunk;
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          streamingBuf += chunk.text;
        }
      }
    }

    if (streamingBuf.trim()) {
      this.liveStreamingText = streamingBuf;
      this.lastEmittedLiveLen = streamingBuf.length;
      history.push({
        at: Date.now(),
        type: 'worker_text',
        text: streamingBuf,
        final: false,
      });
    }

    return history;
  }

  private publishWelcome(entries: readonly any[]): void {
    const characters = KNOWN_CHARACTER_IDS.map((id) =>
      toCharacterSummary(getCachedCharacterPack(id))
    );
    const history = this.buildFullHistoryFromWindow(entries);
    this.emitMessage({
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      settings: this.buildPublicSettings(),
      characters,
      workerAdapters: [
        {
          id: 'dsh',
          name: 'DeepSeek Harness (Native)',
          available: true,
        },
      ],
      session: this.buildSessionInfo(),
      history,
    });
  }

  private handleWindowUpdate = (): void => {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const win = binding?.eventSource?.getSnapshot?.();
    if (!win) return;

    if (!this.initialized || win.change?.kind === 'replace' || win.change?.kind === 'prepend') {
      this.initialized = true;
      this.publishWelcome(win.entries ?? []);
      return;
    }

    const cwd = this.resolveCwd();
    const change = win.change;
    if (change?.kind === 'append' && Array.isArray(change.entries)) {
      for (const item of change.entries) {
        if (item.type === 'event' && item.event) {
          const seq = typeof item.event.seq === 'number' ? item.event.seq : -1;
          if (seq !== -1 && seq <= this.processedDurableSeq) continue;
          if (seq > this.processedDurableSeq) this.processedDurableSeq = seq;
          for (const ev of this.translateDurableEvent(item.event, cwd)) {
            this.emitMessage({ type: 'event', event: ev });
          }
        } else if (item.type === 'transient' && item.event?.type === 'assistant/live-chunk') {
          const chunk = item.event.data?.chunk;
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
            this.liveStreamingText += chunk.text;
            if (this.liveStreamingText.length - this.lastEmittedLiveLen >= 12) {
              this.lastEmittedLiveLen = this.liveStreamingText.length;
              this.emitMessage({
                type: 'event',
                event: {
                  at: Date.now(),
                  type: 'worker_text',
                  text: this.liveStreamingText,
                  final: false,
                },
              });
            }
          }
        }
      }
    } else if (change?.kind === 'settle-assistant' && change.entry?.event) {
      const ev = change.entry.event;
      const seq = typeof ev.seq === 'number' ? ev.seq : -1;
      if (seq === -1 || seq > this.processedDurableSeq) {
        if (seq > this.processedDurableSeq) this.processedDurableSeq = seq;
        for (const stageEv of this.translateDurableEvent(ev, cwd)) {
          this.emitMessage({ type: 'event', event: stageEv });
        }
      }
    }
  };

  public connect(): void {
    ACTIVE_STAGE_SOURCES.set(this.sessionId, this);
    notifyActiveStageSessionId(this.sessionId);

    this.emitConnection({
      state: 'connected',
      attempt: 0,
      hasEverConnected: true,
    });

    void this.refreshModelCatalog(false);

    void preloadCharacterPacks().then(() => {
      if (this.initialized) {
        const binding = this.ctx.sessions?.binding?.(this.sessionId);
        const entries = binding?.eventSource?.getSnapshot?.()?.entries ?? [];
        this.publishWelcome(entries);
      }
    });

    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    if (binding?.eventSource) {
      this.handleWindowUpdate();
      this.disposers.push(binding.eventSource.subscribe(this.handleWindowUpdate));
    } else {
      this.initialized = true;
      this.publishWelcome([]);
    }

    if (binding?.session?.subscribe) {
      this.disposers.push(
        binding.session.subscribe(() => {
          this.emitMessage({ type: 'session', session: this.buildSessionInfo() });
        })
      );
    }

    if (this.ctx.sessions?.list?.subscribe) {
      this.disposers.push(
        this.ctx.sessions.list.subscribe(() => {
          this.emitMessage({ type: 'session', session: this.buildSessionInfo() });
          this.publishSessionListToSubscribers();
        })
      );
    }

    const modelProj = binding?.session?.projections?.faceOf?.('modelSelection');
    if (modelProj?.subscribe) {
      this.disposers.push(
        modelProj.subscribe(() => {
          this.emitMessage({ type: 'session', session: this.buildSessionInfo() });
          this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
        })
      );
    }

    this.disposers.push(
      subscribeStoredAgentPreset((nextPreset) => {
        if (nextPreset !== this.activeAgentPreset) {
          this.activeAgentPreset = nextPreset;
          this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
        }
      })
    );

    this.disposers.push(
      subscribeStoredCharacterId((nextId) => {
        if (nextId !== this.activeCharacterId) {
          this.activeCharacterId = nextId;
          this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
        }
      })
    );
  }

  public retryNow(): void {
    this.handleWindowUpdate();
  }

  public dispose(): void {
    if (ACTIVE_STAGE_SOURCES.get(this.sessionId) === this) {
      ACTIVE_STAGE_SOURCES.delete(this.sessionId);
    }
    for (const [, pending] of this.pendingApprovals) {
      pending.cleanup();
      pending.resolve({ outcome: 'cancelled' });
    }
    this.pendingApprovals.clear();
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
    this.sessionListeners.clear();
  }

  public send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const session = binding?.session;
    if (!session) return;

    if (trimmed.startsWith('/')) {
      void session.command(trimmed);
      return;
    }

    const sub = session.beginSubmission?.({
      mode: 'queue',
      text: trimmed,
      attachments: [],
    });
    void session
      .prompt([{ type: 'text', text: trimmed }], 'queue', undefined, sub?.requestId)
      .then((res: any) => {
        if (res && res.ok === false) {
          sub?.abandon?.();
          const errText = String(res.error?.message ?? 'DSH 会话请求未通过，请检查模型设置');
          this.emitStageEventWithReaction({
            at: Date.now(),
            type: 'error',
            message: errText,
          });
        }
      })
      .catch((err: unknown) => {
        sub?.abandon?.();
        const errText = err instanceof Error ? err.message : '发送失败';
        this.emitStageEventWithReaction({
          at: Date.now(),
          type: 'error',
          message: errText,
        });
      });
  }

  public steer(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const session = binding?.session;
    if (!session) return;

    const sub = session.beginSubmission?.({
      mode: 'steer',
      text: trimmed,
      attachments: [],
    });
    this.emitMessage({
      type: 'event',
      event: {
        at: Date.now(),
        type: 'steer_queued',
        id: String(sub?.requestId ?? `steer_${Date.now()}`),
        text: trimmed,
      },
    });
    void session
      .prompt([{ type: 'text', text: trimmed }], 'steer', undefined, sub?.requestId)
      .then((res: any) => {
        if (res && res.ok === false) {
          sub?.abandon?.();
        }
      })
      .catch(() => {
        sub?.abandon?.();
      });
  }

  public stop(): void {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    void binding?.session?.cancel?.();
  }

  public decidePermission(requestId: string, allowed: boolean): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;
    this.pendingApprovals.delete(requestId);
    pending.cleanup();
    this.emitMessage({
      type: 'event',
      event: {
        at: Date.now(),
        type: 'permission_resolved',
        requestId,
        allowed,
      },
    });
    pending.resolve({ outcome: allowed ? 'allowed-once' : 'rejected' });
  }

  private buildSessionSummaries(): SessionSummary[] {
    const snap = this.ctx.sessions?.list?.getSnapshot?.();
    if (!snap?.ids || !snap?.byId) return [];
    const out: SessionSummary[] = [];
    for (const id of snap.ids) {
      const row = snap.byId[id];
      if (!row || row.blank) continue;
      out.push({
        sessionId: row.id,
        title: row.displayTitle || row.title || row.id,
        adapter: 'dsh',
        cwd: row.cwd,
        updatedAt: row.updatedAt,
        current: row.id === this.sessionId,
      });
    }
    return out;
  }

  private publishSessionListToSubscribers(): void {
    const sessions = this.buildSessionSummaries();
    const feedState: SessionListState = {
      sessions,
      loading: false,
      loaded: true,
    };
    for (const fn of this.sessionListeners) {
      fn(feedState);
    }
  }

  public listSessions(): void {
    const sessions = this.buildSessionSummaries();
    this.emitMessage({ type: 'sessions', sessions });
    this.publishSessionListToSubscribers();
  }

  public subscribeSessions = (listener: (state: SessionListState) => void): (() => void) => {
    this.sessionListeners.add(listener);
    listener({
      sessions: this.buildSessionSummaries(),
      loading: false,
      loaded: true,
    });
    return () => {
      this.sessionListeners.delete(listener);
    };
  };

  public newSession(): void {
    const agentPreset = getStoredAgentPreset();
    if (this.ctx.uiWorkspace?.startSession) {
      this.ctx.uiWorkspace.startSession(undefined, { agentPreset });
      return;
    }
    const cwd = this.resolveCwd();
    if (this.ctx.sessions?.create) {
      void this.ctx.sessions.create({ cwd }).then((newId: string) => {
        this.ctx.uiWorkspace?.openSession?.(newId);
      });
    }
  }

  public resumeSession(targetSessionId: string): void {
    this.ctx.uiWorkspace?.openSession?.(targetSessionId);
  }

  public switchCharacter(characterId: string): void {
    this.activeCharacterId = characterId;
    setStoredCharacterId(characterId);
    const pack = getCachedCharacterPack(characterId);
    const picked = pickReactionForEvent(
      pack,
      {
        at: Date.now(),
        type: 'session_started',
        sessionId: this.sessionId,
        model: this.resolveModelName(),
        cwd: this.resolveCwd(),
      },
      this.reactionSeed++
    );
    this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
    if (picked) {
      this.emitMessage({
        type: 'event',
        event: {
          at: Date.now(),
          type: 'character_line',
          characterId,
          emotion: 'happy',
          text: picked.text,
          source: 'preset',
          lineId: `switch_${Date.now()}_${this.reactionSeed}`,
        },
      });
    }
  }

  public updateSettings(patch: SettingsPatch): void {
    if (patch.activeCharacterId) {
      this.switchCharacter(patch.activeCharacterId);
    }
    const requestedPreset = patch.worker?.agentPreset;
    if (typeof requestedPreset === 'string' && requestedPreset.trim()) {
      const presetId = requestedPreset.trim();
      this.activeAgentPreset = presetId;
      setStoredAgentPreset(presetId);
      // Persist as DSH default for new sessions
      void this.ctx.remote?.settings
        ?.update?.('agent-preset-registry', { selectedDefault: presetId })
        ?.catch?.(() => {});
      // If current session is still blank, immediately switch its preset too
      const binding = this.ctx.sessions?.binding?.(this.sessionId);
      if (binding?.session?.getSnapshot?.()?.blank) {
        void this.ctx.remote?.agentPresets
          ?.select?.(this.sessionId, presetId)
          ?.then?.(() => {
            this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
          })
          ?.catch?.(() => {});
      }
      this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
    }
    const brainModel = patch.characterBrains
      ? Object.values(patch.characterBrains).find((b) => typeof b?.model === 'string' && b.model.trim())?.model
      : undefined;
    const requestedModel = patch.worker?.model ?? brainModel;
    if (typeof requestedModel === 'string' && requestedModel.trim()) {
      const model = requestedModel.trim();
      const provider =
        this.modelProviderMap.get(model) ??
        this.defaultModelSelection?.provider ??
        'magpie';
      if (this.ctx.remote?.session?.selectModel) {
        void this.ctx.remote.session
          .selectModel({
            sessionId: this.sessionId,
            provider,
            model,
          })
          .then(() => {
            this.emitMessage({ type: 'session', session: this.buildSessionInfo() });
            this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
          })
          .catch(() => {
            // ignore if model route is not yet configured in DSH
          });
      }
    }
  }

  public listModels(target: 'worker' | 'voice'): void {
    if (target === 'worker') {
      void this.refreshModelCatalog(true);
      return;
    }
    this.emitMessage({
      type: 'models',
      target,
      models: [DEFAULT_SETTINGS.voice.endpoint.model],
    });
  }

  public compactSession(): void {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    void binding?.session?.command?.('/compact');
  }

  public testConnection(target: 'worker' | 'voice' | 'tts'): void {
    this.emitMessage({
      type: 'connection_test',
      target,
      ok: true,
      message: 'DSH 原生会话引擎直连就绪',
      latencyMs: 1,
    });
  }
}
