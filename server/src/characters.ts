import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CharacterPack, CharacterSummary, Reaction } from '../../src/shared/character-pack';
import type { Emotion, StageEvent, ToolKind } from '../../src/shared/stage-events';

const emotions: Emotion[] = ['idle', 'thinking', 'working', 'happy', 'worried', 'shocked'];
const safeAsset = (value: unknown): value is string => typeof value === 'string' && !!value && !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.split('/').includes('..');
export function validateCharacter(value: unknown, directoryId: string): CharacterPack {
  const c = value as CharacterPack;
  if (!c || c.schemaVersion !== 1 || c.id !== directoryId || !/^[\w-]+$/.test(c.id)
    || ![c.name, c.codename, c.tagline, c.themeColor, c.persona?.systemPrompt, c.persona?.speechStyle].every(v => typeof v === 'string')
    || !Array.isArray(c.persona?.catchphrases) || !c.persona.catchphrases.every(v => typeof v === 'string')
    || !c.reactions || typeof c.reactions !== 'object' || Array.isArray(c.reactions)) throw new Error(`角色包格式无效: ${directoryId}`);
  for (const reaction of Object.values(c.reactions)) {
    if (!reaction || !emotions.includes(reaction.emotion) || !Array.isArray(reaction.lines) || !reaction.lines.length || !reaction.lines.every(v => typeof v === 'string' && !!v.trim())) throw new Error(`角色反应表无效: ${directoryId}`);
  }
  if (!c.art || (c.art.renderer !== 'sprites' && c.art.renderer !== 'live2d')) throw new Error(`角色立绘格式无效: ${directoryId}`);
  if (c.art.portrait !== undefined && !safeAsset(c.art.portrait)) throw new Error('角色头像路径无效');
  if (c.art.renderer === 'sprites') {
    if (!safeAsset(c.art.emotions?.idle) || !Object.values(c.art.emotions).every(safeAsset)) throw new Error('角色表情路径无效');
  } else if (!safeAsset(c.art.model3) || !c.art.expressions || !c.art.motions) throw new Error('Live2D 角色格式无效');
  return c;
}
export class CharacterCatalog {
  private packs = new Map<string, CharacterPack>();
  readonly warnings: string[] = [];
  constructor(readonly root: string) {}
  async load() {
    this.packs.clear(); this.warnings.length = 0;
    let directories;
    try { directories = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      try {
        const pack = validateCharacter(JSON.parse(await readFile(join(this.root, directory.name, 'character.json'), 'utf8')), directory.name);
        this.packs.set(pack.id, pack);
      } catch { this.warnings.push(`跳过缺失或无效的角色包: ${directory.name}`); }
    }
  }
  get(id: string) { return this.packs.get(id); }
  summaries(): CharacterSummary[] {
    return [...this.packs.values()].map(c => {
      const portrait = c.art.portrait ?? (c.art.renderer === 'sprites' ? c.art.emotions.idle : undefined);
      return { id: c.id, name: c.name, codename: c.codename, themeColor: c.themeColor, renderer: c.art.renderer,
        portraitUrl: portrait ? `/characters/${encodeURIComponent(c.id)}/${portrait.split('/').map(encodeURIComponent).join('/')}` : null };
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
  // Failure is more specific than tool kind, then the generic event.
  const keys = [reactionKey(event, tool)];
  if (event.type === 'tool_end' && tool) keys.push(`tool_end:${tool}`);
  keys.push(event.type);
  for (const key of keys) { const reaction = pack.reactions[key as keyof typeof pack.reactions]; if (reaction) return reaction; }
}
