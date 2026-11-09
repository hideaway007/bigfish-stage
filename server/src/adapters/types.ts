import type { StageEvent } from '../../../src/shared/stage-events';
import type { WorkerAdapterInfo, WorkerSettings } from '../../../src/shared/settings';

export interface ConnectionResult { ok: boolean; message: string; latencyMs?: number }
export interface ModelList { models: string[]; error?: string }
export interface StartSessionOptions extends Omit<WorkerSettings, 'adapter'> {
  cwd: string;
  resumeId?: string;
  onEvent: (event: StageEvent) => void;
}
export interface WorkerSession {
  readonly sessionId: string;
  readonly turnActive: boolean;
  send(id: string, text: string): Promise<void>;
  steer(id: string, text: string): Promise<void>;
  interrupt(): Promise<void>;
  decidePermission(requestId: string, allowed: boolean): Promise<void>;
  close(): Promise<void>;
}
export interface WorkerAdapter {
  readonly id: string;
  info(settings?: WorkerSettings): Promise<WorkerAdapterInfo>;
  listModels(settings?: WorkerSettings): Promise<ModelList>;
  testConnection(settings: WorkerSettings): Promise<ConnectionResult>;
  startSession(options: StartSessionOptions): Promise<WorkerSession>;
}
