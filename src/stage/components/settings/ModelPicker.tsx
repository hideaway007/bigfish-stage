import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelListState } from '../../stageReducer';
import {
  filterModelsByQuery,
  groupModelsByProvider,
  splitHighlightSegments,
} from './connectionErrorMap';

interface ModelPickerProps {
  target: 'worker' | 'voice';
  label: string;
  currentModel: string;
  draft: string;
  onDraftChange: (nextDraft: string) => void;
  modelList: ModelListState;
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
  modelList,
  placeholder,
  refreshLabel = '↻ 刷新可选模型',
  onRefresh,
  onApplyModel,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const optionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Reset filter query when server-side currentModel changes
  useEffect(() => {
    setFilterQuery('');
    setActiveIndex(-1);
  }, [currentModel]);

  const filteredModels = useMemo(
    () => filterModelsByQuery(modelList.models, filterQuery),
    [modelList.models, filterQuery]
  );

  const groups = useMemo(
    () => groupModelsByProvider(filteredModels),
    [filteredModels]
  );

  // Flat list in visual group order for keyboard ↑/↓ navigation
  const flatModels = useMemo(
    () => groups.flatMap((g) => g.models),
    [groups]
  );

  // Keep activeIndex in bounds when filtered list changes
  useEffect(() => {
    if (flatModels.length === 0) {
      setActiveIndex(-1);
    } else if (activeIndex >= flatModels.length) {
      setActiveIndex(0);
    }
  }, [flatModels.length, activeIndex]);

  // Scroll active keyboard option into view
  useEffect(() => {
    if (activeIndex < 0 || activeIndex >= flatModels.length) return;
    const activeModel = flatModels[activeIndex];
    const el = optionRefs.current.get(activeModel);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, flatModels]);

  const selectAndApply = (modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed) return;
    onDraftChange(trimmed);
    onApplyModel(trimmed);
    setFilterQuery('');
    setActiveIndex(-1);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    source: 'main' | 'search'
  ) => {
    if (e.key === 'ArrowDown') {
      if (flatModels.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % flatModels.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (flatModels.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev <= 0 ? flatModels.length - 1 : prev - 1
        );
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < flatModels.length) {
        selectAndApply(flatModels[activeIndex]);
        return;
      }
      if (source === 'search' && flatModels.length > 0) {
        selectAndApply(flatModels[0]);
        return;
      }
      const trimmed = draft.trim();
      if (trimmed) {
        selectAndApply(trimmed);
      }
      return;
    }
    if (e.key === 'Escape' && filterQuery) {
      e.preventDefault();
      e.stopPropagation();
      setFilterQuery('');
      setActiveIndex(-1);
    }
  };

  const trimmedDraft = draft.trim();
  const isCustomDraft =
    trimmedDraft.length > 0 &&
    !modelList.models.some(
      (m) => m.toLowerCase() === trimmedDraft.toLowerCase()
    );
  const isCurrentCustom =
    Boolean(currentModel) &&
    modelList.models.length > 0 &&
    !modelList.models.includes(currentModel);

  return (
    <div
      className="p5-form-group p5-model-picker"
      data-testid={`${target}-model-picker`}
    >
      {/* Top label + current selection + refresh button */}
      <div className="p5-form-label-row">
        <label className="p5-form-label" htmlFor={`${target}-model-input`}>
          {label} — 当前生效：
          <code data-testid={`${target}-current-model-val`}>
            {currentModel}
          </code>
          {isCurrentCustom && (
            <span className="p5-model-custom-badge" title="当前使用的是手动输入的自定义模型 ID">
              自定义
            </span>
          )}
        </label>

        <button
          type="button"
          className="p5-mini-action-btn"
          data-testid={`${target}-refresh-models-btn`}
          onClick={onRefresh}
          disabled={modelList.loading}
        >
          {modelList.loading ? '⟳ 拉取中…' : refreshLabel}
        </button>
      </div>

      {/* Main input (supports both free-text custom model ID & filter-as-you-type + ↑↓ Enter) */}
      <div className="p5-input-inline-row">
        <input
          id={`${target}-model-input`}
          data-testid={`${target}-model-input`}
          type="text"
          className="p5-form-input"
          value={draft}
          onChange={(e) => {
            const val = e.target.value;
            onDraftChange(val);
            setFilterQuery(val);
            // 主输入框不预选：Enter 默认应用手填的原文，需 ↑↓ 才选列表项
            setActiveIndex(-1);
          }}
          onKeyDown={(e) => handleKeyDown(e, 'main')}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          className="p5-apply-btn"
          data-testid={`${target}-model-save-btn`}
          onClick={() => {
            if (trimmedDraft) {
              selectAndApply(trimmedDraft);
            }
          }}
        >
          应用模型
        </button>
      </div>

      {/* Loading banner */}
      {modelList.loading && (
        <div
          className="p5-model-loading-bar"
          data-testid={`${target}-models-loading`}
          role="status"
        >
          <span className="p5-model-loading-dot" />
          <span>正在从接口拉取可用模型列表…</span>
        </div>
      )}

      {/* Friendly error card when list_models returns an error */}
      {modelList.error && (
        <div
          className="p5-model-error-card"
          data-testid={`${target}-models-error`}
          role="alert"
        >
          <div className="p5-model-error-top">
            <span className="p5-model-error-tag">⚠ 模型列表获取失败</span>
            <span className="p5-model-error-msg">{modelList.error}</span>
            <button
              type="button"
              className="p5-mini-action-btn"
              data-testid={`${target}-models-retry-btn`}
              onClick={onRefresh}
            >
              ↻ 重试拉取
            </button>
          </div>
          <p className="p5-model-error-hint">
            提示：无法拉取列表时，你仍可在上方输入框直接手填任意自定义模型 ID 并点击「应用模型」。
          </p>
        </div>
      )}

      {/* Search / filter bar + grouped model list */}
      {modelList.models.length > 0 && (
        <div className="p5-model-catalog">
          <div className="p5-model-search-bar">
            <span className="p5-model-search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="text"
              className="p5-model-search-input"
              data-testid={`${target}-model-search`}
              value={filterQuery}
              onChange={(e) => {
                setFilterQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(e) => handleKeyDown(e, 'search')}
              placeholder="筛选模型（如 codex/、remote-magpie/、gemini，支持 ↑↓ 键与 Enter 选择）…"
              aria-label="搜索可选模型"
              autoComplete="off"
            />
            {filterQuery && (
              <button
                type="button"
                className="p5-model-search-clear"
                data-testid={`${target}-model-filter-clear`}
                onClick={() => {
                  setFilterQuery('');
                  setActiveIndex(-1);
                }}
              >
                × 全部 ({modelList.models.length})
              </button>
            )}
            <span
              className="p5-model-search-count"
              data-testid={`${target}-model-count`}
            >
              {filteredModels.length} / {modelList.models.length}
            </span>
          </div>

          <div
            className="p5-model-groups"
            data-testid={`${target}-model-list`}
            role="listbox"
            aria-label="可选模型分组列表"
          >
            {groups.map((group) => (
              <div
                key={group.prefixKey}
                className="p5-model-group"
                data-testid={`${target}-model-group-${group.prefixKey}`}
              >
                <div className="p5-model-group-header">
                  <span className="p5-model-group-prefix">{group.label}</span>
                  <span className="p5-model-group-cnt">
                    {group.models.length}
                  </span>
                </div>
                <div className="p5-model-select-chips">
                  {group.models.map((m) => {
                    const flatIdx = flatModels.indexOf(m);
                    const isSelected = currentModel === m;
                    const isKbdActive = flatIdx !== -1 && flatIdx === activeIndex;
                    const segments = splitHighlightSegments(m, filterQuery);

                    return (
                      <button
                        key={m}
                        ref={(el) => {
                          if (el) optionRefs.current.set(m, el);
                          else optionRefs.current.delete(m);
                        }}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-testid={`${target}-model-option-${m}`}
                        className={`p5-model-chip-btn ${
                          isSelected ? 'is-selected' : ''
                        } ${isKbdActive ? 'is-kbd-active' : ''}`}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => selectAndApply(m)}
                      >
                        <span className="p5-model-chip-text">
                          {segments.map((seg, i) =>
                            seg.matched ? (
                              <mark key={i} className="p5-model-highlight">
                                {seg.text}
                              </mark>
                            ) : (
                              <React.Fragment key={i}>{seg.text}</React.Fragment>
                            )
                          )}
                        </span>
                        {isSelected && (
                          <span className="p5-model-chip-cur">★ 当前</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {filteredModels.length === 0 && (
              <div
                className="p5-model-empty-match"
                data-testid={`${target}-model-empty-match`}
              >
                列表内无匹配「<code>{filterQuery}</code>
                」的预设模型，可直接点击下方或右上角「应用模型」作为自定义模型 ID 使用。
              </div>
            )}

            {isCustomDraft && (
              <button
                type="button"
                className="p5-model-custom-apply-btn"
                data-testid={`${target}-model-custom-option`}
                onClick={() => selectAndApply(trimmedDraft)}
              >
                + 使用自定义模型 ID：<code>{trimmedDraft}</code>（点击或按 Enter 应用）
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
