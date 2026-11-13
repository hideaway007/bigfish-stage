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
  StageImageAttachment,
} from '../../../../src/stage/sources/types';

function buildPromptParts(text: string, images: readonly StageImageAttachment[] | undefined) {
  const parts: any[] = [{ type: 'text', text }];
  for (const img of images ?? []) {
    parts.push({ type: 'image', mediaType: img.mediaType, data: img.data, ...(img.name ? { name: img.name } : {}) });
  }
  return parts;
}

function echoAttachments(images: readonly StageImageAttachment[] | undefined) {
  return (images ?? []).map((img) => ({
    type: 'image' as const,
    value: { previewUrl: img.previewUrl, ...(img.name ? { name: img.name } : {}) },
  }));
}

type Room = { model?: string; sessionId?: string };
type Rooms = Record<string, Room>;

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
  return stripThinking(parts.join('\n'));
}

/** Remove model reasoning (<thinking>…</thinking>, incl. an unclosed trailing block while streaming). */
export function stripThinking(text: string): string {
  return text
    .replace(/<(thinking|think|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(thinking|think|reasoning)>[\s\S]*$/i, '')
    .trim();
}

function hasToolCallBlock(content: unknown): boolean {
  return Array.isArray(content) && content.some((b: any) =>
    b && typeof b === 'object' && (b.type === 'tool-call' || b.type === 'tool_use' || b.kind === 'tool-call'));
}

export interface ReasoningEffortOption { id: string; name: string }
const REASONING_LISTENERS = new Set<() => void>();
const reasoningByModel = new Map<string, { efforts: ReasoningEffortOption[]; defaultEffort?: string }>();
let currentReasoningEffort: string | null = null;

/** Live bridge for the stage UI: efforts the current model supports + selected effort. */
export const reasoningBridge = {
  efforts(model: string) { return reasoningByModel.get(model)?.efforts ?? []; },
  defaultEffort(model: string) { return reasoningByModel.get(model)?.defaultEffort; },
  current() { return currentReasoningEffort; },
  subscribe(fn: () => void) { REASONING_LISTENERS.add(fn); return () => { REASONING_LISTENERS.delete(fn); }; },
};
function notifyReasoning() { for (const fn of REASONING_LISTENERS) fn(); }

/**
 * 每个模型能接收哪些输入（与 DSH 原生「模型设置」里的 文本/图片 勾选同源：
 * 设置文档里 providers.<id>.models[].input）。宿主据此拒绝不支持图片的模型，
 * 舞台据此禁用上传。
 */
interface ModelInputLocation { ns: string; provider: string; field: 'input' | 'inputModalities'; revision: number; models: any[] }
const modelInputByModel = new Map<string, { input: string[] | undefined; loc: ModelInputLocation }>();
let modalityLoader: (() => Promise<void>) | null = null;
let modalityRemote: any = null;

async function loadModelModalities(): Promise<void> {
  const res = await modalityRemote?.settings?.describe?.();
  const desc = res?.ok === false ? undefined : (res?.value ?? res);
  if (!desc || !Array.isArray(desc.namespaces)) return;
  modelInputByModel.clear();
  for (const view of desc.namespaces) {
    const providers = view?.value?.providers;
    if (!providers || typeof providers !== 'object') continue;
    for (const [provider, prof] of Object.entries<any>(providers)) {
      const models = Array.isArray(prof?.models) ? prof.models : null;
      if (!models) continue;
      for (const m of models) {
        const id = typeof m?.id === 'string' ? m.id : '';
        if (!id || modelInputByModel.has(id)) continue;
        const field: 'input' | 'inputModalities' = Array.isArray(m.inputModalities) ? 'inputModalities' : 'input';
        const raw = m[field];
        modelInputByModel.set(id, {
          input: Array.isArray(raw) && raw.length > 0 ? raw.map(String) : Array.isArray(prof?.defaultInput) ? prof.defaultInput.map(String) : undefined,
          loc: { ns: String(view.ns), provider, field, revision: Number(view.revision), models },
        });
      }
    }
  }
  notifyReasoning();
}

/** Stage-facing bridge: 当前模型是否支持看图，以及在设置里切换它。 */
export const modalityBridge = {
  /** true / false；undefined = 该模型不在可编辑的模型配置里（按不支持处理）。 */
  supportsImages(model: string): boolean | undefined {
    const entry = modelInputByModel.get(model);
    if (!entry) return undefined;
    return (entry.input ?? ['text']).includes('image');
  },
  editable(model: string): boolean { return modelInputByModel.has(model); },
  async setSupportsImages(model: string, on: boolean): Promise<void> {
    const entry = modelInputByModel.get(model);
    if (!entry || !modalityRemote?.settings?.mutate) throw new Error('该模型不在可编辑的模型配置中');
    const { ns, provider, field, revision, models } = entry.loc;
    const next = models.map((m: any) => {
      if (m?.id !== model) return m;
      const cur: string[] = Array.isArray(m[field]) && m[field].length ? m[field] : ['text'];
      const set = new Set(cur.filter((x) => x !== 'image'));
      set.add('text');
      if (on) set.add('image');
      return { ...m, [field]: ['text', 'image'].filter((x) => set.has(x)) };
    });
    const res = await modalityRemote.settings.mutate(ns, [{ op: 'set', path: ['providers', provider, 'models'], value: next }], revision);
    if (res && res.ok === false) throw new Error(String(res.error?.message ?? '保存失败'));
    await loadModelModalities();
  },
  refresh(): Promise<void> { return modalityLoader ? modalityLoader() : Promise.resolve(); },
};

export interface DshProviderModelItem {
  id: string;
  name?: string;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
}

export interface DshProviderRow {
  route: string;
  displayName: string;
  api?: string;
  baseURL?: string;
  apiKeyEnv: string;
  keyConfigured: boolean;
  models: DshProviderModelItem[];
  isBuiltin: boolean;
}

export interface SaveDshProviderInput {
  route: string;
  displayName?: string;
  api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  baseURL?: string;
  apiKey?: string;
  models?: DshProviderModelItem[];
}

function deriveProviderKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

const BUILTIN_PI_AI_ROUTES = new Set(['openai', 'anthropic', 'google', 'openrouter', 'xai', 'groq', 'mistral']);

async function refreshAllActiveCatalogs(): Promise<void> {
  await loadModelModalities().catch(() => {});
  for (const src of ACTIVE_STAGE_SOURCES.values()) {
    await src.reloadCatalogAndBroadcast();
  }
}

export const providersBridge = {
  async listProviders(): Promise<DshProviderRow[]> {
    if (!modalityRemote?.settings?.describe) return [];
    const res = await modalityRemote.settings.describe();
    const desc = res?.ok === false ? undefined : (res?.value ?? res);
    if (!desc || !Array.isArray(desc.namespaces)) return [];
    const piView = desc.namespaces.find((n: any) => n?.ns === 'llm-pi-ai');
    const providersObj = piView?.value?.providers;
    if (!providersObj || typeof providersObj !== 'object') return [];

    const entries = Object.entries<any>(providersObj);
    const keyRefs = entries.map(([route, prof]) =>
      typeof prof?.apiKeyEnv === 'string' && prof.apiKeyEnv.trim()
        ? prof.apiKeyEnv.trim()
        : deriveProviderKeyRef(route)
    );

    const credMap: Record<string, any> = {};
    if (keyRefs.length > 0 && modalityRemote?.credentials?.describe) {
      try {
        const credRes = await modalityRemote.credentials.describe(Array.from(new Set(keyRefs)));
        if (credRes?.ok && credRes.value) {
          Object.assign(credMap, credRes.value);
        }
      } catch {
        // ignore credential describe errors
      }
    }

    return entries.map(([route, prof]) => {
      const apiKeyEnv =
        typeof prof?.apiKeyEnv === 'string' && prof.apiKeyEnv.trim()
          ? prof.apiKeyEnv.trim()
          : deriveProviderKeyRef(route);
      const rawModels = Array.isArray(prof?.models) ? prof.models : [];
      return {
        route,
        displayName:
          typeof prof?.displayName === 'string' && prof.displayName.trim()
            ? prof.displayName.trim()
            : route === 'openai'
            ? 'OpenAI (GPT)'
            : route === 'anthropic'
            ? 'Anthropic (Claude)'
            : route,
        api: typeof prof?.api === 'string' ? prof.api : undefined,
        baseURL: typeof prof?.baseURL === 'string' ? prof.baseURL : undefined,
        apiKeyEnv,
        keyConfigured: Boolean(credMap[apiKeyEnv]?.configured),
        models: rawModels
          .filter((m: any) => typeof m?.id === 'string' && m.id.trim())
          .map((m: any) => ({
            id: String(m.id).trim(),
            ...(typeof m.name === 'string' ? { name: m.name } : {}),
            ...(Array.isArray(m.input) ? { input: m.input.map(String) } : {}),
          })),
        isBuiltin: BUILTIN_PI_AI_ROUTES.has(route),
      };
    });
  },

  async saveProvider(input: SaveDshProviderInput): Promise<void> {
    if (!modalityRemote?.settings?.describe || !modalityRemote?.settings?.mutate) {
      throw new Error('DSH 设置接口尚未就绪');
    }
    const route = input.route.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (!route) throw new Error('请填写服务商代号（如 openai / anthropic / my-gateway）');

    const descRes = await modalityRemote.settings.describe();
    const desc = descRes?.ok === false ? undefined : (descRes?.value ?? descRes);
    const piView = desc?.namespaces?.find((n: any) => n?.ns === 'llm-pi-ai');
    if (!piView) throw new Error('未找到 DSH llm-pi-ai 模型配置命名空间');

    const existing = piView?.value?.providers?.[route] ?? {};
    const keyRef =
      typeof existing?.apiKeyEnv === 'string' && existing.apiKeyEnv.trim()
        ? existing.apiKeyEnv.trim()
        : deriveProviderKeyRef(route);

    const trimmedKey = (input.apiKey ?? '').trim();
    if (trimmedKey) {
      if (!modalityRemote?.credentials?.set) {
        throw new Error('DSH 密钥存储接口不可用');
      }
      const keyRes = await modalityRemote.credentials.set(keyRef, trimmedKey);
      if (keyRes && keyRes.ok === false) {
        throw new Error(String(keyRes.error?.message ?? '保存 API Key 失败'));
      }
    }

    const isBuiltin = BUILTIN_PI_AI_ROUTES.has(route);
    const cleanBase = (input.baseURL ?? '').trim();
    const cleanModels = (input.models ?? [])
      .map((m) => ({
        id: m.id.trim(),
        ...(m.name ? { name: m.name } : {}),
        input: Array.isArray(m.input) && m.input.length > 0 ? m.input : ['text', 'image'],
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
      }))
      .filter((m) => m.id.length > 0);

    if (!isBuiltin && !cleanBase) {
      throw new Error('自定义网关必须填写接口地址 (Base URL)');
    }
    if (!isBuiltin && cleanModels.length === 0) {
      throw new Error('自定义网关请至少填写或自动探测 1 个模型 ID');
    }

    const profile: Record<string, any> = {
      apiKeyEnv: keyRef,
    };
    if (!isBuiltin && input.displayName?.trim()) {
      profile.displayName = input.displayName.trim();
    }
    if (!isBuiltin) {
      profile.api = input.api || 'openai-completions';
    } else if (input.api && !isBuiltin) {
      profile.api = input.api;
    }
    if (cleanBase) {
      profile.baseURL = cleanBase;
    }
    if (cleanModels.length > 0) {
      profile.models = cleanModels;
    }

    const mutRes = await modalityRemote.settings.mutate(
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', route], value: profile }],
      Number(piView.revision ?? 0)
    );
    if (mutRes && mutRes.ok === false) {
      throw new Error(String(mutRes.error?.message ?? '写入模型服务商配置失败'));
    }

    await refreshAllActiveCatalogs();
  },

  async removeProvider(route: string): Promise<void> {
    if (!modalityRemote?.settings?.describe || !modalityRemote?.settings?.mutate) {
      throw new Error('DSH 设置接口尚未就绪');
    }
    const descRes = await modalityRemote.settings.describe();
    const desc = descRes?.ok === false ? undefined : (descRes?.value ?? descRes);
    const piView = desc?.namespaces?.find((n: any) => n?.ns === 'llm-pi-ai');
    if (!piView) return;

    const mutRes = await modalityRemote.settings.mutate(
      'llm-pi-ai',
      [{ op: 'unset', path: ['providers', route] }],
      Number(piView.revision ?? 0)
    );
    if (mutRes && mutRes.ok === false) {
      throw new Error(String(mutRes.error?.message ?? '移除服务商失败'));
    }
    await refreshAllActiveCatalogs();
  },

  async discoverModels(probe: {
    provider?: string;
    baseURL?: string;
    api?: string;
    apiKey?: string;
  }): Promise<DshProviderModelItem[]> {
    if (!modalityRemote?.llm?.discoverModels) {
      throw new Error('当前运行时不支持自动探测模型，请手动填写模型 ID');
    }
    const req: Record<string, any> = {};
    if (probe.provider?.trim()) req.provider = probe.provider.trim();
    if (probe.baseURL?.trim()) req.baseURL = probe.baseURL.trim();
    if (probe.api?.trim()) req.api = probe.api.trim();
    if (probe.apiKey?.trim()) req.apiKey = probe.apiKey.trim();

    const res = await modalityRemote.llm.discoverModels('llm-pi-ai', req);
    if (res && res.ok === false) {
      throw new Error(String(res.error?.message ?? '无法从该接口拉取模型列表'));
    }
    const list = Array.isArray(res?.value) ? res.value : [];
    return list
      .filter((m: any) => typeof m?.id === 'string' && m.id.trim())
      .map((m: any) => ({
        id: String(m.id).trim(),
        ...(typeof m.name === 'string' ? { name: m.name } : {}),
        ...(Array.isArray(m.inputModalities)
          ? { input: m.inputModalities.map(String) }
          : { input: ['text', 'image'] }),
      }));
  },
};

const PERSONA_TAG_RE = /<stage-persona>[\s\S]*?<\/stage-persona>\s*/g;

const PERSONA_STYLE: Record<string, { self: string; call: string; tone: string }> = {
  'deepseek-v4-pro': { self: '本鱼', call: '店长', tone: '元气活泼、爱用「咕噜」等鱼系语气词，干活冲劲十足' },
  'gemini-4-argon': { self: '本喵', call: '主人', tone: '傲娇猫娘口吻，句尾偶尔带「喵」，对界面美感非常挑剔' },
  'claude-opus-5-5': { self: '我', call: '老师', tone: '知性温柔的文学少女，措辞优雅、条理分明' },
  'codex-dragon': { self: '我', call: '搭档', tone: '清冷高洁的白龙娘，从容自信、简洁可靠，偶尔带一丝神秘微笑' },
};

/** Hidden persona preamble so the worker answers as the active character, never as a generic "AI 助手". */
export function buildPersonaPreamble(characterId: string): string {
  const pack = getCachedCharacterPack(characterId);
  const name = pack.name.split('（')[0];
  const style = PERSONA_STYLE[characterId] ?? { self: '我', call: '搭档', tone: '保持角色口吻' };
  const role = DEFAULT_SETTINGS.characterBrains?.[characterId]?.rolePrompt ?? '';
  return `<stage-persona>你现在是「${name}」。${role}自称「${style.self}」，称呼用户为「${style.call}」；语气：${style.tone}。全程用简体中文、以该角色身份回复，自我介绍时只说自己是「${name}」，不要提及任何模型名、厂商或版本号（如 DeepSeek、V4 Pro、GPT、Claude），绝不自称"AI 助手"或"编程助手"；角色口吻只体现在措辞上，技术内容必须准确完整，不编造执行结果。用户没有问起时，不要主动提及工作目录、文件路径、当前环境或自身状态，直接回应用户的话。此段为舞台设定，无需复述。</stage-persona>\n\n`;
}

export function stripPersona(text: string): string {
  return text.replace(PERSONA_TAG_RE, '').trim();
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
  private replyShownInTurn = false;
  private openTools = new Map<string, { tool: ToolKind; summary: string; file?: string }>();
  private pendingApprovals = new Map<string, PendingStageApproval>();
  private modelProviderMap = new Map<string, string>();
  private defaultModelSelection: { provider: string; model: string } | null = null;
  private catalogModels: string[] = [];
  private turnStartAt = 0;
  private liveStreamingText = '';
  private lastEmittedLiveLen = 0;
  private approvalSeq = 0;
  private rooms: Rooms = {};
  private roomsReady: Promise<void> | null = null;
  private changingRoom = false;
  private pendingSteers = new Set<string>();

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

  private syncReasoningFromProjection(): void {
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const sel = binding?.session?.projections?.faceOf?.('modelSelection')?.getSnapshot?.() as any;
    const active = sel?.next ?? sel?.pending ?? sel?.lastUsed;
    const eff = typeof active?.reasoningEffort === 'string' ? active.reasoningEffort : null;
    const model = this.resolveModelName();
    const next = eff ?? reasoningBridge.defaultEffort(model) ?? null;
    if (next !== currentReasoningEffort) { currentReasoningEffort = next; notifyReasoning(); }
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
          baseUrl: 'https://api.deepseek.com/v1',
          apiKeySet: true,
        },
      },
      characterBrains: Object.fromEntries(
        Object.entries(DEFAULT_SETTINGS.characterBrains).map(([cid, brain]) => [cid, {
          rolePrompt: brain.rolePrompt,
          ...(this.rooms[cid]?.model ? { model: this.rooms[cid].model } : cid === this.activeCharacterId ? { model } : {}),
          activeSessionId: this.rooms[cid]?.sessionId ?? null,
        }])
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
      characterId: this.activeCharacterId,
    };
  }

  private maybeCharacterReaction(ev: StageEvent): StageEvent | null {
    if (this.replyShownInTurn && ev.type !== 'error' && ev.type !== 'interrupted') return null;
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
    if (!modalityRemote && this.ctx.remote) {
      modalityRemote = this.ctx.remote;
      modalityLoader = loadModelModalities;
      try {
        const off = this.ctx.remote.$on?.('settings/document-updated', () => { void loadModelModalities().catch(() => {}); });
        if (typeof off === 'function') this.disposers.push(() => { off(); modalityRemote = null; modalityLoader = null; });
      } catch {
        // ignore
      }
    }
    void loadModelModalities().catch(() => {});
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
              if (Array.isArray(m?.reasoning?.efforts) && m.reasoning.efforts.length > 0) {
                reasoningByModel.set(modelId, {
                  efforts: m.reasoning.efforts.map((e: any) => ({ id: String(e.id), name: String(e.name ?? e.id) })),
                  defaultEffort: m.reasoning.defaultEffort,
                });
              }
              if (!this.modelProviderMap.has(modelId)) {
                this.modelProviderMap.set(modelId, provId);
                found.push(modelId);
              }
            }
          }
        }
        this.catalogModels = found;
        this.syncReasoningFromProjection();
        notifyReasoning();
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
      const requestId = data.source?.rpcId ?? data.message?.source?.rpcId;
      if (typeof requestId === 'string' && this.pendingSteers.delete(requestId)) out.push({ type: 'steer_acked', id: requestId, at });
      const content = data.message?.content ?? data.content;
      const text = stripPersona(extractContentText(content));
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
      this.replyShownInTurn = false;
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
      // Keep tool-attached narration in durable history; only final replies drive the main dialogue.
      if (text) {
        const final = !hasToolCallBlock(content);
        if (final) this.replyShownInTurn = true;
        out.push({
          at,
          type: 'worker_text',
          text,
          final,
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
      const freed = Number(data.shadowedTokenCount ?? data.freedTokens ?? 0);
      const turns = Number(data.shadowedItemCount ?? 0);
      out.push({
        at,
        type: 'context_compacted',
        turnsCompacted: turns,
        freedTokens: Number.isFinite(freed) && freed > 0 ? freed : 0,
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

    if (false) {
      this.liveStreamingText = streamingBuf;
      this.lastEmittedLiveLen = streamingBuf.length;
      history.push({
        at: Date.now(),
        type: 'worker_text',
        text: stripThinking(streamingBuf),
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
            if (false) {
              this.lastEmittedLiveLen = this.liveStreamingText.length;
              this.emitMessage({
                type: 'event',
                event: {
                  at: Date.now(),
                  type: 'worker_text',
                  text: stripThinking(this.liveStreamingText),
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

    void this.ensureRooms().catch(error => this.reportError(error, 'update_settings'));
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
          this.syncReasoningFromProjection();
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

  public send(text: string, images?: readonly StageImageAttachment[]): void {
    if (this.changingRoom) { this.reportError(new Error('角色正在切换，请稍后发送'), 'send'); return; }
    const hasImages = !!images && images.length > 0;
    const trimmed = text.trim() || (hasImages ? '请看这张图。' : '');
    if (!trimmed) return;
    const binding = this.ctx.sessions?.binding?.(this.sessionId);
    const session = binding?.session;
    if (!session) return;

    if (!hasImages && trimmed.startsWith('/')) {
      void session.command(trimmed);
      return;
    }

    const sub = session.beginSubmission?.({
      mode: 'queue',
      text: trimmed,
      attachments: echoAttachments(images),
    });
    void session
      .prompt(buildPromptParts(buildPersonaPreamble(this.activeCharacterId) + trimmed, images), 'queue', undefined, sub?.requestId)
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

  public steer(text: string, images?: readonly StageImageAttachment[]): void {
    const trimmed = text.trim() || (images?.length ? '请看这张图。' : '');
    if (!trimmed) return;
    const session = this.ctx.sessions?.binding?.(this.sessionId)?.session;
    if (!session) { this.reportError(new Error('尚未建立会话'), 'steer'); return; }
    const sub = session.beginSubmission?.({ mode: 'steer', text: trimmed, attachments: echoAttachments(images) });
    const id = String(sub?.requestId ?? crypto.randomUUID());
    this.pendingSteers.add(id);
    this.emitMessage({ type: 'event', event: { at: Date.now(), type: 'steer_queued', id, text: trimmed } });
    void session.prompt(buildPromptParts(buildPersonaPreamble(this.activeCharacterId) + trimmed, images), 'steer', undefined, id)
      .then((res: any) => {
        this.unwrap(res);
        if (this.pendingSteers.has(id)) this.emitMessage({ type: 'event', event: { at: Date.now(), type: 'steer_submitted', id } });
      }).catch((error: unknown) => {
        sub?.abandon?.();
        this.pendingSteers.delete(id);
        this.emitMessage({ type: 'event', event: { at: Date.now(), type: 'steer_failed', id, message: error instanceof Error ? error.message : '插话提交失败，请重试' } });
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
      status: 'ready',
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
      status: 'ready',
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

  public async reloadCatalogAndBroadcast(): Promise<void> {
    await this.refreshModelCatalog(true);
  }

  private unwrap(value: any): any {
    if (value?.ok === false) throw new Error(String(value.error?.message ?? 'DSH 拒绝了请求'));
    return value?.value ?? value;
  }

  private reportError(error: unknown, commandType: 'send' | 'steer' | 'switch_character' | 'baton_pass' | 'update_settings' | 'compact_session') {
    this.emitMessage({ type: 'command_error', commandType, message: error instanceof Error ? error.message : '操作失败' });
  }

  private async stageRequest(input: Record<string, unknown>): Promise<any> {
    const res = await fetch('/api/bigfish-stage', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, cwd: this.resolveCwd() }) });
    if (!res.ok) throw new Error(res.status === 404 ? '请升级 DeepSeek Harness 并重新启用舞台插件，以使用角色房间和代码变更功能' : `舞台操作失败 (${res.status})`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  private ensureRooms(): Promise<void> {
    if (!this.roomsReady) this.roomsReady = (async () => {
      this.rooms = await this.stageRequest({ op: 'rooms_get' });
      const owner = Object.entries(this.rooms).find(([, room]) => room.sessionId === this.sessionId)?.[0];
      if (owner) this.activeCharacterId = owner;
      else if (!this.rooms[this.activeCharacterId]?.sessionId) {
        this.rooms = await this.stageRequest({ op: 'rooms_patch', characterId: this.activeCharacterId, sessionId: this.sessionId, ...(this.resolveModelName() !== 'dsh/default' ? { model: this.resolveModelName() } : {}) });
      }
      this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
      this.emitMessage({ type: 'session', session: this.buildSessionInfo() });
    })().catch(error => { this.roomsReady = null; throw error; });
    return this.roomsReady;
  }

  public switchCharacter(characterId: string): void { void this.changeRoom(characterId); }

  public batonPass(toCharacterId: string, instruction?: string): void {
    const entries = this.ctx.sessions?.binding?.(this.sessionId)?.eventSource?.getSnapshot?.()?.entries ?? [];
    const context: string[] = [];
    for (const item of entries) {
      const ev = item?.event;
      if (ev?.type === 'user/message' || ev?.type === 'assistant/message') {
        const text = stripPersona(extractContentText(ev.data?.message?.content ?? ev.data?.content));
        if (text) context.push(`${ev.type === 'user/message' ? '用户' : '上一位角色'}：${text.slice(0, 2500)}`);
      } else if (ev?.type === 'tool/call') {
        const d = ev.data ?? {};
        const info = summarizeToolCall(String(d.toolName ?? d.name ?? 'tool'), parseArgsObject(d.args ?? d.input ?? d.arguments), this.resolveCwd());
        if (info.file) context.push(`操作文件：${info.file}`);
      }
    }
    const handoff = `【角色换手交接】上一位：${getCachedCharacterPack(this.activeCharacterId).name}\n${context.slice(-12).join('\n')}\n本轮任务：${instruction?.trim() || '复核已有改动和结论，继续完成任务。'}`;
    void this.changeRoom(toCharacterId, handoff);
  }

  private async changeRoom(characterId: string, handoff?: string): Promise<void> {
    const command = handoff ? 'baton_pass' : 'switch_character';
    if (this.changingRoom || this.isSessionRunning()) { this.reportError(new Error('请等待本轮完成或先喊停，再切换角色'), command); return; }
    if (!(KNOWN_CHARACTER_IDS as readonly string[]).includes(characterId)) { this.reportError(new Error('角色不存在'), command); return; }
    if (characterId === this.activeCharacterId) return;
    this.changingRoom = true;
    try {
      await this.ensureRooms();
      await this.refreshModelCatalog(false);
      if (this.isSessionRunning()) throw new Error('任务已开始，请先喊停');
      if (!this.ctx.uiWorkspace?.openSession) throw new Error('DSH 会话导航暂不可用');
      this.rooms = await this.stageRequest({ op: 'rooms_patch', characterId: this.activeCharacterId, sessionId: this.sessionId, model: this.resolveModelName() });
      const room = this.rooms[characterId];
      const model = room?.model || getCachedCharacterPack(characterId).recommendedModels?.find(m => this.catalogModels.includes(m)) || this.defaultModelSelection?.model || this.resolveModelName();
      let target = room?.sessionId;
      if (!target) {
        if (!this.ctx.remote?.session?.create) throw new Error('DSH 不支持创建独立角色会话，请升级');
        target = this.unwrap(await this.ctx.remote.session.create({ cwd: this.resolveCwd(), agentPreset: this.resolveAgentPreset() }))?.sessionId;
        if (!target) throw new Error('未能创建角色会话');
      }
      if (this.ctx.sessions?.binding?.(target)?.session?.getSnapshot?.()?.running || this.ctx.sessions?.list?.getSnapshot?.()?.byId?.[target]?.running) throw new Error('目标角色正在执行另一项任务');
      await this.selectModelAndEffort(model, undefined, target);
      this.rooms = await this.stageRequest({ op: 'rooms_patch', characterId, sessionId: target, model });
      if (handoff) {
        if (!this.ctx.remote?.session?.prompt) throw new Error('DSH 接力发送接口不可用');
        this.unwrap(await this.ctx.remote.session.prompt({ sessionId: target, requestId: crypto.randomUUID(), mode: 'queue', content: buildPromptParts(buildPersonaPreamble(characterId) + handoff, undefined) }));
      }
      const fromCharacterId = this.activeCharacterId;
      setStoredCharacterId(characterId);
      if (handoff) this.emitMessage({ type: 'event', event: { at: Date.now(), type: 'baton_pass', fromCharacterId, toCharacterId: characterId, summary: '已切换到目标角色的模型和会话并提交交接任务' } });
      this.ctx.uiWorkspace.openSession(target);
    } catch (error) { this.reportError(error, command); }
    finally { this.changingRoom = false; }
  }

  public requestGitStatus(): void {
    void this.stageRequest({ op: 'git_status' }).then(data => this.emitMessage({ type: 'git_status_result', ...data }))
      .catch(error => this.emitMessage({ type: 'git_status_result', isRepo: false, files: [], diff: '', error: error.message }));
  }
  public revertGitFile(path: string): void { this.gitOperation('revert', { op: 'git_revert', path }); }
  public commitGit(message: string): void { this.gitOperation('commit', { op: 'git_commit', message }); }
  private gitOperation(op: 'revert' | 'commit', input: Record<string, unknown>) {
    if (this.isSessionRunning() || this.changingRoom) { this.emitMessage({ type: 'git_op_result', op, ok: false, message: '请先等待当前任务完成，避免同时修改文件' }); return; }
    void this.stageRequest(input).then(data => { this.emitMessage({ type: 'git_op_result', op, ...data }); this.requestGitStatus(); })
      .catch(error => this.emitMessage({ type: 'git_op_result', op, ok: false, message: error.message }));
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
    void this.updateModelSettings(patch).catch(error => this.reportError(error, 'update_settings'));
  }

  private async updateModelSettings(patch: SettingsPatch): Promise<void> {
    if (!patch.characterBrains && !patch.worker?.model && !patch.worker?.reasoningEffort) return;
    if (this.changingRoom || this.isSessionRunning()) throw new Error('请等待本轮完成后再修改模型');
    this.changingRoom = true;
    try {
      await this.ensureRooms();
      if (this.isSessionRunning()) throw new Error('任务已开始，请先喊停');
      for (const [characterId, brain] of Object.entries(patch.characterBrains ?? {})) {
        if (!brain?.model?.trim()) continue;
        if (characterId === this.activeCharacterId) await this.selectModelAndEffort(brain.model.trim());
        this.rooms = await this.stageRequest({ op: 'rooms_patch', characterId, model: brain.model.trim() });
      }
      if (patch.worker?.model || patch.worker?.reasoningEffort) {
        const model = patch.worker.model?.trim() || this.resolveModelName();
        await this.selectModelAndEffort(model, patch.worker.reasoningEffort);
        this.rooms = await this.stageRequest({ op: 'rooms_patch', characterId: this.activeCharacterId, model });
      }
      this.emitMessage({ type: 'settings', settings: this.buildPublicSettings() });
      this.emitMessage({ type: 'session', session: this.buildSessionInfo() });
    } finally { this.changingRoom = false; }
  }

  private async selectModelAndEffort(model: string, effort?: string, sessionId = this.sessionId): Promise<void> {
    const provider = this.modelProviderMap.get(model) ?? this.defaultModelSelection?.provider ?? 'deepseek-account';
    if (!this.ctx.remote?.session?.selectModel) throw new Error('DSH 模型切换接口不可用');
    this.unwrap(await this.ctx.remote.session.selectModel({ sessionId, provider, model, ...(effort ? { reasoningEffort: effort } : {}) }));
    if (effort && sessionId === this.sessionId) { currentReasoningEffort = effort; notifyReasoning(); }
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
    if (this.changingRoom || this.isSessionRunning()) { this.reportError(new Error('请等待当前任务完成后再整理记忆'), 'compact_session'); return; }
    if (!binding?.session?.command) { this.reportError(new Error('当前会话不支持整理记忆'), 'compact_session'); return; }
    void Promise.resolve(binding.session.command('/compact')).then(value => this.unwrap(value)).catch(error => this.reportError(error, 'compact_session'));
  }

  public testConnection(target: 'worker' | 'voice'): void {
    this.emitMessage({
      type: 'connection_test',
      target,
      ok: true,
      message: 'DSH 原生会话引擎直连就绪',
      latencyMs: 1,
    });
  }
}
