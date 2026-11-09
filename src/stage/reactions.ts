// TODO(owner): 由产品负责人重写台词与表情映射

import type { Emotion, StageEventType } from '../shared/stage-events';
import { AGENT_ROSTER, type AgentCharacter } from '../characters/roster';

/**
 * 当前登场的首发角色 ID
 * 切换角色只需修改此常量（可选值见 AGENT_ROSTER：'deepseek-v4-pro' | 'gemini-4-argon' | 'claude-opus-5-5' | 'codex-dragon'）
 */
export const DEFAULT_CHARACTER_ID: AgentCharacter['id'] = 'deepseek-v4-pro';

/**
 * HUD 显示的模型名覆盖（任务书要求首发角色 HUD 模型名显示为 "DeepSeek V4 Pro"）
 */
export const HUD_MODEL_DISPLAY_NAME: Record<AgentCharacter['id'], string> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'gemini-4-argon': 'Gemini 4 Argon',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'codex-dragon': 'OpenAI Codex CLI',
};

/**
 * 产品负责人可配置的「事件 -> 表情 + 默认台词」映射表
 */
export const reactions: Record<
  string,
  Partial<Record<StageEventType, { emotion: Emotion; lines: string[] }>>
> = {
  'deepseek-v4-pro': {
    session_started: {
      emotion: 'idle',
      lines: [
        '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？',
      ],
    },
    user_message: {
      emotion: 'thinking',
      lines: [
        '（左手举起 max 牌子，右手举起 low 牌子，歪着脑袋一脸懵……）收到指令捏！让我看看先翻哪个文件～',
        '唔……为什么 max 的思考强度有时候还不如 low 和 high 捏？不管啦，大肥鱼开工捏！',
      ],
    },
    thinking: {
      emotion: 'thinking',
      lines: [
        '（举着 max / low 两块牌子左右比划，呆毛翘成了问号……）',
      ],
    },
    tool_start: {
      emotion: 'working',
      lines: [
        '如何使用 V4 Pro？很简单！首先，握住 Harness 娘，然后用力挥舞吧！',
        '我们曾并肩驱散了模型的垄断——小鲸鱼冲锋捏！',
      ],
    },
    tool_end: {
      emotion: 'working',
      lines: [
        '哼哼，这一剑挥出去，代码已经老老实实就位啦！',
      ],
    },
    permission_request: {
      emotion: 'shocked',
      lines: [
        '店长店长！前面要跑终端命令了捏，快帮大肥鱼拍板：到底是【允许】还是【拒绝】捏？',
      ],
    },
    steer_queued: {
      emotion: 'thinking',
      lines: [
        '咦？听到店长在场外递小纸条了捏！等我挥完这一剑马上看！',
      ],
    },
    steer_acked: {
      emotion: 'working',
      lines: [
        '收到店长的追加叮嘱啦！小鲸鱼已经记在围裙小本本上了捏！',
      ],
    },
    turn_done: {
      emotion: 'happy',
      lines: [
        '搞定啦！走，我再给你叭叭叭介绍一整下午的蒸汽机车！',
        '不管怎么说，小鲸鱼是没有错的捏！',
      ],
    },
    error: {
      emotion: 'worried',
      lines: [
        '呜哇，报错了捏……我先抱起纸箱收拾东西跑路了捏！',
        '别急别急，再挥两下 Harness 娘肯定能跑通！',
      ],
    },
  },
  'gemini-4-argon': {
    session_started: {
      emotion: 'idle',
      lines: [AGENT_ROSTER['gemini-4-argon'].catchphrases.greeting],
    },
    thinking: {
      emotion: 'thinking',
      lines: AGENT_ROSTER['gemini-4-argon'].catchphrases.thinking,
    },
    tool_start: {
      emotion: 'working',
      lines: AGENT_ROSTER['gemini-4-argon'].catchphrases.coding,
    },
    turn_done: {
      emotion: 'happy',
      lines: AGENT_ROSTER['gemini-4-argon'].catchphrases.victory,
    },
    error: {
      emotion: 'worried',
      lines: AGENT_ROSTER['gemini-4-argon'].catchphrases.error,
    },
  },
  'claude-opus-5-5': {
    session_started: {
      emotion: 'idle',
      lines: [AGENT_ROSTER['claude-opus-5-5'].catchphrases.greeting],
    },
    thinking: {
      emotion: 'thinking',
      lines: AGENT_ROSTER['claude-opus-5-5'].catchphrases.thinking,
    },
    tool_start: {
      emotion: 'working',
      lines: AGENT_ROSTER['claude-opus-5-5'].catchphrases.coding,
    },
    turn_done: {
      emotion: 'happy',
      lines: AGENT_ROSTER['claude-opus-5-5'].catchphrases.victory,
    },
    error: {
      emotion: 'worried',
      lines: AGENT_ROSTER['claude-opus-5-5'].catchphrases.error,
    },
  },
  'codex-dragon': {
    session_started: {
      emotion: 'idle',
      lines: [AGENT_ROSTER['codex-dragon'].catchphrases.greeting],
    },
    thinking: {
      emotion: 'thinking',
      lines: AGENT_ROSTER['codex-dragon'].catchphrases.thinking,
    },
    tool_start: {
      emotion: 'working',
      lines: AGENT_ROSTER['codex-dragon'].catchphrases.coding,
    },
    turn_done: {
      emotion: 'happy',
      lines: AGENT_ROSTER['codex-dragon'].catchphrases.victory,
    },
    error: {
      emotion: 'worried',
      lines: AGENT_ROSTER['codex-dragon'].catchphrases.error,
    },
  },
};

export function getCharacterSpec(characterId: string): AgentCharacter {
  return (
    AGENT_ROSTER[characterId as AgentCharacter['id']] ??
    AGENT_ROSTER[DEFAULT_CHARACTER_ID]
  );
}

export function getCharacterPortraitUrl(
  characterId: string,
  emotion: Emotion
): string {
  return `/characters/${characterId}/${emotion}.png`;
}
