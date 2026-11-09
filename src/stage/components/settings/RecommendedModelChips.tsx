import React, { useEffect, useRef, useState } from 'react';

interface RecommendedModelChipsProps {
  characterId: string;
  isCurrentCharacter: boolean;
  recommendedModels: string[];
  currentWorkerModel: string;
  currentVoiceModel: string;
  onApplyWorkerModel: (model: string) => void;
  onApplyVoiceModel: (model: string) => void;
}

export const RecommendedModelChips: React.FC<RecommendedModelChipsProps> = ({
  characterId,
  isCurrentCharacter,
  recommendedModels,
  currentWorkerModel,
  currentVoiceModel,
  onApplyWorkerModel,
  onApplyVoiceModel,
}) => {
  const [openModel, setOpenModel] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!openModel) return;
    const handleDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpenModel(null);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [openModel]);

  if (recommendedModels.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className={`p5-char-card-models ${
        isCurrentCharacter ? 'is-active-pack-models' : ''
      }`}
      data-testid={
        isCurrentCharacter
          ? 'active-pack-recommended-models'
          : `char-${characterId}-recommended-models`
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p5-rec-models-head">
        <span className="p5-field-tag">
          {isCurrentCharacter
            ? '★ 当前登场推荐模型（点击选用 · 不自动套用）'
            : '推荐搭配模型（点击选用 · 不自动套用）'}
        </span>
      </div>

      <div className="p5-model-pills">
        {recommendedModels.map((m) => {
          const isWorker = currentWorkerModel === m;
          const isVoice = currentVoiceModel === m;
          const isAppliedAny = isWorker || isVoice;
          const isOpen = openModel === m;

          return (
            <div key={m} className="p5-rec-chip-wrap">
              <button
                type="button"
                data-testid={
                  isCurrentCharacter
                    ? `rec-model-chip-${m}`
                    : `char-${characterId}-rec-model-${m}`
                }
                aria-expanded={isOpen}
                className={`p5-rec-chip-btn ${
                  isAppliedAny ? 'is-applied' : ''
                } ${isOpen ? 'is-open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenModel((prev) => (prev === m ? null : m));
                }}
              >
                <span className="p5-rec-chip-name">{m}</span>
                {isWorker && (
                  <span
                    className="p5-rec-applied-tag p5-rec-applied-tag--worker"
                    data-testid={
                      isCurrentCharacter
                        ? `rec-model-applied-worker-${m}`
                        : `char-${characterId}-applied-worker-${m}`
                    }
                  >
                    ✓ 执行
                  </span>
                )}
                {isVoice && (
                  <span
                    className="p5-rec-applied-tag p5-rec-applied-tag--voice"
                    data-testid={
                      isCurrentCharacter
                        ? `rec-model-applied-voice-${m}`
                        : `char-${characterId}-applied-voice-${m}`
                    }
                  >
                    ✓ 台词
                  </span>
                )}
              </button>

              {isOpen && (
                <div
                  className="p5-rec-popover"
                  data-testid={
                    isCurrentCharacter
                      ? `rec-model-menu-${m}`
                      : `char-${characterId}-rec-menu-${m}`
                  }
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p5-rec-popover-head">
                    <span className="p5-rec-popover-title" title={m}>
                      选用：{m}
                    </span>
                    <button
                      type="button"
                      className="p5-rec-popover-close"
                      aria-label="关闭菜单"
                      onClick={() => setOpenModel(null)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="p5-rec-popover-actions">
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={
                        isCurrentCharacter
                          ? `rec-model-apply-worker-${m}`
                          : `char-${characterId}-apply-worker-${m}`
                      }
                      className={`p5-rec-action-btn ${
                        isWorker ? 'is-current-role' : ''
                      }`}
                      onClick={() => {
                        onApplyWorkerModel(m);
                        setOpenModel(null);
                      }}
                    >
                      <span>用作执行 Agent 模型</span>
                      <span className="p5-rec-action-state">
                        {isWorker ? '✓ 已应用' : '套用 ▶'}
                      </span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      data-testid={
                        isCurrentCharacter
                          ? `rec-model-apply-voice-${m}`
                          : `char-${characterId}-apply-voice-${m}`
                      }
                      className={`p5-rec-action-btn ${
                        isVoice ? 'is-current-role' : ''
                      }`}
                      onClick={() => {
                        onApplyVoiceModel(m);
                        setOpenModel(null);
                      }}
                    >
                      <span>用作台词模型</span>
                      <span className="p5-rec-action-state">
                        {isVoice ? '✓ 已应用' : '套用 ▶'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
