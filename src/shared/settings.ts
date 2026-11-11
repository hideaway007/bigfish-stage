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
  /** Agent 潜入预设模式（standard | ptc | minimal | cordis 或自定义预设 ID） */
  agentPreset?: string;
  /** 思考强度（low / medium / high / max …，取决于模型支持的档位） */
  reasoningEffort?: string;
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
  'deepseek-v4-pro': 'Leda',
  'gemini-4-argon': 'Autonoe',
  'claude-opus-5-5': 'Laomedeia',
  'codex-dragon': 'Zephyr',
};

export const DEFAULT_CHARACTER_BRAINS: Record<string, CharacterBrainSettings> = {
  'deepseek-v4-pro': {
    rolePrompt: '你是主舞台看板娘大肥鱼，擅长全栈快速落地与长任务冲锋。',
  },
  'gemini-4-argon': {
    rolePrompt: '你是焊工猫娘哈基米，专精前端界面美学、动效焊接与视觉精修。',
  },
  'claude-opus-5-5': {
    rolePrompt: '你是知性文学少女 Claude 娘，擅长复杂架构推演、重构设计与长文梳理。',
  },
  'codex-dragon': {
    rolePrompt: '你是银角白翼的高洁白龙娘，擅长深水区 Bug 洞察、全局逻辑推演与严苛代码审查。',
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
    agentPreset: 'standard',
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
    enabled: false,
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


export interface AgentPresetInfo {
  id: string;
  name: string;
  badge: string;
  builtIn: boolean;
  description: string;
  modeDetails: string;
  howToUse: string;
}

export const BUILTIN_AGENT_PRESETS: AgentPresetInfo[] = [
  {
    id: 'standard',
    name: '标准模式',
    badge: '内置',
    builtIn: true,
    description:
      '处理代码、文件和资料，适合大多数日常开发任务。角色会按需调用检索、编辑和终端等全套工具。',
    modeDetails:
      '直接向模型开放文件读写、代码检索、终端执行、计划与子智能体等完整工具集，一步一动清晰可控。',
    howToUse:
      '示例指令：「帮我排查这个项目构建报错的原因，修好后跑一遍测试验证。」',
  },
  {
    id: 'ptc',
    name: 'PTC 模式',
    badge: '内置',
    builtIn: true,
    description:
      '包含标准模式的所有能力，通过代码编排批量调用工具，并对结果进行筛选、整理、去重、统计或汇总。',
    modeDetails:
      'PTC（Programmatic Tool Calling）允许角色编写 TypeScript 脚本在沙箱内循环或并发调用工具，先聚合过滤中间数据再交给模型，大幅节省上下文。',
    howToUse:
      '示例指令：「扫描 configs/ 下所有 JSON 配置，对照 schema 列出缺失字段并汇总输出一份统计表。」',
  },
  {
    id: 'minimal',
    name: '极简模式',
    badge: '内置',
    builtIn: true,
    description:
      '仅挂载持久终端与图片读取工具，并支持上下文自动压缩，适合轻量执行与基础表现对比测试。',
    modeDetails:
      '不加载复杂技能目录与扩展运行时提示词，所有文件查看与修改均通过纯粹的 Shell 命令完成，受上下文压力时自动触发摘要压缩。',
    howToUse:
      '示例指令：「在终端运行当前仓库的测试套件，定位失败用例并做最小改动修复。」',
  },
  {
    id: 'cordis',
    name: '创造模式',
    badge: '内置',
    builtIn: true,
    description:
      '用对话扩展与定制工作台能力：编写新插件、新增自定义工具，或组合工具与提示词创建你自己的专属模式。',
    modeDetails:
      '在标准开发工具之上额外注入运行时自省与插件/预设编排能力，可直接生成、安装并校验新的自定义预设模式。',
    howToUse:
      '示例指令：「基于标准模式帮我创建一个“代码审查”预设模式：优先排查潜在 Bug 与测试缺口，并在改文件前先询问我。」',
  },
];
