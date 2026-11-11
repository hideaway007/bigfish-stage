/**
 * 设置项格式（Phase 2 契约：单平台 DeepSeek / DSH 底座 + 每角色独立大脑 + Google Cloud TTS）
 *
 * 服务端把设置存在用户本机：~/.config/bigfish-stage/settings.json（权限 600），绝不写进仓库。
 * 发给 UI 的是 PublicSettings：所有 apiKey 都被替换成 apiKeySet: boolean。
 */

/** 任意 OpenAI / DeepSeek 兼容接口的连接信息 */
export interface ProviderEndpoint {
  /** 例如 https://api.deepseek.com/v1 或本机网关 http://127.0.0.1:3425/v1 */
  baseUrl: string;
  apiKey?: string;
}

export type ModelEndpoint = ProviderEndpoint & { model: string };

export interface WorkerSettings {
  /** 执行 Agent 适配器 ID：默认 'dsh'（DeepSeek Harness），轻量直连 'direct-chat' */
  adapter: string;
  /** 默认模型（各角色可在 characterBrains 中单独覆盖自己的模型） */
  model: string;
  /** 自定义 OpenAI/DeepSeek 兼容接口，或沿用本机 DSH 默认配置 */
  connection: 'endpoint' | 'agent-default';
  endpoint: ProviderEndpoint;
  sandbox: 'read-only' | 'workspace-write';
  /** 适配器专属的额外选项 */
  extra?: Record<string, string>;
}

/** 单个角色的独立大脑与独立会话槽配置（围绕统一 DeepSeek / DSH 底座） */
export interface CharacterBrainSettings {
  /** 角色独立使用的模型名（留空则沿用全局 worker.model） */
  model?: string;
  /** 是否使用该角色单独的 API Endpoint（默认 false，直接复用全局 DeepSeek API Key） */
  useCustomEndpoint?: boolean;
  endpoint?: ProviderEndpoint;
  /** 该角色当前驻留的独立会话 ID（切换角色自动切回她自己的会话房间，互不串脑子） */
  activeSessionId?: string | null;
  /** 该角色额外的职责/人格指令补充 */
  rolePrompt?: string;
}

export interface VoiceSettings {
  /** 关掉则只用角色包里的预置台词 */
  enabled: boolean;
  endpoint: ModelEndpoint;
  /** 每分钟最多生成几句模型台词（限流防刷屏） */
  maxLinesPerMinute: number;
}

/** 角色实时语音合成（TTS）设置，默认支持本机 Google Cloud Chirp3-HD 中文女声 */
export interface TtsSettings {
  /** 是否开启角色台词实时语音播报 */
  enabled: boolean;
  provider: 'google-cloud' | 'openai-tts';
  /** 各角色对应的声线名称（如 cmn-CN-Chirp3-HD-Leda） */
  characterVoices: Record<string, string>;
  /** 可选：Google Cloud API Key 或 OpenAI TTS Endpoint Key；留空时自动探测本机 gcloud ADC */
  endpoint: ProviderEndpoint;
  /** 可选：Google Cloud Quota Project ID（仅存本机 settings.json，绝不入库） */
  gcpProject?: string;
  /** 语速倍率 0.7 ~ 1.4，默认 1.04 */
  speakingRate: number;
}

export interface PerformanceSettings {
  /** 打字机速度：每秒字符数 */
  typingCharsPerSec: number;
}

export interface AppSettings {
  version: 1;
  activeCharacterId: string;
  /** 执行 Agent 的工作目录；null = 尚未选择 */
  projectDir: string | null;
  recentProjects: string[];
  worker: WorkerSettings;
  /** 每个角色的独立大脑与独立会话绑定 */
  characterBrains: Record<string, CharacterBrainSettings>;
  voice: VoiceSettings;
  tts: TtsSettings;
  performance: PerformanceSettings;
}

type Publicize<T> = T extends ProviderEndpoint
  ? Omit<T, 'apiKey'> & { apiKeySet: boolean }
  : T extends Record<string, CharacterBrainSettings>
    ? Record<string, PublicizeCharacterBrain>
    : T extends object
      ? { [K in keyof T]: Publicize<T[K]> }
      : T;

export interface PublicizeCharacterBrain {
  model?: string;
  useCustomEndpoint?: boolean;
  endpoint?: Omit<ProviderEndpoint, 'apiKey'> & { apiKeySet: boolean };
  activeSessionId?: string | null;
  rolePrompt?: string;
}

export type PublicSettings = Publicize<AppSettings>;

/** UI 发来的局部修改。apiKey: '' 表示清除，undefined 表示不改 */
export type SettingsPatch = {
  version?: 1;
  activeCharacterId?: string;
  projectDir?: string | null;
  recentProjects?: string[];
  worker?: Partial<Omit<WorkerSettings, 'endpoint'>> & {
    endpoint?: Partial<ProviderEndpoint>;
  };
  characterBrains?: Record<
    string,
    Partial<Omit<CharacterBrainSettings, 'endpoint'>> & {
      endpoint?: Partial<ProviderEndpoint>;
    }
  >;
  voice?: Partial<Omit<VoiceSettings, 'endpoint'>> & {
    endpoint?: Partial<ModelEndpoint>;
  };
  tts?: Partial<Omit<TtsSettings, 'endpoint' | 'characterVoices'>> & {
    endpoint?: Partial<ProviderEndpoint>;
    characterVoices?: Record<string, string>;
  };
  performance?: Partial<PerformanceSettings>;
};

export const DEFAULT_CHARACTER_VOICES: Record<string, string> = {
  'deepseek-v4-pro': 'cmn-CN-Chirp3-HD-Leda',
  'gemini-4-argon': 'cmn-CN-Chirp3-HD-Aoede',
  'claude-opus-5-5': 'cmn-CN-Chirp3-HD-Achernar',
  'codex-dragon': 'cmn-CN-Chirp3-HD-Zephyr',
};

export const DEFAULT_CHARACTER_BRAINS: Record<string, CharacterBrainSettings> = {
  'deepseek-v4-pro': {
    model: 'deepseek-chat',
    rolePrompt: '你是主舞台看板娘大肥鱼，擅长全栈快速落地与长任务冲锋。',
  },
  'gemini-4-argon': {
    model: 'deepseek-chat',
    rolePrompt: '你是焊工猫娘哈基米，专精前端界面美学、动效焊接与视觉精修。',
  },
  'claude-opus-5-5': {
    model: 'deepseek-reasoner',
    rolePrompt: '你是知性文学少女 Claude 娘，擅长复杂架构推演、重构设计与长文梳理。',
  },
  'codex-dragon': {
    model: 'deepseek-reasoner',
    rolePrompt: '你是困倦白龙娘 Codex，擅长深水区 Bug 定位、边界条件排查与严苛代码审查。',
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  activeCharacterId: 'deepseek-v4-pro',
  projectDir: null,
  recentProjects: [],
  worker: {
    adapter: 'dsh',
    model: 'deepseek-chat',
    sandbox: 'workspace-write',
    connection: 'endpoint',
    endpoint: { baseUrl: 'https://api.deepseek.com/v1' },
  },
  characterBrains: DEFAULT_CHARACTER_BRAINS,
  voice: {
    enabled: true,
    endpoint: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    maxLinesPerMinute: 6,
  },
  tts: {
    enabled: true,
    provider: 'google-cloud',
    characterVoices: { ...DEFAULT_CHARACTER_VOICES },
    endpoint: { baseUrl: 'https://texttospeech.googleapis.com' },
    speakingRate: 1.04,
  },
  performance: { typingCharsPerSec: 40 },
};

/** 执行 Agent 适配器的描述（服务端在 welcome 里下发，UI 据此渲染下拉框） */
export interface WorkerAdapterInfo {
  id: string;
  name: string;
  /** 本机是否可用（如 dsh 命令是否存在），不可用时附原因 */
  available: boolean;
  unavailableReason?: string;
}
