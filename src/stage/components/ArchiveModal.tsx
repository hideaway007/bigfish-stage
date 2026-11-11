import React, { useEffect, useMemo, useState } from 'react';
import type {
  GitOpNotice,
  GitStatusState,
  SkillCardItem,
} from '../stageReducer';
import { DiffViewer } from './DiffViewer';

type ArchiveTab = 'step' | 'git';

const GIT_STATUS_LABELS: Record<
  string,
  { label: string; cls: string }
> = {
  M: { label: 'M 修改', cls: 'status-m' },
  A: { label: 'A 新增', cls: 'status-a' },
  D: { label: 'D 删除', cls: 'status-d' },
  '?': { label: '? 未跟踪', cls: 'status-q' },
  R: { label: 'R 重命名', cls: 'status-r' },
};

function filterUnifiedDiffForPath(fullDiff: string, targetPath: string | null): string {
  if (!targetPath || !fullDiff) return fullDiff;
  const lines = fullDiff.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let matched = false;

  const flush = () => {
    if (matched && current.length > 0) {
      chunks.push(current.join('\n'));
    }
    current = [];
    matched = false;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ') || (line.startsWith('--- ') && current.some((l) => l.startsWith('@@')))) {
      flush();
    }
    current.push(line);
    if (
      (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git ')) &&
      line.includes(targetPath)
    ) {
      matched = true;
    }
  }
  flush();
  return chunks.join('\n') || fullDiff;
}

interface ArchiveModalProps {
  card: SkillCardItem | null;
  gitDrawerOpen?: boolean;
  gitStatus?: GitStatusState;
  gitOpNotice?: GitOpNotice | null;
  characterName: string;
  onClose: () => void;
  onRequestGitStatus?: () => void;
  onRevertGitFile?: (path: string) => void;
  onCommitGit?: (message: string) => void;
}

export const ArchiveModal: React.FC<ArchiveModalProps> = ({
  card,
  gitDrawerOpen = false,
  gitStatus,
  gitOpNotice = null,
  characterName,
  onClose,
  onRequestGitStatus,
  onRevertGitFile,
  onCommitGit,
}) => {
  const isOpen = Boolean(card) || gitDrawerOpen;
  const [activeTab, setActiveTab] = useState<ArchiveTab>(
    gitDrawerOpen ? 'git' : 'step'
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [confirmRevertPath, setConfirmRevertPath] = useState<string | null>(
    null
  );
  const [commitMessage, setCommitMessage] = useState<string>('');

  useEffect(() => {
    if (gitDrawerOpen) {
      setActiveTab('git');
      onRequestGitStatus?.();
    } else if (card) {
      setActiveTab('step');
    }
  }, [gitDrawerOpen, card?.toolUseId]);

  useEffect(() => {
    if (!confirmRevertPath) return;
    const t = window.setTimeout(() => setConfirmRevertPath(null), 4500);
    return () => window.clearTimeout(t);
  }, [confirmRevertPath]);

  useEffect(() => {
    if (gitOpNotice?.op === 'commit' && gitOpNotice.ok) {
      setCommitMessage('');
      setSelectedFilePath(null);
    }
    if (gitOpNotice?.op === 'revert' && gitOpNotice.ok) {
      setConfirmRevertPath(null);
    }
  }, [gitOpNotice?.at]);

  const gitTotals = useMemo(() => {
    const files = gitStatus?.files ?? [];
    return files.reduce(
      (acc, f) => {
        acc.added += f.added || 0;
        acc.removed += f.removed || 0;
        return acc;
      },
      { added: 0, removed: 0 }
    );
  }, [gitStatus?.files]);

  const displayedGitDiff = useMemo(
    () => filterUnifiedDiffForPath(gitStatus?.diff ?? '', selectedFilePath),
    [gitStatus?.diff, selectedFilePath]
  );

  if (!isOpen) return null;

  const durationMs =
    card && card.endedAt !== undefined
      ? Math.max(0, card.endedAt - card.startedAt)
      : null;

  const handleSwitchToGitTab = () => {
    setActiveTab('git');
    onRequestGitStatus?.();
  };

  const handleCommitSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commitMessage.trim();
    if (!trimmed || !gitStatus?.files.length) return;
    onCommitGit?.(trimmed);
  };

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
        className="p5-archive-modal p5-trophy-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p5-archive-header">
          <div className="p5-archive-title-group">
            <span className="p5-archive-kicker">
              PHANTOM TROPHY & ARCHIVE // 战利品与行动档案
            </span>
            <h2 className="p5-archive-title">
              {activeTab === 'git' ? (
                <>工作区总变更审查 (Git Trophy)</>
              ) : card ? (
                <>
                  {characterName} 发动 {card.tool.toUpperCase()} ▶{' '}
                  <code>{card.file ?? card.summary}</code>
                </>
              ) : (
                <>单步行动档案</>
              )}
            </h2>
          </div>

          <div className="p5-archive-meta">
            <div className="p5-archive-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'step'}
                data-testid="archive-tab-step"
                className={`p5-archive-tab-btn ${
                  activeTab === 'step' ? 'is-active' : ''
                }`}
                onClick={() => setActiveTab('step')}
              >
                单步行动档案
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'git'}
                data-testid="archive-tab-git"
                className={`p5-archive-tab-btn ${
                  activeTab === 'git' ? 'is-active' : ''
                }`}
                onClick={handleSwitchToGitTab}
              >
                工作区总变更 (Git)
                {gitStatus?.loaded && gitStatus.files.length > 0
                  ? ` (${gitStatus.files.length})`
                  : ''}
              </button>
            </div>

            {activeTab === 'step' && card?.diffStats && (
              <span className="p5-diff-stat-pill">
                <strong className="stat-add">+{card.diffStats.added}</strong>{' '}
                <strong className="stat-del">−{card.diffStats.removed}</strong>
              </span>
            )}
            {activeTab === 'step' && card && (
              <span
                className={`p5-status-stamp p5-status-stamp--${card.status}`}
              >
                {card.status === 'running'
                  ? 'EXECUTING'
                  : card.status === 'success'
                  ? 'SUCCESS // 命中'
                  : 'FAILED // 失误'}
              </span>
            )}
            {activeTab === 'step' && durationMs !== null && (
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

        {activeTab === 'step' ? (
          card ? (
            <>
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
            </>
          ) : (
            <div className="p5-archive-body">
              <div className="p5-git-empty-state">
                当前尚未选中单步工具卡片。可在主舞台点击任意行动记录，或切换到上方「工作区总变更 (Git)」审查全量代码改动。
              </div>
            </div>
          )
        ) : (
          <>
            {/* Git Trophy Subbar */}
            <div className="p5-archive-subbar p5-git-subbar">
              <div className="p5-git-subbar-left">
                {gitStatus?.isRepo !== false ? (
                  <>
                    <span
                      className="p5-git-branch-pill"
                      data-testid="git-branch-badge"
                    >
                      ⎇ {gitStatus?.branch || 'HEAD'}
                    </span>
                    <span>
                      共 <strong>{gitStatus?.files.length ?? 0}</strong> 个变更文件
                    </span>
                    {(gitTotals.added > 0 || gitTotals.removed > 0) && (
                      <span className="p5-diff-stat-pill">
                        <strong className="stat-add">+{gitTotals.added}</strong>{' '}
                        <strong className="stat-del">
                          −{gitTotals.removed}
                        </strong>
                      </span>
                    )}
                    {selectedFilePath && (
                      <button
                        type="button"
                        className="p5-git-filter-clear"
                        onClick={() => setSelectedFilePath(null)}
                      >
                        筛选中：{selectedFilePath} × 显示全部
                      </button>
                    )}
                  </>
                ) : (
                  <span>当前工作文件夹尚未初始化 Git 仓库</span>
                )}
              </div>

              <button
                type="button"
                className="p5-git-refresh-btn"
                data-testid="git-refresh-btn"
                onClick={() => onRequestGitStatus?.()}
                disabled={gitStatus?.loading}
              >
                {gitStatus?.loading ? '正在读取…' : '↻ 刷新状态'}
              </button>
            </div>

            <div className="p5-archive-body p5-git-drawer-body">
              {gitOpNotice && (
                <div
                  className={`p5-git-op-banner ${
                    gitOpNotice.ok ? 'is-ok' : 'is-err'
                  }`}
                  data-testid="git-op-notice"
                  role="status"
                >
                  <span>
                    {gitOpNotice.ok ? '✓' : '✗'} {gitOpNotice.message}
                  </span>
                </div>
              )}

              {gitStatus?.error && (
                <div className="p5-git-op-banner is-err">
                  <span>提示：{gitStatus.error}</span>
                </div>
              )}

              {gitStatus?.isRepo === false ? (
                <div className="p5-git-empty-state">
                  当前工作目录还不是 Git 仓库，暂时无法展示分支变更。
                </div>
              ) : (gitStatus?.files.length ?? 0) === 0 ? (
                <div
                  className="p5-git-empty-state"
                  data-testid="git-clean-state"
                >
                  ★ 当前工作区非常干净，没有未提交的文件改动。
                </div>
              ) : (
                <>
                  <div
                    className="p5-git-files-list"
                    data-testid="git-files-list"
                  >
                    {gitStatus!.files.map((f, idx) => {
                      const meta = GIT_STATUS_LABELS[f.status] ?? {
                        label: f.status,
                        cls: 'status-m',
                      };
                      const isConfirming = confirmRevertPath === f.path;
                      const isFiltered = selectedFilePath === f.path;
                      return (
                        <div
                          key={f.path}
                          className={`p5-git-file-row ${
                            isFiltered ? 'is-selected' : ''
                          }`}
                          data-testid={`git-file-row-${idx}`}
                        >
                          <span className={`p5-git-status-tag ${meta.cls}`}>
                            {meta.label}
                          </span>
                          <button
                            type="button"
                            className="p5-git-file-path-btn"
                            onClick={() =>
                              setSelectedFilePath((prev) =>
                                prev === f.path ? null : f.path
                              )
                            }
                            title="点击筛选此文件的 Diff"
                          >
                            <code>{f.path}</code>
                          </button>
                          <span className="p5-git-file-nums">
                            <strong className="stat-add">+{f.added}</strong>{' '}
                            <strong className="stat-del">−{f.removed}</strong>
                          </span>

                          <div className="p5-git-revert-group">
                            {isConfirming ? (
                              <>
                                <button
                                  type="button"
                                  className="p5-git-revert-confirm-btn"
                                  data-testid={`git-revert-confirm-${idx}`}
                                  onClick={() => {
                                    onRevertGitFile?.(f.path);
                                    setConfirmRevertPath(null);
                                  }}
                                >
                                  确认撤回？
                                </button>
                                <button
                                  type="button"
                                  className="p5-git-revert-cancel-btn"
                                  onClick={() => setConfirmRevertPath(null)}
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="p5-git-revert-btn"
                                data-testid={`git-revert-btn-${idx}`}
                                onClick={() => setConfirmRevertPath(f.path)}
                              >
                                ↩ 撤回此文件改动
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {displayedGitDiff ? (
                    <DiffViewer diff={displayedGitDiff} />
                  ) : (
                    <div className="p5-git-empty-state">
                      暂无可视化文本 Diff（可能仅包含未跟踪或二进制文件）。
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Bottom 1-Line Git Commit Bar */}
            <form
              className="p5-git-commit-bar"
              data-testid="git-commit-bar"
              onSubmit={handleCommitSubmit}
            >
              <input
                type="text"
                className="p5-git-commit-input"
                data-testid="git-commit-input"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="输入提交说明（例如 feat: 完成登录按钮主题色改造），一键生成 Git 提交…"
                disabled={
                  gitStatus?.isRepo === false ||
                  (gitStatus?.files.length ?? 0) === 0
                }
              />
              <button
                type="submit"
                className="p5-git-commit-btn"
                data-testid="git-commit-btn"
                disabled={
                  gitStatus?.isRepo === false ||
                  (gitStatus?.files.length ?? 0) === 0 ||
                  !commitMessage.trim()
                }
              >
                ★ 一键 Git Commit
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
