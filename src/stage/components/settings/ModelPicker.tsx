import React, { useMemo } from 'react';
import type { ModelListState } from '../../stageReducer';
import { filterModelsByQuery } from './connectionErrorMap';

interface ModelPickerProps {
  target: 'worker' | 'voice';
  label: string;
  currentModel: string;
  draft: string;
  onDraftChange: (nextDraft: string) => void;
  modelList?: ModelListState;
  placeholder: string;
  refreshLabel?: string;
  onRefresh: () => void;
  onApplyModel: (model: string) => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  target,
  label,
  currentModel,
  draft,
  onDraftChange,
  modelList = { models: [], loading: false },
  placeholder,
  refreshLabel = '↻ 刷新列表',
  onRefresh,
  onApplyModel,
}) => {
  const safeModels = modelList?.models ?? [];
  const isLoading = Boolean(modelList?.loading);

  const filteredModels = useMemo(() => {
    const q = draft.trim();
    if (!q || q === currentModel) return safeModels;
    const matched = filterModelsByQuery(safeModels, q);
    return matched.length > 0 ? matched : safeModels;
  }, [safeModels, draft, currentModel]);

  const selectAndApply = (modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed) return;
    onDraftChange(trimmed);
    onApplyModel(trimmed);
  };

  return (
    <div
      className="p5-form-group p5-model-picker"
      data-testid={`${target}-model-picker`}
    >
      <div className="p5-form-label-row">
        <label className="p5-form-label" htmlFor={`${target}-model-input`}>
          {label}：
          <code data-testid={`${target}-current-model-val`}>
            {currentModel}
          </code>
        </label>

        <button
          type="button"
          className="p5-mini-action-btn"
          data-testid={`${target}-refresh-models-btn`}
          onClick={onRefresh}
          disabled={isLoading}
        >
          {isLoading ? '刷新中…' : refreshLabel}
        </button>
      </div>

      <div className="p5-input-inline-row">
        <input
          id={`${target}-model-input`}
          data-testid={`${target}-model-input`}
          type="text"
          className="p5-form-input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              selectAndApply(draft);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          className="p5-apply-btn"
          data-testid={`${target}-model-save-btn`}
          onClick={() => selectAndApply(draft)}
        >
          确定
        </button>
      </div>

      {safeModels.length > 0 && (
        <div
          className="p5-model-select-chips"
          data-testid={`${target}-model-list`}
          role="listbox"
          aria-label="可选模型列表"
        >
          {filteredModels.map((m) => {
            const isSelected = currentModel === m;
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid={`${target}-model-option-${m}`}
                className={`p5-model-chip-btn ${
                  isSelected ? 'is-selected' : ''
                }`}
                onClick={() => selectAndApply(m)}
              >
                {m}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
