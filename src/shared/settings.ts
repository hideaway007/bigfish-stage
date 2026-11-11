/**
 * 设置项格式（Phase 1 契约）
 *
 * 服务端把设置存在用户本机：~/.config/bigfish-stage/settings.json（权限 600），绝不写进仓库。
 * 发给 UI 的是 PublicSettings：所有 apiKey 都被替换成 apiKeySet: boolean。
 */

/** 任意 OpenAI 兼容接口的连接信息 */
export interface ProviderEndpoint {
  /** 例如 http://127.0.0.1:3425/v1 */
  baseUrl: string;
  apiKey?: string;
}

export type ModelEndpoint = ProviderEndpoint & { model: string };

export interface WorkerSettings {
  /** 执行 Agent 适配器 ID。Phase 1 只有 'codex'，以后加 'claude-code' 等 */
  adapter: string;
  /** 执行 Agent 使用的模型，由用户自选（传给适配器） */
  model: string;
  /** 自定义 OpenAI 兼容接口，或沿用本机 Agent 的登录与配置 */
  connection: 'endpoint' | 'agent-default';
  endpoint: ProviderEndpoint;
  sandbox: 'read-only' | 'workspace-write';
  /** Agent 潜入预设模式（standard | ptc | minimal | cordis 或自定义预设 ID） */
  agentPreset?: string;
  /** 适配器专属的额外选项（如 codex 可执行文件路径） */
  extra?: Record<string, string>;
}

export interface VoiceSettings {
  /** 关掉则只用角色包里的预置台词 */
  enabled: boolean;
  endpoint: ModelEndpoint;
  /** 每分钟最多生成几句模型台词（限流防刷屏） */
  maxLinesPerMinute: number;
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
  voice: VoiceSettings;
  performance: PerformanceSettings;
}

type Publicize<T> = T extends ProviderEndpoint
  ? Omit<T, 'apiKey'> & { apiKeySet: boolean }
  : T extends object
    ? { [K in keyof T]: Publicize<T[K]> }
    : T;

export type PublicSettings = Publicize<AppSettings>;

/** UI 发来的局部修改。apiKey: '' 表示清除，undefined 表示不改 */
export type SettingsPatch = {
  [K in keyof AppSettings]?: AppSettings[K] extends object
    ? AppSettings[K] extends unknown[]
      ? AppSettings[K]
      : { [P in keyof AppSettings[K]]?: AppSettings[K][P] extends object ? Partial<AppSettings[K][P]> : AppSettings[K][P] }
    : AppSettings[K];
};

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  activeCharacterId: 'deepseek-v4-pro',
  projectDir: null,
  recentProjects: [],
  worker: {
    adapter: 'codex', model: 'gpt-6.1-sol', sandbox: 'workspace-write', agentPreset: 'standard',
    connection: 'endpoint', endpoint: { baseUrl: 'http://127.0.0.1:3425/v1' },
  },
  voice: {
    enabled: true,
    // 默认指向本机 OpenAI 兼容网关；用户可改成任意 OpenAI 兼容地址
    endpoint: { baseUrl: 'http://127.0.0.1:3425/v1', model: 'gpt-4o-mini' },
    maxLinesPerMinute: 6,
  },
  performance: { typingCharsPerSec: 40 },
};

/** 执行 Agent 适配器的描述（服务端在 welcome 里下发，UI 据此渲染下拉框） */
export interface WorkerAdapterInfo {
  id: string;
  name: string;
  /** 本机是否可用（如 codex 命令是否存在），不可用时附原因 */
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
