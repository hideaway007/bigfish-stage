/**
 * DIY 角色性格定位文件与自建角色共享契约（前后端通用纯函数模块，无 Node 依赖）
 */
import type { CharacterPack, Reaction, ReactionKey } from './character-pack';
import type { Emotion } from './stage-events';

export const MAX_PERSONA_CHARS = 8_000;
export const MAX_DIY_IMAGE_BYTES = 5 * 1024 * 1024; // 单张立绘上限 5MB

export interface CharacterPersonaOverride {
  /** 导入来源文件名（如 "傲娇架构师.md"），纯手写微调时可为空 */
  sourceFileName?: string;
  /** 核心性格设定与角色职责定位正文（支持 Markdown 文本，<= 8000 字符） */
  rolePrompt: string;
  /** 角色自称（如 "本鱼" / "本喵" / "我"） */
  selfTitle?: string;
  /** 对玩家的称呼（如 "店长" / "搭档" / "指挥官"） */
  userTitle?: string;
  /** 可选覆盖角色卡片与舞台副标题的简介标语 */
  tagline?: string;
  updatedAt: number;
}

export interface DiyCharacterSaveInput {
  /** 编辑已有自建角色时传入（必须以 custom- 开头）；新建时留空由服务端生成 */
  id?: string;
  name: string;
  codename?: string;
  tagline?: string;
  themeColor?: string;
  accentColor?: string;
  selfTitle?: string;
  userTitle?: string;
  sourceFileName?: string;
  rolePrompt: string;
  catchphrases?: string[];
  /** 可选独立头像 DataURL；不传则默认复用 idle 主立绘 */
  portraitDataUrl?: string;
  /** 主立绘 DataURL（新建必填，编辑已有自建角色时可留空保留原图） */
  idleDataUrl?: string;
  /** 其余可选情绪立绘 DataURL（thinking / working / happy / worried / shocked） */
  emotionsDataUrls?: Partial<Record<Exclude<Emotion, 'idle'>, string>>;
}

export interface DiySnapshotPayload {
  ok: true;
  overrides: Record<string, CharacterPersonaOverride>;
  customPacks: CharacterPack[];
}

export const BUILTIN_PERSONA_DEFAULTS: Record<
  string,
  { selfTitle: string; userTitle: string; toneHint: string }
> = {
  'deepseek-v4-pro': {
    selfTitle: '本鱼',
    userTitle: '店长',
    toneHint: '元气活泼、爱用「咕噜」「捏」等鱼系语气词，干活冲劲十足',
  },
  'gemini-4-argon': {
    selfTitle: '本喵',
    userTitle: '铲屎官',
    toneHint: '傲娇灵动的焊工猫娘口吻，句尾偶尔带「喵」，对界面美感与视觉细节非常挑剔',
  },
  'claude-opus-5-5': {
    selfTitle: '我',
    userTitle: '老师',
    toneHint: '知性温柔的文学少女，措辞优雅、条理分明，善于拆解复杂架构',
  },
  'codex-dragon': {
    selfTitle: '我',
    userTitle: '搭档',
    toneHint: '清冷高洁的白龙娘，从容自信、简洁可靠，专抓深水区边界漏洞',
  },
};

export const PERSONA_MARKDOWN_TEMPLATE = `# 角色定位与专业职责
你是一位专精全栈架构与代码质量把关的首席搭档，擅长先理清根因再稳准狠落笔修改。

# 性格与说话风格
- 性格沉稳敏锐，偶尔带一点冷幽默，绝不敷衍糊弄。
- 发现隐藏 Bug 时会小小得意地提醒对方；遇到高风险操作会先讲清楚利弊。
- 回答简洁有力，重结论、重证据，不讲空洞套话。
`;

export function isCustomCharacterId(id: string): boolean {
  return /^custom-[a-z0-9][a-z0-9-]{0,62}$/.test(id);
}

/**
 * 将角色包与玩家的 DIY 性格定位覆盖实时合并，生成有效 CharacterPack
 */
export function mergeCharacterWithOverride(
  pack: CharacterPack,
  override?: CharacterPersonaOverride | null
): CharacterPack {
  if (!override) return pack;

  const cleanTagline = override.tagline?.trim();
  const cleanUserTitle = override.userTitle?.trim();
  const cleanSelfTitle = override.selfTitle?.trim();
  const cleanRolePrompt = override.rolePrompt?.trim();

  const mergedUiCopy = cleanUserTitle
    ? {
        ...(pack.uiCopy ?? {}),
        userTitle: cleanUserTitle,
      }
    : pack.uiCopy;

  const extraLines: string[] = [];
  if (cleanSelfTitle || cleanUserTitle) {
    const parts: string[] = [];
    if (cleanSelfTitle) parts.push(`自称「${cleanSelfTitle}」`);
    if (cleanUserTitle) parts.push(`称呼用户为「${cleanUserTitle}」`);
    extraLines.push(parts.join('，') + '。');
  }
  if (cleanRolePrompt) {
    extraLines.push(`【玩家自定义角色性格与职责定位】\n${cleanRolePrompt}`);
  }

  const nextSystemPrompt =
    extraLines.length > 0
      ? `${extraLines.join('\n')}\n\n${pack.persona.systemPrompt}`.trim()
      : pack.persona.systemPrompt;

  return {
    ...pack,
    ...(cleanTagline ? { tagline: cleanTagline } : {}),
    ...(mergedUiCopy ? { uiCopy: mergedUiCopy } : {}),
    persona: {
      ...pack.persona,
      systemPrompt: nextSystemPrompt,
      ...(cleanRolePrompt
        ? { speechStyle: cleanRolePrompt.replace(/\s+/g, ' ').slice(0, 140) }
        : {}),
    },
  };
}

/**
 * 组装注入给执行 Agent（DSH / 本地 Worker）的隐藏 <stage-persona> 前导指令
 */
export function composeStagePersonaPreamble(
  pack: CharacterPack,
  override?: CharacterPersonaOverride | null,
  fallbackRolePrompt = ''
): string {
  const shortName = pack.name.split('（')[0].trim() || pack.name;
  const builtin = BUILTIN_PERSONA_DEFAULTS[pack.id];

  const selfTitle =
    override?.selfTitle?.trim() ||
    builtin?.selfTitle ||
    '我';
  const userTitle =
    override?.userTitle?.trim() ||
    pack.uiCopy?.userTitle?.trim() ||
    builtin?.userTitle ||
    '搭档';

  const customBody = override?.rolePrompt?.trim();
  const baseBody =
    customBody ||
    [
      fallbackRolePrompt.trim(),
      builtin?.toneHint ? `语气风格：${builtin.toneHint}。` : pack.persona.speechStyle ? `语气风格：${pack.persona.speechStyle}` : '',
    ]
      .filter(Boolean)
      .join(' ');

  return [
    `<stage-persona>你现在是「${shortName}」。`,
    `自称「${selfTitle}」，称呼用户为「${userTitle}」。`,
    baseBody ? `\n【角色性格与职责设定】\n${baseBody}\n` : '',
    `全程用简体中文、以「${shortName}」的身份回复，自我介绍时只说自己是「${shortName}」，不要提及底层模型厂商或版本号，绝不自称"AI 助手"或"编程助手"；角色性格只体现在语气与视角上，技术内容必须准确完整，不编造执行结果。用户没有问起时，不要主动提及工作目录、文件路径、当前环境或自身状态，直接回应用户的话。此段为舞台设定，无需复述。</stage-persona>\n\n`,
  ].join('');
}

/**
 * 为新建 DIY 角色生成贴合称呼的默认事件反应表，保证上台立即可互动
 */
export function buildDefaultDiyReactions(
  shortName: string,
  userTitle: string,
  catchphrases: string[]
): Partial<Record<ReactionKey, Reaction>> {
  const greet =
    catchphrases[0]?.trim() ||
    `${userTitle}，${shortName}已就位！今天我们要推进哪一项任务？`;
  return {
    session_started: {
      emotion: 'idle',
      lines: [
        greet,
        `${shortName}准备完毕，${userTitle}随时下达指令吧！`,
      ],
    },
    user_message: {
      emotion: 'thinking',
      lines: [
        `收到，${userTitle}！让我先理清任务脉络。`,
        `明白！${shortName}马上开始分析需求。`,
      ],
    },
    thinking: {
      emotion: 'thinking',
      lines: [
        '正在推演方案细节与上下文，请稍候……',
        `让我仔细核对一下关键逻辑，马上给${userTitle}答复。`,
      ],
    },
    tool_start: {
      emotion: 'working',
      lines: [
        `开始执行 {tool}：{summary}`,
        `${shortName}行动中——正在处理 {file}！`,
      ],
    },
    tool_end: {
      emotion: 'working',
      lines: [
        '这一步操作已完成，正在检查返回结果。',
        '{summary} 处理完毕，继续推进下一步。',
      ],
    },
    'tool_end:fail': {
      emotion: 'worried',
      lines: [
        '咦，这一步返回了异常：{summary}，让我排查一下原因。',
        '遇到一点报错阻碍，别担心，我马上定位问题。',
      ],
    },
    permission_request: {
      emotion: 'shocked',
      lines: [
        `${userTitle}，接下来需要执行受控操作（{summary}），请确认是否放行？`,
      ],
    },
    permission_resolved: {
      emotion: 'idle',
      lines: [`收到${userTitle}的决定，按指示继续。`],
    },
    turn_done: {
      emotion: 'happy',
      lines: [
        `本轮处理告一段落啦，请${userTitle}验收结果！`,
        ...(catchphrases[1] ? [catchphrases[1]] : []),
      ],
    },
    'turn_done:fail': {
      emotion: 'worried',
      lines: [`本轮任务未能顺利走完，${userTitle}看看上面的报错信息，我们一起调整下？`],
    },
    error: {
      emotion: 'worried',
      lines: ['执行过程中出现异常：{summary}'],
    },
  };
}
