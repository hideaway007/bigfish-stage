import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CharacterPack } from '../../src/shared/character-pack';
import type { Emotion } from '../../src/shared/stage-events';
import {
  buildDefaultDiyReactions,
  isCustomCharacterId,
  MAX_DIY_IMAGE_BYTES,
  MAX_PERSONA_CHARS,
  type CharacterPersonaOverride,
  type DiyCharacterSaveInput,
  type DiySnapshotPayload,
} from '../../src/shared/diy-character';
import { validateCharacter } from './characters';

export const defaultDiyDir = () => join(homedir(), '.config/bigfish-stage/diy');

const ALLOWED_IMAGE_MIMES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const OPTIONAL_EMOTIONS: Array<Exclude<Emotion, 'idle'>> = [
  'thinking',
  'working',
  'happy',
  'worried',
  'shocked',
];

function decodeImageDataUrl(dataUrl: string, label: string): { bytes: Buffer; ext: string } {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error(`${label}图片格式不受支持（请上传 PNG / JPG / WebP / GIF）`);
  }
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_IMAGE_MIMES[mime];
  if (!ext) {
    throw new Error(`${label}图片格式不受支持：${mime}（仅支持 PNG / JPG / WebP / GIF）`);
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (bytes.byteLength === 0) {
    throw new Error(`${label}图片内容为空`);
  }
  if (bytes.byteLength > MAX_DIY_IMAGE_BYTES) {
    throw new Error(`${label}图片超过 5MB 上限，请压缩后再试`);
  }
  return { bytes, ext };
}

function sanitizeColor(color: string | undefined, fallback: string): string {
  const clean = (color ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
}

function makeCustomCharacterId(rawName: string): string {
  const ascii = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = randomUUID().slice(0, 8);
  return ascii ? `custom-${ascii}-${suffix}` : `custom-char-${suffix}`;
}

async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
  await rename(tmp, filePath);
  await chmod(filePath, 0o600);
}

export function cleanPersonaOverride(raw: unknown): CharacterPersonaOverride {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('性格设定数据格式无效');
  }
  const obj = raw as Record<string, unknown>;
  const rolePrompt = typeof obj.rolePrompt === 'string' ? obj.rolePrompt.trim() : '';
  if (rolePrompt.length > MAX_PERSONA_CHARS) {
    throw new Error(`性格定位内容过长（当前 ${rolePrompt.length} 字，上限 ${MAX_PERSONA_CHARS} 字）`);
  }
  const sourceFileName =
    typeof obj.sourceFileName === 'string' && obj.sourceFileName.trim()
      ? obj.sourceFileName.trim().slice(0, 120)
      : undefined;
  const selfTitle =
    typeof obj.selfTitle === 'string' && obj.selfTitle.trim()
      ? obj.selfTitle.trim().slice(0, 24)
      : undefined;
  const userTitle =
    typeof obj.userTitle === 'string' && obj.userTitle.trim()
      ? obj.userTitle.trim().slice(0, 24)
      : undefined;
  const tagline =
    typeof obj.tagline === 'string' && obj.tagline.trim()
      ? obj.tagline.trim().slice(0, 80)
      : undefined;

  if (!rolePrompt && !selfTitle && !userTitle && !tagline) {
    throw new Error('请至少填写性格与职责定位内容、称呼或简介标语之一');
  }

  return {
    rolePrompt,
    ...(sourceFileName ? { sourceFileName } : {}),
    ...(selfTitle ? { selfTitle } : {}),
    ...(userTitle ? { userTitle } : {}),
    ...(tagline ? { tagline } : {}),
    updatedAt: typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now(),
  };
}

export class DiyStore {
  readonly overridesPath: string;
  readonly charactersDir: string;
  private overrides: Record<string, CharacterPersonaOverride> = {};
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly rootDir = defaultDiyDir()) {
    this.overridesPath = join(this.rootDir, 'overrides.json');
    this.charactersDir = join(this.rootDir, 'characters');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.overridesPath, 'utf8'));
      const next: Record<string, CharacterPersonaOverride> = {};
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [charId, item] of Object.entries(raw)) {
          if (!/^[\w-]+$/.test(charId)) continue;
          try {
            next[charId] = cleanPersonaOverride(item);
          } catch {
            // ignore corrupted entry
          }
        }
      }
      this.overrides = next;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.overrides = {};
      }
    }
  }

  getOverrides(): Record<string, CharacterPersonaOverride> {
    return structuredClone(this.overrides);
  }

  async listCustomPacks(): Promise<CharacterPack[]> {
    let entries;
    try {
      entries = await readdir(this.charactersDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const packs: CharacterPack[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isCustomCharacterId(entry.name)) continue;
      try {
        const jsonPath = join(this.charactersDir, entry.name, 'character.json');
        const parsed = JSON.parse(await readFile(jsonPath, 'utf8'));
        packs.push(validateCharacter(parsed, entry.name));
      } catch {
        // skip invalid custom pack
      }
    }
    packs.sort((a, b) => a.id.localeCompare(b.id));
    return packs;
  }

  async snapshot(): Promise<DiySnapshotPayload> {
    const customPacks = await this.listCustomPacks();
    return {
      ok: true,
      overrides: this.getOverrides(),
      customPacks,
    };
  }

  async saveOverride(
    characterId: string,
    override: CharacterPersonaOverride | null
  ): Promise<Record<string, CharacterPersonaOverride>> {
    if (!characterId || !/^[\w-]+$/.test(characterId)) {
      throw new Error('角色 ID 无效');
    }
    const task = async () => {
      if (override === null) {
        delete this.overrides[characterId];
      } else {
        this.overrides[characterId] = cleanPersonaOverride(override);
      }
      await atomicWriteFile(this.overridesPath, JSON.stringify(this.overrides, null, 2) + '\n');
    };
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.catch(() => {});
    await run;
    return this.getOverrides();
  }

  async saveCustomCharacter(input: DiyCharacterSaveInput): Promise<CharacterPack> {
    if (!input || typeof input !== 'object') {
      throw new Error('角色配置参数无效');
    }
    const name = (input.name ?? '').trim().slice(0, 48);
    if (!name) {
      throw new Error('请填写角色名称');
    }
    const rolePrompt = (input.rolePrompt ?? '').trim();
    if (!rolePrompt) {
      throw new Error('请导入或填写角色的性格与职责定位内容');
    }
    if (rolePrompt.length > MAX_PERSONA_CHARS) {
      throw new Error(`性格定位内容过长（当前 ${rolePrompt.length} 字，上限 ${MAX_PERSONA_CHARS} 字）`);
    }

    let id: string;
    let existingPack: CharacterPack | null = null;
    if (input.id) {
      if (!isCustomCharacterId(input.id)) {
        throw new Error('自建角色 ID 格式无效');
      }
      id = input.id;
      try {
        const raw = JSON.parse(await readFile(join(this.charactersDir, id, 'character.json'), 'utf8'));
        existingPack = validateCharacter(raw, id);
      } catch {
        existingPack = null;
      }
    } else {
      id = makeCustomCharacterId(name);
    }

    const charDir = resolve(join(this.charactersDir, id));
    const safeRoot = resolve(this.charactersDir);
    if (!charDir.startsWith(safeRoot + sep)) {
      throw new Error('非法的角色目录路径');
    }
    const artDir = join(charDir, 'art');
    await mkdir(artDir, { recursive: true, mode: 0o700 });

    const prevSprites =
      existingPack?.art.renderer === 'sprites' ? existingPack.art : undefined;

    let idleRel = prevSprites?.emotions.idle ?? '';
    if (input.idleDataUrl?.trim()) {
      const { bytes, ext } = decodeImageDataUrl(input.idleDataUrl, '主立绘 ');
      idleRel = `art/idle${ext}`;
      await atomicWriteFile(join(charDir, idleRel), bytes);
    }
    if (!idleRel) {
      throw new Error('新建 DIY 角色请至少上传一张主立绘（待机形象）');
    }

    let portraitRel = prevSprites?.portrait ?? idleRel;
    if (input.portraitDataUrl?.trim()) {
      const { bytes, ext } = decodeImageDataUrl(input.portraitDataUrl, '角色头像 ');
      portraitRel = `art/portrait${ext}`;
      await atomicWriteFile(join(charDir, portraitRel), bytes);
    } else if (!prevSprites?.portrait) {
      portraitRel = idleRel;
    }

    const emotionsMap: Partial<Record<Emotion, string>> & { idle: string } = {
      ...(prevSprites?.emotions ?? {}),
      idle: idleRel,
    };

    if (input.emotionsDataUrls && typeof input.emotionsDataUrls === 'object') {
      for (const emo of OPTIONAL_EMOTIONS) {
        const rawUrl = input.emotionsDataUrls[emo];
        if (typeof rawUrl === 'string' && rawUrl.trim()) {
          const { bytes, ext } = decodeImageDataUrl(rawUrl, `${emo} 表情立绘 `);
          const rel = `art/${emo}${ext}`;
          await atomicWriteFile(join(charDir, rel), bytes);
          emotionsMap[emo] = rel;
        }
      }
    }

    const shortName = name.split('（')[0].trim() || name;
    const selfTitle = (input.selfTitle ?? '').trim().slice(0, 24) || '我';
    const userTitle = (input.userTitle ?? '').trim().slice(0, 24) || '店长';
    const codename =
      (input.codename ?? '').trim().slice(0, 36) ||
      `DIY · ${shortName.toUpperCase()}`;
    const tagline =
      (input.tagline ?? '').trim().slice(0, 80) ||
      `${shortName} · 玩家自定义专属搭档`;
    const themeColor = sanitizeColor(input.themeColor, '#E60012');
    const accentColor = sanitizeColor(input.accentColor, '#FACC15');

    const cleanCatchphrases = (input.catchphrases ?? [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 6);
    if (cleanCatchphrases.length === 0) {
      cleanCatchphrases.push(`${userTitle}，${shortName}随时待命！`);
    }

    const pack: CharacterPack = {
      schemaVersion: 1,
      id,
      name,
      codename,
      tagline,
      themeColor,
      accentColor,
      persona: {
        systemPrompt: [
          `你是「${shortName}」，自称「${selfTitle}」，称呼用户为「${userTitle}」。`,
          rolePrompt,
          '每次舞台短台词只说一行简体中文，最多40字；依据真实进度说话，不编造完成结果。',
        ].join('\n'),
        speechStyle: rolePrompt.replace(/\s+/g, ' ').slice(0, 140),
        catchphrases: cleanCatchphrases,
      },
      reactions:
        existingPack?.reactions && Object.keys(existingPack.reactions).length > 0
          ? existingPack.reactions
          : buildDefaultDiyReactions(shortName, userTitle, cleanCatchphrases),
      uiCopy: {
        userTitle,
        inputTitle: `TASK // 呼叫${shortName}`,
        inputPlaceholder: `向${shortName}下达任务指令并按 Enter 发送…`,
        inputTag: 'TASK // 当前指令',
        sendLabel: '出击 ▶',
        idleHint: `待命舞台：发送指令后，${shortName}的工具调用将在此实时演出。`,
        stageSubtitle: `${shortName} · 专属工作台`,
      },
      art: {
        renderer: 'sprites',
        portrait: portraitRel,
        emotions: emotionsMap,
      },
    };

    const validated = validateCharacter(pack, id);
    await atomicWriteFile(join(charDir, 'character.json'), JSON.stringify(validated, null, 2) + '\n');

    // 同步记录该自建角色的详细 DIY 性格元信息（自称/玩家称呼/源文件名）
    await this.saveOverride(id, {
      sourceFileName: input.sourceFileName,
      rolePrompt,
      selfTitle,
      userTitle,
      tagline,
      updatedAt: Date.now(),
    });

    return validated;
  }

  async deleteCustomCharacter(characterId: string): Promise<void> {
    if (!isCustomCharacterId(characterId)) {
      throw new Error('仅允许删除自建角色（custom-*）');
    }
    const targetDir = resolve(join(this.charactersDir, characterId));
    const safeRoot = resolve(this.charactersDir);
    if (!targetDir.startsWith(safeRoot + sep)) {
      throw new Error('角色目录路径无效');
    }
    await rm(targetDir, { recursive: true, force: true });
    await this.saveOverride(characterId, null);
  }

  /**
   * 安全解析自建角色静态资源文件路径（供 /characters/<id>/... 回退使用）
   */
  async resolveCustomAssetFile(relUrlPath: string): Promise<{ target: string; size: number; ext: string } | null> {
    if (!relUrlPath || relUrlPath.includes('\0') || relUrlPath.includes('\\')) return null;
    const cleanRel = relUrlPath.replace(/^\/+/, '');
    const firstSlash = cleanRel.indexOf('/');
    if (firstSlash <= 0) return null;
    const charId = cleanRel.slice(0, firstSlash);
    if (!isCustomCharacterId(charId)) return null;

    const safeRoot = resolve(this.charactersDir);
    const targetPath = resolve(join(safeRoot, cleanRel));
    if (!targetPath.startsWith(safeRoot + sep)) return null;
    try {
      const info = await stat(targetPath);
      if (!info.isFile()) return null;
      return { target: targetPath, size: info.size, ext: extname(targetPath).toLowerCase() };
    } catch {
      return null;
    }
  }
}

export interface DiyHttpResult {
  status: number;
  body: Record<string, unknown>;
  mutated?: boolean;
  deletedCharacterId?: string;
}

/**
 * 统一处理 /api/diy* 请求（同时复用于 DSH WebServer Resource 与 server/src/index.ts）
 */
export async function handleDiyApiAction(
  store: DiyStore,
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  rawBody?: string
): Promise<DiyHttpResult> {
  const cleanPath = pathname.replace(/\/+$/, '') || '/api/diy';
  const upper = method.toUpperCase();

  try {
    if (upper === 'GET' && cleanPath === '/api/diy') {
      const snap = await store.snapshot();
      return { status: 200, body: snap as unknown as Record<string, unknown> };
    }

    if (upper === 'POST' && cleanPath === '/api/diy/override') {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const characterId = typeof parsed?.characterId === 'string' ? parsed.characterId.trim() : '';
      const overrideVal = parsed?.override === null ? null : parsed?.override;
      await store.saveOverride(characterId, overrideVal);
      const snap = await store.snapshot();
      return {
        status: 200,
        body: snap as unknown as Record<string, unknown>,
        mutated: true,
      };
    }

    if (upper === 'POST' && cleanPath === '/api/diy/character') {
      const parsed = (rawBody ? JSON.parse(rawBody) : {}) as DiyCharacterSaveInput;
      const savedPack = await store.saveCustomCharacter(parsed);
      const snap = await store.snapshot();
      return {
        status: 200,
        body: { ...snap, savedPack },
        mutated: true,
      };
    }

    if (
      (upper === 'DELETE' && cleanPath === '/api/diy/character') ||
      (upper === 'POST' && cleanPath === '/api/diy/character/delete')
    ) {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const targetId =
        (typeof parsed?.id === 'string' && parsed.id.trim()) ||
        (searchParams.get('id') ?? '').trim();
      await store.deleteCustomCharacter(targetId);
      const snap = await store.snapshot();
      return {
        status: 200,
        body: snap as unknown as Record<string, unknown>,
        mutated: true,
        deletedCharacterId: targetId,
      };
    }

    return { status: 404, body: { ok: false, error: '未知的 DIY 接口路径' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : '处理 DIY 配置失败';
    return { status: 400, body: { ok: false, error: message } };
  }
}
