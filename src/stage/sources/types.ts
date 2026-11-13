import type {
  ClientCommand,
  ServerMessage,
} from '../../shared/wire';
import type { CharacterTouchZone } from '../../shared/stage-events';
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

/** 用户随消息附带的图片（base64，不含 data: 前缀）。 */
export interface StageImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  data: string;
  name?: string;
  /** 本地预览用的 object URL / data URL。 */
  previewUrl: string;
}

export interface StageDataSource {
  readonly mode: DataSourceMode;
  connect(): void;
  retryNow(): void;
  dispose(): void;
  send(text: string, images?: readonly StageImageAttachment[]): void;
  steer(text: string, images?: readonly StageImageAttachment[]): void;
  stop(): void;
  decidePermission(requestId: string, allowed: boolean): void;
  listSessions(): void;
  subscribeSessions(listener: (state: SessionListState) => void): () => void;
  newSession(): void;
  newSessionInDirectory?(directory: string): void;
  pickDirectory?(): Promise<string | null>;
  resumeSession(sessionId: string): void;
  switchCharacter(characterId: string): void;
  updateSettings(patch: SettingsPatch): void;
  listModels(target: 'worker' | 'voice'): void;
  testConnection(target: 'worker' | 'voice'): void;
  compactSession?(): void;
  batonPass?(toCharacterId: string, instruction?: string): void;
  interactCharacter?(characterId: string, zone: CharacterTouchZone): void;
  requestGitStatus?(): void;
  revertGitFile?(path: string): void;
  commitGit?(message: string): void;
  setFastForward?(fast: boolean): void;
  replayDemo?(): void;
  sendRawCommand?(cmd: ClientCommand): void;
}
