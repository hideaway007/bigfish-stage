import {
  PROTOCOL_VERSION,
  type ClientCommand,
  type ServerMessage,
} from '../../shared/wire';
import type { CharacterTouchZone } from '../../shared/stage-events';
import type { SettingsPatch } from '../../shared/settings';
import { SessionListFeed } from './SessionListFeed';
import { fetchCharacterPack } from '../characterLoader';
import type {
  StageDataSource,
  StageDataSourceCallbacks,
} from './types';

interface ElectronApi {
  isNativeApp: boolean;
  sendCommand: (cmd: ClientCommand) => void;
  onMessage: (cb: (msg: ServerMessage) => void) => () => void;
  pickDirectory?: () => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export class NativeAppSource implements StageDataSource {
  public readonly mode = 'live' as const;
  private callbacks: StageDataSourceCallbacks;
  private sessionList = new SessionListFeed();
  public subscribeSessions = this.sessionList.subscribe;
  private sessionListRequested = false;
  private unsubscribeMessage?: () => void;

  constructor(callbacks: StageDataSourceCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(): void {
    // 原生桌面 App 永远在线，状态直接为已连接
    this.callbacks.onConnectionChange({
      state: 'connected',
      attempt: 0,
      hasEverConnected: true,
    });

    if (window.electronAPI?.onMessage) {
      this.unsubscribeMessage = window.electronAPI.onMessage((msg) => {
        if (msg.type === 'welcome') {
          for (const ch of msg.characters) {
            void fetchCharacterPack(ch.id);
          }
          if (msg.settings?.activeCharacterId) {
            void fetchCharacterPack(msg.settings.activeCharacterId);
          }
        } else if (msg.type === 'settings' && msg.settings?.activeCharacterId) {
          void fetchCharacterPack(msg.settings.activeCharacterId);
        }
        this.sessionList.receive(msg);
        if ((msg.type === 'session' || msg.type === 'welcome') && this.sessionListRequested) {
          this.listSessions();
        }
        if (msg.type === 'command_error' && msg.commandType === 'list_sessions') return;
        this.callbacks.onServerMessage(msg);
      });
    }

    this.sendRawCommand({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  public retryNow(): void {
    this.callbacks.onConnectionChange({
      state: 'connected',
      attempt: 0,
      hasEverConnected: true,
    });
    this.sendRawCommand({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  public dispose(): void {
    this.sessionList.dispose();
    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = undefined;
    }
  }

  public send(text: string): void {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.sendRawCommand({ type: 'send', id, text });
  }

  public steer(text: string): void {
    const id = `steer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.sendRawCommand({ type: 'steer', id, text });
  }

  public stop(): void {
    this.sendRawCommand({ type: 'stop' });
  }

  public decidePermission(requestId: string, allowed: boolean): void {
    this.sendRawCommand({
      type: 'permission_decision',
      requestId,
      allowed,
    });
  }

  public listSessions(): void {
    this.sessionListRequested = true;
    this.sessionList.request();
    this.sendRawCommand({ type: 'list_sessions', limit: 100 });
  }

  public newSession(): void {
    this.sendRawCommand({ type: 'new_session' });
  }

  public resumeSession(sessionId: string): void {
    this.sendRawCommand({ type: 'resume_session', sessionId });
  }

  public switchCharacter(characterId: string): void {
    void fetchCharacterPack(characterId);
    this.sendRawCommand({ type: 'switch_character', characterId });
  }

  public updateSettings(patch: SettingsPatch): void {
    if (typeof patch.activeCharacterId === 'string') {
      void fetchCharacterPack(patch.activeCharacterId);
    }
    this.sendRawCommand({ type: 'update_settings', patch });
  }

  public listModels(target: 'worker' | 'voice'): void {
    this.sendRawCommand({ type: 'list_models', target });
  }

  public testConnection(target: 'worker' | 'voice' | 'tts'): void {
    this.sendRawCommand({ type: 'test_connection', target });
  }

  public compactSession(): void {
    this.sendRawCommand({ type: 'compact_session' });
  }

  public batonPass(toCharacterId: string, instruction?: string): void {
    void fetchCharacterPack(toCharacterId);
    const trimmed = instruction?.trim();
    this.sendRawCommand({
      type: 'baton_pass',
      toCharacterId,
      ...(trimmed ? { instruction: trimmed } : {}),
    });
  }

  public interactCharacter(
    characterId: string,
    zone: CharacterTouchZone
  ): void {
    this.sendRawCommand({
      type: 'interact_character',
      characterId,
      zone,
    });
  }

  public synthesizeTts(
    characterId: string,
    text: string,
    lineId?: string
  ): void {
    this.sendRawCommand({
      type: 'synthesize_tts',
      characterId,
      text,
      ...(lineId ? { lineId } : {}),
    });
  }

  public requestGitStatus(): void {
    this.sendRawCommand({ type: 'git_status' });
  }

  public revertGitFile(path: string): void {
    this.sendRawCommand({ type: 'git_revert_file', path });
  }

  public commitGit(message: string): void {
    this.sendRawCommand({ type: 'git_commit', message });
  }

  public sendRawCommand(cmd: ClientCommand): void {
    if (window.electronAPI?.sendCommand) {
      window.electronAPI.sendCommand(cmd);
    }
  }
}
