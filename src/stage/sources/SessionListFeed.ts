import type { ServerMessage, SessionSummary } from '../../shared/wire';

export interface SessionListState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';
  sessions: SessionSummary[];
  error?: string;
}

/** 数据源内的列表订阅，不影响舞台事件与回看记录。 */
export class SessionListFeed {
  private state: SessionListState = { status: 'idle', sessions: [] };
  private listeners = new Set<(state: SessionListState) => void>();
  private timer: number | undefined;

  subscribe = (listener: (state: SessionListState) => void): (() => void) => {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  };

  private publish(state: SessionListState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  request(): void {
    window.clearTimeout(this.timer);
    this.publish({ ...this.state, status: 'loading', error: undefined });
    this.timer = window.setTimeout(() => this.markUnsupported(), 3000);
  }

  /** 服务端不认识 list_sessions（超时，或因「未知命令」断开连接）时调用 */
  markUnsupported(): void {
    window.clearTimeout(this.timer);
    this.publish({ ...this.state, status: 'unsupported', error: '服务端暂不支持会话列表（等待 B 侧实现）' });
  }

  receive(message: ServerMessage): void {
    if (message.type === 'sessions') {
      window.clearTimeout(this.timer);
      this.publish({ status: message.error ? 'error' : 'ready', sessions: message.sessions, error: message.error });
    } else if (message.type === 'command_error' && ['list_sessions', 'resume_session', 'new_session'].includes(message.commandType)) {
      window.clearTimeout(this.timer);
      this.publish({ ...this.state, status: 'error', error: message.message });
    } else if (message.type === 'session' || message.type === 'welcome') {
      const currentId = message.session?.sessionId;
      this.publish({ ...this.state, sessions: this.state.sessions.map((session) => ({ ...session, current: session.sessionId === currentId })) });
    }
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.listeners.clear();
  }
}
