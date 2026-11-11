import React from 'react';
import type { StageEvent } from '../../shared/stage-events';
import type { PendingPermission, SteerItem } from '../stageReducer';
import { DiffViewer } from './DiffViewer';
import { ShortcutHelp } from './ShortcutHelp';

interface EngineeringViewProps {
  events: StageEvent[];
  modelName: string;
  hudStatusLabel: string;
  turnDurationSec: string;
  pendingPermission: PendingPermission | null;
  steers: SteerItem[];
  inputValue: string;
  turnActive: boolean;
  isDemo?: boolean;
  onInputChange: (val: string) => void;
  onSubmitInput: (e: React.FormEvent) => void;
  onResolvePermission: (allowed: boolean) => void;
  onExitEngineeringView: () => void;
  onReplayScript: () => void;
}

export const EngineeringView: React.FC<EngineeringViewProps> = ({
  events,
  modelName,
  hudStatusLabel,
  turnDurationSec,
  pendingPermission,
  steers,
  inputValue,
  turnActive,
  isDemo,
  onInputChange,
  onSubmitInput,
  onResolvePermission,
  onExitEngineeringView,
  onReplayScript,
}) => {
  const resolvedIsDemo =
    isDemo ??
    (typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).get('demo') === '1' ||
        new URLSearchParams(window.location.search).get('demo') === 'true'));

  return (
    <div className="eng-view-root" data-testid="engineering-view">
      <ShortcutHelp showTrigger />
      <header className="eng-view-header">
        <div className="eng-view-header-left">
          <span className="eng-badge-mode">ENGINEERING VIEW // 朴素工程视图</span>
          <span className="eng-meta-item">
            MODEL: <strong>{modelName}</strong>
          </span>
          <span className="eng-meta-item">
            STATUS: <strong>{hudStatusLabel}</strong>
          </span>
          <span className="eng-meta-item">
            ELAPSED: <strong>{turnDurationSec}s</strong>
          </span>
          <span className="eng-meta-item">
            EVENTS: <strong>{events.length}</strong>
          </span>
        </div>

        <div className="eng-view-header-right">
          <button
            type="button"
            className="eng-btn"
            onClick={onReplayScript}
          >
            {resolvedIsDemo ? '↻ 重播剧本' : '＋ 新建会话'}
          </button>
          <button
            type="button"
            className="eng-btn eng-btn--primary"
            onClick={onExitEngineeringView}
            data-testid="exit-engineering-view-btn"
          >
            [`] 返回鱼塘舞台
          </button>
        </div>
      </header>

      {steers.length > 0 && (
        <div className="eng-steer-bar">
          {steers.map((st) => (
            <div key={st.id} className="eng-steer-item">
              <span className="eng-steer-tag">
                {st.status === 'queued' ? '已传达，待接收' : '已接收'}
              </span>
              <span>插话：{st.text}</span>
            </div>
          ))}
        </div>
      )}

      <main className="eng-timeline" data-testid="engineering-timeline">
        {events.map((ev, idx) => {
          const ts = new Date(ev.at).toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          return (
            <div
              key={`${ev.at}_${idx}`}
              className={`eng-event-row eng-event-row--${ev.type}`}
            >
              <div className="eng-event-meta">
                <span className="eng-event-idx">#{idx + 1}</span>
                <span className="eng-event-time">{ts}</span>
                <span className={`eng-event-type type-${ev.type}`}>
                  {ev.type}
                </span>
              </div>

              <div className="eng-event-body">
                {ev.type === 'session_started' && (
                  <code>
                    sessionId={ev.sessionId} model="{ev.model}" cwd="{ev.cwd}"
                  </code>
                )}

                {ev.type === 'user_message' && (
                  <div className="eng-user-text">{ev.text}</div>
                )}

                {ev.type === 'character_line' && (
                  <div className="eng-char-text">
                    <span className="eng-emotion-tag">[{ev.emotion}]</span>{' '}
                    {ev.text}
                  </div>
                )}

                {ev.type === 'sub_navigator_line' && (
                  <div className="eng-char-text">
                    <span className="eng-emotion-tag">
                      [NAVI:{ev.characterId}/{ev.emotion}]
                    </span>{' '}
                    {ev.text}
                  </div>
                )}

                {ev.type === 'baton_pass' && (
                  <div>
                    <strong>
                      [BATON PASS] {ev.fromCharacterId} ➔ {ev.toCharacterId}
                    </strong>{' '}
                    — {ev.summary}
                  </div>
                )}

                {ev.type === 'context_compacted' && (
                  <div>
                    <strong>[COMPACTED]</strong> turns={ev.turnsCompacted},
                    freed={ev.freedTokens} tokens — {ev.summary}
                  </div>
                )}

                {ev.type === 'thinking' && (
                  <div className="eng-mono-muted">
                    Agent thinking... (reasoning in progress)
                  </div>
                )}

                {ev.type === 'worker_text' && (
                  <div
                    className="eng-worker-text"
                    data-testid="eng-worker-text"
                  >
                    {ev.final && (
                      <span className="eng-final-tag">[FINAL ANSWER] </span>
                    )}
                    {ev.text}
                  </div>
                )}

                {ev.type === 'tool_start' && (
                  <div className="eng-tool-start">
                    <strong>
                      [{ev.tool.toUpperCase()} / {ev.rawName}]
                    </strong>{' '}
                    {ev.summary}{' '}
                    {ev.file && <code className="eng-file-tag">{ev.file}</code>}
                    <span className="eng-mono-id"> ({ev.toolUseId})</span>
                  </div>
                )}

                {ev.type === 'tool_end' && (
                  <div className="eng-tool-end">
                    <div className="eng-tool-end-header">
                      <span
                        className={
                          ev.ok ? 'eng-status-ok' : 'eng-status-fail'
                        }
                      >
                        {ev.ok ? '✓ OK' : '✗ FAILED'}
                      </span>{' '}
                      <span>{ev.summary}</span>
                      <span className="eng-mono-id"> ({ev.toolUseId})</span>
                    </div>
                    {(ev.diff || ev.output) && (
                      <div className="eng-inline-artifact">
                        <DiffViewer diff={ev.diff} output={ev.output} />
                      </div>
                    )}
                  </div>
                )}

                {ev.type === 'permission_request' && (
                  <div className="eng-perm-box">
                    <div>
                      <strong>
                        PERMISSION REQUEST [{ev.tool} / {ev.rawName}]
                      </strong>{' '}
                      — {ev.summary}
                    </div>
                    <pre className="eng-perm-detail">{ev.detail}</pre>
                    {pendingPermission?.requestId === ev.requestId && (
                      <div className="eng-perm-actions">
                        <button
                          type="button"
                          className="eng-btn eng-btn--allow"
                          onClick={() => onResolvePermission(true)}
                        >
                          允许 (Allow)
                        </button>
                        <button
                          type="button"
                          className="eng-btn eng-btn--reject"
                          onClick={() => onResolvePermission(false)}
                        >
                          拒绝 (Reject)
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {ev.type === 'permission_resolved' && (
                  <div>
                    Permission <code>{ev.requestId}</code> resolved:{' '}
                    <strong>{ev.allowed ? 'ALLOWED (允许)' : 'REJECTED (拒绝)'}</strong>
                  </div>
                )}

                {ev.type === 'steer_queued' && (
                  <div>
                    <strong>[已传达，待接收]</strong> 插话内容：{ev.text}{' '}
                    <span className="eng-mono-id">({ev.id})</span>
                  </div>
                )}

                {ev.type === 'steer_acked' && (
                  <div>
                    <strong>[已接收]</strong> Worker 已确认接收插话{' '}
                    <span className="eng-mono-id">({ev.id})</span>
                  </div>
                )}

                {ev.type === 'turn_done' && (
                  <div className="eng-turn-done">
                    <strong>{ev.ok ? 'TURN DONE (OK)' : 'TURN FAILED'}</strong> —{' '}
                    {ev.summary} ({ev.durationMs}ms, ${ev.costUsd?.toFixed(3)})
                  </div>
                )}

                {ev.type === 'error' && (
                  <div className="eng-status-fail">ERROR: {ev.message}</div>
                )}
              </div>
            </div>
          );
        })}
      </main>

      <form className="eng-input-bar" onSubmit={onSubmitInput}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={
            turnActive
              ? '任务进行中：输入追加指令插话（steer_queued）...'
              : '输入指令并回车启动剧本...'
          }
          className="eng-input"
        />
        <button type="submit" className="eng-btn eng-btn--primary">
          {turnActive ? '发送插话 (Steer)' : '发送指令 (Start)'}
        </button>
      </form>
    </div>
  );
};
