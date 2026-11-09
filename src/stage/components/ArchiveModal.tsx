import React from 'react';
import type { SkillCardItem } from '../stageReducer';
import { DiffViewer } from './DiffViewer';

interface ArchiveModalProps {
  card: SkillCardItem | null;
  characterName: string;
  onClose: () => void;
}

export const ArchiveModal: React.FC<ArchiveModalProps> = ({
  card,
  characterName,
  onClose,
}) => {
  if (!card) return null;

  const durationMs =
    card.endedAt !== undefined ? Math.max(0, card.endedAt - card.startedAt) : null;

  return (
    <div
      className="p5-modal-backdrop"
      onClick={onClose}
      data-testid="archive-modal"
      role="dialog"
      aria-modal="true"
      aria-label="档案层详情"
    >
      <div
        className="p5-archive-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p5-archive-header">
          <div className="p5-archive-title-group">
            <span className="p5-archive-kicker">ARCHIVE DOSSIER // 档案层</span>
            <h2 className="p5-archive-title">
              {characterName} 发动 {card.tool.toUpperCase()} ▶{' '}
              <code>{card.file ?? card.summary}</code>
            </h2>
          </div>

          <div className="p5-archive-meta">
            {card.diffStats && (
              <span className="p5-diff-stat-pill">
                <strong className="stat-add">+{card.diffStats.added}</strong>{' '}
                <strong className="stat-del">−{card.diffStats.removed}</strong>
              </span>
            )}
            <span
              className={`p5-status-stamp p5-status-stamp--${card.status}`}
            >
              {card.status === 'running'
                ? 'EXECUTING'
                : card.status === 'success'
                ? 'SUCCESS // 命中'
                : 'FAILED // 失误'}
            </span>
            {durationMs !== null && (
              <span className="p5-archive-duration">{durationMs}ms</span>
            )}
            <button
              type="button"
              className="p5-close-btn"
              onClick={onClose}
              data-testid="archive-close-btn"
            >
              ESC // 关闭
            </button>
          </div>
        </div>

        <div className="p5-archive-subbar">
          <span>
            RAW TOOL: <strong>{card.rawName}</strong> ({card.toolUseId})
          </span>
          {card.endSummary && (
            <span>
              RESULT: <strong>{card.endSummary}</strong>
            </span>
          )}
        </div>

        <div className="p5-archive-body">
          <DiffViewer diff={card.diff} output={card.output} />
        </div>
      </div>
    </div>
  );
};
