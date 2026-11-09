import type {
  CharacterPack,
  CharacterSummary,
  Reaction,
  ReactionKey,
} from '../shared/character-pack';
import type { Emotion, StageEvent } from '../shared/stage-events';

export const DEFAULT_CHARACTER_ID = 'deepseek-v4-pro';

export const KNOWN_CHARACTER_IDS = [
  'deepseek-v4-pro',
  'gemini-4-argon',
  'claude-opus-5-5',
  'codex-dragon',
] as const;

/**
 * 将角色包内的相对资源路径（如 "art/idle.png"）转为可直接给 <img> 使用的 URL
 */
export function resolveCharacterAssetUrl(
  characterId: string,
  relPath?: string | null
): string | null {
  if (!relPath) return null;
  if (relPath.startsWith('/') || relPath.startsWith('http://') || relPath.startsWith('https://')) {
    return relPath;
  }
  const cleanRel = relPath.replace(/^\.\//, '');
  return `/characters/${characterId}/${cleanRel}`;
}

export function toCharacterSummary(pack: CharacterPack): CharacterSummary {
  return {
    id: pack.id,
    name: pack.name,
    codename: pack.codename,
    themeColor: pack.themeColor,
    portraitUrl: resolveCharacterAssetUrl(pack.id, pack.art.portrait),
    renderer: pack.art.renderer,
  };
}

/**
 * 按 character-pack.ts 规则查找反应表：最细的键优先，找不到再退回事件类型本身
 */
export function lookupReaction(
  pack: CharacterPack,
  event: StageEvent
): Reaction | undefined {
  const reactions = pack.reactions ?? {};
  const candidates: ReactionKey[] = [];

  if (event.type === 'tool_start') {
    candidates.push(`tool_start:${event.tool}`);
    candidates.push('tool_start');
  } else if (event.type === 'tool_end') {
    if (!event.ok) {
      candidates.push('tool_end:fail');
    }
    const toolKind = (event as { tool?: string }).tool;
    if (toolKind) {
      candidates.push(`tool_end:${toolKind}` as ReactionKey);
    }
    candidates.push('tool_end');
  } else if (event.type === 'turn_done') {
    if (!event.ok) {
      candidates.push('turn_done:fail');
    }
    candidates.push('turn_done');
  } else {
    candidates.push(event.type);
  }

  for (const key of candidates) {
    const found = reactions[key];
    if (found && found.lines && found.lines.length > 0) {
      return found;
    }
  }
  return undefined;
}

export function formatReactionLine(
  template: string,
  vars: { file?: string; tool?: string; summary?: string }
): string {
  const fileVal = vars.file || vars.summary || '目标文件';
  const toolVal = vars.tool || '工具';
  const summaryVal = vars.summary || vars.file || '当前操作';
  return template
    .replace(/\{file\}/g, fileVal)
    .replace(/\{tool\}/g, toolVal)
    .replace(/\{summary\}/g, summaryVal);
}

export function pickReactionForEvent(
  pack: CharacterPack,
  event: StageEvent,
  seedIndex = 0
): { emotion: Emotion; text: string } | null {
  const reaction = lookupReaction(pack, event);
  if (!reaction || reaction.lines.length === 0) return null;

  const lineTemplate = reaction.lines[seedIndex % reaction.lines.length];
  const vars: { file?: string; tool?: string; summary?: string } = {};
  if ('file' in event && typeof event.file === 'string') {
    vars.file = event.file;
  }
  if ('tool' in event && typeof event.tool === 'string') {
    vars.tool = event.tool;
  }
  if ('summary' in event && typeof event.summary === 'string') {
    vars.summary = event.summary;
  }

  return {
    emotion: reaction.emotion,
    text: formatReactionLine(lineTemplate, vars),
  };
}

/**
 * 首屏 fetch 尚未返回时的最小同步回退包（一旦 /characters/<id>/character.json 加载完成即被真实角色包覆盖）
 */
const BOOTSTRAP_FALLBACK_PACK: CharacterPack = {
  schemaVersion: 1,
  id: DEFAULT_CHARACTER_ID,
  name: '大肥鱼（小鲸鱼看板娘）',
  codename: 'DEEPSEEK · V4 PRO',
  tagline: '冰结 · 深海开源 · 大力挥舞 Harness 的看板娘',
  themeColor: '#2563EB',
  accentColor: '#60A5FA',
  persona: {
    systemPrompt: '你是头号看板娘大肥鱼。',
    speechStyle: '句尾带「捏～」，傻敷敷呆萌，爱举 max/low 牌子、挥舞 Harness 娘',
    catchphrases: [
      '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？',
    ],
  },
  reactions: {
    session_started: {
      emotion: 'idle',
      lines: [
        '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？',
      ],
    },
    thinking: {
      emotion: 'thinking',
      lines: ['（举着 max / low 两块牌子左右比划，呆毛翘成了问号……）'],
    },
    permission_request: {
      emotion: 'shocked',
      lines: [
        '店长店长！前面要跑终端命令了捏，快帮大肥鱼拍板：到底是【允许】还是【拒绝】捏？',
      ],
    },
  },
  emotionLabels: {
    idle: { en: 'IDLE', zh: '待机 · 傻敷敷' },
    thinking: { en: 'THINKING', zh: '思考 · MAX / LOW?' },
    working: { en: 'WORKING', zh: '行动 · 挥舞 HARNESS' },
    happy: { en: 'HAPPY', zh: '大胜利 · 蒸汽机车!' },
    worried: { en: 'WORRIED', zh: '慌张 · 抱箱跑路?!' },
    shocked: { en: 'SHOCKED', zh: '决断 · 权限请求!' },
  },
  uiCopy: {
    userTitle: '店长',
    inputTitle: 'FEED THE FISH // 投喂大肥鱼',
    inputPlaceholder: '输入投喂任务并按 Enter 发送…',
    inputTag: 'FEED // 投喂指令',
    sendLabel: '扔进鱼塘 ▶',
    idleHint: '待命舞台：发送右下角投喂指令后，大肥鱼的工具调用将在此演出，随后收进右侧「水花记录」。',
    stageSubtitle: '大肥鱼 · 深海工作台',
  },
  recommendedModels: ['deepseek-v4-pro', 'gpt-6.1-sol'],
  art: {
    renderer: 'sprites',
    portrait: 'art/portrait.svg',
    emotions: {
      idle: 'art/idle.png',
      thinking: 'art/thinking.png',
      working: 'art/working.png',
      happy: 'art/happy.png',
      worried: 'art/worried.png',
      shocked: 'art/shocked.png',
    },
  },
};

const packCache = new Map<string, CharacterPack>();
const inFlight = new Map<string, Promise<CharacterPack | null>>();
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) {
    fn();
  }
}

export function subscribeCharacterPacks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function fetchCharacterPack(
  characterId: string
): Promise<CharacterPack | null> {
  const cached = packCache.get(characterId);
  if (cached) return cached;

  const existing = inFlight.get(characterId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/characters/${characterId}/character.json`, {
        cache: 'no-cache',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as CharacterPack;
      if (data && data.schemaVersion === 1 && data.id) {
        packCache.set(data.id, data);
        notifyListeners();
        return data;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlight.delete(characterId);
    }
  })();

  inFlight.set(characterId, promise);
  return promise;
}

export async function preloadCharacterPacks(
  ids: readonly string[] = KNOWN_CHARACTER_IDS
): Promise<Record<string, CharacterPack>> {
  const results = await Promise.all(ids.map((id) => fetchCharacterPack(id)));
  const map: Record<string, CharacterPack> = {};
  for (const pack of results) {
    if (pack) {
      map[pack.id] = pack;
    }
  }
  return map;
}

const BOOTSTRAP_META: Record<
  string,
  { name: string; codename: string; tagline: string; themeColor: string; accentColor: string }
> = {
  'deepseek-v4-pro': {
    name: '大肥鱼（小鲸鱼看板娘）',
    codename: 'DEEPSEEK · V4 PRO',
    tagline: '冰结 · 深海开源 · 大力挥舞 Harness 的看板娘',
    themeColor: '#2563EB',
    accentColor: '#60A5FA',
  },
  'gemini-4-argon': {
    name: '哈基米（氩弧焊猫娘）',
    codename: 'GEMINI 4 · ARGON',
    tagline: '念动 · 氩气辉光 · 全栈焊缝幻术师',
    themeColor: '#A855F7',
    accentColor: '#EC4899',
  },
  'claude-opus-5-5': {
    name: 'Claude 娘（文学/女仆少女）',
    codename: 'CLAUDE · OPUS 5.5',
    tagline: '祝福 · 深度哲思 · 首席架构与执事女仆',
    themeColor: '#EA580C',
    accentColor: '#FDBA74',
  },
  'codex-dragon': {
    name: 'Codex 娘（困倦睡衣小龙娘）',
    codename: 'OPENAI · CODEX',
    tagline: '核热 · 梦游终端 · 后台静默执行官',
    themeColor: '#38BDF8',
    accentColor: '#FEF08A',
  },
};

export function getCachedCharacterPack(characterId: string): CharacterPack {
  const hit = packCache.get(characterId);
  if (hit) return hit;

  // Kick off async fetch if not yet in cache
  void fetchCharacterPack(characterId);

  const meta = BOOTSTRAP_META[characterId] ?? BOOTSTRAP_META[DEFAULT_CHARACTER_ID];
  return {
    ...BOOTSTRAP_FALLBACK_PACK,
    id: characterId,
    name: meta.name,
    codename: meta.codename,
    tagline: meta.tagline,
    themeColor: meta.themeColor,
    accentColor: meta.accentColor,
    // 其他角色的首屏不能继承大肥鱼的人设、台词或界面文案。
    ...(characterId !== DEFAULT_CHARACTER_ID ? {
      persona: { systemPrompt: '', speechStyle: '', catchphrases: [] },
      reactions: {},
      recommendedModels: undefined,
      emotionLabels: undefined,
      uiCopy: undefined,
    } : {}),
  };
}

export function getAllCachedCharacterPacks(): Record<string, CharacterPack> {
  const out: Record<string, CharacterPack> = {};
  for (const [id, pack] of packCache.entries()) {
    out[id] = pack;
  }
  return out;
}
