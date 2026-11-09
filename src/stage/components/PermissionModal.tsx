import React from 'react';
import type { PendingPermission } from '../stageReducer';

interface PermissionModalProps {
  permission: PendingPermission | null;
  selectedChoice: 'allow' | 'reject';
  characterName: string;
  onSelectChoice: (choice: 'allow' | 'reject') => void;
  onConfirm: (allowed: boolean) => void;
}

export const PermissionModal: React.FC<PermissionModalProps> = ({
  permission,
  selectedChoice,
  characterName,
  onSelectChoice,
  onConfirm,
}) => {
  if (!permission) return null;

  return (
    <div
      className="p5-permission-backdrop"
      data-testid="permission-modal"
      role="dialog"
      aria-modal="true"
      aria-label="权限审批选择肢"
    >
      <div className="p5-permission-cutin">
        {/* Top warning slash */}
        <div className="p5-permission-ribbon">
          <span>MAX or LOW? // 举牌决定</span>
          <span className="p5-permission-kbd-hint">
            键盘 [← / →] 切换 · [ENTER] 决断
          </span>
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
              onMouseEnter={() => onSelectChoice('allow')}
              onClick={() => onConfirm(true)}
            >
              <span className="p5-choice-arrow">
                {selectedChoice === 'allow' ? '▶' : ' '}
              </span>
              <div className="p5-choice-text-wrap">
                <span className="p5-choice-en">MAX // 冲！</span>
                <span className="p5-choice-zh">允许执行</span>
              </div>
              <span className="p5-choice-sub">挥舞 Harness 跑单元测试</span>
            </button>

            <button
              type="button"
              data-testid="permission-reject-btn"
              className={`p5-choice-blade p5-choice-blade--reject ${
                selectedChoice === 'reject' ? 'is-selected' : ''
              }`}
              onMouseEnter={() => onSelectChoice('reject')}
              onClick={() => onConfirm(false)}
            >
              <span className="p5-choice-arrow">
                {selectedChoice === 'reject' ? '▶' : ' '}
              </span>
              <div className="p5-choice-text-wrap">
                <span className="p5-choice-en">LOW // 先别</span>
                <span className="p5-choice-zh">拒绝执行</span>
              </div>
              <span className="p5-choice-sub">跳过测试直接收工</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
