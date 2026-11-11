import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StageDataSource } from '../sources/types';
import type { SessionListState } from '../sources/SessionListFeed';
import './SessionListModal.css';

function relativeTime(at?: number): string {
  if (!at) return '时间未知';
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

function folderName(cwd?: string): string {
  return cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '未选文件夹';
}

interface SessionListModalProps {
  source: StageDataSource;
  turnActive: boolean;
  onClose: () => void;
}

export const SessionListModal: React.FC<SessionListModalProps> = ({ source, turnActive, onClose }) => {
  const [list, setList] = useState<SessionListState>({ status: 'idle', sessions: [] });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sessions = useMemo(() => list.sessions.filter((session) =>
    [session.title, session.model, folderName(session.cwd)].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ).sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)), [list.sessions, query]);
  const selected = sessions.find((session) => session.sessionId === selectedId) ?? sessions[0];
  const busy = list.status === 'loading';

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const unsubscribe = source.subscribeSessions(setList);
    source.listSessions();
    searchRef.current?.focus();
    return () => { unsubscribe(); previousFocus?.focus(); };
  }, [source]);

  useEffect(() => {
    const row = rowsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    const container = rowsRef.current;
    if (row && container) {
      if (row.offsetTop < container.scrollTop) container.scrollTop = row.offsetTop;
      if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) {
        container.scrollTop = row.offsetTop + row.offsetHeight - container.clientHeight;
      }
    }
  }, [selected?.sessionId]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // 在捕获阶段隔离舞台快捷键，Esc 不会同时打开 SYSTEM。
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = sessions.findIndex((session) => session.sessionId === selected?.sessionId);
        const next = sessions[Math.max(0, Math.min(sessions.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (next) setSelectedId(next.sessionId);
      }
      if (event.key === 'Enter' && (event.target === searchRef.current || event.target === dialogRef.current || (event.target as HTMLElement).dataset.testid === 'session-row')) {
        event.preventDefault();
        if (selected && !turnActive && !busy) {
          source.resumeSession(selected.sessionId);
          onClose();
        }
      }
      if (event.key === 'Tab') {
        const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') ?? []);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [sessions, selected, source, turnActive, busy, onClose]);

  return createPortal(
    <div className="p5-modal-backdrop p5-session-backdrop" onClick={onClose}>
      <div className="p5-session-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="session-list-title" data-testid="session-list-modal" onClick={(event) => event.stopPropagation()} tabIndex={-1}>
        <header className="p5-archive-header">
          <div><span className="p5-archive-kicker">POND SESSIONS // 鱼塘航迹</span><h2 className="p5-archive-title" id="session-list-title">会话列表</h2></div>
          <button type="button" className="p5-close-btn" data-testid="session-list-close" onClick={onClose}>ESC // 关闭</button>
        </header>
        <div className="p5-session-toolbar">
          <input ref={searchRef} type="search" aria-label="搜索会话" placeholder="搜索标题、模型、文件夹…" data-testid="session-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(undefined); }} />
          <button type="button" data-testid="session-refresh" disabled={busy} onClick={() => source.listSessions()}>刷新</button>
          <button type="button" className="p5-session-primary" data-testid="session-new" disabled={turnActive || busy} onClick={() => { source.newSession(); onClose(); }}>＋ 新会话</button>
        </div>
        {source.mode === 'demo' && <p className="p5-session-note">演示会话 · 继续会话将重置演示剧本，可关闭面板后发送指令。</p>}
        {turnActive && <p className="p5-session-note" role="status">当前回合进行中，请先结束或喊停，再切换会话。</p>}
        <div className="p5-session-results" ref={rowsRef} aria-label="历史会话" aria-busy={busy}>
          {busy && <p className="p5-session-state" role="status" data-testid="session-loading">正在打捞会话记录…</p>}
          {(list.status === 'error' || list.status === 'unsupported') && <p className="p5-session-state" role="status" data-testid="session-error">{list.error}</p>}
          {!busy && list.status === 'ready' && sessions.length === 0 && <p className="p5-session-state" data-testid="session-empty">{query ? '没有匹配的会话，试试其他关键词。' : '还没有会话，从「新会话」开始一段航迹。'}</p>}
          {!busy && sessions.map((session, index) => (
            <button type="button" className="p5-session-row" key={session.sessionId} data-testid="session-row" data-session-id={session.sessionId} aria-pressed={selected?.sessionId === session.sessionId} onClick={() => setSelectedId(session.sessionId)}>
              <span className="p5-session-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="p5-session-details">
                <span className="p5-session-title">{session.title || '未命名会话'} {session.current && <span className="p5-session-current" data-testid="session-current">当前</span>}</span>
                <span className="p5-session-meta"><span>{session.model || '模型未知'}</span><span>{folderName(session.cwd)}</span><span>{session.turnCount ?? '—'} 轮</span></span>
              </span>
              <time className="p5-session-time" dateTime={session.updatedAt ? new Date(session.updatedAt).toISOString() : undefined}>{relativeTime(session.updatedAt ?? session.createdAt)}</time>
            </button>
          ))}
        </div>
        <footer className="p5-session-footer">
          <span>↑ ↓ 选择 · Enter 继续<span className="p5-session-count">{sessions.length} 个会话</span></span>
          <button type="button" className="p5-session-primary" data-testid="session-resume" disabled={!selected || turnActive || busy} onClick={() => { if (selected) { source.resumeSession(selected.sessionId); onClose(); } }}>继续 {selected?.current ? '当前会话' : '选中会话'} ▶</button>
        </footer>
      </div>
    </div>, document.body
  );
};

/** HUD 入口独立管理面板，StageApp 只需挂载一次。H 未被现有快捷键占用。 */
export const SessionListControl: React.FC<{ sourceRef: React.RefObject<StageDataSource | null>; turnActive: boolean }> = ({ sourceRef, turnActive }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'h' || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
  return <>
    <button type="button" className="p5-session-hud-btn" data-testid="session-list-open" title="H · 查看与切换历史会话" onClick={() => setOpen(true)}>H // 会话</button>
    {open && sourceRef.current && <SessionListModal source={sourceRef.current} turnActive={turnActive} onClose={() => setOpen(false)} />}
  </>;
};
