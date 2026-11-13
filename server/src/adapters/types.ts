import type { StageEvent } from '../../../src/shared/stage-events';
import type { WorkerAdapterInfo, WorkerSettings } from '../../../src/shared/settings';

export interface ConnectionResult { ok: boolean; message: string; latencyMs?: number }
export interface ModelList { models: string[]; error?: string }
export interface CompactionResult {
  turnsCompacted: number;
  /** 引擎真实统计的释放/折叠 Token 数；未知时为 0（不凭估算伪造） */
  freedTokens: number;
  afterTokens?: number;
  maxTokens?: number;
  summary: string;
}
export interface StartSessionOptions extends Omit<WorkerSettings, 'adapter'> {
  cwd: string;
  resumeId?: string;
  rolePrompt?: string;
  /** 恢复已有会话时供轻量适配器重建内存上下文的事件记录 */
  restoredEvents?: StageEvent[];
  onEvent: (event: StageEvent) => void;
}
export interface WorkerSession {
  readonly sessionId: string;
  readonly turnActive: boolean;
  send(id: string, text: string): Promise<void>;
  steer(id: string, text: string): Promise<void>;
  interrupt(): Promise<void>;
  decidePermission(requestId: string, allowed: boolean): Promise<void>;
  compact?(): Promise<CompactionResult>;
  close(): Promise<void>;
}
export interface WorkerAdapter {
  readonly id: string;
  readonly supportsCompact?: boolean;
  info(settings?: WorkerSettings): Promise<WorkerAdapterInfo>;
  listModels(settings?: WorkerSettings): Promise<ModelList>;
  testConnection(settings: WorkerSettings): Promise<ConnectionResult>;
  startSession(options: StartSessionOptions): Promise<WorkerSession>;
}
