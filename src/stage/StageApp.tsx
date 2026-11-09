import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  DEFAULT_CHARACTER_ID,
  getCharacterPortraitUrl,
  getCharacterSpec,
} from './reactions';
import {
  createInitialStageState,
  stageReducer,
  type SkillCardItem,
} from './stageReducer';
import { ScriptPlayer } from '../demo/player';
import { DEFAULT_FIRST_USER_PROMPT } from '../demo/script';
import { ArchiveModal } from './components/ArchiveModal';
import { PermissionModal } from './components/PermissionModal';
import { BacklogModal } from './components/BacklogModal';
import { EngineeringView } from './components/EngineeringView';
import type { Emotion, ToolKind } from '../shared/stage-events';

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

function formatSkillHeader(
  charNickname: string,
  tool: ToolKind,
  fileOrSummary: string,
  diffStats?: { added: number; removed: number }
): string {
  const shortName = charNickname.split('（')[0];
  const base = `${shortName} 发动 ${tool.toUpperCase()} ▶ ${fileOrSummary}`;
  if (diffStats) {
    return `${base} +${diffStats.added} −${diffStats.removed}`;
  }
  return base;
}

export const StageApp: React.FC = () => {
  const [state, dispatch] = useReducer(
    stageReducer,
    DEFAULT_CHARACTER_ID,
    createInitialStageState
  );

  const [inputValue, setInputValue] = useState<string>(
    DEFAULT_FIRST_USER_PROMPT
  );
  const [typedLength, setTypedLength] = useState<number>(0);

  const playerRef = useRef<ScriptPlayer | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const collapseTimersRef = useRef<Map<string, number>>(new Map());

  const character = getCharacterSpec(state.characterId);
  const shortNickname = character.nickname.split('（')[0];

  // Initialize player & boot session
  useEffect(() => {
    dispatch({ type: 'RESET_STAGE' });
    const player = new ScriptPlayer((event) => {
      dispatch({ type: 'STAGE_EVENT', event });
    }, state.characterId);
    playerRef.current = player;
    player.boot();

    return () => {
      player.dispose();
      for (const timer of collapseTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      collapseTimersRef.current.clear();
    };
  }, [state.characterId]);

  // Sync fastForward with player
  useEffect(() => {
    playerRef.current?.setFastForward(state.fastForward);
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

  // Live HUD stopwatch while turn is active
  useEffect(() => {
    if (!state.turnActive) return;
    const interval = window.setInterval(() => {
      dispatch({ type: 'TICK_TIMER', now: Date.now() });
    }, 100);
    return () => window.clearInterval(interval);
  }, [state.turnActive]);

  // Reset typewriter when currentLine changes
  const fullLineText = state.currentLine?.text ?? '';
  const currentLineId = state.currentLine?.lineId ?? 0;

  useEffect(() => {
    setTypedLength(0);
  }, [currentLineId]);

  // Advance typewriter characters
  useEffect(() => {
    if (!fullLineText || typedLength >= fullLineText.length) return;
    const stepMs = state.fastForward ? 8 : 24;
    const stepChars = state.fastForward ? 4 : 1;
    const tId = window.setTimeout(() => {
      setTypedLength((prev) => Math.min(fullLineText.length, prev + stepChars));
    }, stepMs);
    return () => window.clearTimeout(tId);
  }, [fullLineText, typedLength, state.fastForward]);

  const skipTypewriter = () => {
    if (fullLineText && typedLength < fullLineText.length) {
      setTypedLength(fullLineText.length);
    }
  };

  const handleConfirmPermission = (allowed: boolean) => {
    playerRef.current?.resolvePermission(allowed);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        dispatch({ type: 'SET_FAST_FORWARD', fast: true });
      }

      // Backtick ` always toggles Engineering View
      if (e.key === '`' || e.code === 'Backquote') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_ENGINEERING_VIEW' });
        return;
      }

      // Escape closes Archive Modal or Backlog Modal
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
      }

      // When Permission Modal is open, Left/Right + Enter control the choice blades
      if (state.pendingPermission) {
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
        activeTag === 'input' || activeTag === 'textarea';

      if (!isTypingInInput) {
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
      // Mid-turn steer (插话)
      const steerText =
        trimmed || '顺便确认按钮带上 data-variant="theme-primary" 属性！';
      playerRef.current?.sendSteer(steerText);
      setInputValue('');
      return;
    }

    // Start new scripted turn
    for (const timer of collapseTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    collapseTimersRef.current.clear();

    const promptToSend = trimmed || DEFAULT_FIRST_USER_PROMPT;
    playerRef.current?.startTurn(promptToSend);
    setInputValue('');
    inputRef.current?.blur();
  };

  const handleReplay = () => {
    for (const timer of collapseTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    collapseTimersRef.current.clear();
    playerRef.current?.startTurn(DEFAULT_FIRST_USER_PROMPT);
    setInputValue('');
  };

  const turnDurationSec = (state.turnDurationMs / 1000).toFixed(1);
  const hudStatusMeta = HUD_STATUS_TEXT[state.hudStatus];
  const emotionMeta = EMOTION_LABELS[state.currentEmotion];

  const selectedCard: SkillCardItem | null =
    state.skillCards.find((c) => c.toolUseId === state.selectedToolUseId) ??
    null;

  // Active cards on the main Action Layer (not yet collapsed into the side log)
  const stageSkillCards = state.skillCards.filter((c) => !c.collapsedToLog);

  // Latest user message for mission banner
  const latestUserMsg = [...state.events]
    .reverse()
    .find((ev) => ev.type === 'user_message');

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
        onReplayScript={handleReplay}
      />
    );
  }

  const displayedText = fullLineText.slice(0, typedLength);
  const isTypingLine = typedLength < fullLineText.length;

  return (
    <div className="p5-stage-viewport" data-testid="p5-stage-viewport">
      {/* Background comic rays & halftone textures */}
      <div className="p5-bg-halftone" aria-hidden="true" />
      <div className="p5-bg-slash-red" aria-hidden="true" />
      <div className="p5-bg-slash-black" aria-hidden="true" />

      {/* ── TOP COMMAND & HOTKEY RIBBON ── */}
      <header className="p5-topbar">
        <div className="p5-topbar-left">
          <div className="p5-logo-plate">
            <span className="p5-logo-phantom">PHANTOM STAGE</span>
            <span className="p5-logo-sub">P5 AGENT TERMINAL</span>
          </div>
          <div className="p5-cwd-pill" title={state.cwd}>
            <span className="p5-cwd-prefix">TARGET //</span> {state.cwd}
          </div>
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
            {state.fastForward ? '>> 快进中 FAST' : '快进演出'}
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
            <span className="kbd-tag">L</span> 回看 BACKLOG (
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
            className="p5-top-btn p5-top-btn--replay"
            onClick={handleReplay}
            data-testid="replay-script-btn"
          >
            ↻ 重播剧本
          </button>
        </div>
      </header>

      {/* ── MAIN 3-COLUMN STAGE GRID ── */}
      <div className="p5-main-grid">
        {/* ══ LEFT COLUMN: CHARACTER PORTRAIT + HUD STATUS CARD ══ */}
        <aside className="p5-left-column" data-testid="hud-layer">
          {/* Character Portrait Frame */}
          <div className="p5-portrait-stage">
            <div className="p5-portrait-emotion-tag" data-testid="emotion-badge">
              <span className="emotion-en">{emotionMeta.en}</span>
              <span className="emotion-zh">{emotionMeta.zh}</span>
            </div>

            <div
              key={state.emotionSwitchKey}
              className={`p5-portrait-art-wrap p5-portrait-bounce emotion-${state.currentEmotion}`}
            >
              <img
                src={getCharacterPortraitUrl(
                  state.characterId,
                  state.currentEmotion
                )}
                alt={`${character.nickname} - ${state.currentEmotion}`}
                className="p5-portrait-img"
                data-testid="character-portrait"
              />
            </div>

            <div className="p5-character-nameplate">
              <div className="p5-char-codename">{character.codename}</div>
              <div className="p5-char-nickname">{character.nickname}</div>
              <div className="p5-char-attribute">
                ★{character.stars} · {character.attribute} · {character.role}
              </div>
            </div>
          </div>

          {/* RPG HUD Status Card (Model Name, Current Status, Elapsed Time) */}
          <div className="p5-hud-card" data-testid="hud-status-card">
            <div className="p5-hud-header">
              <span className="p5-hud-label">PARTY LEADER HUD // 会话状态</span>
              <span
                className={`p5-hud-live-dot status-${state.hudStatus}`}
              />
            </div>

            <div className="p5-hud-row">
              <span className="p5-hud-key">MODEL // 模型</span>
              <strong className="p5-hud-val p5-hud-model" data-testid="hud-model-name">
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

            {/* Game-style slanted gauge bar */}
            <div className="p5-hud-gauge-track">
              <div
                className={`p5-hud-gauge-fill status-${state.hudStatus}`}
                style={{ width: `${hudStatusMeta.gauge}%` }}
              />
            </div>

            <div className="p5-hud-row p5-hud-row--timer">
              <span className="p5-hud-key">TIME // 本轮耗时</span>
              <strong
                className="p5-hud-timer"
                data-testid="hud-elapsed-time"
              >
                {turnDurationSec}s
              </strong>
            </div>
          </div>
        </aside>

        {/* ══ CENTER STAGE: 1. DIALOGUE LAYER (TOP) / 2. ACTION LAYER (MID) / 3. INPUT BAR (BOTTOM-RIGHT) ══ */}
        <main className="p5-center-stage">
          {/* ── LAYER 1: 台词层 (MAIN DIALOGUE BOX) ── */}
          <section className="p5-dialogue-section" data-testid="dialogue-layer">
            {/* Active user mission strip */}
            <div className="p5-mission-strip">
              <span className="p5-mission-tag">ORDER // 委托指令</span>
              <span className="p5-mission-text">
                {latestUserMsg && latestUserMsg.type === 'user_message'
                  ? latestUserMsg.text
                  : '等待店长下达第一条潜入指令……'}
              </span>
              {state.lastTurnOk !== null && !state.turnActive && (
                <span className="p5-mission-done-stamp" data-testid="turn-done-badge">
                  MISSION COMPLETE // 回合完成
                </span>
              )}
            </div>

            {/* One-line-at-a-time P5 comic dialogue box */}
            <div
              className="p5-dialogue-box"
              onClick={skipTypewriter}
              data-testid="dialogue-box"
              role="region"
              aria-label="角色当前台词"
            >
              <div className="p5-dialogue-speaker-tab">
                <span className="speaker-zh">{shortNickname}</span>
                <span className="speaker-en">{character.codename}</span>
                <span className="speaker-emotion">
                  [{state.currentEmotion.toUpperCase()}]
                </span>
              </div>

              <div className="p5-dialogue-content">
                <p
                  className="p5-dialogue-text"
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
                  <span className="p5-ff-badge">&gt;&gt; FAST FORWARD 加速中</span>
                )}
              </div>
            </div>
          </section>

          {/* ── LAYER 2: 行动层 (SKILL CUT-IN CARDS & STEER STATUS) ── */}
          <section className="p5-action-section" data-testid="action-layer">
            <div className="p5-action-section-header">
              <span className="p5-action-kicker">
                SKILL CUT-IN // 行动层（工具调用不进聊天流，点击卡片展开档案层）
              </span>
              {state.turnActive && (
                <span className="p5-action-live-indicator">
                  ● EXECUTING STAGE SCRIPT
                </span>
              )}
            </div>

            {/* Active Skill Cut-in Cards */}
            <div className="p5-active-skills-zone">
              {stageSkillCards.length > 0 ? (
                stageSkillCards.map((card) => (
                  <div
                    key={card.toolUseId}
                    className={`p5-skill-cutin-card status-${card.status}`}
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
                        SKILL ACTIVATED // 技能发动
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
                          character.nickname,
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
              ) : (
                <div className="p5-skill-idle-stage">
                  {state.skillCards.length === 0 ? (
                    <div className="p5-skill-placeholder">
                      <span className="p5-placeholder-star">★</span>
                      <span>
                        待命舞台：发送右下角指令后，{shortNickname}的每次工具调用将以
                        <strong>「技能发动」切入卡</strong>在此演出，随后收进右侧「行动记录」条。
                      </span>
                    </div>
                  ) : (
                    <div
                      className="p5-skill-placeholder p5-skill-placeholder--clickable"
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
                      <span className="p5-placeholder-star">✔</span>
                      <span>
                        本轮共发动 <strong>{state.skillCards.length}</strong> 次技能，已全部收入右侧
                        <strong>「行动记录」</strong>条（点击此处或右侧条目可随时打开档案层查看 Diff / 终端输出）。
                      </span>
                    </div>
                  )}
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

          {/* ── BOTTOM-RIGHT: 玩家输入框 (PLAYER COMMAND INPUT) ── */}
          <section className="p5-input-section" data-testid="player-input-zone">
            <div className="p5-input-quick-row">
              <span className="p5-input-mode-tag">
                {state.turnActive
                  ? 'LIVE STEER // 演出中随时插话'
                  : 'PHANTOM ORDER // 玩家指令输入'}
              </span>

              <div className="p5-quick-chips">
                {!state.turnActive ? (
                  <button
                    type="button"
                    className="p5-chip-btn"
                    onClick={() => setInputValue(DEFAULT_FIRST_USER_PROMPT)}
                  >
                    填入示例委托指令
                  </button>
                ) : (
                  <button
                    type="button"
                    className="p5-chip-btn p5-chip-btn--steer"
                    data-testid="quick-steer-btn"
                    onClick={() => {
                      playerRef.current?.sendSteer(
                        '顺便检查一下深色模式下的按钮边框对比度！'
                      );
                    }}
                  >
                    ⚡ 一键测试插话 (Steer)
                  </button>
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
                    ? '剧本运行中：输入消息并回车立即插话（触发 steer_queued -> 已传达，待接收）...'
                    : '输入委托任务并按 Enter 发送（开始播放剧本）...'
                }
              />
              <button
                type="submit"
                className="p5-send-btn"
                data-testid="stage-send-btn"
              >
                <span className="send-en">
                  {state.turnActive ? 'STEER' : 'TAKE HEART'}
                </span>
                <span className="send-zh">
                  {state.turnActive ? '插话传达 ▶' : '发送出击 ▶'}
                </span>
              </button>
            </form>
          </section>
        </main>

        {/* ══ RIGHT SIDEBAR STRIP: 「行动记录」 (COLLAPSED SKILL LOG) ══ */}
        <aside className="p5-right-action-log" data-testid="action-log-strip">
          <div className="p5-log-header">
            <span className="p5-log-title-en">ACTION LOG</span>
            <span className="p5-log-title-zh">行动记录 ({state.skillCards.length})</span>
          </div>
          <div className="p5-log-sub">点击任一技能条展开【档案层】</div>

          <div className="p5-log-list">
            {state.skillCards.length === 0 ? (
              <div className="p5-log-empty">暂无已发动技能</div>
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

      {/* ── OVERLAYS: 权限选择肢 / 档案层 / BACKLOG ── */}
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
    </div>
  );
};
