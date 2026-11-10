import React, { useEffect, useState } from 'react';
import type { CharacterPack } from '../../shared/character-pack';
import type { PublicSettings, WorkerAdapterInfo } from '../../shared/settings';
import type { StageErrorNotice, SystemMenuTab } from '../stageReducer';
import '../onboarding.css';

export interface OnboardingCardProps {
  character: CharacterPack;
  settings: PublicSettings;
  workerAdapters: WorkerAdapterInfo[];
  lastError: StageErrorNotice | null;
  onStartWithDir: (projectDir: string) => void;
  onOpenSystemMenu: (tab?: SystemMenuTab) => void;
  onDismissError: () => void;
}

export function isAbsoluteProjectPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('~')) return false;
  return /^(\/|([a-zA-Z]:[\\/]))/.test(trimmed);
}

export const OnboardingCard: React.FC<OnboardingCardProps> = ({
  character,
  settings,
  lastError,
  onStartWithDir,
  onOpenSystemMenu,
  onDismissError,
}) => {
  const [dirDraft, setDirDraft] = useState<string>(settings.projectDir ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/default-directory')
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data.cwd) {
          setDirDraft((current) => current || settings.projectDir || data.cwd);
        }
      })
      .catch(() => {});
  }, [settings.projectDir]);

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const electronAPI = (
        window as unknown as {
          electronAPI?: { pickDirectory: () => Promise<string | null> };
        }
      ).electronAPI;
      if (electronAPI?.pickDirectory) {
        const selected = await electronAPI.pickDirectory();
        if (selected) {
          setDirDraft(selected);
          setLocalError(null);
          if (lastError) onDismissError();
        }
        return;
      }

      const res = await fetch('/api/pick-directory', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.path) {
          setDirDraft(data.path);
          setLocalError(null);
          if (lastError) onDismissError();
        }
      }
    } catch (e) {
      console.error('Failed to pick directory:', e);
    } finally {
      setBrowsing(false);
    }
  };

  const shortName = character.name.split('（')[0] || character.name;
  const trimmed = dirDraft.trim();
  const isValidAbsPath = isAbsoluteProjectPath(trimmed);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setLocalError('请先选择或输入工作文件夹路径');
      return;
    }
    if (!isValidAbsPath) {
      setLocalError('请选择完整文件夹路径（以 / 开头）');
      return;
    }
    setLocalError(null);
    if (lastError) {
      onDismissError();
    }
    onStartWithDir(trimmed);
  };

  return (
    <div
      className="p5-onboard-card"
      data-testid="onboarding-card"
      role="region"
      aria-label="选择工作文件夹"
    >
      <div className="p5-onboard-ribbon">
        <div className="p5-onboard-ribbon-left">
          <strong className="p5-onboard-title">
            先选择一个工作文件夹，让{shortName}开始帮你干活
          </strong>
        </div>
        <button
          type="button"
          className="p5-onboard-sys-link"
          data-testid="onboarding-open-system-btn"
          onClick={() => onOpenSystemMenu('pond')}
        >
          更多设置
        </button>
      </div>

      <div className="p5-onboard-body">
        <form className="p5-onboard-form" onSubmit={handleSubmit}>
          <div className="p5-onboard-input-row">
            <input
              type="text"
              className="p5-onboard-input"
              data-testid="onboarding-dir-input"
              value={dirDraft}
              onChange={(e) => {
                setDirDraft(e.target.value);
                if (localError) setLocalError(null);
              }}
              placeholder="点击右侧「选择文件夹」或直接输入路径…"
              autoComplete="off"
            />
            <button
              type="button"
              className="p5-onboard-browse-btn"
              data-testid="onboarding-browse-btn"
              onClick={handleBrowse}
              disabled={browsing}
            >
              {browsing ? '打开中…' : '📁 选择文件夹'}
            </button>
            <button
              type="submit"
              className="p5-onboard-start-btn"
              data-testid="onboarding-start-btn"
              disabled={!isValidAbsPath}
            >
              开始 ▶
            </button>
          </div>

          {localError && (
            <div
              className="p5-onboard-error-msg"
              data-testid="onboarding-error-msg"
              role="alert"
            >
              {localError}
            </div>
          )}
        </form>

        {settings.recentProjects.length > 0 && (
          <div
            className="p5-onboard-recent"
            data-testid="onboarding-recent-section"
          >
            <span className="p5-onboard-recent-label">最近打开的文件夹：</span>
            <div className="p5-onboard-recent-chips">
              {settings.recentProjects.map((dir) => (
                <button
                  key={dir}
                  type="button"
                  className={`p5-onboard-recent-chip ${
                    trimmed === dir ? 'is-selected' : ''
                  }`}
                  data-testid="onboarding-recent-chip"
                  onClick={() => onStartWithDir(dir)}
                >
                  📁 {dir.split('/').pop() || dir}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
