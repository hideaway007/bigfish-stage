import React from 'react';
import type { StageEvent } from '../../shared/stage-events';
import type { SkillCardItem } from '../stageReducer';

interface BacklogModalProps {
  open: boolean;
  events: StageEvent[];
  skillCards: SkillCardItem[];
  characterName: string;
  onClose: () => void;
  onInspectSkill: (toolUseId: string) => void;
}

export const BacklogModal: React.FC<BacklogModalProps> = ({
  open,
  events,
  skillCards,
  characterName,
  onClose,
  onInspectSkill,
}) => {
  if (!open) return null;

  const skillMap = new Map<string, SkillCardItem>();
  for (const c of skillCards) {
    skillMap.set(c.toolUseId, c);
  }

  // Filter to the meaningful narrative & execution entries required by spec:
  // user_message / character_line / skill card (on tool_start) / worker_text (+ steer & permission)
  const backlogEntries = events.filter((ev) =>
    [
      'user_message',
      'character_line',
      'tool_start',
      'worker_text',
      'steer_queued',
      'permission_resolved',
      'turn_done',
    ].includes(ev.type)
  );

  return (
    <div
      className="p5-modal-backdrop"
      onClick={onClose}
      data-testid="backlog-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Backlog 对话与行动回看"
    >
      <div
        className="p5-backlog-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p5-archive-header">
          <div className="p5-archive-title-group">
            <span className="p5-archive-kicker">STAGE BACKLOG // 演出回看记录</span>
            <h2 className="p5-archive-title">
              CHRONOLOGICAL LOG（按时间顺序列出全部台词 / 用户指令 / 技能卡 / Worker 原文）
            </h2>
          </div>

          <div className="p5-archive-meta">
            <span className="p5-archive-duration">
              共 {backlogEntries.length} 条记录
            </span>
            <button
              type="button"
              className="p5-close-btn"
              onClick={onClose}
              data-testid="backlog-close-btn"
            >
              [L / ESC] 关闭
            </button>
          </div>
        </div>

        <div className="p5-backlog-list">
          {backlogEntries.map((ev, index) => {
            const timeStr = new Date(ev.at).toLocaleTimeString('zh-CN', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            if (ev.type === 'user_message') {
              return (
                <div
                  key={`${ev.at}_${index}`}
                  className="p5-backlog-item p5-backlog-item--user"
                >
                  <div className="p5-backlog-badge">PLAYER // 玩家指令</div>
                  <div className="p5-backlog-content">
                    <p className="p5-backlog-text">{ev.text}</p>
                  </div>
                  <span className="p5-backlog-time">{timeStr}</span>
                </div>
              );
            }

            if (ev.type === 'character_line') {
              return (
                <div
                  key={`${ev.at}_${index}`}
                  className="p5-backlog-item p5-backlog-item--char"
                >
                  <div className="p5-backlog-badge">
                    {characterName} · [{ev.emotion.toUpperCase()}]
                  </div>
                  <div className="p5-backlog-content">
                    <p className="p5-backlog-text">{ev.text}</p>
                  </div>
                  <span className="p5-backlog-time">{timeStr}</span>
                </div>
              );
            }

            if (ev.type === 'tool_start') {
              const card = skillMap.get(ev.toolUseId);
              return (
                <div
                  key={`${ev.at}_${index}`}
                  className="p5-backlog-item p5-backlog-item--skill"
                  onClick={() => {
                    onClose();
                    onInspectSkill(ev.toolUseId);
                  }}
                >
                  <div className="p5-backlog-badge">SKILL // 技能发动</div>
                  <div className="p5-backlog-content">
                    <div className="p5-backlog-skill-row">
                      <strong>
                        {characterName} 发动 {ev.tool.toUpperCase()} ▶{' '}
                        <code>{ev.file ?? ev.summary}</code>
                      </strong>
                      {card?.diffStats && (
                        <span className="p5-diff-stat-pill">
                          <span className="stat-add">+{card.diffStats.added}</span>{' '}
                          <span className="stat-del">−{card.diffStats.removed}</span>
                        </span>
                      )}
                      {card && (
                        <span
                          className={`p5-mini-status p5-mini-status--${card.status}`}
                        >
                          {card.status === 'success'
                            ? '命中'
                            : card.status === 'error'
                            ? '失败'
                            : '进行中'}
                        </span>
                      )}
                      <span className="p5-backlog-click-hint">
                        [点击展开档案]
                      </span>
                    </div>
                    {card?.endSummary && (
                      <div className="p5-backlog-subtext">{card.endSummary}</div>
                    )}
                  </div>
                  <span className="p5-backlog-time">{timeStr}</span>
                </div>
              );
            }

            if (ev.type === 'worker_text') {
              return (
                <div
                  key={`${ev.at}_${index}`}
                  className="p5-backlog-item p5-backlog-item--worker"
                >
                  <div className="p5-backlog-badge">
                    WORKER RAW {ev.final ? '// FINAL' : ''}
                  </div>
                  <div className="p5-backlog-content">
                    <p className="p5-backlog-mono">{ev.text}</p>
                  </div>
                  <span className="p5-backlog-time">{timeStr}</span>
                </div>
              );
            }

            if (ev.type === 'steer_queued') {
              return (
                <div
                  key={`${ev.at}_${index}`}
                  className="p5-backlog-item p5-backlog-item--steer"
                >
                  <div className="p5-backlog-badge">STEER // 场外插话</div>
                  <div className="p5-backlog-content">
                    <p className="p5-backlog-text">{ev.text}</p>
                  </div>
                  <span className="p5-backlog-time">{timeStr}</span>
                </div>
              );
            }

            if (ev.type === 'permission_resolved') {
              return (
                <div
                  key={`${ev.at}_${index}`}
                  className="p5-backlog-item p5-backlog-item--perm"
                >
                  <div className="p5-backlog-badge">DECISION // 权限决断</div>
                  <div className="p5-backlog-content">
                    <p className="p5-backlog-mono">
                      Request {ev.requestId}:{' '}
                      <strong>{ev.allowed ? 'ALLOWED (允许)' : 'REJECTED (拒绝)'}</strong>
                    </p>
                  </div>
                  <span className="p5-backlog-time">{timeStr}</span>
                </div>
              );
            }

            if (ev.type === 'turn_done') {
              return (
                <div
                  key={`${ev.at}_${index}`}
                  className="p5-backlog-item p5-backlog-item--done"
                >
                  <div className="p5-backlog-badge">TURN DONE // 回合结算</div>
                  <div className="p5-backlog-content">
                    <p className="p5-backlog-text">
                      {ev.summary ?? (ev.ok ? '任务完成' : '任务中断')}
                    </p>
                  </div>
                  <span className="p5-backlog-time">{timeStr}</span>
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
};
