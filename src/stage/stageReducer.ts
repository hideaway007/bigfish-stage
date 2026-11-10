import type { Emotion, StageEvent, ToolKind } from '../shared/stage-events';
import type { CharacterSummary } from '../shared/character-pack';
import {
  DEFAULT_SETTINGS,
  type PublicSettings,
  type WorkerAdapterInfo,
} from '../shared/settings';
import type { ServerMessage, SessionInfo } from '../shared/wire';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  KNOWN_CHARACTER_IDS,
  lookupReaction,
  toCharacterSummary,
} from './characterLoader';

export type HudStatus = 'idle' | 'thinking' | 'acting';

export type SystemMenuTab =
  | 'characters'
  | 'worker'
  | 'voice'
  | 'pond'
  | 'performance';

export interface DiffStats {
  added: number;
  removed: number;
}

export interface SkillCardItem {
  toolUseId: string;
  tool: ToolKind;
  rawName: string;
  summary: string;
  file?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'success' | 'error';
  endSummary?: string;
  diff?: string;
  output?: string;
  diffStats?: DiffStats;
  collapsedToLog: boolean;
}

export interface SteerItem {
  id: string;
  text: string;
  status: 'queued' | 'acked';
  queuedAt: number;
  ackedAt?: number;
}

export interface ActiveDialogueLine {
  lineKey: string;
  characterId: string;
  emotion: Emotion;
  text: string;
  source?: 'preset' | 'model';
  replaceVersion: number;
  at: number;
}

export interface PendingPermission {
  requestId: string;
  tool: ToolKind;
  rawName: string;
  summary: string;
  detail: string;
  at: number;
}

export interface StageErrorNotice {
  message: string;
  at: number;
}

export interface ModelListState {
  models: string[];
  error?: string;
  loading: boolean;
}

export interface ConnectionTestState {
  testing: boolean;
  ok?: boolean;
  message?: string;
  latencyMs?: number;
}

export interface StageState {
  characterId: string;
  characterSwitchKey: number;
  sessionId: string;
  modelName: string;
  cwd: string;
  hudStatus: HudStatus;
  turnActive: boolean;
  turnStartedAt: number | null;
  turnDurationMs: number;
  lastEventAt: number | null;
  idleWaitMs: number;
  lastTurnOk: boolean | null;
  lastTurnSummary: string | null;

  currentEmotion: Emotion;
  emotionSwitchKey: number;
  currentLine: ActiveDialogueLine | null;

  skillCards: SkillCardItem[];
  selectedToolUseId: string | null;

  pendingPermission: PendingPermission | null;
  permissionChoice: 'allow' | 'reject';
  lastPermissionDecision: 'allow' | 'reject' | null;

  steers: SteerItem[];
  events: StageEvent[];
  lastError: StageErrorNotice | null;

  backlogOpen: boolean;
  engineeringView: boolean;
  systemMenuOpen: boolean;
  systemMenuTab: SystemMenuTab;
  fastForward: boolean;

  serverSettings: PublicSettings;
  settingsSyncedAt: number | null;
  characters: CharacterSummary[];
  workerAdapters: WorkerAdapterInfo[];
  sessionInfo: SessionInfo | null;

  workerModels: ModelListState;
  voiceModels: ModelListState;
  workerConnTest: ConnectionTestState;
  voiceConnTest: ConnectionTestState;
}

export type StageAction =
  | { type: 'STAGE_EVENT'; event: StageEvent }
  | { type: 'SERVER_MESSAGE'; message: ServerMessage }
  | { type: 'COLLAPSE_SKILL_CARD'; toolUseId: string }
  | { type: 'SELECT_SKILL_CARD'; toolUseId: string | null }
  | { type: 'SET_PERMISSION_CHOICE'; choice: 'allow' | 'reject' }
  | { type: 'TOGGLE_BACKLOG'; open?: boolean }
  | { type: 'TOGGLE_ENGINEERING_VIEW'; open?: boolean }
  | { type: 'TOGGLE_SYSTEM_MENU'; open?: boolean; tab?: SystemMenuTab }
  | { type: 'SET_SYSTEM_TAB'; tab: SystemMenuTab }
  | { type: 'SET_FAST_FORWARD'; fast: boolean }
  | { type: 'SET_CHARACTER'; characterId: string }
  | { type: 'MARK_MODELS_LOADING'; target: 'worker' | 'voice' }
  | { type: 'MARK_CONN_TESTING'; target: 'worker' | 'voice' }
  | { type: 'DISMISS_ERROR' }
  | { type: 'TICK_TIMER'; now: number }
  | { type: 'RESET_STAGE' };

export function computeDiffStats(diff?: string): DiffStats | undefined {
  if (!diff) return undefined;
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed += 1;
    }
  }
  return { added, removed };
}

export function createDefaultPublicSettings(
  characterId: string = DEFAULT_CHARACTER_ID
): PublicSettings {
  return {
    version: 1,
    activeCharacterId: characterId,
    projectDir: DEFAULT_SETTINGS.projectDir,
    recentProjects: [...DEFAULT_SETTINGS.recentProjects],
    worker: {
      ...DEFAULT_SETTINGS.worker,
      endpoint: { baseUrl: DEFAULT_SETTINGS.worker.endpoint.baseUrl, apiKeySet: false },
    },
    voice: {
      enabled: DEFAULT_SETTINGS.voice.enabled,
      endpoint: {
        baseUrl: DEFAULT_SETTINGS.voice.endpoint.baseUrl,
        model: DEFAULT_SETTINGS.voice.endpoint.model,
        apiKeySet: false,
      },
      maxLinesPerMinute: DEFAULT_SETTINGS.voice.maxLinesPerMinute,
    },
    performance: { ...DEFAULT_SETTINGS.performance },
  };
}

export function createInitialStageState(
  characterId: string = DEFAULT_CHARACTER_ID
): StageState {
  const defaultChars = KNOWN_CHARACTER_IDS.map((id) =>
    toCharacterSummary(getCachedCharacterPack(id))
  );

  return {
    characterId,
    characterSwitchKey: 1,
    sessionId: 'ses_dafeiyu_v4_01',
    modelName: DEFAULT_SETTINGS.worker.model,
    cwd: '尚未选择项目文件夹',
    hudStatus: 'idle',
    turnActive: false,
    turnStartedAt: null,
    turnDurationMs: 0,
    lastEventAt: null,
    idleWaitMs: 0,
    lastTurnOk: null,
    lastTurnSummary: null,

    currentEmotion: 'idle',
    emotionSwitchKey: 1,
    currentLine: null,

    skillCards: [],
    selectedToolUseId: null,

    pendingPermission: null,
    permissionChoice: 'allow',
    lastPermissionDecision: null,

    steers: [],
    events: [],
    lastError: null,

    backlogOpen: false,
    engineeringView: false,
    systemMenuOpen: false,
    systemMenuTab: 'characters',
    fastForward: false,

    serverSettings: createDefaultPublicSettings(characterId),
    settingsSyncedAt: null,
    characters: defaultChars,
    workerAdapters: [
      {
        id: 'dsh',
        name: 'DeepSeek Harness (DSH)',
        available: true,
      },
    ],
    sessionInfo: null,

    workerModels: { models: [], loading: false },
    voiceModels: { models: [], loading: false },
    workerConnTest: { testing: false },
    voiceConnTest: { testing: false },
  };
}

function appendOrMergeEvent(
  existingEvents: StageEvent[],
  event: StageEvent
): StageEvent[] {
  // Handle in-place replacement for character_line with replacesLineId
  if (event.type === 'character_line' && event.replacesLineId) {
    const targetId = event.replacesLineId;
    let replaced = false;
    const next = existingEvents.map((ev) => {
      if (ev.type === 'character_line' && ev.lineId === targetId && ev.characterId === event.characterId) {
        replaced = true;
        return {
          ...event,
          lineId: event.lineId ?? targetId,
        };
      }
      return ev;
    });
    if (replaced) {
      return next;
    }
  }

  // Coalesce token-streamed worker_text events so Backlog & EngineeringView stay readable
  if (event.type === 'worker_text') {
    const lastIdx = existingEvents.length - 1;
    if (lastIdx >= 0) {
      const lastEv = existingEvents[lastIdx];
      if (lastEv.type === 'worker_text' && !lastEv.final) {
        const merged: StageEvent = {
          ...lastEv,
          text: lastEv.text + event.text,
          final: event.final,
          at: event.at,
        };
        return [...existingEvents.slice(0, lastIdx), merged];
      }
      if (event.text === '' && event.final) {
        // Attach final flag to the most recent worker_text in current turn if present
        for (let i = lastIdx; i >= 0; i -= 1) {
          const prev = existingEvents[i];
          if (prev.type === 'user_message') break;
          if (prev.type === 'worker_text') {
            const copy = [...existingEvents];
            copy[i] = { ...prev, final: true };
            return copy;
          }
        }
        return existingEvents;
      }
    }
  }

  return [...existingEvents, event];
}

function applySingleStageEvent(
  state: StageState,
  event: StageEvent
): StageState {
  const events = appendOrMergeEvent(state.events, event);
  const pack = getCachedCharacterPack(state.characterId);
  const matchedReaction = lookupReaction(pack, event);
  const nextStateBase: StageState = {
    ...state,
    events,
    lastEventAt: event.at,
    idleWaitMs: 0,
  };

  switch (event.type) {
    case 'session_started': {
      return {
        ...nextStateBase,
        sessionId: event.sessionId,
        modelName: event.model ?? state.modelName,
        cwd: event.cwd ?? state.cwd,
        hudStatus: 'idle',
      };
    }

    case 'user_message': {
      return {
        ...nextStateBase,
        turnActive: true,
        turnStartedAt: event.at,
        turnDurationMs: 0,
        lastTurnOk: null,
        lastTurnSummary: null,
        hudStatus: 'thinking',
        pendingPermission: null,
        lastPermissionDecision: null,
        skillCards: [],
        steers: [],
        lastError: null,
      };
    }

    case 'character_line': {
      // If the real AI (worker_text) has already started answering in this turn,
      // do not let canned preset catchphrases overwrite the real reply in the dialogue box!
      const hasRealReplyInTurn = (() => {
        for (let i = events.length - 1; i >= 0; i -= 1) {
          const ev = events[i];
          if (ev.type === 'user_message') break;
          if (ev.type === 'worker_text' && ev.text.trim().length > 0) {
            return true;
          }
        }
        return false;
      })();
      if (hasRealReplyInTurn) {
        return nextStateBase;
      }

      const emotionChanged = state.currentEmotion !== event.emotion;
      const isReplacement = Boolean(
        event.replacesLineId &&
          state.currentLine &&
          state.currentLine.lineKey === event.replacesLineId &&
          state.currentLine.characterId === event.characterId
      );
      // A delayed model response may update history, but cannot replace another line/character.
      if (event.replacesLineId && !isReplacement) return nextStateBase;

      const lineKey =
        event.lineId ??
        event.replacesLineId ??
        `line_${state.emotionSwitchKey + 1}_${event.at}`;

      return {
        ...nextStateBase,
        currentEmotion: event.emotion,
        emotionSwitchKey:
          state.emotionSwitchKey + (emotionChanged ? 2 : 1),
        currentLine: {
          lineKey,
          characterId: event.characterId || state.characterId,
          emotion: event.emotion,
          text: event.text,
          source: event.source ?? (event.replacesLineId ? 'model' : 'preset'),
          replaceVersion: isReplacement
            ? (state.currentLine?.replaceVersion ?? 0) + 1
            : 0,
          at: event.at,
        },
      };
    }

    case 'thinking': {
      const mappedEmotion = matchedReaction?.emotion ?? 'thinking';
      return {
        ...nextStateBase,
        hudStatus: 'thinking',
        currentEmotion: mappedEmotion,
        emotionSwitchKey:
          state.currentEmotion !== mappedEmotion
            ? state.emotionSwitchKey + 1
            : state.emotionSwitchKey,
      };
    }

    case 'worker_text': {
      // Stream the real AI response directly into the main dialogue bubble!
      let mergedText = event.text;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev.type === 'user_message') break;
        if (ev.type === 'worker_text' && ev.text.trim()) {
          mergedText = ev.text;
          break;
        }
      }
      if (!mergedText.trim()) {
        return nextStateBase;
      }
      const nextEmotion: Emotion = event.final ? 'happy' : 'working';
      const lineKey = `worker_reply_${state.turnStartedAt ?? event.at}`;
      const isSameReply = state.currentLine?.lineKey === lineKey;
      return {
        ...nextStateBase,
        currentEmotion: nextEmotion,
        emotionSwitchKey:
          state.currentEmotion !== nextEmotion
            ? state.emotionSwitchKey + 1
            : state.emotionSwitchKey,
        currentLine: {
          lineKey,
          characterId: state.characterId,
          emotion: nextEmotion,
          text: mergedText,
          source: 'model',
          replaceVersion: isSameReply
            ? (state.currentLine?.replaceVersion ?? 0) + 1
            : 1,
          at: event.at,
        },
      };
    }

    case 'tool_start': {
      const newCard: SkillCardItem = {
        toolUseId: event.toolUseId,
        tool: event.tool,
        rawName: event.rawName,
        summary: event.summary,
        file: event.file,
        startedAt: event.at,
        status: 'running',
        collapsedToLog: false,
      };
      const updatedExisting = state.skillCards.map((c) =>
        c.status !== 'running' ? { ...c, collapsedToLog: true } : c
      );
      return {
        ...nextStateBase,
        hudStatus: 'acting',
        currentEmotion: 'working',
        emotionSwitchKey:
          state.currentEmotion !== 'working'
            ? state.emotionSwitchKey + 1
            : state.emotionSwitchKey,
        skillCards: [...updatedExisting, newCard],
      };
    }

    case 'tool_end': {
      const diffStats = computeDiffStats(event.diff);
      const existingCard = state.skillCards.find(
        (c) => c.toolUseId === event.toolUseId
      );

      let skillCards: SkillCardItem[];
      if (existingCard) {
        skillCards = state.skillCards.map((card) =>
          card.toolUseId === event.toolUseId
            ? {
                ...card,
                endedAt: event.at,
                status: (event.ok ? 'success' : 'error') as
                  | 'success'
                  | 'error',
                endSummary: event.summary,
                diff: event.diff,
                output: event.output,
                diffStats,
              }
            : card
        );
      } else {
        // Synthetic tool_end (e.g. git diff at end of turn)
        skillCards = [
          ...state.skillCards,
          {
            toolUseId: event.toolUseId,
            tool: event.diff ? 'edit' : 'other',
            rawName: 'git diff',
            summary: event.summary ?? '工作区文件变更汇总',
            startedAt: event.at,
            endedAt: event.at,
            status: event.ok ? 'success' : 'error',
            endSummary: event.summary,
            diff: event.diff,
            output: event.output,
            diffStats,
            collapsedToLog: false,
          },
        ];
      }

      const anyStillRunning = skillCards.some((c) => c.status === 'running');
      const nextEmotion = !event.ok ? 'worried' : state.currentEmotion;
      return {
        ...nextStateBase,
        skillCards,
        hudStatus: anyStillRunning ? 'acting' : 'thinking',
        currentEmotion: nextEmotion,
        emotionSwitchKey:
          nextEmotion !== state.currentEmotion
            ? state.emotionSwitchKey + 1
            : state.emotionSwitchKey,
      };
    }

    case 'permission_request': {
      const mappedEmotion = matchedReaction?.emotion ?? 'shocked';
      return {
        ...nextStateBase,
        hudStatus: 'acting',
        currentEmotion: mappedEmotion,
        emotionSwitchKey: state.emotionSwitchKey + 1,
        pendingPermission: {
          requestId: event.requestId,
          tool: event.tool,
          rawName: event.rawName,
          summary: event.summary,
          detail: event.detail,
          at: event.at,
        },
        permissionChoice: 'allow',
      };
    }

    case 'permission_resolved': {
      return {
        ...nextStateBase,
        pendingPermission: null,
        lastPermissionDecision: event.allowed ? 'allow' : 'reject',
        hudStatus: 'thinking',
      };
    }

    case 'steer_queued': {
      const nextSteer: SteerItem = {
        id: event.id,
        text: event.text,
        status: 'queued',
        queuedAt: event.at,
      };
      return {
        ...nextStateBase,
        steers: [...state.steers, nextSteer],
      };
    }

    case 'steer_acked': {
      return {
        ...nextStateBase,
        steers: state.steers.map((s) =>
          s.id === event.id
            ? { ...s, status: 'acked', ackedAt: event.at }
            : s
        ),
      };
    }

    case 'turn_done': {
      const elapsed =
        event.durationMs ??
        (state.turnStartedAt !== null
          ? Math.max(0, event.at - state.turnStartedAt)
          : state.turnDurationMs);
      const nextEmotion: Emotion = event.ok ? 'happy' : 'worried';
      return {
        ...nextStateBase,
        turnActive: false,
        hudStatus: 'idle',
        idleWaitMs: 0,
        turnDurationMs: elapsed,
        lastTurnOk: event.ok,
        lastTurnSummary: event.summary ?? null,
        pendingPermission: null,
        currentEmotion: nextEmotion,
        emotionSwitchKey:
          state.currentEmotion !== nextEmotion
            ? state.emotionSwitchKey + 1
            : state.emotionSwitchKey,
      };
    }

    case 'error': {
      return {
        ...nextStateBase,
        turnActive: false,
        hudStatus: 'idle',
        idleWaitMs: 0,
        currentEmotion: 'worried',
        emotionSwitchKey: state.emotionSwitchKey + 1,
        lastError: {
          message: event.message,
          at: event.at,
        },
      };
    }

    case 'interrupted': {
      return {
        ...nextStateBase,
        turnActive: false,
        hudStatus: 'idle',
        idleWaitMs: 0,
        pendingPermission: null,
      };
    }

    default:
      return nextStateBase;
  }
}

export function stageReducer(
  state: StageState,
  action: StageAction
): StageState {
  switch (action.type) {
    case 'RESET_STAGE': {
      return {
        ...createInitialStageState(state.characterId),
        engineeringView: state.engineeringView,
        serverSettings: state.serverSettings,
        characters: state.characters,
        workerAdapters: state.workerAdapters,
      };
    }

    case 'SET_CHARACTER': {
      if (state.characterId === action.characterId) return state;
      return {
        ...state,
        characterId: action.characterId,
        characterSwitchKey: state.characterSwitchKey + 1,
        emotionSwitchKey: state.emotionSwitchKey + 1,
        currentLine: state.currentLine,
      };
    }

    case 'SET_FAST_FORWARD': {
      if (state.fastForward === action.fast) return state;
      return { ...state, fastForward: action.fast };
    }

    case 'TOGGLE_BACKLOG': {
      const next =
        action.open !== undefined ? action.open : !state.backlogOpen;
      return { ...state, backlogOpen: next };
    }

    case 'TOGGLE_ENGINEERING_VIEW': {
      const next =
        action.open !== undefined ? action.open : !state.engineeringView;
      return { ...state, engineeringView: next };
    }

    case 'TOGGLE_SYSTEM_MENU': {
      const next =
        action.open !== undefined ? action.open : !state.systemMenuOpen;
      return {
        ...state,
        systemMenuOpen: next,
        systemMenuTab: action.tab ?? state.systemMenuTab,
      };
    }

    case 'SET_SYSTEM_TAB': {
      return { ...state, systemMenuTab: action.tab };
    }

    case 'SELECT_SKILL_CARD': {
      return { ...state, selectedToolUseId: action.toolUseId };
    }

    case 'SET_PERMISSION_CHOICE': {
      return { ...state, permissionChoice: action.choice };
    }

    case 'COLLAPSE_SKILL_CARD': {
      return {
        ...state,
        skillCards: state.skillCards.map((card) =>
          card.toolUseId === action.toolUseId
            ? { ...card, collapsedToLog: true }
            : card
        ),
      };
    }

    case 'MARK_MODELS_LOADING': {
      if (action.target === 'worker') {
        return {
          ...state,
          workerModels: { ...state.workerModels, loading: true, error: undefined },
        };
      }
      return {
        ...state,
        voiceModels: { ...state.voiceModels, loading: true, error: undefined },
      };
    }

    case 'MARK_CONN_TESTING': {
      if (action.target === 'worker') {
        return { ...state, workerConnTest: { testing: true } };
      }
      return { ...state, voiceConnTest: { testing: true } };
    }

    case 'DISMISS_ERROR': {
      return { ...state, lastError: null };
    }

    case 'TICK_TIMER': {
      if (!state.turnActive) return state;
      const turnDurationMs =
        state.turnStartedAt !== null
          ? Math.max(0, action.now - state.turnStartedAt)
          : state.turnDurationMs;
      const idleWaitMs =
        state.lastEventAt !== null
          ? Math.max(0, action.now - state.lastEventAt)
          : 0;
      return {
        ...state,
        turnDurationMs,
        idleWaitMs,
      };
    }

    case 'STAGE_EVENT': {
      const now = Date.now();
      const updated = applySingleStageEvent(state, action.event);
      // Use real wall-clock timestamp for live turn/idle tracking so replayed sample timestamps work accurately
      return {
        ...updated,
        turnStartedAt:
          action.event.type === 'user_message'
            ? now
            : updated.turnStartedAt ?? (updated.turnActive ? now : null),
        lastEventAt: now,
        idleWaitMs: 0,
      };
    }

    case 'SERVER_MESSAGE': {
      const { message } = action;
      switch (message.type) {
        case 'welcome': {
          const activeCharId =
            message.settings?.activeCharacterId || state.characterId;
          let nextState: StageState = {
            ...state,
            characterId: activeCharId,
            serverSettings: message.settings,
            settingsSyncedAt: Date.now(),
            characters:
              message.characters && message.characters.length > 0
                ? message.characters
                : state.characters,
            workerAdapters:
              message.workerAdapters && message.workerAdapters.length > 0
                ? message.workerAdapters
                : state.workerAdapters,
            sessionInfo: message.session,
            sessionId: message.session?.sessionId ?? state.sessionId,
            modelName:
              message.session?.model ||
              message.settings?.worker?.model ||
              state.modelName,
            cwd:
              message.session?.cwd ||
              message.settings?.projectDir ||
              '尚未选择项目文件夹',
          };

          if (message.history && message.history.length > 0) {
            // Reset event-derived state and replay welcome.history
            nextState = {
              ...nextState,
              events: [],
              skillCards: [],
              steers: [],
              pendingPermission: null,
              lastPermissionDecision: null,
              lastTurnOk: null,
              lastTurnSummary: null,
              turnActive: false,
              hudStatus: 'idle',
            };
            for (const ev of message.history) {
              nextState = applySingleStageEvent(nextState, ev);
            }
            if (!nextState.turnActive) {
              nextState = {
                ...nextState,
                skillCards: nextState.skillCards.map((c) => ({
                  ...c,
                  collapsedToLog: true,
                })),
              };
            } else {
              const now = Date.now();
              nextState = {
                ...nextState,
                turnStartedAt: now - nextState.turnDurationMs,
                lastEventAt: now,
                idleWaitMs: 0,
              };
            }
          }

          return nextState;
        }

        case 'event': {
          return stageReducer(state, {
            type: 'STAGE_EVENT',
            event: message.event,
          });
        }

        case 'settings': {
          const nextCharId =
            message.settings.activeCharacterId || state.characterId;
          const charChanged = nextCharId !== state.characterId;
          return {
            ...state,
            serverSettings: message.settings,
            settingsSyncedAt: Date.now(),
            characterId: nextCharId,
            characterSwitchKey: charChanged
              ? state.characterSwitchKey + 1
              : state.characterSwitchKey,
            emotionSwitchKey: charChanged
              ? state.emotionSwitchKey + 1
              : state.emotionSwitchKey,
            currentLine: state.currentLine,
            modelName: !state.turnActive
              ? message.settings.worker.model || state.modelName
              : state.modelName,
            cwd:
              !state.turnActive && message.settings.projectDir
                ? message.settings.projectDir
                : state.cwd,
          };
        }

        case 'session': {
          if (!message.session) {
            return {
              ...state,
              sessionInfo: null,
              turnActive: false,
              hudStatus: 'idle',
            };
          }
          return {
            ...state,
            sessionInfo: message.session,
            sessionId: message.session.sessionId,
            modelName: message.session.model || state.modelName,
            cwd: message.session.cwd || state.cwd,
            turnActive: message.session.turnActive,
          };
        }

        case 'models': {
          if (message.target === 'worker') {
            return {
              ...state,
              workerModels: {
                models: message.models,
                error: message.error,
                loading: false,
              },
            };
          }
          return {
            ...state,
            voiceModels: {
              models: message.models,
              error: message.error,
              loading: false,
            },
          };
        }

        case 'connection_test': {
          if (message.target === 'worker') {
            return {
              ...state,
              workerConnTest: {
                testing: false,
                ok: message.ok,
                message: message.message,
                latencyMs: message.latencyMs,
              },
            };
          }
          return {
            ...state,
            voiceConnTest: {
              testing: false,
              ok: message.ok,
              message: message.message,
              latencyMs: message.latencyMs,
            },
          };
        }

        case 'command_error': {
          return {
            ...state,
            lastError: {
              message: `${message.message} (${message.commandType})`,
              at: Date.now(),
            },
          };
        }

        default:
          return state;
      }
    }
  }
}
