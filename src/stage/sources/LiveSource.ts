import {
  PROTOCOL_VERSION,
  WS_PATH,
  type ClientCommand,
  type ServerMessage,
} from '../../shared/wire';
import type { CharacterTouchZone } from '../../shared/stage-events';
import type { SettingsPatch } from '../../shared/settings';
import { SessionListFeed } from './SessionListFeed';
import { fetchCharacterPack } from '../characterLoader';
import type {
  ConnectionStatus,
  StageDataSource,
  StageDataSourceCallbacks,
} from './types';

function resolveDefaultWsUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const customWs = params.get('ws');
  if (customWs) return customWs;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${WS_PATH}`;
}

export class LiveSource implements StageDataSource {
  public readonly mode = 'live' as const;
  private callbacks: StageDataSourceCallbacks;
  private sessionList = new SessionListFeed();
  public subscribeSessions = this.sessionList.subscribe;
  private sessionListRequested = false;
  /** 已发出 list_sessions、尚未收到回应 */
  private sessionListInFlight = false;
  /**
   * 当前服务端不支持 list_sessions。旧服务端收到未知命令会直接断开连接（1008），
   * 若重连后再请求就会断开→重连→再请求，无限循环。确认不支持后，本页面内不再发送。
   */
  private sessionListUnsupported = false;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private disposed = false;
  private attempt = 0;
  private hasEverConnected = false;
  private reconnectTimer: number | null = null;

  constructor(callbacks: StageDataSourceCallbacks, wsUrl?: string) {
    this.callbacks = callbacks;
    this.wsUrl = wsUrl ?? resolveDefaultWsUrl();
  }

  public connect(): void {
    this.disposed = false;
    this.clearReconnectTimer();
    this.openSocket();
  }

  public retryNow(): void {
    if (this.disposed) return;
    this.clearReconnectTimer();
    this.closeSocket();
    this.openSocket();
  }

  public dispose(): void {
    this.disposed = true;
    this.sessionList.dispose();
    this.clearReconnectTimer();
    this.closeSocket();
  }

  private closeSocket(): void {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        // StrictMode 会立即清理首次连接；握手完成后再关闭，避免浏览器记录连接取消错误。
        if (this.ws.readyState === WebSocket.CONNECTING) {
          const pendingSocket = this.ws;
          pendingSocket.onopen = () => pendingSocket.close();
        } else {
          this.ws.onopen = null;
          this.ws.close();
        }
      } catch {
        // ignore
      }
      this.ws = null;
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
    if (this.sessionListUnsupported) {
      this.sessionList.markUnsupported();
      return;
    }
    this.sessionList.request();
    this.sessionListInFlight = this.ws?.readyState === WebSocket.OPEN;
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

  public testConnection(target: 'worker' | 'voice'): void {
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const error: ServerMessage = {
        type: 'command_error',
        commandType: cmd.type,
        message: '鱼塘连接未就绪，请等待重连或运行 npm run dev:server 启动本地服务',
      };
      this.sessionList.receive(error);
      if (cmd.type !== 'list_sessions') this.callbacks.onServerMessage(error);
      return;
    }
    this.ws.send(JSON.stringify(cmd));
  }

  private openSocket(): void {
    if (this.disposed) return;

    const statusState: ConnectionStatus['state'] =
      this.attempt === 0 && !this.hasEverConnected
        ? 'connecting'
        : 'reconnecting';

    this.callbacks.onConnectionChange({
      state: statusState,
      attempt: this.attempt,
      hasEverConnected: this.hasEverConnected,
    });

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      if (this.disposed || this.ws !== socket) return;
      this.attempt = 0;
      this.hasEverConnected = true;
      this.callbacks.onConnectionChange({
        state: 'connected',
        attempt: 0,
        hasEverConnected: true,
      });
      const helloCmd: ClientCommand = {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
      };
      socket.send(JSON.stringify(helloCmd));
    };

    socket.onmessage = (ev) => {
      if (this.disposed || this.ws !== socket) return;
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as ServerMessage;
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
        if (msg.type === 'sessions' || (msg.type === 'command_error' && msg.commandType === 'list_sessions')) {
          this.sessionListInFlight = false;
        }
        this.sessionList.receive(msg);
        if ((msg.type === 'session' || msg.type === 'welcome') && this.sessionListRequested) {
          this.listSessions();
        }
        if (msg.type === 'command_error' && msg.commandType === 'list_sessions') return;
        this.callbacks.onServerMessage(msg);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onerror = () => {
      // onclose will handle reconnect scheduling
    };

    socket.onclose = (ev) => {
      if (this.disposed || this.ws !== socket) return;
      this.ws = null;
      // 1008 = 服务端拒绝了某条命令；刚发过 list_sessions 就被断开，说明它不认识这条命令
      if (this.sessionListInFlight && ev.code === 1008) {
        this.sessionListUnsupported = true;
        this.sessionList.markUnsupported();
      }
      this.sessionListInFlight = false;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.clearReconnectTimer();
    this.attempt += 1;
    // Exponential backoff: 400ms, 680ms, 1150ms, 1950ms, 3300ms, capped at 5000ms
    const delayMs = Math.min(
      5000,
      Math.round(400 * Math.pow(1.7, Math.min(this.attempt - 1, 6)))
    );

    this.callbacks.onConnectionChange({
      state: 'reconnecting',
      attempt: this.attempt,
      hasEverConnected: this.hasEverConnected,
      nextRetryDelayMs: delayMs,
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
