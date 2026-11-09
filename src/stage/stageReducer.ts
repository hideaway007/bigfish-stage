import type { Emotion, StageEvent, ToolKind } from '../shared/stage-events';
import {
  DEFAULT_CHARACTER_ID,
  HUD_MODEL_DISPLAY_NAME,
  reactions,
} from './reactions';
import type { AgentCharacter } from '../characters/roster';

export type HudStatus = 'idle' | 'thinking' | 'acting';

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
  lineId: number;
  characterId: string;
  emotion: Emotion;
  text: string;
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

export interface StageState {
  characterId: AgentCharacter['id'];
  sessionId: string;
  modelName: string;
  cwd: string;
  hudStatus: HudStatus;
  turnActive: boolean;
  turnStartedAt: number | null;
  turnDurationMs: number;
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

  backlogOpen: boolean;
  engineeringView: boolean;
  fastForward: boolean;
}

export type StageAction =
  | { type: 'STAGE_EVENT'; event: StageEvent }
  | { type: 'COLLAPSE_SKILL_CARD'; toolUseId: string }
  | { type: 'SELECT_SKILL_CARD'; toolUseId: string | null }
  | { type: 'SET_PERMISSION_CHOICE'; choice: 'allow' | 'reject' }
  | { type: 'TOGGLE_BACKLOG'; open?: boolean }
  | { type: 'TOGGLE_ENGINEERING_VIEW'; open?: boolean }
  | { type: 'SET_FAST_FORWARD'; fast: boolean }
  | { type: 'SET_CHARACTER'; characterId: AgentCharacter['id'] }
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

export function createInitialStageState(
  characterId: AgentCharacter['id'] = DEFAULT_CHARACTER_ID
): StageState {
  return {
    characterId,
    sessionId: 'ses_dafeiyu_v4_01',
    modelName: HUD_MODEL_DISPLAY_NAME[characterId],
    cwd: '/workspace/phantom-login-app',
    hudStatus: 'idle',
    turnActive: false,
    turnStartedAt: null,
    turnDurationMs: 0,
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

    backlogOpen: false,
    engineeringView: false,
    fastForward: false,
  };
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
      };
    }

    case 'SET_CHARACTER': {
      return {
        ...state,
        characterId: action.characterId,
        modelName: HUD_MODEL_DISPLAY_NAME[action.characterId],
        emotionSwitchKey: state.emotionSwitchKey + 1,
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

    case 'TICK_TIMER': {
      if (!state.turnActive || state.turnStartedAt === null) return state;
      return {
        ...state,
        turnDurationMs: Math.max(0, action.now - state.turnStartedAt),
      };
    }

    case 'STAGE_EVENT': {
      const { event } = action;
      const events = [...state.events, event];
      const charReactions = reactions[state.characterId] ?? {};

      switch (event.type) {
        case 'session_started': {
          return {
            ...state,
            events,
            sessionId: event.sessionId,
            modelName:
              event.model ?? HUD_MODEL_DISPLAY_NAME[state.characterId],
            cwd: event.cwd ?? state.cwd,
            hudStatus: 'idle',
          };
        }

        case 'user_message': {
          return {
            ...state,
            events,
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
          };
        }

        case 'character_line': {
          const emotionChanged = state.currentEmotion !== event.emotion;
          return {
            ...state,
            events,
            currentEmotion: event.emotion,
            emotionSwitchKey: state.emotionSwitchKey + (emotionChanged ? 2 : 1),
            currentLine: {
              lineId: state.emotionSwitchKey + 1,
              characterId: event.characterId || state.characterId,
              emotion: event.emotion,
              text: event.text,
              at: event.at,
            },
          };
        }

        case 'thinking': {
          const mappedEmotion =
            charReactions.thinking?.emotion ?? 'thinking';
          return {
            ...state,
            events,
            hudStatus: 'thinking',
            currentEmotion: mappedEmotion,
            emotionSwitchKey:
              state.currentEmotion !== mappedEmotion
                ? state.emotionSwitchKey + 1
                : state.emotionSwitchKey,
          };
        }

        case 'worker_text': {
          return {
            ...state,
            events,
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
          // Collapse older completed cards when a new skill starts so the main cut-in zone stays focused
          const updatedExisting = state.skillCards.map((c) =>
            c.status !== 'running' ? { ...c, collapsedToLog: true } : c
          );
          return {
            ...state,
            events,
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
          const skillCards = state.skillCards.map((card) =>
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
          const anyStillRunning = skillCards.some(
            (c) => c.status === 'running'
          );
          return {
            ...state,
            events,
            skillCards,
            hudStatus: anyStillRunning ? 'acting' : 'thinking',
          };
        }

        case 'permission_request': {
          const mappedEmotion =
            charReactions.permission_request?.emotion ?? 'shocked';
          return {
            ...state,
            events,
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
            ...state,
            events,
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
            ...state,
            events,
            steers: [...state.steers, nextSteer],
          };
        }

        case 'steer_acked': {
          return {
            ...state,
            events,
            steers: state.steers.map((s) =>
              s.id === event.id
                ? { ...s, status: 'acked', ackedAt: event.at }
                : s
            ),
          };
        }

        case 'turn_done': {
          const elapsed =
            state.turnStartedAt !== null
              ? Math.max(0, event.at - state.turnStartedAt)
              : event.durationMs ?? 0;
          return {
            ...state,
            events,
            turnActive: false,
            hudStatus: 'idle',
            turnDurationMs: elapsed || event.durationMs || state.turnDurationMs,
            lastTurnOk: event.ok,
            lastTurnSummary: event.summary ?? null,
          };
        }

        case 'error': {
          return {
            ...state,
            events,
            turnActive: false,
            hudStatus: 'idle',
            currentEmotion: 'worried',
            emotionSwitchKey: state.emotionSwitchKey + 1,
          };
        }

        case 'interrupted': {
          return {
            ...state,
            events,
            turnActive: false,
            hudStatus: 'idle',
          };
        }

        default:
          return { ...state, events };
      }
    }
  }
}
