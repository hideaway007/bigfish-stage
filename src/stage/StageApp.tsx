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
import { SystemMenuModal } from './components/SystemMenuModal';
import type { Emotion, ToolKind } from '../shared/stage-events';
import type { SettingsPatch } from '../shared/settings';
import type { ServerMessage } from '../shared/wire';

const EMOTION_LABELS: Record<Emotion, { en: string; zh: string }> = {
  idle: { en: 'IDLE', zh: '待机 · 傻敷敷' },
  thinking: { en: 'THINKING', zh: '思考 · MAX / LOW?' },
  working: { en: 'WORKING', zh: '行动 · 挥舞 HARNESS' },
  happy: { en: 'HAPPY', zh: '大胜利 · 蒸汽机车!' },
  worried: { en: 'WORRIED', zh: '慌张 · 抱箱跑路?!' },
  shocked: { en: 'SHOCKED', zh: '决断 · 权限请求!' },
};

const HUD_STATUS_TEXT = {
  idle: { zh: '待机', en: 'STANDBY', gauge: 38 },
  thinking: { zh: '思考', en: 'THINKING', gauge: 72 },
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
  other: 'OTHER · 通用水花',
};

function detectSourceMode(): DataSourceMode {
  const params = new URLSearchParams(window.location.search);
  const demoVal = params.get('demo');
  if (demoVal === '1' || demoVal === 'true') {
    return 'demo';
  }
  return 'live';
}

function formatSkillHeader(
  charName: string,
  tool: ToolKind,
  fileOrSummary: string,
  diffStats?: { added: number; removed: number }
): string {
  const shortName = charName.split('（')[0];
  const toolTag = TOOL_DISPLAY_LABELS[tool] ?? tool.toUpperCase();
  const base = `${shortName} 发动 ${toolTag} ▶ ${fileOrSummary}`;
  if (diffStats) {
    return `${base} +${diffStats.added} −${diffStats.removed}`;
  }
  return base;
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
  const dialogueCharacter = getCachedCharacterPack(state.currentLine?.characterId ?? state.characterId);

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

  // Schedule auto-collapse of finished skill cards into the side Action Log after ~2.6s
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
        // Was still typing when replaced -> re-type from the beginning
        setTypedLength(0);
      } else {
        // Was already fully displayed -> show full replaced text with fade-in
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

  // Keep track of whether typewriter is still in progress
  const isTypingLine = typedLength < fullLineText.length;
  useEffect(() => {
    prevLineTrackRef.current.wasTyping = isTypingLine;
  }, [isTypingLine]);

  // Advance typewriter characters using settings.performance.typingCharsPerSec
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

      // Escape: close active modal, or open SYSTEM menu when no other modal is open
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

      if (state.pendingPermission && !state.systemMenuOpen) {
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

      if (!isTypingInInput && !state.systemMenuOpen) {
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_BACKLOG' });
          return;
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
  const emotionMeta = EMOTION_LABELS[state.currentEmotion];

  const selectedCard: SkillCardItem | null =
    state.skillCards.find((c) => c.toolUseId === state.selectedToolUseId) ??
    null;

  const stageSkillCards = state.skillCards.filter((c) => !c.collapsedToLog);

  const latestUserMsg = [...state.events]
    .reverse()
    .find((ev) => ev.type === 'user_message');

  // Compute Turn Summary statistics for the post-turn report card
  const touchedFiles = Array.from(
    new Set(
      state.skillCards
        .map((c) => c.file || (c.tool === 'edit' || c.tool === 'write' ? c.summary : undefined))
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

  // If Engineering View is active, render plain developer timeline
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
    fullLineText.slice(0, typedLength) ||
    character.persona.catchphrases[0] ||
    '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？';

  const isDisconnected =
    sourceMode === 'live' && connStatus.state !== 'connected';

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
      {/* Background comic rays & halftone textures */}
      <div className="p5-bg-halftone" aria-hidden="true" />
      <div className="p5-bg-slash-red" aria-hidden="true" />
      <div className="p5-bg-slash-black" aria-hidden="true" />

      {/* ── DISCONNECT / RECONNECT BANNER (LiveSource) ── */}
      {isDisconnected && (
        <div
          className="p5-disconnect-banner"
          data-testid="disconnect-banner"
          role="status"
        >
          <div className="p5-disconnect-left">
            <span className="p5-disconnect-badge">OFFLINE // 信号中断</span>
            <strong className="p5-disconnect-title">
              鱼塘断线，重连中…
            </strong>
            <span className="p5-disconnect-detail">
              {connStatus.hasEverConnected
                ? `正在进行第 ${connStatus.attempt} 次指数退避重连（重连后由 welcome.history 自动恢复）— 若服务已停止请运行：`
                : `尚未连上本地服务（第 ${Math.max(1, connStatus.attempt)} 次尝试）— 请启动本地服务：`}
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

      {/* ── TOP COMMAND & HOTKEY RIBBON ── */}
      <header className="p5-topbar">
        <div className="p5-topbar-left">
          <div className="p5-logo-plate">
            <span className="p5-logo-main">BIG FISH STAGE</span>
            <span className="p5-logo-sub">大肥鱼 · 深海工作台</span>
          </div>
          <div
            className="p5-cwd-pill"
            title={state.cwd}
            onClick={() =>
              dispatch({
                type: 'TOGGLE_SYSTEM_MENU',
                open: true,
                tab: 'pond',
              })
            }
          >
            <span className="p5-cwd-prefix">鱼塘 //</span> {state.cwd}
          </div>
          <span
            className={`p5-mode-pill mode-${sourceMode}`}
            data-testid="data-source-badge"
          >
            {sourceMode === 'demo' ? 'DEMO // 剧本模式' : 'LIVE // 实时鱼塘'}
          </span>
        </div>

        <div className="p5-topbar-right">
          <button
            type="button"
            className={`p5-top-btn ${state.fastForward ? 'is-active-ff' : ''}`}
            onClick={() =>
              dispatch({
                type: 'SET_FAST_FORWARD',
                fast: !state.fastForward,
              })
            }
            data-testid="fast-forward-btn"
            title="按住 Ctrl 快进演出（也可点击切换）"
          >
            <span className="kbd-tag">CTRL</span>{' '}
            {state.fastForward ? '>> 快进中' : '快进'}
          </button>

          <button
            type="button"
            className="p5-top-btn"
            onClick={skipTypewriter}
            data-testid="skip-line-btn"
            title="按 Space 或点击对话框立即显示整句"
          >
            <span className="kbd-tag">SPACE</span> 跳过打字
          </button>

          <button
            type="button"
            className="p5-top-btn"
            onClick={() => dispatch({ type: 'TOGGLE_BACKLOG' })}
            data-testid="backlog-open-btn"
          >
            <span className="kbd-tag">L</span> 回看 (
            {
              state.events.filter((e) =>
                [
                  'user_message',
                  'character_line',
                  'tool_start',
                  'worker_text',
                ].includes(e.type)
              ).length
            }
            )
          </button>

          <button
            type="button"
            className="p5-top-btn p5-top-btn--eng"
            onClick={() => dispatch({ type: 'TOGGLE_ENGINEERING_VIEW' })}
            data-testid="engineering-view-btn"
          >
            <span className="kbd-tag">`</span> 工程视图
          </button>

          <button
            type="button"
            className="p5-top-btn p5-top-btn--system"
            onClick={() =>
              dispatch({
                type: 'TOGGLE_SYSTEM_MENU',
                open: !state.systemMenuOpen,
              })
            }
            data-testid="system-menu-btn"
          >
            <span className="kbd-tag">ESC</span> SYSTEM
          </button>

          {sourceMode === 'demo' && (
            <button
              type="button"
              className="p5-top-btn p5-top-btn--replay"
              onClick={handleReplayOrNewSession}
              data-testid="replay-script-btn"
            >
              ↻ 重播剧本
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN 3-COLUMN STAGE GRID ── */}
      <div className="p5-main-grid">
        {/* ══ LEFT COLUMN: CHARACTER PORTRAIT + HUD STATUS CARD + PARTY BAR ══ */}
        <aside className="p5-left-column" data-testid="hud-layer">
          {/* Character Portrait Frame */}
          <div
            key={`stage_frame_${state.characterSwitchKey}`}
            className="p5-portrait-stage p5-portrait-stage--theme"
          >
            <div className="p5-portrait-emotion-tag" data-testid="emotion-badge">
              <span className="emotion-en">{emotionMeta.en}</span>
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
              breathing={
                state.turnActive &&
                (state.currentEmotion === 'thinking' ||
                  state.currentEmotion === 'working' ||
                  isLongWaiting)
              }
            />

            <div className="p5-character-nameplate">
              <div
                className="p5-char-codename"
                data-testid="character-codename"
              >
                {character.codename}
              </div>
              <div
                className="p5-char-nickname"
                data-testid="character-nickname"
              >
                {character.name}
              </div>
              <div className="p5-char-attribute">{character.tagline}</div>
            </div>
          </div>

          {/* RPG HUD Status Card */}
          <div className="p5-hud-card" data-testid="hud-status-card">
            <div className="p5-hud-header">
              <span className="p5-hud-label">POND STATUS // 鱼塘状态</span>
              <SessionListControl sourceRef={sourceRef} turnActive={state.turnActive} />
              <span
                className={`p5-hud-live-dot status-${state.hudStatus}`}
              />
            </div>

            <div className="p5-hud-row">
              <span className="p5-hud-key">MODEL // 模型</span>
              <strong
                className="p5-hud-val p5-hud-model"
                data-testid="hud-model-name"
              >
                {state.modelName}
              </strong>
            </div>

            <div className="p5-hud-row">
              <span className="p5-hud-key">STATE // 状态</span>
              <div className="p5-hud-status-group">
                <strong
                  className={`p5-hud-status-pill status-${state.hudStatus}`}
                  data-testid="hud-status-text"
                >
                  {hudStatusMeta.zh} // {hudStatusMeta.en}
                </strong>
              </div>
            </div>

            <div className="p5-hud-gauge-track">
              <div
                className={`p5-hud-gauge-fill status-${state.hudStatus}`}
                style={{ width: `${hudStatusMeta.gauge}%` }}
              />
            </div>

            <div className="p5-hud-row p5-hud-row--timer">
              <span className="p5-hud-key">TIME // 本轮耗时</span>
              <strong className="p5-hud-timer" data-testid="hud-elapsed-time">
                {turnDurationSec}s
              </strong>
            </div>

            {isLongWaiting && (
              <div
                className="p5-hud-wait-alert"
                data-testid="hud-idle-wait-timer"
              >
                <span className="p5-wait-pulse" />
                <span>
                  潜航思考中 · 已等待新水花 <strong>{idleWaitSec}s</strong>
                </span>
              </div>
            )}
          </div>

          {/* Party Switcher Bar (Section 4: 左侧 HUD 下方一排队伍头像) */}
          <div className="p5-party-bar" data-testid="party-bar">
            <div className="p5-party-header">
              <span className="p5-party-label">PARTY // 队伍切换</span>
              <span className="p5-party-hint">点选换人 · 任务不中断</span>
            </div>
            <div className="p5-party-list">
              {state.characters.map((ch) => {
                const isActive = ch.id === character.id;
                const shortLabel = ch.name.split('（')[0];
                return (
                  <button
                    key={ch.id}
                    type="button"
                    data-testid={`party-member-${ch.id}`}
                    className={`p5-party-btn ${isActive ? 'is-active' : ''}`}
                    style={
                      {
                        '--member-color': ch.themeColor,
                      } as React.CSSProperties
                    }
                    onClick={() => handleSwitchCharacter(ch.id)}
                    title={`${ch.name} (${ch.codename})`}
                  >
                    <div className="p5-party-avatar-wrap">
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
                    <span className="p5-party-name">{shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* ══ CENTER STAGE: 1. DIALOGUE LAYER (TOP) / 2. ACTION LAYER (MID) / 3. INPUT BAR (BOTTOM-RIGHT) ══ */}
        <main className="p5-center-stage">
          {/* ── LAYER 1: 台词层 (MAIN DIALOGUE BOX) ── */}
          <section className="p5-dialogue-section" data-testid="dialogue-layer">
            {/* Active user mission strip */}
            <div className="p5-mission-strip">
              <span className="p5-mission-tag">FEED // 投喂指令</span>
              <span className="p5-mission-text">
                {latestUserMsg && latestUserMsg.type === 'user_message'
                  ? latestUserMsg.text
                  : '等待店长下达第一条潜入指令……'}
              </span>
              {state.lastTurnOk !== null && !state.turnActive && (
                <span
                  className="p5-mission-done-stamp"
                  data-testid="turn-done-badge"
                >
                  {state.lastTurnOk ? 'FULL! // 吃饱啦' : 'STOP // 已中止'}
                </span>
              )}
            </div>

            {/* One-line-at-a-time comic dialogue box */}
            <div
              className="p5-dialogue-box"
              onClick={skipTypewriter}
              data-testid="dialogue-box"
              role="region"
              aria-label="角色当前台词"
            >
              <div className="p5-dialogue-speaker-tab">
                <span
                  className="speaker-zh"
                  data-testid="dialogue-speaker-name"
                >
                  {dialogueCharacter.name.split('（')[0]}
                </span>
                <span
                  className="speaker-en"
                  data-testid="dialogue-speaker-codename"
                >
                  {dialogueCharacter.codename}
                </span>
                <span className="speaker-emotion">
                  [{(state.currentLine?.emotion ?? state.currentEmotion).toUpperCase()}]
                </span>
                {state.currentLine?.source && (
                  <span
                    className={`speaker-source source-${state.currentLine.source}`}
                    data-testid="dialogue-line-source"
                  >
                    {state.currentLine.source === 'model'
                      ? 'MODEL · 即兴台词'
                      : 'PRESET · 预置台词'}
                  </span>
                )}
              </div>

              <div className="p5-dialogue-content">
                <p
                  key={fadeReplaceKey}
                  className={`p5-dialogue-text ${
                    fadeReplaceKey > 0 ? 'p5-dialogue-text--fade-replace' : ''
                  }`}
                  data-testid="dialogue-line-text"
                >
                  {displayedText}
                  <span
                    className={`p5-dialogue-cursor ${
                      isTypingLine ? 'is-typing' : 'is-ready'
                    }`}
                  >
                    ▼
                  </span>
                </p>
              </div>

              <div className="p5-dialogue-footer">
                <span>
                  {isTypingLine
                    ? 'TYPING... 点击对话框或按 [SPACE] 立即显示整句'
                    : 'LINE READY // 单句台词模式（历史台词按 [L] 回看）'}
                </span>
                {state.fastForward && (
                  <span className="p5-ff-badge">
                    &gt;&gt; FAST FORWARD 加速中
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* ── LAYER 2: 行动层 (SKILL CUT-IN CARDS, TURN SUMMARY, ERROR BANNER & STEER STATUS) ── */}
          <section className="p5-action-section" data-testid="action-layer">
            <div className="p5-action-section-header">
              <span className="p5-action-kicker">
                SPLASH // 甩尾行动（工具调用不进聊天流，点击卡片展开档案层）
              </span>
              {state.turnActive && (
                <span className="p5-action-live-indicator">
                  ● EXECUTING IN POND
                </span>
              )}
            </div>

            <div className="p5-active-skills-zone">
              {/* Friendly non-scary Error Notice Banner */}
              {state.lastError && (
                <div
                  className="p5-error-notice-card"
                  data-testid="stage-error-banner"
                >
                  <div className="p5-error-notice-left">
                    <span className="p5-error-notice-tag">
                      WAVE NOTICE // 鱼塘小状况
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

              {/* Active Skill Cut-in Cards */}
              {stageSkillCards.length > 0 ? (
                stageSkillCards.map((card) => (
                  <div
                    key={card.toolUseId}
                    className={`p5-skill-cutin-card status-${card.status} tool-${card.tool}`}
                    onClick={() =>
                      dispatch({
                        type: 'SELECT_SKILL_CARD',
                        toolUseId: card.toolUseId,
                      })
                    }
                    data-testid={`active-skill-card-${card.toolUseId}`}
                  >
                    <div className="p5-skill-cutin-slash">
                      <span className="p5-skill-type-tag">
                        SPLASH! // 甩尾发动 ·{' '}
                        {TOOL_DISPLAY_LABELS[card.tool] ??
                          card.tool.toUpperCase()}
                      </span>
                      <span className="p5-skill-status-badge">
                        {card.status === 'running'
                          ? '▶ IN PROGRESS · 发动中'
                          : card.status === 'success'
                          ? '★ HIT // 成功'
                          : '✖ MISS // 失败'}
                      </span>
                    </div>

                    <div className="p5-skill-cutin-main">
                      <div className="p5-skill-headline">
                        {formatSkillHeader(
                          character.name,
                          card.tool,
                          card.file ?? card.summary,
                          card.diffStats
                        )}
                      </div>
                      <div className="p5-skill-subline">
                        <span>
                          {card.endSummary ??
                            `${card.rawName}: ${card.summary}`}
                        </span>
                        <span className="p5-skill-inspect-cta">
                          [点击查看 DIFF / 输出 ▶]
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : !state.turnActive &&
                (state.lastTurnOk !== null || state.skillCards.length > 0) ? (
                /* ── POST-TURN SUMMARY CARD (Section 6: 回合结束后本轮小结卡片填满中间区域) ── */
                <div
                  className="p5-turn-summary-card"
                  data-testid="turn-summary-card"
                >
                  <div className="p5-turn-summary-ribbon">
                    <span className="p5-turn-summary-kicker">
                      TURN REPORT // 本轮水花战报
                    </span>
                    <span
                      className={`p5-turn-summary-stamp ${
                        state.lastTurnOk ? 'is-ok' : 'is-fail'
                      }`}
                    >
                      {state.lastTurnOk
                        ? '★ MISSION COMPLETE // 满载而归'
                        : '▲ TURN ENDED // 本轮中止'}
                    </span>
                  </div>

                  <div className="p5-turn-summary-grid">
                    <div className="p5-summary-stat-box">
                      <span className="p5-summary-stat-label">
                        SPLASHES // 甩尾次数
                      </span>
                      <strong
                        className="p5-summary-stat-val"
                        data-testid="summary-splash-count"
                      >
                        {state.skillCards.length} 次
                      </strong>
                      <span className="p5-summary-stat-sub">
                        命中{' '}
                        {
                          state.skillCards.filter((c) => c.status === 'success')
                            .length
                        }{' '}
                        次 · 失误{' '}
                        {
                          state.skillCards.filter((c) => c.status === 'error')
                            .length
                        }{' '}
                        次
                      </span>
                    </div>

                    <div className="p5-summary-stat-box">
                      <span className="p5-summary-stat-label">
                        FILES // 涉及文件与变更
                      </span>
                      <strong
                        className="p5-summary-stat-val p5-summary-stat-val--files"
                        data-testid="summary-files-touched"
                      >
                        {touchedFiles.length > 0
                          ? touchedFiles.map((f) => f.split('/').pop()).join(', ')
                          : '终端巡检 / 无文件写入'}
                      </strong>
                      <span className="p5-summary-stat-sub">
                        {totalDiffStats.added > 0 || totalDiffStats.removed > 0
                          ? `代码增删 +${totalDiffStats.added} / −${totalDiffStats.removed} 行`
                          : '点击右侧水花记录查看完整输出'}
                      </span>
                    </div>

                    <div className="p5-summary-stat-box">
                      <span className="p5-summary-stat-label">
                        DURATION // 本轮耗时
                      </span>
                      <strong
                        className="p5-summary-stat-val"
                        data-testid="summary-turn-duration"
                      >
                        {turnDurationSec}s
                      </strong>
                      <span className="p5-summary-stat-sub">
                        模型：{state.modelName}
                      </span>
                    </div>
                  </div>

                  <div className="p5-turn-summary-footer">
                    <span className="p5-turn-summary-note">
                      {state.lastTurnSummary
                        ? `小结：${state.lastTurnSummary}`
                        : '本轮所有甩尾已归档至右侧「水花记录」'}
                    </span>
                    {state.skillCards.length > 0 && (
                      <button
                        type="button"
                        className="p5-summary-inspect-btn"
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
                        查看最新档案 ▶
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p5-skill-idle-stage">
                  <div className="p5-skill-placeholder">
                    <span className="p5-placeholder-star">★</span>
                    <span>
                      待命舞台：发送右下角投喂指令后，{shortNickname}
                      的每次工具调用将以
                      <strong>「甩尾发动」切入卡</strong>
                      在此演出，随后收进右侧「水花记录」条。
                    </span>
                  </div>
                </div>
              )}

              {/* Steer (插话) Live Status Pills — stays visible throughout turn */}
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

          {/* ── BOTTOM-RIGHT: 玩家输入框 (PLAYER COMMAND INPUT) ── */}
          <section className="p5-input-section" data-testid="player-input-zone">
            <div className="p5-input-quick-row">
              <span className="p5-input-mode-tag">
                {state.turnActive
                  ? 'SHOUT // 游动中随时喊话'
                  : 'FEED THE FISH // 投喂大肥鱼'}
              </span>

              <div className="p5-quick-chips">
                {!state.turnActive ? (
                  <button
                    type="button"
                    className="p5-chip-btn"
                    onClick={() => setInputValue(DEFAULT_FIRST_USER_PROMPT)}
                  >
                    填入示例投喂指令
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="p5-chip-btn p5-chip-btn--steer"
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
                      className="p5-chip-btn p5-chip-btn--stop"
                      data-testid="stop-turn-btn"
                      onClick={() => sourceRef.current?.stop()}
                    >
                      ■ 喊停 (STOP)
                    </button>
                  </>
                )}
              </div>
            </div>

            <form className="p5-input-form" onSubmit={handleSubmitInput}>
              <input
                ref={inputRef}
                type="text"
                className="p5-command-input"
                data-testid="stage-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={
                  state.turnActive
                    ? '任务进行中：输入消息并回车立即插话（触发 steer_queued -> 已传达，待接收）...'
                    : '输入投喂任务并按 Enter 发送...'
                }
              />
              <button
                type="submit"
                className="p5-send-btn"
                data-testid="stage-send-btn"
              >
                <span className="send-en">
                  {state.turnActive ? 'SHOUT' : 'FEED'}
                </span>
                <span className="send-zh">
                  {state.turnActive ? '喊一嗓子 ▶' : '扔进鱼塘 ▶'}
                </span>
              </button>
            </form>
          </section>
        </main>

        {/* ══ RIGHT SIDEBAR STRIP: 「水花记录」 (COLLAPSED SKILL LOG) ══ */}
        <aside className="p5-right-action-log" data-testid="action-log-strip">
          <div className="p5-log-header">
            <span className="p5-log-title-en">SPLASH LOG</span>
            <span className="p5-log-title-zh">
              水花记录 ({state.skillCards.length})
            </span>
          </div>
          <div className="p5-log-sub">点击任一技能条展开【档案层】</div>

          <div className="p5-log-list">
            {state.skillCards.length === 0 ? (
              <div className="p5-log-empty">暂无已发动水花</div>
            ) : (
              state.skillCards.map((card, index) => (
                <button
                  key={card.toolUseId}
                  type="button"
                  className={`p5-log-slot status-${card.status} ${
                    state.selectedToolUseId === card.toolUseId
                      ? 'is-selected'
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
                  <div className="p5-log-slot-top">
                    <span className="p5-log-tool-badge">
                      #{index + 1} {card.tool.toUpperCase()}
                    </span>
                    <span className={`p5-log-state status-${card.status}`}>
                      {card.status === 'running'
                        ? '发动中'
                        : card.status === 'success'
                        ? '成功'
                        : '失败'}
                    </span>
                  </div>

                  <div className="p5-log-slot-title">
                    {shortNickname} 发动 {card.tool.toUpperCase()} ▶{' '}
                    {card.file ?? card.summary}
                  </div>

                  <div className="p5-log-slot-bottom">
                    {card.diffStats ? (
                      <span className="p5-log-diff-nums">
                        <span className="add">+{card.diffStats.added}</span>{' '}
                        <span className="del">−{card.diffStats.removed}</span>
                      </span>
                    ) : (
                      <span className="p5-log-raw">{card.rawName}</span>
                    )}
                    <span className="p5-log-open-tag">档案 ▶</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

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
