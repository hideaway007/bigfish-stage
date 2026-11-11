import React, { useEffect, useRef } from 'react';
import { playSfx } from '../sfx';
import type { PendingPermission } from '../stageReducer';
import '../cutins.css';

interface PermissionModalProps {
  permission: PendingPermission | null;
  selectedChoice: 'allow' | 'reject';
  characterId?: string;
  characterName: string;
  portraitUrl?: string | null;
  onSelectChoice: (choice: 'allow' | 'reject') => void;
  onConfirm: (allowed: boolean) => void;
}

export const PermissionModal: React.FC<PermissionModalProps> = ({
  permission,
  selectedChoice,
  characterId = 'deepseek-v4-pro',
  characterName,
  portraitUrl,
  onSelectChoice,
  onConfirm,
}) => {
  const prevChoiceRef = useRef(selectedChoice);
  useEffect(() => {
    if (prevChoiceRef.current !== selectedChoice) {
      prevChoiceRef.current = selectedChoice;
      playSfx('select');
    }
  }, [selectedChoice]);

  useEffect(() => {
    if (permission) playSfx('hover');
  }, [permission?.requestId]);

  if (!permission) return null;

  const eyePortraitSrc =
    portraitUrl || `/characters/${characterId}/art/portrait.png`;

  return (
    <div
      className="p5-permission-backdrop"
      data-testid="permission-modal"
      role="dialog"
      aria-modal="true"
      aria-label="权限审批选择肢"
    >
      <div className="p5-permission-cutin">
        {/* Dramatic P5 HOLD UP! diagonal crimson-and-black eye-strip cut-in */}
        <div className="p5-holdup-banner" data-testid="permission-holdup-banner">
          <div className="p5-holdup-speedlines" aria-hidden="true" />
          <div className="p5-holdup-eye-strip" aria-hidden="true">
            <img
              src={eyePortraitSrc}
              alt=""
              className="p5-holdup-eye-img"
            />
            <div className="p5-holdup-eye-gradient" />
          </div>
          <div className="p5-holdup-badge-cluster">
            <div className="p5-holdup-kicker">
              <em>HOLD UP!</em> // 权限决断
            </div>
            <span className="p5-permission-kbd-hint">
              键盘 [← / →] 切换 · [ENTER] 决断
            </span>
          </div>
        </div>

        <div className="p5-permission-main">
          <div className="p5-permission-header">
            <span className="p5-permission-tool-badge">
              {permission.tool.toUpperCase()} · {permission.rawName}
            </span>
            <h2 className="p5-permission-title">
              {characterName} 请求执行终端指令：{permission.summary}
            </h2>
          </div>

          {/* Verbatim command detail */}
          <div className="p5-permission-detail-box">
            <div className="p5-permission-detail-label">
              COMMAND DETAIL // 待执行命令全文（原样展示）
            </div>
            <pre
              className="p5-permission-detail-code"
              data-testid="permission-detail-text"
            >
              {permission.detail}
            </pre>
          </div>

          {/* Big P5 two-way choice blades */}
          <div className="p5-permission-choices">
            <button
              type="button"
              data-testid="permission-allow-btn"
              className={`p5-choice-blade p5-choice-blade--allow ${
                selectedChoice === 'allow' ? 'is-selected' : ''
              }`}
              onMouseEnter={() => {
                playSfx('hover');
                onSelectChoice('allow');
              }}
              onClick={() => onConfirm(true)}
            >
              <span className="p5-choice-arrow">
                {selectedChoice === 'allow' ? '▶' : ' '}
              </span>
              <div className="p5-choice-text-wrap">
                <span className="p5-choice-en">ALL-IN // 批准突入！</span>
                <span className="p5-choice-zh">允许执行</span>
              </div>
              <span className="p5-choice-sub">放行本次操作并继续推进</span>
            </button>

            <button
              type="button"
              data-testid="permission-reject-btn"
              className={`p5-choice-blade p5-choice-blade--reject ${
                selectedChoice === 'reject' ? 'is-selected' : ''
              }`}
              onMouseEnter={() => {
                playSfx('hover');
                onSelectChoice('reject');
              }}
              onClick={() => onConfirm(false)}
            >
              <span className="p5-choice-arrow">
                {selectedChoice === 'reject' ? '▶' : ' '}
              </span>
              <div className="p5-choice-text-wrap">
                <span className="p5-choice-en">STAND DOWN // 暂缓行动</span>
                <span className="p5-choice-zh">拒绝执行</span>
              </div>
              <span className="p5-choice-sub">拦截该命令并交回你处理</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
