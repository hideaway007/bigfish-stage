import React, { useEffect, useState } from 'react';
import type { CharacterSummary } from '../../shared/character-pack';
import type { PublicSettings } from '../../shared/settings';
import type { Emotion } from '../../shared/stage-events';
import {
  getCachedCharacterPack,
  resolveCharacterAssetUrl,
} from '../characterLoader';
import { playSfx } from '../sfx';
import { CHARACTER_ROLE_META } from '../touchReactions';
import '../cutins.css';

/* ══════════════════════════════════════════════════════════════════════════
   1. ALL-OUT FINISH // 总攻击任务结算大演出
   ══════════════════════════════════════════════════════════════════════════ */
export interface AllOutFinishData {
  key: number;
  characterId: string;
  characterName: string;
  codename: string;
  themeColor: string;
  durationSec: string;
  filesCount: number;
  added: number;
  removed: number;
  toolCount: number;
  summaryText?: string | null;
}

export interface AllOutFinishOverlayProps {
  data: AllOutFinishData | null;
  onDismiss: () => void;
}

export const AllOutFinishOverlay: React.FC<AllOutFinishOverlayProps> = ({
  data,
  onDismiss,
}) => {
  useEffect(() => {
    if (!data) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [data?.key, onDismiss]);

  if (!data) return null;

  const pack = getCachedCharacterPack(data.characterId);
  const happySprite =
    pack.art.renderer === 'sprites'
      ? resolveCharacterAssetUrl(
          data.characterId,
          pack.art.emotions.happy ?? pack.art.emotions.idle
        )
      : `/characters/${data.characterId}/art/happy.png`;
  const artSrc = happySprite || `/characters/${data.characterId}/art/idle.png`;
  const shortName = data.characterName.split('（')[0] || data.characterName;

  return (
    <div
      key={`allout_${data.key}`}
      className="p5-allout-overlay"
      data-testid="all-out-finish-overlay"
      role="dialog"
      aria-label="任务结算演出"
      onClick={onDismiss}
    >
      {/* Shattered red-black geometric star rays */}
      <svg
        className="p5-allout-shatter-svg"
        viewBox="0 0 1600 900"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon points="0,0 640,0 420,900 0,900" fill="#07070c" opacity="0.62" />
        <polygon
          points="520,0 760,0 1600,320 1600,520 620,460"
          fill="#090910"
          opacity="0.72"
        />
        <polygon
          points="480,450 1600,140 1600,220 530,480"
          fill="#ffffff"
          opacity="0.92"
        />
        <polygon
          points="410,610 1600,560 1600,900 680,900"
          fill="#08080d"
          opacity="0.82"
        />
        <polygon
          points="360,590 1600,525 1600,552 380,612"
          fill="#facc15"
          opacity="0.9"
        />
      </svg>
      <div className="p5-allout-halftone" aria-hidden="true" />

      <div className="p5-allout-stage">
        <div className="p5-allout-portrait-zone">
          <img
            src={artSrc}
            alt=""
            aria-hidden="true"
            className="p5-allout-portrait-silhouette"
          />
          <img
            src={artSrc}
            alt={shortName}
            className="p5-allout-portrait-main"
          />
        </div>

        <div className="p5-allout-copy-zone">
          <span className="p5-allout-kicker">
            STAGE CLEAR // {shortName} · 任务决胜结算
          </span>
          <div className="p5-allout-headline-en">MISSION ACCOMPLISHED</div>
          <div className="p5-allout-headline-zh">STAGE CLEAR // 华丽收工</div>

          {data.summaryText && (
            <div className="p5-allout-summary-strip">{data.summaryText}</div>
          )}

          <div className="p5-allout-stats-row">
            <span className="p5-allout-stat-pill">
              ⏱ 耗时 {data.durationSec}s
            </span>
            <span className="p5-allout-stat-pill">
              📁 触及 {data.filesCount} 个文件
            </span>
            <span className="p5-allout-stat-pill">
              ⚡{' '}
              <span className="stat-add">+{data.added}</span> /{' '}
              <span className="stat-del">−{data.removed}</span> 行代码变更
              {data.toolCount > 0 ? ` · ${data.toolCount} 项行动` : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="p5-allout-seal" aria-hidden="true">
        ★ BIGFISH CLEAR!
      </div>
      <div className="p5-allout-dismiss-hint">
        点击屏幕任意处或按 ESC 立即关闭
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   2. BATON PASS // 怪盗团击掌换手接力选择器 & 1.4s 闪电演出
   ══════════════════════════════════════════════════════════════════════════ */
const BATON_PRESET_INSTRUCTIONS = [
  '帮我审查刚才的代码改动',
  '接着把界面细节打磨得更漂亮',
  '排查有没有潜在边界 Bug',
] as const;

export interface BatonPassModalProps {
  open: boolean;
  activeCharacterId: string;
  characters: CharacterSummary[];
  settings: PublicSettings;
  onClose: () => void;
  onConfirm: (toCharacterId: string, instruction: string) => void;
}

export const BatonPassModal: React.FC<BatonPassModalProps> = ({
  open,
  activeCharacterId,
  characters,
  settings,
  onClose,
  onConfirm,
}) => {
  const teammates = characters.filter((c) => c.id !== activeCharacterId);
  const [selectedId, setSelectedId] = useState<string>(
    teammates[0]?.id ?? 'claude-opus-5-5'
  );
  const [instruction, setInstruction] = useState<string>(
    BATON_PRESET_INSTRUCTIONS[0]
  );

  useEffect(() => {
    if (!open) return;
    const first = characters.find((c) => c.id !== activeCharacterId);
    if (first) {
      setSelectedId(first.id);
    }
  }, [open, activeCharacterId, characters]);

  if (!open) return null;

  const fromShortName =
    getCachedCharacterPack(activeCharacterId).name.split('（')[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    onConfirm(selectedId, instruction.trim());
  };

  return (
    <div
      className="p5-modal-backdrop"
      data-testid="baton-pass-modal"
      role="dialog"
      aria-modal="true"
      aria-label="角色换手接力选择"
      onClick={onClose}
    >
      <div className="p5-baton-modal" onClick={(e) => e.stopPropagation()}>
        <header className="p5-baton-header">
          <div>
            <span className="p5-baton-kicker">AGENT RELAY // 换手接力</span>
            <h2 className="p5-baton-title">
              从「{fromShortName}」击掌交接给哪位队友？
            </h2>
          </div>
          <button
            type="button"
            className="p5-close-btn"
            onClick={onClose}
            data-testid="baton-pass-close-btn"
          >
            ESC // 取消
          </button>
        </header>

        <form className="p5-baton-body" onSubmit={handleSubmit}>
          <div className="p5-baton-grid">
            {teammates.map((mate) => {
              const isSelected = mate.id === selectedId;
              const roleMeta = CHARACTER_ROLE_META[mate.id] ?? {
                shortTitle: mate.name.split('（')[0],
                specialtyTag: '接力支援',
                specialtyDesc: '接手当前改动上下文继续推进',
              };
              const brainModel =
                settings.characterBrains?.[mate.id]?.model ||
                settings.worker.model;
              const avatarSrc =
                mate.portraitUrl || `/characters/${mate.id}/art/portrait.png`;

              return (
                <button
                  key={mate.id}
                  type="button"
                  data-testid={`baton-target-${mate.id}`}
                  className={`p5-baton-card ${isSelected ? 'is-selected' : ''}`}
                  style={
                    {
                      '--teammate-color': mate.themeColor,
                    } as React.CSSProperties
                  }
                  onMouseEnter={() => playSfx('hover')}
                  onClick={() => {
                    playSfx('select');
                    setSelectedId(mate.id);
                  }}
                >
                  <div className="p5-baton-card-top">
                    <img
                      src={avatarSrc}
                      alt={roleMeta.shortTitle}
                      className="p5-baton-avatar"
                    />
                    <div>
                      <span className="p5-baton-role-tag">
                        {roleMeta.specialtyTag}
                      </span>
                      <div className="p5-baton-char-name">
                        {roleMeta.shortTitle}
                      </div>
                    </div>
                  </div>
                  <p className="p5-baton-desc">{roleMeta.specialtyDesc}</p>
                  <span className="p5-baton-brain-pill">
                    独立大脑：{brainModel}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p5-baton-presets">
            <span className="p5-baton-preset-label">快捷交接指令：</span>
            {BATON_PRESET_INSTRUCTIONS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`p5-baton-preset-chip ${
                  instruction === preset ? 'is-active' : ''
                }`}
                onClick={() => setInstruction(preset)}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="p5-baton-input-row">
            <input
              type="text"
              className="p5-baton-input"
              data-testid="baton-pass-input"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="可选：补充一句交接叮嘱（将连同本轮摘要与代码 Diff 一起传递给她）…"
            />
            <button
              type="submit"
              className="p5-baton-confirm-btn"
              data-testid="baton-pass-confirm-btn"
            >
              ⚡ 击掌换手 ▶
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export interface BatonPassCutinData {
  key: number;
  fromCharacterId: string;
  toCharacterId: string;
  summary?: string;
}

export const BatonPassCutin: React.FC<{
  data: BatonPassCutinData | null;
  onDismiss: () => void;
}> = ({ data, onDismiss }) => {
  useEffect(() => {
    if (!data) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [data?.key, onDismiss]);

  if (!data) return null;

  const fromPack = getCachedCharacterPack(data.fromCharacterId);
  const toPack = getCachedCharacterPack(data.toCharacterId);
  const fromName = fromPack.name.split('（')[0];
  const toName = toPack.name.split('（')[0];
  const toRole = CHARACTER_ROLE_META[data.toCharacterId]?.specialtyTag ?? '接力登场';

  return (
    <div
      key={`baton_cutin_${data.key}`}
      className="p5-baton-cutin"
      data-testid="baton-pass-cutin"
      style={
        {
          '--baton-to-color': toPack.themeColor,
        } as React.CSSProperties
      }
      onClick={onDismiss}
    >
      <div className="p5-baton-cutin-slash">
        <div className="p5-baton-relay-row">
          <div className="p5-baton-fighter">
            <img
              src={`/characters/${data.fromCharacterId}/art/portrait.png`}
              alt={fromName}
              className="p5-baton-fighter-img"
            />
            <div className="p5-baton-fighter-meta">
              <span className="p5-baton-fighter-tag">HANDOFF FROM // 交棒</span>
              <strong className="p5-baton-fighter-name">{fromName}</strong>
            </div>
          </div>

          <div className="p5-baton-lightning-hub">
            <div className="p5-baton-lightning-bolt">
              ⚡ AGENT RELAY // 换手接力! ★
            </div>
          </div>

          <div className="p5-baton-fighter is-to">
            <img
              src={`/characters/${data.toCharacterId}/art/portrait.png`}
              alt={toName}
              className="p5-baton-fighter-img"
            />
            <div className="p5-baton-fighter-meta">
              <span className="p5-baton-fighter-tag">
                RELAY TO // {toRole}
              </span>
              <strong className="p5-baton-fighter-name">{toName}</strong>
            </div>
          </div>
        </div>

        {data.summary && (
          <div className="p5-baton-summary-bar">{data.summary}</div>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   3. SUB-NAVIGATOR // 场外队友菱形雷达插嘴窗 (3.8s 自动收起)
   ══════════════════════════════════════════════════════════════════════════ */
export interface NavigatorCutinData {
  key: number;
  characterId: string;
  emotion: Emotion;
  text: string;
}

export const NavigatorCutin: React.FC<{
  data: NavigatorCutinData | null;
  onDismiss: () => void;
}> = ({ data, onDismiss }) => {
  useEffect(() => {
    if (!data) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, 3800);
    return () => window.clearTimeout(timer);
  }, [data?.key, onDismiss]);

  if (!data) return null;

  const pack = getCachedCharacterPack(data.characterId);
  const shortName = pack.name.split('（')[0] || pack.name;
  const portraitSrc =
    resolveCharacterAssetUrl(data.characterId, pack.art.portrait) ||
    `/characters/${data.characterId}/art/portrait.png`;

  return (
    <aside
      key={`navi_${data.key}`}
      className="p5-navi-cutin"
      data-testid="sub-navigator-cutin"
      style={
        {
          '--navi-color': pack.themeColor,
        } as React.CSSProperties
      }
      onClick={onDismiss}
      title="点击关闭场外支援提示"
    >
      <div className="p5-navi-callout">
        <div className="p5-navi-callout-head">
          <span className="p5-navi-badge">NAVI // 场外支援</span>
          <strong className="p5-navi-speaker">{shortName}</strong>
        </div>
        <div className="p5-navi-text">{data.text}</div>
      </div>

      <div className="p5-navi-diamond-wrap" aria-hidden="true">
        <div className="p5-navi-diamond-ring" />
        <div className="p5-navi-diamond-frame">
          <img
            src={portraitSrc}
            alt={shortName}
            className="p5-navi-diamond-img"
          />
        </div>
      </div>
    </aside>
  );
};
