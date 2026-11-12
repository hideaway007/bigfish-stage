import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CharacterPack, CharacterSummary, Reaction } from '../../src/shared/character-pack';
import { mergeCharacterWithOverride, type CharacterPersonaOverride } from '../../src/shared/diy-character';
import type { CharacterTouchZone, Emotion, StageEvent, ToolKind } from '../../src/shared/stage-events';

const emotions: Emotion[] = ['idle', 'thinking', 'working', 'happy', 'worried', 'shocked'];
const touchZones: CharacterTouchZone[] = ['head', 'face', 'body', 'prop'];
const CANONICAL_CHARACTER_ORDER = ['deepseek-v4-pro', 'gemini-4-argon', 'claude-opus-5-5', 'codex-dragon'];
const safeAsset = (value: unknown): value is string =>
  typeof value === 'string' && !!value && !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.split('/').includes('..');

function isValidReaction(reaction: unknown): reaction is Reaction {
  const r = reaction as Reaction;
  return Boolean(
    r &&
      emotions.includes(r.emotion) &&
      Array.isArray(r.lines) &&
      r.lines.length > 0 &&
      r.lines.every(v => typeof v === 'string' && !!v.trim())
  );
}

export function validateCharacter(value: unknown, directoryId: string): CharacterPack {
  const c = value as CharacterPack;
  if (
    !c ||
    c.schemaVersion !== 1 ||
    c.id !== directoryId ||
    !/^[\w-]+$/.test(c.id) ||
    ![c.name, c.codename, c.tagline, c.themeColor, c.persona?.systemPrompt, c.persona?.speechStyle].every(v => typeof v === 'string') ||
    !Array.isArray(c.persona?.catchphrases) ||
    !c.persona.catchphrases.every(v => typeof v === 'string') ||
    !c.reactions ||
    typeof c.reactions !== 'object' ||
    Array.isArray(c.reactions)
  ) {
    throw new Error(`角色包格式无效: ${directoryId}`);
  }
  for (const reaction of Object.values(c.reactions)) {
    if (!isValidReaction(reaction)) throw new Error(`角色反应表无效: ${directoryId}`);
  }
  if (c.touchReactions !== undefined) {
    if (!c.touchReactions || typeof c.touchReactions !== 'object' || Array.isArray(c.touchReactions)) {
      throw new Error(`角色触摸反应表无效: ${directoryId}`);
    }
    for (const [zone, reaction] of Object.entries(c.touchReactions)) {
      if (!touchZones.includes(zone as CharacterTouchZone) || !isValidReaction(reaction)) {
        throw new Error(`角色触摸反应项无效: ${directoryId}.${zone}`);
      }
    }
  }
  if (!c.art || (c.art.renderer !== 'sprites' && c.art.renderer !== 'live2d')) throw new Error(`角色立绘格式无效: ${directoryId}`);
  if (c.art.portrait !== undefined && !safeAsset(c.art.portrait)) throw new Error('角色头像路径无效');
  if (c.art.renderer === 'sprites') {
    if (!safeAsset(c.art.emotions?.idle) || !Object.values(c.art.emotions).every(safeAsset)) throw new Error('角色表情路径无效');
  } else if (!safeAsset(c.art.model3) || !c.art.expressions || !c.art.motions) {
    throw new Error('Live2D 角色格式无效');
  }
  return c;
}

export class CharacterCatalog {
  private packs = new Map<string, CharacterPack>();
  private overrides: Record<string, CharacterPersonaOverride> = {};
  readonly warnings: string[] = [];
  constructor(readonly root: string, readonly extraRoot?: string) {}
  setOverrides(overrides: Record<string, CharacterPersonaOverride>) {
    this.overrides = structuredClone(overrides);
  }
  getOverride(id: string): CharacterPersonaOverride | undefined {
    const found = this.overrides[id];
    return found ? structuredClone(found) : undefined;
  }
  private async loadDirectory(dirRoot: string) {
    let directories;
    try {
      directories = await readdir(dirRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      try {
        const pack = validateCharacter(
          JSON.parse(await readFile(join(dirRoot, directory.name, 'character.json'), 'utf8')),
          directory.name
        );
        this.packs.set(pack.id, pack);
      } catch {
        this.warnings.push(`跳过缺失或无效的角色包: ${directory.name}`);
      }
    }
  }
  async load() {
    this.packs.clear();
    this.warnings.length = 0;
    await this.loadDirectory(this.root);
    if (this.extraRoot) {
      await this.loadDirectory(this.extraRoot);
    }
  }
  get(id: string) {
    const base = this.packs.get(id);
    if (!base) return undefined;
    return mergeCharacterWithOverride(base, this.overrides[id]);
  }
  all(): CharacterPack[] {
    return [...this.packs.values()].map(p => mergeCharacterWithOverride(p, this.overrides[p.id]));
  }
  summaries(): CharacterSummary[] {
    return this.all()
      .sort((a, b) => {
        const ia = CANONICAL_CHARACTER_ORDER.indexOf(a.id);
        const ib = CANONICAL_CHARACTER_ORDER.indexOf(b.id);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.id.localeCompare(b.id);
      })
      .map(c => {
        const portrait = c.art.portrait ?? (c.art.renderer === 'sprites' ? c.art.emotions.idle : undefined);
        return {
          id: c.id,
          name: c.name,
          codename: c.codename,
          themeColor: c.themeColor,
          renderer: c.art.renderer,
          portraitUrl: portrait ? `/characters/${encodeURIComponent(c.id)}/${portrait.split('/').map(encodeURIComponent).join('/')}` : null,
        };
      });
  }
}

export function reactionKey(event: StageEvent, tool?: ToolKind): string {
  if ((event.type === 'tool_end' || event.type === 'turn_done') && !event.ok) return `${event.type}:fail`;
  if (event.type === 'tool_start') return `tool_start:${event.tool}`;
  if (event.type === 'tool_end' && tool) return `tool_end:${tool}`;
  return event.type;
}

export function findReaction(pack: CharacterPack, event: StageEvent, tool?: ToolKind): Reaction | undefined {
  const keys = [reactionKey(event, tool)];
  if (event.type === 'tool_end' && tool) keys.push(`tool_end:${tool}`);
  keys.push(event.type);
  for (const key of keys) {
    const reaction = pack.reactions[key as keyof typeof pack.reactions];
    if (reaction) return reaction;
  }
}

const DEFAULT_TOUCH_FALLBACKS: Record<CharacterTouchZone, Reaction> = {
  head: { emotion: 'happy', lines: ['呜哇，别乱摸头顶啦！发型都要乱了～'] },
  face: { emotion: 'shocked', lines: ['诶？！突然戳脸干嘛，在认真看代码呢！'] },
  prop: { emotion: 'working', lines: ['这可是吃饭的家伙，小心轻放哦！'] },
  body: { emotion: 'idle', lines: ['收到信号啦，随时准备开工！'] },
};

export function findTouchReaction(pack: CharacterPack | undefined, zone: CharacterTouchZone): Reaction {
  if (pack?.touchReactions?.[zone]) return pack.touchReactions[zone]!;
  const keyed = pack?.reactions[`touch:${zone}`];
  if (keyed) return keyed;
  return DEFAULT_TOUCH_FALLBACKS[zone] ?? DEFAULT_TOUCH_FALLBACKS.head;
}
