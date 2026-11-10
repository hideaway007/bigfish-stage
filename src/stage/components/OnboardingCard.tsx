import React, { useState } from 'react';
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
  workerAdapters,
  lastError,
  onStartWithDir,
  onOpenSystemMenu,
  onDismissError,
}) => {
  const [dirDraft, setDirDraft] = useState<string>(settings.projectDir ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const shortName = character.name.split('（')[0] || character.name;
  const inCharLine = `${shortName}（${character.codename}）已就位 —— 请先选定本地项目文件夹，开启新会话！`;

  const trimmed = dirDraft.trim();
  const isValidAbsPath = isAbsoluteProjectPath(trimmed);

  // Determine 3-step completion states
  const step1Done = Boolean(settings.projectDir);
  const activeAdapter = workerAdapters.find(
    (ad) => ad.id === settings.worker.adapter
  );
  const step2Done = Boolean(
    settings.worker.adapter &&
      settings.worker.model &&
      (activeAdapter ? activeAdapter.available : true)
  );
  const step3Done = false;

  const getValidationState = (): {
    status: 'neutral' | 'valid' | 'invalid';
    text: string;
  } => {
    if (!trimmed) {
      return {
        status: 'neutral',
        text: '提示：请输入本地项目文件夹绝对路径（以 / 开头），或点选下方最近项目',
      };
    }
    if (trimmed.startsWith('~')) {
      return {
        status: 'invalid',
        text: '⚠ 请填写展开后的完整绝对路径（以 / 开头，暂不支持 ~ 缩写）',
      };
    }
    if (!isValidAbsPath) {
      return {
        status: 'invalid',
        text: '⚠ 必须是绝对路径（需以 / 开头，不能使用相对路径）',
      };
    }
    return {
      status: 'valid',
      text: `✓ 绝对路径格式有效（${trimmed}），点击「开始」立即创建新会话`,
    };
  };

  const validation = getValidationState();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setLocalError('请先输入本地项目文件夹的绝对路径');
      return;
    }
    if (!isValidAbsPath) {
      setLocalError('项目目录必须是绝对路径（需以 / 开头）');
      return;
    }
    setLocalError(null);
    if (lastError) {
      onDismissError();
    }
    onStartWithDir(trimmed);
  };

  const handlePickRecent = (dir: string) => {
    setDirDraft(dir);
    setLocalError(null);
    if (lastError) {
      onDismissError();
    }
  };

  return (
    <div
      className="p5-onboard-card"
      data-testid="onboarding-card"
      role="region"
      aria-label="首次使用引导：选择项目文件夹"
    >
      {/* Top Slanted Ribbon */}
      <div className="p5-onboard-ribbon">
        <div className="p5-onboard-ribbon-left">
          <span className="p5-onboard-kicker">FIRST DIVE // 首次潜入引导</span>
          <strong className="p5-onboard-title">尚未选择项目文件夹</strong>
        </div>

        <button
          type="button"
          className="p5-onboard-sys-link"
          data-testid="onboarding-open-system-btn"
          onClick={() => onOpenSystemMenu('pond')}
        >
          ⚙ 打开 SYSTEM 菜单 [ESC]
        </button>
      </div>

      <div className="p5-onboard-body">
        {/* 3-Step Indicator: 选文件夹 → 选执行 Agent/模型 → 投喂第一条任务 */}
        <div className="p5-onboard-steps" data-testid="onboarding-steps">
          <div
            className={`p5-onboard-step ${step1Done ? 'is-done' : 'is-active'}`}
            data-testid="onboarding-step-1"
            data-step-status={step1Done ? 'done' : 'active'}
          >
            <div className="p5-onboard-step-top">
              <span className="p5-onboard-step-name">1. 选文件夹</span>
              <span className="p5-onboard-step-badge">
                {step1Done
                  ? '✓ 已完成'
                  : isValidAbsPath
                  ? '◉ 待确认'
                  : '● 当前步骤'}
              </span>
            </div>
            <span className="p5-onboard-step-sub">
              {settings.projectDir ??
                (isValidAbsPath ? trimmed : '指定本地工作仓库绝对路径')}
            </span>
          </div>

          <span className="p5-onboard-step-arrow" aria-hidden="true">
            →
          </span>

          <button
            type="button"
            className={`p5-onboard-step p5-onboard-step--clickable ${
              step2Done ? 'is-done' : 'is-active'
            }`}
            data-testid="onboarding-step-2"
            data-step-status={step2Done ? 'done' : 'active'}
            onClick={() => onOpenSystemMenu('worker')}
            title="点击打开 SYSTEM · 执行 Agent 设置"
          >
            <div className="p5-onboard-step-top">
              <span className="p5-onboard-step-name">2. 选执行 Agent/模型</span>
              <span className="p5-onboard-step-badge">
                {step2Done ? '✓ 已完成' : '● 待配置'}
              </span>
            </div>
            <span className="p5-onboard-step-sub">
              {settings.worker.adapter} · {settings.worker.model}
            </span>
          </button>

          <span className="p5-onboard-step-arrow" aria-hidden="true">
            →
          </span>

          <div
            className={`p5-onboard-step ${
              step3Done ? 'is-done' : 'is-pending'
            }`}
            data-testid="onboarding-step-3"
            data-step-status={step3Done ? 'done' : 'pending'}
          >
            <div className="p5-onboard-step-top">
              <span className="p5-onboard-step-name">3. 投喂第一条任务</span>
              <span className="p5-onboard-step-badge">
                {step3Done ? '✓ 已完成' : '○ 待解锁'}
              </span>
            </div>
            <span className="p5-onboard-step-sub">
              开启会话后在下方输入框发送指令
            </span>
          </div>
        </div>

        {/* Short In-Character Line from Active Character Pack */}
        <div
          className="p5-onboard-char-box"
          data-testid="onboarding-character-line"
        >
          <span className="p5-onboard-char-tag">{shortName}</span>
          <p className="p5-onboard-char-text" title={inCharLine}>
            {inCharLine}
          </p>
        </div>

        {/* Path Input + Start Button */}
        <form className="p5-onboard-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className={`p5-onboard-input ${
              validation.status === 'invalid' || localError || lastError
                ? 'is-invalid'
                : validation.status === 'valid'
                ? 'is-valid'
                : ''
            }`}
            data-testid="onboarding-dir-input"
            value={dirDraft}
            onChange={(e) => {
              setDirDraft(e.target.value);
              if (localError) setLocalError(null);
              if (lastError) onDismissError();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isValidAbsPath) {
                e.preventDefault();
                setLocalError(
                  !trimmed
                    ? '请先输入本地项目文件夹的绝对路径'
                    : '项目目录必须是绝对路径（需以 / 开头）'
                );
              }
            }}
            placeholder="/tmp/my-project（输入本地项目文件夹绝对路径）"
            aria-label="项目文件夹绝对路径"
          />
          <button
            type="submit"
            className="p5-onboard-start-btn"
            data-testid="onboarding-start-btn"
            disabled={!isValidAbsPath}
          >
            ★ 开始
          </button>
        </form>

        {/* Validation Hint or Graceful Command Error */}
        <div className="p5-onboard-meta-row">
          {lastError || localError ? (
            <div
              className="p5-onboard-error-inline"
              data-testid="stage-error-banner"
              role="alert"
            >
              <span data-testid="onboarding-error">
                ⚠ {lastError?.message ?? localError}
              </span>
              <button
                type="button"
                className="p5-error-dismiss-btn"
                onClick={() => {
                  setLocalError(null);
                  if (lastError) onDismissError();
                }}
              >
                知道了
              </button>
            </div>
          ) : (
            <span
              className={`p5-onboard-hint hint-${validation.status}`}
              data-testid="onboarding-path-hint"
            >
              {validation.text}
            </span>
          )}
        </div>

        {/* Recent Projects as One-Click Chips */}
        <div
          className="p5-onboard-recent-row"
          data-testid="onboarding-recent-list"
        >
          <span className="p5-onboard-recent-label">
            最近项目 (RECENT) //
          </span>
          {settings.recentProjects.length > 0 ? (
            settings.recentProjects.map((dir, idx) => (
              <button
                key={dir}
                type="button"
                className={`p5-onboard-chip ${
                  trimmed === dir ? 'is-selected' : ''
                }`}
                data-testid={`onboarding-recent-chip-${idx}`}
                onClick={() => handlePickRecent(dir)}
              >
                {dir}
              </button>
            ))
          ) : (
            <span className="p5-onboard-hint hint-neutral">
              暂无最近项目记录，请在上方输入绝对路径
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
