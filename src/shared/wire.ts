/**
 * 网页 / Electron ⇄ 本地服务 的通信协议（Phase 2 契约）
 */
import type { CharacterTouchZone, StageEvent } from './stage-events';
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
  characterId?: string;
  /** 本轮是否在跑 */
  turnActive: boolean;
}

export interface SessionSummary {
  sessionId: string;
  /** 会话标题（通常取首条用户消息前若干字） */
  title?: string;
  adapter?: string;
  model?: string;
  cwd?: string;
  characterId?: string;
  createdAt?: number;
  updatedAt?: number;
  turnCount?: number;
  /** 是否是当前激活会话 */
  current?: boolean;
}

export interface GitChangedFile {
  path: string;
  /** M=修改, A=新增, D=删除, ?=未跟踪 */
  status: 'M' | 'A' | 'D' | '?' | 'R';
  added: number;
  removed: number;
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
  /** 为当前角色开新会话 */
  | { type: 'new_session' }
  | { type: 'resume_session'; sessionId: string }
  /** 请求历史会话列表（支持按角色筛选） */
  | { type: 'list_sessions'; limit?: number; characterId?: string }
  | { type: 'switch_character'; characterId: string }
  | { type: 'update_settings'; patch: SettingsPatch }
  /** 列出某个接口可用的模型 */
  | { type: 'list_models'; target: 'worker' | 'voice' }
  /** 发一个极小请求验证连通性（支持 worker / voice / tts） */
  | { type: 'test_connection'; target: 'worker' | 'voice' | 'tts' }
  /** 真实上下文记忆蒸馏压缩（方向 3） */
  | { type: 'compact_session' }
  /** P5 怪盗团击掌换手接力：将本轮摘要与 diff 交接给目标角色的独立大脑 */
  | { type: 'baton_pass'; toCharacterId: string; instruction?: string }
  /** 触摸/点击角色立绘分部位彩蛋互动（方向 5） */
  | { type: 'interact_character'; characterId: string; zone: CharacterTouchZone }
  /** 按需请求合成某句台词的 TTS 语音（如试听或重播） */
  | { type: 'synthesize_tts'; characterId: string; text: string; lineId?: string }
  /** 怪盗战利品 Git 工作区变更查询、单文件撤回与快速提交（方向 6） */
  | { type: 'git_status' }
  | { type: 'git_revert_file'; path: string }
  | { type: 'git_commit'; message: string };

// ── 服务端 → 网页 ──
export type ServerMessage =
  | {
      type: 'welcome';
      protocolVersion: number;
      settings: PublicSettings;
      characters: CharacterSummary[];
      workerAdapters: WorkerAdapterInfo[];
      session: SessionInfo | null;
      /** 当前会话已发生的事件（含从磁盘 JSONL 恢复的历史记录） */
      history: StageEvent[];
    }
  | { type: 'event'; event: StageEvent }
  | { type: 'settings'; settings: PublicSettings }
  | {
      type: 'session';
      session: SessionInfo | null;
      /** 切换角色房间或恢复历史会话时同步带回该会话持久化的 StageEvent 历史 */
      history?: StageEvent[];
    }
  | { type: 'sessions'; sessions: SessionSummary[]; error?: string }
  | { type: 'models'; target: 'worker' | 'voice'; models: string[]; error?: string }
  | { type: 'connection_test'; target: 'worker' | 'voice' | 'tts'; ok: boolean; message: string; latencyMs?: number }
  /** 服务端合成好的角色 TTS 语音帧（跨 Web / Electron 原生通用） */
  | {
      type: 'tts_audio';
      characterId: string;
      lineId?: string;
      text?: string;
      audioBase64: string;
      mimeType: string;
      error?: string;
    }
  /** Git 工作区实时战利品状态与全量 Diff */
  | {
      type: 'git_status_result';
      isRepo: boolean;
      branch?: string;
      files: GitChangedFile[];
      diff: string;
      error?: string;
    }
  | {
      type: 'git_op_result';
      op: 'revert' | 'commit';
      ok: boolean;
      message: string;
    }
  /** 某条命令无法执行 */
  | { type: 'command_error'; commandType: ClientCommand['type']; message: string };
