import type {
  ClientCommand,
  ServerMessage,
} from '../../shared/wire';
import type { SettingsPatch } from '../../shared/settings';
import type { SessionListState } from './SessionListFeed';

export type DataSourceMode = 'live' | 'demo' | 'native';

export interface ConnectionStatus {
  state: 'connecting' | 'connected' | 'reconnecting';
  attempt: number;
  hasEverConnected: boolean;
  nextRetryDelayMs?: number;
}

export interface StageDataSourceCallbacks {
  onServerMessage: (msg: ServerMessage) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}

export interface StageDataSource {
  readonly mode: DataSourceMode;
  connect(): void;
  retryNow(): void;
  dispose(): void;
  send(text: string): void;
  steer(text: string): void;
  stop(): void;
  decidePermission(requestId: string, allowed: boolean): void;
  listSessions(): void;
  subscribeSessions(listener: (state: SessionListState) => void): () => void;
  newSession(): void;
  resumeSession(sessionId: string): void;
  switchCharacter(characterId: string): void;
  updateSettings(patch: SettingsPatch): void;
  listModels(target: 'worker' | 'voice'): void;
  testConnection(target: 'worker' | 'voice'): void;
  setFastForward?(fast: boolean): void;
  replayDemo?(): void;
  sendRawCommand?(cmd: ClientCommand): void;
}
