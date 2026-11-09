/**
 * 网页 ⇄ 本地服务 的 WebSocket 协议（Phase 1 契约）
 *
 * 服务端：server/，默认监听 127.0.0.1:5300，WebSocket 路径 /ws，只绑定本机地址。
 * 开发时 Vite 把 /ws 代理到 5300；`npm start` 时服务端直接托管 dist/ 静态页面。
 * 所有消息都是 JSON 文本帧。
 */
import type { StageEvent } from './stage-events';
import type { PublicSettings, SettingsPatch, WorkerAdapterInfo } from './settings';
import type { CharacterSummary } from './character-pack';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_SERVER_PORT = 5300;
export const WS_PATH = '/ws';

export interface SessionInfo {
  sessionId: string;
  adapter: string;
  model: string;
  cwd: string;
  /** 本轮是否在跑 */
  turnActive: boolean;
}

// ── 网页 → 服务端 ──
export type ClientCommand =
  | { type: 'hello'; protocolVersion: number }
  /** 开始新一轮（或会话空闲时的下一条消息） */
  | { type: 'send'; id: string; text: string }
  /** 本轮进行中插话 */
  | { type: 'steer'; id: string; text: string }
  | { type: 'stop' }
  | { type: 'permission_decision'; requestId: string; allowed: boolean }
  /** 用当前设置（projectDir / worker）开新会话 */
  | { type: 'new_session' }
  | { type: 'resume_session'; sessionId: string }
  | { type: 'switch_character'; characterId: string }
  | { type: 'update_settings'; patch: SettingsPatch }
  /** 列出某个接口可用的模型（worker 由适配器提供；voice 调 baseUrl/models） */
  | { type: 'list_models'; target: 'worker' | 'voice' }
  /** 发一个极小请求验证连通性 */
  | { type: 'test_connection'; target: 'worker' | 'voice' };

// ── 服务端 → 网页 ──
export type ServerMessage =
  | {
      type: 'welcome';
      protocolVersion: number;
      settings: PublicSettings;
      characters: CharacterSummary[];
      workerAdapters: WorkerAdapterInfo[];
      session: SessionInfo | null;
      /** 当前会话已发生的事件（断线重连后据此恢复界面） */
      history: StageEvent[];
    }
  | { type: 'event'; event: StageEvent }
  | { type: 'settings'; settings: PublicSettings }
  | { type: 'session'; session: SessionInfo | null }
  | { type: 'models'; target: 'worker' | 'voice'; models: string[]; error?: string }
  | { type: 'connection_test'; target: 'worker' | 'voice'; ok: boolean; message: string; latencyMs?: number }
  /** 某条命令无法执行（如未选项目文件夹就 send） */
  | { type: 'command_error'; commandType: ClientCommand['type']; message: string };
