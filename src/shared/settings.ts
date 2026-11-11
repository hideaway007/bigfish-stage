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
    adapter: 'codex', model: 'gpt-6.1-sol', sandbox: 'workspace-write',
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
