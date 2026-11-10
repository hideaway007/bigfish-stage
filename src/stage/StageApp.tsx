import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  preloadCharacterPacks,
  subscribeCharacterPacks,
} from './characterLoader';
import {
  createInitialStageState,
  stageReducer,
  type SkillCardItem,
  type SystemMenuTab,
} from './stageReducer';
import { DEFAULT_FIRST_USER_PROMPT } from '../demo/script';
import { LiveSource } from './sources/LiveSource';
import { ScriptSource } from './sources/ScriptSource';
import type {
  ConnectionStatus,
  DataSourceMode,
  StageDataSource,
  StageDataSourceCallbacks,
} from './sources/types';
import { CharacterRenderer } from './components/CharacterRenderer';
import { ArchiveModal } from './components/ArchiveModal';
import { PermissionModal } from './components/PermissionModal';
import { BacklogModal } from './components/BacklogModal';
import { SessionListControl } from './components/SessionListModal';
import { EngineeringView } from './components/EngineeringView';
import { isTypingTarget } from './components/ShortcutHelp';
import { SystemMenuModal } from './components/SystemMenuModal';
import { defaultCharacterLine, resolveEmotionLabel, resolveUiCopy } from './uiCopy';
import { SwitchTransition, SfxMuteButton } from './components/SwitchTransition';
import { playSfx } from './sfx';
import { OnboardingCard } from './components/OnboardingCard';
import type { ToolKind } from '../shared/stage-events';
import type { SettingsPatch } from '../shared/settings';
import type { ServerMessage } from '../shared/wire';

const HUD_STATUS_TEXT = {
  idle: { zh: '待机', en: 'STANDBY', gauge: 38 },
  thinking: { zh: '思考中', en: 'THINKING', gauge: 72 },
  acting: { zh: '行动中', en: 'IN ACTION', gauge: 100 },
} as const;

const TOOL_DISPLAY_LABELS: Record<ToolKind, string> = {
  read: 'READ',
  edit: 'EDIT',
  write: 'WRITE',
  bash: 'BASH',
  search: 'SEARCH',
  web: 'WEB',
  task: 'TASK',
  other: 'TOOL',
};

function detectSourceMode(): DataSourceMode {
  const params = new URLSearchParams(window.location.search);
  const demoVal = params.get('demo');
  if (demoVal === '1' || demoVal === 'true') {
    return 'demo';
  }
  return 'live';
}

function extractInlineDiffLines(diff?: string): { kind: 'add' | 'del'; text: string }[] {
  if (!diff) return [];
  const rows: { kind: 'add' | 'del'; text: string }[] = [];
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) {
      continue;
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', text: raw });
    } else if (raw.startsWith('-')) {
      rows.push({ kind: 'del', text: raw });
    }
    if (rows.length >= 4) break;
  }
  return rows;
}

export const StageApp: React.FC = () => {
  const [sourceMode] = useState<DataSourceMode>(detectSourceMode);

  const [state, dispatch] = useReducer(
    stageReducer,
    DEFAULT_CHARACTER_ID,
    createInitialStageState
  );

  // Force re-render when character pack JSONs finish loading
  const [, setPackVersion] = useState(0);
  useEffect(() => {
    void preloadCharacterPacks();
    return subscribeCharacterPacks(() => {
      setPackVersion((v) => v + 1);
    });
  }, []);

  const [connStatus, setConnStatus] = useState<ConnectionStatus>({
    state: sourceMode === 'demo' ? 'connected' : 'connecting',
    attempt: 0,
    hasEverConnected: sourceMode === 'demo',
  });

  const [inputValue, setInputValue] = useState<string>(
    sourceMode === 'demo' ? DEFAULT_FIRST_USER_PROMPT : ''
  );
  const [typedLength, setTypedLength] = useState<number>(0);
  const [fadeReplaceKey, setFadeReplaceKey] = useState<number>(0);
  const [inlinePreviewId, setInlinePreviewId] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState<{
    used: number;
    max: number;
  }>({ used: 45000, max: 1000000 });
  const [compactionState, setCompactionState] = useState<{
    activeCutin: boolean;
    turnsCompacted: number;
    freedTokens: number;
    summaryText: string;
    compactedAt: number | null;
  }>({
    activeCutin: false,
    turnsCompacted: 10,
    freedTokens: 80000,
    summaryText: '已将前 10 轮历史压缩为摘要卡，释放 80,000 Tokens！',
    compactedAt: null,
  });

  const sourceRef = useRef<StageDataSource | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const collapseTimersRef = useRef<Map<string, number>>(new Map());

  const prevLineTrackRef = useRef<{
    lineKey: string;
    replaceVersion: number;
    wasTyping: boolean;
  }>({
    lineKey: '',
    replaceVersion: 0,
    wasTyping: false,
  });

  const character = getCachedCharacterPack(state.characterId);
  const shortNickname = character.name.split('（')[0];
  const uiCopy = resolveUiCopy(character);
  const dialogueCharacter = getCachedCharacterPack(
    state.currentLine?.characterId ?? state.characterId
  );

  // Connect data source on mount
  useEffect(() => {
    const callbacks: StageDataSourceCallbacks = {
      onServerMessage: (message: ServerMessage) => {
        dispatch({ type: 'SERVER_MESSAGE', message });
      },
      onConnectionChange: (status: ConnectionStatus) => {
        setConnStatus(status);
      },
    };

    const source: StageDataSource =
      sourceMode === 'demo'
        ? new ScriptSource(callbacks)
        : new LiveSource(callbacks);

    sourceRef.current = source;
    source.connect();

    return () => {
      source.dispose();
      sourceRef.current = null;
      for (const timer of collapseTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      collapseTimersRef.current.clear();
    };
  }, [sourceMode]);

  // Sync fastForward with data source
  useEffect(() => {
    sourceRef.current?.setFastForward?.(state.fastForward);
  }, [state.fastForward]);

  // Auto-select latest card with diff for inline preview & sync DSH context/compaction events
  useEffect(() => {
    const latestDiffCard = [...state.skillCards]
      .reverse()
      .find((c) => Boolean(c.diff));
    if (latestDiffCard) {
      setInlinePreviewId(latestDiffCard.toolUseId);
    } else if (state.skillCards.length === 0) {
      setInlinePreviewId(null);
    }
  }, [state.skillCards]);

  useEffect(() => {
    if (state.events.length === 0) return;
    const lastEv = state.events[state.events.length - 1];
    if (lastEv.type === 'context_usage') {
      setContextTokens({
        used: lastEv.usedTokens,
        max: lastEv.maxTokens || 1000000,
      });
    } else if (lastEv.type === 'context_compacted') {
      const msg =
        lastEv.summary ||
        `已成功将前 ${lastEv.turnsCompacted} 轮历史压缩为摘要卡，释放 ${lastEv.freedTokens.toLocaleString()} Tokens！`;
      setCompactionState({
        activeCutin: true,
        turnsCompacted: lastEv.turnsCompacted,
        freedTokens: lastEv.freedTokens,
        summaryText: msg,
        compactedAt: Date.now(),
      });
      setContextTokens((prev) => ({
        used:
          lastEv.afterTokens ??
          Math.max(18000, prev.used - lastEv.freedTokens),
        max: prev.max,
      }));
    } else {
      // Estimate realistic token growth from trajectory events when backend hasn't sent explicit context_usage yet
      const baseTokens = 45000;
      const dynamicTokens =
        baseTokens +
        state.skillCards.length * 14500 +
        state.events.length * 1200 -
        (compactionState.compactedAt ? compactionState.freedTokens : 0);
      setContextTokens((prev) => ({
        used: Math.max(18000, Math.min(prev.max, dynamicTokens)),
        max: prev.max,
      }));
    }
  }, [state.events, state.skillCards.length, compactionState.compactedAt, compactionState.freedTokens]);

  useEffect(() => {
    if (!compactionState.activeCutin) return;
    const tId = window.setTimeout(() => {
      setCompactionState((prev) => ({ ...prev, activeCutin: false }));
    }, 2800);
    return () => window.clearTimeout(tId);
  }, [compactionState.activeCutin]);

  const handleTriggerCompactionDemo = () => {
    playSfx('allow');
    setCompactionState({
      activeCutin: true,
      turnsCompacted: 10,
      freedTokens: 80000,
      summaryText: '已成功将前 10 轮历史压缩为摘要卡，释放 80,000 Tokens！',
      compactedAt: Date.now(),
    });
    setContextTokens((prev) => ({
      used: Math.max(24000, prev.used > 90000 ? prev.used - 80000 : 45000),
      max: prev.max,
    }));
  };

  // Schedule auto-collapse of finished skill cards after ~2.6s
  useEffect(() => {
    for (const card of state.skillCards) {
      if (
        card.status !== 'running' &&
        !card.collapsedToLog &&
        !collapseTimersRef.current.has(card.toolUseId)
      ) {
        const delay = state.fastForward ? 650 : 2600;
        const tId = window.setTimeout(() => {
          collapseTimersRef.current.delete(card.toolUseId);
          dispatch({ type: 'COLLAPSE_SKILL_CARD', toolUseId: card.toolUseId });
        }, delay);
        collapseTimersRef.current.set(card.toolUseId, tId);
      }
    }
  }, [state.skillCards, state.fastForward]);

  // Live HUD stopwatch & 15s idle wait check while turn is active
  useEffect(() => {
    if (!state.turnActive) return;
    const interval = window.setInterval(() => {
      dispatch({ type: 'TICK_TIMER', now: Date.now() });
    }, 100);
    return () => window.clearInterval(interval);
  }, [state.turnActive]);

  // Handle typewriter & in-place replacesLineId transitions
  const fullLineText = state.currentLine?.text ?? '';
  const currentLineKey = state.currentLine?.lineKey ?? '';
  const currentReplaceVersion = state.currentLine?.replaceVersion ?? 0;

  useEffect(() => {
    const prev = prevLineTrackRef.current;
    const isInPlaceReplace =
      currentReplaceVersion > 0 && currentReplaceVersion !== prev.replaceVersion;

    if (isInPlaceReplace) {
      if (prev.wasTyping) {
        setTypedLength(0);
      } else {
        setTypedLength(fullLineText.length);
        setFadeReplaceKey((k) => k + 1);
      }
    } else if (currentLineKey !== prev.lineKey) {
      setTypedLength(0);
    }

    prevLineTrackRef.current = {
      lineKey: currentLineKey,
      replaceVersion: currentReplaceVersion,
      wasTyping: true,
    };
  }, [currentLineKey, currentReplaceVersion, fullLineText]);

  const isTypingLine = typedLength < fullLineText.length;
  useEffect(() => {
    prevLineTrackRef.current.wasTyping = isTypingLine;
  }, [isTypingLine]);

  const typingCharsPerSec =
    state.serverSettings?.performance?.typingCharsPerSec || 40;

  useEffect(() => {
    if (!fullLineText || typedLength >= fullLineText.length) return;
    const baseStepMs = Math.max(8, Math.round(1000 / typingCharsPerSec));
    const stepMs = state.fastForward ? 8 : baseStepMs;
    const stepChars = state.fastForward ? 4 : 1;
    const tId = window.setTimeout(() => {
      setTypedLength((prev) => Math.min(fullLineText.length, prev + stepChars));
    }, stepMs);
    return () => window.clearTimeout(tId);
  }, [fullLineText, typedLength, state.fastForward, typingCharsPerSec]);

  const skipTypewriter = () => {
    if (fullLineText && typedLength < fullLineText.length) {
      setTypedLength(fullLineText.length);
    }
  };

  const handleConfirmPermission = (allowed: boolean) => {
    if (!state.pendingPermission) return;
    playSfx(allowed ? 'allow' : 'deny');
    sourceRef.current?.decidePermission(
      state.pendingPermission.requestId,
      allowed
    );
  };

  const handleSwitchCharacter = (nextCharId: string) => {
    if (!nextCharId) return;
    dispatch({ type: 'SET_CHARACTER', characterId: nextCharId });
    sourceRef.current?.switchCharacter(nextCharId);
  };

  const handleUpdateSettings = (patch: SettingsPatch) => {
    sourceRef.current?.updateSettings(patch);
  };

  const handleListModels = (target: 'worker' | 'voice') => {
    dispatch({ type: 'MARK_MODELS_LOADING', target });
    sourceRef.current?.listModels(target);
  };

  const handleTestConnection = (target: 'worker' | 'voice') => {
    dispatch({ type: 'MARK_CONN_TESTING', target });
    sourceRef.current?.testConnection(target);
  };

  const handleStartNewSessionWithDir = (projectDir: string) => {
    sourceRef.current?.updateSettings({ projectDir });
    sourceRef.current?.newSession();
    dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: false });
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.metaKey ||
        e.altKey ||
        (e.ctrlKey && e.key !== 'Control') ||
        e.repeat
      )
        return;
      if (isTypingTarget(e.target) && e.key !== 'Escape') return;
      if (e.key === 'Control') {
        dispatch({ type: 'SET_FAST_FORWARD', fast: true });
      }

      if (e.key === '`' || e.code === 'Backquote') {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_ENGINEERING_VIEW' });
          return;
        }
      }

      if (e.key === 'Escape') {
        if (state.selectedToolUseId !== null) {
          e.preventDefault();
          dispatch({ type: 'SELECT_SKILL_CARD', toolUseId: null });
          return;
        }
        if (state.backlogOpen) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_BACKLOG', open: false });
          return;
        }
        if (state.systemMenuOpen) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: false });
          return;
        }
        if (!state.pendingPermission && !state.engineeringView) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: true });
          return;
        }
      }

      if (
        state.pendingPermission &&
        !state.systemMenuOpen &&
        !state.backlogOpen &&
        state.selectedToolUseId === null
      ) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          dispatch({ type: 'SET_PERMISSION_CHOICE', choice: 'allow' });
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          dispatch({ type: 'SET_PERMISSION_CHOICE', choice: 'reject' });
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          handleConfirmPermission(state.permissionChoice === 'allow');
          return;
        }
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTypingInInput =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        activeTag === 'select';

      if (!isTypingInInput && !state.systemMenuOpen && !state.engineeringView) {
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_BACKLOG' });
          return;
        }
        if (e.key === 'o' || e.key === 'O') {
          if (state.skillCards.length > 0 && !selectedCard) {
            e.preventDefault();
            dispatch({
              type: 'SELECT_SKILL_CARD',
              toolUseId: state.skillCards[state.skillCards.length - 1].toolUseId,
            });
            return;
          }
        }
        if (e.key === ' ') {
          e.preventDefault();
          skipTypewriter();
          return;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        dispatch({ type: 'SET_FAST_FORWARD', fast: false });
      }
    };

    const onBlur = () => {
      dispatch({ type: 'SET_FAST_FORWARD', fast: false });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  });

  const handleSubmitInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (needsOnboarding) return;
    const trimmed = inputValue.trim();

    if (state.turnActive) {
      const steerText =
        trimmed || '顺便确认按钮带上 data-variant="theme-primary" 属性！';
      sourceRef.current?.steer(steerText);
      setInputValue('');
      return;
    }

    for (const timer of collapseTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    collapseTimersRef.current.clear();

    const promptToSend = trimmed || DEFAULT_FIRST_USER_PROMPT;
    sourceRef.current?.send(promptToSend);
    setInputValue('');
    inputRef.current?.blur();
  };

  const handleReplayOrNewSession = () => {
    for (const timer of collapseTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    collapseTimersRef.current.clear();

    if (sourceMode === 'demo') {
      sourceRef.current?.replayDemo?.();
    } else {
      sourceRef.current?.newSession();
    }
    setInputValue('');
  };

  const turnDurationSec = (state.turnDurationMs / 1000).toFixed(1);
  const idleWaitSec = (state.idleWaitMs / 1000).toFixed(1);
  const isLongWaiting = state.turnActive && state.idleWaitMs >= 15000;
  const hudStatusMeta = HUD_STATUS_TEXT[state.hudStatus];
  const emotionMeta = resolveEmotionLabel(character, state.currentEmotion);

  const selectedCard: SkillCardItem | null =
    state.skillCards.find((c) => c.toolUseId === state.selectedToolUseId) ??
    null;

  const latestUserMsg = [...state.events]
    .reverse()
    .find((ev) => ev.type === 'user_message');

  const latestWorkerFinal = [...state.events]
    .reverse()
    .find((ev) => ev.type === 'worker_text');

  const usedK = Math.round(contextTokens.used / 1000);
  const maxK = Math.round(contextTokens.max / 1000);
  const contextPercent = Math.min(
    100,
    Math.max(4, Math.round((contextTokens.used / contextTokens.max) * 100))
  );

  const touchedFiles = Array.from(
    new Set(
      state.skillCards
        .map(
          (c) =>
            c.file ||
            (c.tool === 'edit' || c.tool === 'write' ? c.summary : undefined)
        )
        .filter((f): f is string => Boolean(f))
    )
  );
  const totalDiffStats = state.skillCards.reduce(
    (acc, c) => {
      if (c.diffStats) {
        acc.added += c.diffStats.added;
        acc.removed += c.diffStats.removed;
      }
      return acc;
    },
    { added: 0, removed: 0 }
  );

  if (state.engineeringView) {
    return (
      <EngineeringView
        events={state.events}
        modelName={state.modelName}
        hudStatusLabel={hudStatusMeta.zh}
        turnDurationSec={turnDurationSec}
        pendingPermission={state.pendingPermission}
        steers={state.steers}
        inputValue={inputValue}
        turnActive={state.turnActive}
        onInputChange={setInputValue}
        onSubmitInput={handleSubmitInput}
        onResolvePermission={handleConfirmPermission}
        onExitEngineeringView={() =>
          dispatch({ type: 'TOGGLE_ENGINEERING_VIEW', open: false })
        }
        onReplayScript={handleReplayOrNewSession}
      />
    );
  }

  const displayedText =
    fullLineText.slice(0, typedLength) || defaultCharacterLine(character);

  const isDisconnected =
    sourceMode === 'live' && connStatus.state !== 'connected';
  const needsOnboarding =
    sourceMode === 'live' && !state.serverSettings.projectDir;

  const backlogCount = state.events.filter((e) =>
    ['user_message', 'character_line', 'tool_start', 'worker_text'].includes(
      e.type
    )
  ).length;

  const viewportStyle = {
    '--char-theme-color': character.themeColor,
    '--char-accent-color': character.accentColor ?? character.themeColor,
  } as React.CSSProperties;

  return (
    <div
      className="p5-stage-viewport"
      data-testid="p5-stage-viewport"
      data-active-character={character.id}
      style={viewportStyle}
    >
      {/* ── P5X GEOMETRIC STAGE BACKDROP LAYERS ── */}
      <div className="p5-bg-crimson-wedge" aria-hidden="true" />
      <div className="p5-bg-halftone" aria-hidden="true" />
      <div className="p5-bg-right-red-corner" aria-hidden="true" />
      <div className="p5-bg-right-halftone" aria-hidden="true" />
      <div className="p5-bg-vertical-watermark" aria-hidden="true">
        CHARACTER
      </div>

      {/* ── DISCONNECT / RECONNECT BANNER (LiveSource) ── */}
      {isDisconnected && (
        <div
          className="p5-disconnect-banner"
          data-testid="disconnect-banner"
          role="status"
        >
          <div className="p5-disconnect-left">
            <span className="p5-disconnect-badge">OFFLINE // 信号中断</span>
            <strong className="p5-disconnect-title">鱼塘断线，重连中…</strong>
            <span className="p5-disconnect-detail">
              {connStatus.hasEverConnected
                ? `正在第 ${connStatus.attempt} 次重连 — 若服务已停止请运行：`
                : `尚未连上本地服务（第 ${Math.max(1, connStatus.attempt)} 次尝试）— 请启动服务：`}
            </span>
            <code className="p5-disconnect-cmd">npm run dev:server</code>
          </div>

          <div className="p5-disconnect-actions">
            <button
              type="button"
              className="p5-disconnect-btn"
              data-testid="reconnect-now-btn"
              onClick={() => sourceRef.current?.retryNow()}
            >
              ↻ 立即重连
            </button>
            <a
              href="?demo=1"
              className="p5-disconnect-demo-link"
              data-testid="switch-to-demo-link"
            >
              进入 ?demo=1 剧本模式
            </a>
          </div>
        </div>
      )}

      {/* ── MAIN 2-ZONE P5X STAGE (LEFT CHARACTER STAGE / RIGHT WORKSPACE) ── */}
      <div className="p5-main-grid">
        {/* ══ LEFT ZONE: P5X BREAK-THE-FRAME CHARACTER STAGE + INTEGRATED HUD ══ */}
        <aside className="p5-left-column" data-testid="hud-layer">
          {/* Top Brand & Live Connection Pill */}
          <div className="p5-brand-strip">
            <div className="p5-brand-tag">P5 AGENT STAGE</div>
            <div
              className={`p5-live-pill mode-${sourceMode}`}
              data-testid="data-source-badge"
            >
              <span
                className={`p5-live-dot status-${state.hudStatus}`}
              />
              <span>
                {sourceMode === 'demo'
                  ? 'DEMO · 剧本演示'
                  : connStatus.state === 'connected'
                  ? '实时连接 · 已就绪'
                  : '连接中…'}
              </span>
            </div>
          </div>

          {/* Break-the-Frame Character Showcase */}
          <div
            key={`stage_frame_${state.characterSwitchKey}`}
            className="p5-portrait-stage p5-portrait-stage--theme"
          >
            <div
              className="p5-char-tilted-card"
              data-watermark={character.codename}
              aria-hidden="true"
            />
            <div
              className="p5-portrait-emotion-tag"
              data-testid="emotion-badge"
              title={`${emotionMeta.en} · ${emotionMeta.zh}`}
            >
              <span className="emotion-zh">{emotionMeta.zh}</span>
            </div>

            <CharacterRenderer
              characterId={character.id}
              characterName={character.name}
              codename={character.codename}
              art={character.art}
              emotion={state.currentEmotion}
              emotionSwitchKey={state.emotionSwitchKey}
              characterSwitchKey={state.characterSwitchKey}
              talking={isTypingLine && dialogueCharacter.id === character.id}
              breathing={
                state.turnActive &&
                (state.currentEmotion === 'thinking' ||
                  state.currentEmotion === 'working' ||
                  isLongWaiting)
              }
            />
          </div>

          {/* P5X Overlapping Nameplate + Compact Workspace Attributes + Circular Party Medals */}
          <div className="p5-char-info-cluster" data-testid="hud-status-card">
            <div
              className="p5-char-codename-giant"
              data-testid="character-codename"
            >
              {character.codename}
            </div>

            <div className="p5-char-name-pill">
              <span
                className="p5-char-name-main"
                data-testid="character-nickname"
              >
                {shortNickname} · {character.tagline.split('，')[0]}
              </span>

              <span
                className={`p5-char-status-inline status-${state.hudStatus}`}
                data-testid="hud-status-text"
              >
                <span>★ {hudStatusMeta.zh}</span>
                <span>·</span>
                <strong data-testid="hud-elapsed-time">
                  {turnDurationSec}s
                </strong>
              </span>
            </div>

            {isLongWaiting && (
              <div
                className="p5-hud-wait-alert"
                data-testid="hud-idle-wait-timer"
              >
                <span className="p5-wait-pulse" />
                <span>
                  深度思考中 · 已等待 <strong>{idleWaitSec}s</strong>
                </span>
              </div>
            )}

            <div className="p5-char-meta-pills">
              <button
                type="button"
                className="p5-meta-pill"
                onClick={() =>
                  dispatch({
                    type: 'TOGGLE_SYSTEM_MENU',
                    open: true,
                    tab: 'worker',
                  })
                }
                title="点击切换或配置 AI 模型"
              >
                <span>模型</span>
                <strong data-testid="hud-model-name">
                  {state.modelName} ▾
                </strong>
              </button>

              <button
                type="button"
                className="p5-meta-pill"
                onClick={() =>
                  dispatch({
                    type: 'TOGGLE_SYSTEM_MENU',
                    open: true,
                    tab: 'pond',
                  })
                }
                title={state.cwd}
              >
                <span>工作区</span>
                <strong>📁 {state.cwd} ▾</strong>
              </button>
            </div>

            {/* P5 Palace Security Level / DSH Context Meter */}
            <div className="p5-context-meter" data-testid="context-meter">
              <div className="p5-context-meter-top">
                <span className="p5-context-label">
                  SECURITY // 上下文警戒槽
                </span>
                <span
                  className="p5-context-tokens"
                  data-testid="context-meter-value"
                >
                  <strong>{usedK}k</strong> / {maxK}k Tokens ({contextPercent}%)
                </span>
                <button
                  type="button"
                  className="p5-compaction-trigger-btn"
                  data-testid="trigger-compaction-btn"
                  onClick={handleTriggerCompactionDemo}
                  title="触发 DSH 历史上下文记忆蒸馏压缩演出"
                >
                  ✦ 记忆凝炼
                </button>
              </div>
              <div className="p5-context-gauge-track">
                <div
                  className={`p5-context-gauge-fill ${
                    contextPercent >= 75
                      ? 'is-high'
                      : contextPercent >= 40
                      ? 'is-mid'
                      : 'is-low'
                  }`}
                  style={{ width: `${Math.max(8, contextPercent)}%` }}
                />
              </div>
            </div>

            {/* Circular Party Medallions */}
            <div className="p5-party-medals" data-testid="party-bar">
              {state.characters.map((ch) => {
                const isActive = ch.id === character.id;
                const shortLabel = ch.name.split('（')[0];
                return (
                  <button
                    key={ch.id}
                    type="button"
                    data-testid={`party-member-${ch.id}`}
                    className={`p5-medal-item ${isActive ? 'is-active' : ''}`}
                    style={
                      {
                        '--member-color': ch.themeColor,
                      } as React.CSSProperties
                    }
                    onClick={() => handleSwitchCharacter(ch.id)}
                    title={`${ch.name} (${ch.codename})`}
                  >
                    <div className="p5-medal-ring">
                      {ch.portraitUrl ? (
                        <img
                          src={ch.portraitUrl}
                          alt={shortLabel}
                          className="p5-party-avatar"
                        />
                      ) : (
                        <span className="p5-party-avatar-text">
                          {shortLabel.slice(0, 2)}
                        </span>
                      )}
                    </div>
                    <span className="p5-medal-name">{shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* ══ RIGHT ZONE: AI CODING WORKSPACE (TOPBAR + COMIC BUBBLE + ACTION STREAM + INPUT) ══ */}
        <main className="p5-center-stage">
          {/* ── 1. MINIMAL WORKSPACE HEADER ── */}
          <header className="p5-workspace-header">
            <div className="p5-workspace-header-left">
              <div className="p5-session-switcher-wrap">
                <span className="p5-session-badge">SESSION</span>
                <SessionListControl
                  sourceRef={sourceRef}
                  turnActive={state.turnActive}
                />
              </div>

              {sourceMode === 'demo' && (
                <button
                  type="button"
                  className="p5-pill-btn p5-pill-btn--replay"
                  onClick={handleReplayOrNewSession}
                  data-testid="replay-script-btn"
                >
                  ↻ 重播剧本
                </button>
              )}
            </div>

            <div className="p5-workspace-header-right">
              <button
                type="button"
                className={`p5-pill-btn p5-pill-btn--ghost ${
                  state.fastForward ? 'is-active-ff' : ''
                }`}
                onClick={() =>
                  dispatch({
                    type: 'SET_FAST_FORWARD',
                    fast: !state.fastForward,
                  })
                }
                data-testid="fast-forward-btn"
                title="按住 Ctrl 快进演出（也可点击切换）"
              >
                <kbd>CTRL</kbd> {state.fastForward ? '快进中' : '快进'}
              </button>

              <button
                type="button"
                className="p5-pill-btn"
                onClick={() => dispatch({ type: 'TOGGLE_BACKLOG' })}
                data-testid="backlog-open-btn"
              >
                <kbd>L</kbd> 对话回看 ({backlogCount})
              </button>

              <button
                type="button"
                className="p5-pill-btn"
                onClick={() => dispatch({ type: 'TOGGLE_ENGINEERING_VIEW' })}
                data-testid="engineering-view-btn"
              >
                <kbd>`</kbd> 工程视图
              </button>

              <SfxMuteButton />

              <button
                type="button"
                className="p5-pill-btn is-accent"
                onClick={() =>
                  dispatch({
                    type: 'TOGGLE_SYSTEM_MENU',
                    open: !state.systemMenuOpen,
                  })
                }
                data-testid="system-menu-btn"
              >
                <kbd>ESC</kbd> 设置
              </button>
            </div>
          </header>

          {/* ── 2. P5 COMIC SPEECH BUBBLE WITH POINTER TAIL ── */}
          <section className="p5-dialogue-section" data-testid="dialogue-layer">
            <div className="p5-user-mission-bar">
              <strong>当前指令 //</strong>
              <span className="p5-mission-text">
                {latestUserMsg && latestUserMsg.type === 'user_message'
                  ? latestUserMsg.text
                  : `等待${uiCopy.userTitle}下达第一条任务指令……`}
              </span>
              {state.lastTurnOk !== null && !state.turnActive && (
                <span
                  className="p5-mission-done-stamp"
                  data-testid="turn-done-badge"
                >
                  {state.lastTurnOk ? '✓ 已完成' : '■ 已中止'}
                </span>
              )}
            </div>

            <div className="p5-comic-bubble-wrap">
              <div className="p5-speaker-sticker">
                <span data-testid="dialogue-speaker-name">
                  {dialogueCharacter.name.split('（')[0]}
                </span>
                <span
                  className="p5-speaker-codename-sr"
                  data-testid="dialogue-speaker-codename"
                >
                  {dialogueCharacter.codename}
                </span>
                {state.currentLine?.source && (
                  <span
                    className="p5-speaker-source-sr"
                    data-testid="dialogue-line-source"
                  >
                    {state.currentLine.source}
                  </span>
                )}
              </div>

              <div className="p5-comic-tail" aria-hidden="true" />

              <div
                className="p5-dialogue-box"
                onClick={skipTypewriter}
                data-testid="dialogue-box"
                role="region"
                aria-label="角色当前台词"
                title="点击对话框或按 Space 立即显示整句"
              >
                <p
                  key={fadeReplaceKey}
                  className={`p5-dialogue-text ${
                    fadeReplaceKey > 0 ? 'p5-dialogue-text--fade-replace' : ''
                  }`}
                  data-testid="dialogue-line-text"
                >
                  「{displayedText}」
                  <span
                    className={`p5-dialogue-cursor ${
                      isTypingLine ? 'is-typing' : 'is-ready'
                    }`}
                  >
                    ▼
                  </span>
                </p>

                <button
                  type="button"
                  className="p5-skip-sr-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    skipTypewriter();
                  }}
                  data-testid="skip-line-btn"
                  tabIndex={-1}
                >
                  跳过打字
                </button>
              </div>
            </div>
          </section>

          {/* ── 3. DSH TRAJECTORY ROUTE MAP (P5 怪盗行动路线图 + 代码改动 + 回答正文) ── */}
          <section className="p5-action-section" data-testid="action-layer">
            <div className="p5-deck-header">
              <div className="p5-deck-title-group">
                <span
                  className="p5-deck-slash-badge"
                  data-testid="summary-splash-count"
                >
                  TRAJECTORY // 怪盗行动路线 ({state.skillCards.length})
                </span>
                {touchedFiles.length > 0 ? (
                  <span
                    className="p5-deck-summary-text"
                    data-testid="summary-files-touched"
                  >
                    目标{' '}
                    <strong>
                      {touchedFiles.map((f) => f.split('/').pop()).join(', ')}
                    </strong>
                    {(totalDiffStats.added > 0 ||
                      totalDiffStats.removed > 0) && (
                      <>
                        {' · '}
                        <span className="diff-add">
                          +{totalDiffStats.added}
                        </span>{' '}
                        /{' '}
                        <span className="diff-del">
                          −{totalDiffStats.removed}
                        </span>
                      </>
                    )}
                  </span>
                ) : state.turnActive ? (
                  <span className="p5-deck-summary-text">
                    ● 正在实时推进 DSH 行动轨迹…
                  </span>
                ) : (
                  <span className="p5-deck-summary-text">
                    实时展开工具执行参数、耗时、代码 Diff 与回答正文
                  </span>
                )}
              </div>

              {state.skillCards.length > 0 && (
                <button
                  type="button"
                  className="p5-mini-chip p5-mini-chip--btn"
                  onClick={() => {
                    const last =
                      state.skillCards[state.skillCards.length - 1];
                    if (last) {
                      dispatch({
                        type: 'SELECT_SKILL_CARD',
                        toolUseId: last.toolUseId,
                      });
                    }
                  }}
                >
                  展开完整档案 ▶
                </button>
              )}
            </div>

            <div
              className="p5-active-skills-zone"
              data-testid="action-log-strip"
            >
              {/* Friendly Error Notice Banner */}
              {state.lastError && !needsOnboarding && (
                <div
                  className="p5-error-notice-card"
                  data-testid="stage-error-banner"
                >
                  <div className="p5-error-notice-left">
                    <span className="p5-error-notice-tag">
                      NOTICE // 运行提示
                    </span>
                    <span className="p5-error-notice-msg">
                      {state.lastError.message}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="p5-error-dismiss-btn"
                    onClick={() => dispatch({ type: 'DISMISS_ERROR' })}
                  >
                    知道了
                  </button>
                </div>
              )}

              {/* DSH Memory Compaction Summary Card in Trajectory */}
              {compactionState.compactedAt && (
                <div
                  className="p5-compaction-summary-node"
                  data-testid="compaction-summary-card"
                >
                  <span className="p5-compaction-node-badge">
                    ✦ MEMORY DISTILLED // 记忆摘要卡
                  </span>
                  <span className="p5-compaction-node-text">
                    {compactionState.summaryText}
                  </span>
                  <span className="p5-compaction-node-freed">
                    −{Math.round(compactionState.freedTokens / 1000)}k Tokens
                  </span>
                </div>
              )}

              {needsOnboarding ? (
                <OnboardingCard
                  character={character}
                  settings={state.serverSettings}
                  workerAdapters={state.workerAdapters}
                  lastError={state.lastError}
                  onStartWithDir={handleStartNewSessionWithDir}
                  onOpenSystemMenu={(tab) =>
                    dispatch({
                      type: 'TOGGLE_SYSTEM_MENU',
                      open: true,
                      tab: tab ?? 'pond',
                    })
                  }
                  onDismissError={() => dispatch({ type: 'DISMISS_ERROR' })}
                />
              ) : state.skillCards.length > 0 ? (
                <div
                  className="p5-action-list p5-trajectory-route"
                  data-testid="turn-summary-card"
                >
                  {state.skillCards.map((card, index) => {
                    const isPreviewOpen = inlinePreviewId === card.toolUseId;
                    const inlineDiffRows = isPreviewOpen
                      ? extractInlineDiffLines(card.diff)
                      : [];
                    const stepDurationMs =
                      card.endedAt && card.startedAt
                        ? Math.max(120, card.endedAt - card.startedAt)
                        : null;
                    return (
                      <React.Fragment key={card.toolUseId}>
                        <div
                          className={`p5-action-row status-${card.status} tool-${card.tool} ${
                            isPreviewOpen ||
                            state.selectedToolUseId === card.toolUseId
                              ? 'is-expanded'
                              : ''
                          }`}
                          onClick={() =>
                            dispatch({
                              type: 'SELECT_SKILL_CARD',
                              toolUseId: card.toolUseId,
                            })
                          }
                          data-testid={`action-log-item-${index}`}
                        >
                          <div className="p5-step-badge-group">
                            <span className="p5-step-num">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span
                              className={`p5-tool-tag tool-${card.tool}`}
                              data-testid={`active-skill-card-${card.toolUseId}`}
                            >
                              {TOOL_DISPLAY_LABELS[card.tool] ??
                                card.tool.toUpperCase()}
                            </span>
                          </div>

                          <div className="p5-action-target">
                            <strong>{card.file ?? card.summary}</strong>
                            <span>
                              {card.endSummary ??
                                `${card.rawName} · ${card.summary}`}
                            </span>
                          </div>

                          <span className="p5-action-stat">
                            {card.diffStats ? (
                              <>
                                <span className="add">
                                  +{card.diffStats.added}
                                </span>{' '}
                                <span className="del">
                                  −{card.diffStats.removed}
                                </span>
                              </>
                            ) : (
                              card.rawName
                            )}
                            {stepDurationMs && (
                              <em className="p5-step-ms">
                                {' '}
                                · {stepDurationMs}ms
                              </em>
                            )}
                          </span>

                          <span
                            className={`p5-action-status status-${card.status}`}
                          >
                            {card.status === 'running'
                              ? '▶ 执行中'
                              : card.status === 'success'
                              ? card.diff
                                ? '▼ Diff 预览'
                                : '✓ 完成'
                              : '✖ 失败'}
                          </span>
                        </div>

                        {inlineDiffRows.length > 0 && (
                          <div
                            className="p5-inline-diff-box"
                            onClick={() =>
                              dispatch({
                                type: 'SELECT_SKILL_CARD',
                                toolUseId: card.toolUseId,
                              })
                            }
                            title="点击打开完整代码对比档案"
                          >
                            {inlineDiffRows.map((row, rIdx) => (
                              <div
                                key={rIdx}
                                className={
                                  row.kind === 'add'
                                    ? 'p5-diff-line-add'
                                    : 'p5-diff-line-del'
                                }
                              >
                                {row.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Worker Answer Body Card in Trajectory */}
                  {(latestWorkerFinal ||
                    (!state.turnActive && state.lastTurnSummary)) && (
                    <div
                      className="p5-worker-answer-card"
                      data-testid="trajectory-answer-card"
                    >
                      <div className="p5-worker-answer-head">
                        <span className="p5-worker-answer-badge">
                          ★ CONCLUSION // {shortNickname}的行动结论正文
                        </span>
                        <span className="p5-worker-answer-meta">
                          耗时 {turnDurationSec}s · 模型 {state.modelName}
                        </span>
                      </div>
                      <p className="p5-worker-answer-body">
                        {latestWorkerFinal &&
                        latestWorkerFinal.type === 'worker_text'
                          ? latestWorkerFinal.text
                          : state.lastTurnSummary}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p5-trajectory-standby">
                  <div className="p5-standby-route-nodes">
                    <div className="p5-standby-node is-ready">
                      <span className="node-step">STEP 01</span>
                      <strong>侦察目标文件与上下文</strong>
                      <span>展开 READ / SEARCH 参数与耗时</span>
                    </div>
                    <div className="p5-standby-node">
                      <span className="node-step">STEP 02</span>
                      <strong>斜切轨迹卡片 + 内联 Diff</strong>
                      <span>实时展示代码增删与红绿对比</span>
                    </div>
                    <div className="p5-standby-node">
                      <span className="node-step">STEP 03</span>
                      <strong>终端验证 + 回答正文归档</strong>
                      <span>汇总测试结果与完整结论正文</span>
                    </div>
                  </div>
                  <div className="p5-skill-placeholder">
                    <span className="p5-placeholder-star">★</span>
                    <span>{uiCopy.idleHint}</span>
                  </div>
                </div>
              )}

              {/* Steer (插话) Live Status Pills */}
              {state.steers.length > 0 && (
                <div className="p5-steer-strip" data-testid="steer-strip">
                  {state.steers.map((st) => (
                    <div
                      key={st.id}
                      className={`p5-steer-pill steer-${st.status}`}
                      data-testid={`steer-item-${st.status}`}
                    >
                      <span
                        className="p5-steer-status-badge"
                        data-testid="steer-status-badge"
                      >
                        {st.status === 'queued' ? '已传达，待接收' : '已接收'}
                      </span>
                      <span className="p5-steer-text">
                        场外插话：「{st.text}」
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── 4. SLEEK SLANTED COMMAND INPUT BAR ── */}
          <section className="p5-command-dock" data-testid="player-input-zone">
            <div className="p5-dock-quick-chips">
              <div className="p5-chip-group">
                {needsOnboarding ? (
                  <span
                    className="p5-input-onboarding-hint"
                    data-testid="stage-input-disabled-hint"
                  >
                    ▲ 请先在上方引导卡选定项目文件夹后再投喂任务
                  </span>
                ) : !state.turnActive ? (
                  <>
                    <button
                      type="button"
                      className="p5-mini-chip p5-mini-chip--btn"
                      onClick={handleReplayOrNewSession}
                    >
                      + 新建会话
                    </button>
                    <button
                      type="button"
                      className="p5-mini-chip p5-mini-chip--btn"
                      data-testid="example-instruction-btn"
                      onClick={() => setInputValue(DEFAULT_FIRST_USER_PROMPT)}
                    >
                      ⚡ 填入示例任务指令
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="p5-mini-chip p5-mini-chip--btn is-steer"
                      data-testid="quick-steer-btn"
                      onClick={() => {
                        sourceRef.current?.steer(
                          '顺便检查一下深色模式下的按钮边框对比度！'
                        );
                      }}
                    >
                      ⚡ 一键插话 (Steer)
                    </button>
                    <button
                      type="button"
                      className="p5-mini-chip p5-mini-chip--btn is-stop"
                      data-testid="stop-turn-btn"
                      onClick={() => sourceRef.current?.stop()}
                    >
                      ■ 喊停 (STOP)
                    </button>
                  </>
                )}
              </div>
            </div>

            <form className="p5-input-bar-slash" onSubmit={handleSubmitInput}>
              <div className="p5-input-field-box">
                <input
                  ref={inputRef}
                  type="text"
                  className="p5-command-input"
                  data-testid="stage-input"
                  disabled={needsOnboarding}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={
                    needsOnboarding
                      ? '请先在上方「首次潜入引导」卡片中选定项目文件夹并点击「开始」...'
                      : state.turnActive
                      ? '任务进行中：输入消息并回车立即插话补充要求…'
                      : `向${shortNickname}下达新任务，或在执行中直接插话补充要求…`
                  }
                />
              </div>
              <button
                type="submit"
                className="p5-send-slash-btn"
                data-testid="stage-send-btn"
                disabled={needsOnboarding}
              >
                {state.turnActive ? '插话 ▶' : '投喂 ▶'}
              </button>
            </form>
          </section>
        </main>
      </div>

      <SwitchTransition
        characterId={character.id}
        characterSwitchKey={state.characterSwitchKey}
        name={character.name}
        codename={character.codename}
        tagline={character.tagline}
        themeColor={character.themeColor}
        accentColor={character.accentColor}
        portraitUrl={
          state.characters.find((c) => c.id === character.id)?.portraitUrl
        }
      />

      {/* ── DSH MEMORY COMPACTION CUT-IN EFFECT (记忆凝炼专属技能演出) ── */}
      {compactionState.activeCutin && (
        <div
          className="p5-compaction-cutin"
          data-testid="compaction-cutin-banner"
          onClick={() =>
            setCompactionState((prev) => ({ ...prev, activeCutin: false }))
          }
        >
          <div className="p5-compaction-blade">
            <div className="p5-compaction-kicker">
              ✦ MEMORY DISTILLATION // 记忆凝炼技能发动！
            </div>
            <div className="p5-compaction-headline">
              {compactionState.summaryText}
            </div>
            <div className="p5-compaction-sub">
              DSH 上下文蒸馏完成 · 警戒槽已回落至 {usedK}k / {maxK}k Tokens
            </div>
          </div>
        </div>
      )}

      {/* ── OVERLAYS: 权限选择肢 / 档案层 / BACKLOG / SYSTEM 菜单 ── */}
      <PermissionModal
        permission={state.pendingPermission}
        selectedChoice={state.permissionChoice}
        characterName={shortNickname}
        onSelectChoice={(choice) =>
          dispatch({ type: 'SET_PERMISSION_CHOICE', choice })
        }
        onConfirm={handleConfirmPermission}
      />

      <ArchiveModal
        card={selectedCard}
        characterName={shortNickname}
        onClose={() => dispatch({ type: 'SELECT_SKILL_CARD', toolUseId: null })}
      />

      <BacklogModal
        open={state.backlogOpen}
        events={state.events}
        skillCards={state.skillCards}
        characterName={shortNickname}
        onClose={() => dispatch({ type: 'TOGGLE_BACKLOG', open: false })}
        onInspectSkill={(toolUseId) =>
          dispatch({ type: 'SELECT_SKILL_CARD', toolUseId })
        }
      />

      <SystemMenuModal
        open={state.systemMenuOpen}
        activeTab={state.systemMenuTab}
        settings={state.serverSettings}
        settingsSyncedAt={state.settingsSyncedAt}
        characters={state.characters}
        workerAdapters={state.workerAdapters}
        workerModels={state.workerModels}
        voiceModels={state.voiceModels}
        workerConnTest={state.workerConnTest}
        voiceConnTest={state.voiceConnTest}
        onSelectTab={(tab: SystemMenuTab) =>
          dispatch({ type: 'SET_SYSTEM_TAB', tab })
        }
        onClose={() => dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: false })}
        onSwitchCharacter={handleSwitchCharacter}
        onUpdateSettings={handleUpdateSettings}
        onListModels={handleListModels}
        onTestConnection={handleTestConnection}
        onStartNewSessionWithDir={handleStartNewSessionWithDir}
      />
    </div>
  );
};
