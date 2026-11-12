/**
 * 前端 DIY 角色与性格定位客户端
 * - 优先走同源 /api/diy 落盘到本机 ~/.config/bigfish-stage/diy/
 * - 当处于纯前端离线演示模式（/?demo=1 或无本地服务）时自动降级到 localStorage
 */
import type { CharacterPack } from '../shared/character-pack';
import type { Emotion } from '../shared/stage-events';
import {
  buildDefaultDiyReactions,
  isCustomCharacterId,
  MAX_DIY_IMAGE_BYTES,
  MAX_PERSONA_CHARS,
  type CharacterPersonaOverride,
  type DiyCharacterSaveInput,
  type DiySnapshotPayload,
} from '../shared/diy-character';

const LS_OVERRIDES_KEY = 'bigfish.diy.overrides.v1';
const LS_CUSTOM_PACKS_KEY = 'bigfish.diy.customPacks.v1';

function readLocalOverrides(): Record<string, CharacterPersonaOverride> {
  try {
    const raw = window.localStorage.getItem(LS_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalOverrides(overrides: Record<string, CharacterPersonaOverride>): void {
  try {
    window.localStorage.setItem(LS_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    throw new Error('浏览器本地存储空间不足，无法保存（建议在桌面端或本地服务模式下使用大图）');
  }
}

function readLocalCustomPacks(): CharacterPack[] {
  try {
    const raw = window.localStorage.getItem(LS_CUSTOM_PACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCustomPacks(packs: CharacterPack[]): void {
  try {
    window.localStorage.setItem(LS_CUSTOM_PACKS_KEY, JSON.stringify(packs));
  } catch {
    throw new Error('浏览器本地存储空间已满，请压缩立绘图片或在桌面端/本地服务模式运行');
  }
}

function isDemoOnlyUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const demo = params.get('demo');
  return demo === '1' || demo === 'true';
}

function validateDataUrlSize(dataUrl: string, label: string): void {
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error(`${label}图片格式不受支持，请选择 PNG / JPG / WebP / GIF`);
  }
  const approxBytes = Math.floor((dataUrl.length * 3) / 4);
  if (approxBytes > MAX_DIY_IMAGE_BYTES) {
    throw new Error(`${label}超过 5MB 上限，请换用更小体积的图片`);
  }
}

function buildLocalCustomPack(
  input: DiyCharacterSaveInput,
  existing?: CharacterPack
): CharacterPack {
  const name = (input.name ?? '').trim().slice(0, 48);
  if (!name) throw new Error('请填写角色名称');
  const rolePrompt = (input.rolePrompt ?? '').trim();
  if (!rolePrompt) throw new Error('请填写或导入角色的性格与职责定位内容');
  if (rolePrompt.length > MAX_PERSONA_CHARS) {
    throw new Error(`性格定位内容超过 ${MAX_PERSONA_CHARS} 字上限`);
  }

  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  const rand = Math.random().toString(36).slice(2, 10);
  const id =
    input.id && isCustomCharacterId(input.id)
      ? input.id
      : ascii
      ? `custom-${ascii}-${rand}`
      : `custom-char-${rand}`;

  const prevSprites = existing?.art.renderer === 'sprites' ? existing.art : undefined;
  let idleUrl = prevSprites?.emotions.idle ?? '';
  if (input.idleDataUrl?.trim()) {
    validateDataUrlSize(input.idleDataUrl.trim(), '主立绘');
    idleUrl = input.idleDataUrl.trim();
  }
  if (!idleUrl) {
    throw new Error('新建 DIY 角色请至少上传一张主立绘图片');
  }

  let portraitUrl = prevSprites?.portrait ?? idleUrl;
  if (input.portraitDataUrl?.trim()) {
    validateDataUrlSize(input.portraitDataUrl.trim(), '头像');
    portraitUrl = input.portraitDataUrl.trim();
  }

  const emotions: Partial<Record<Emotion, string>> & { idle: string } = {
    ...(prevSprites?.emotions ?? {}),
    idle: idleUrl,
  };
  if (input.emotionsDataUrls) {
    for (const [emo, url] of Object.entries(input.emotionsDataUrls)) {
      if (url && url.trim()) {
        validateDataUrlSize(url.trim(), `${emo} 立绘`);
        emotions[emo as Emotion] = url.trim();
      }
    }
  }

  const shortName = name.split('（')[0].trim() || name;
  const selfTitle = (input.selfTitle ?? '').trim().slice(0, 24) || '我';
  const userTitle = (input.userTitle ?? '').trim().slice(0, 24) || '店长';
  const codename = (input.codename ?? '').trim().slice(0, 36) || `DIY · ${shortName.toUpperCase()}`;
  const tagline = (input.tagline ?? '').trim().slice(0, 80) || `${shortName} · 玩家自定义专属搭档`;
  const themeColor = /^#[0-9a-fA-F]{6}$/.test((input.themeColor ?? '').trim())
    ? input.themeColor!.trim()
    : '#E60012';
  const cleanCatch = (input.catchphrases ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (cleanCatch.length === 0) cleanCatch.push(`${userTitle}，${shortName}随时待命！`);

  return {
    schemaVersion: 1,
    id,
    name,
    codename,
    tagline,
    themeColor,
    accentColor: '#FACC15',
    persona: {
      systemPrompt: [
        `你是「${shortName}」，自称「${selfTitle}」，称呼用户为「${userTitle}」。`,
        rolePrompt,
        '每次舞台短台词只说一行简体中文，最多40字；依据真实进度说话，不编造完成结果。',
      ].join('\n'),
      speechStyle: rolePrompt.replace(/\s+/g, ' ').slice(0, 140),
      catchphrases: cleanCatch,
    },
    reactions:
      existing?.reactions && Object.keys(existing.reactions).length > 0
        ? existing.reactions
        : buildDefaultDiyReactions(shortName, userTitle, cleanCatch),
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
      portrait: portraitUrl,
      emotions,
    },
  };
}

export async function fetchDiySnapshotClient(): Promise<DiySnapshotPayload> {
  if (!isDemoOnlyUrl()) {
    try {
      const res = await fetch('/api/diy', { cache: 'no-cache' });
      if (res.ok) {
        const data = (await res.json()) as DiySnapshotPayload;
        if (data && data.ok) return data;
      }
    } catch {
      // Fallback to localStorage below
    }
  }
  return {
    ok: true,
    overrides: readLocalOverrides(),
    customPacks: readLocalCustomPacks(),
  };
}

export async function saveDiyOverrideClient(
  characterId: string,
  override: Omit<CharacterPersonaOverride, 'updatedAt'> | null
): Promise<DiySnapshotPayload> {
  const fullOverride: CharacterPersonaOverride | null = override
    ? {
        ...override,
        rolePrompt: override.rolePrompt.trim(),
        updatedAt: Date.now(),
      }
    : null;

  if (fullOverride && fullOverride.rolePrompt.length > MAX_PERSONA_CHARS) {
    throw new Error(
      `性格定位内容过长（当前 ${fullOverride.rolePrompt.length} 字，上限 ${MAX_PERSONA_CHARS} 字）`
    );
  }

  if (!isDemoOnlyUrl()) {
    try {
      const res = await fetch('/api/diy/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, override: fullOverride }),
      });
      if (res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok || data.ok === false) {
          throw new Error(typeof data.error === 'string' ? data.error : '保存性格设定失败');
        }
        return data as unknown as DiySnapshotPayload;
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
    }
  }

  const overrides = readLocalOverrides();
  if (fullOverride === null) {
    delete overrides[characterId];
  } else {
    overrides[characterId] = fullOverride;
  }
  writeLocalOverrides(overrides);
  return {
    ok: true,
    overrides,
    customPacks: readLocalCustomPacks(),
  };
}

export async function saveDiyCustomCharacterClient(
  input: DiyCharacterSaveInput
): Promise<DiySnapshotPayload & { savedPack: CharacterPack }> {
  if (!isDemoOnlyUrl()) {
    try {
      const res = await fetch('/api/diy/character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok || data.ok === false) {
          throw new Error(typeof data.error === 'string' ? data.error : '保存 DIY 角色失败');
        }
        return data as unknown as DiySnapshotPayload & { savedPack: CharacterPack };
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
    }
  }

  const customPacks = readLocalCustomPacks();
  const existing = input.id ? customPacks.find((p) => p.id === input.id) : undefined;
  const savedPack = buildLocalCustomPack(input, existing);
  const nextPacks = customPacks.filter((p) => p.id !== savedPack.id);
  nextPacks.push(savedPack);
  writeLocalCustomPacks(nextPacks);

  const overrides = readLocalOverrides();
  overrides[savedPack.id] = {
    sourceFileName: input.sourceFileName,
    rolePrompt: input.rolePrompt.trim(),
    selfTitle: input.selfTitle?.trim() || '我',
    userTitle: input.userTitle?.trim() || '店长',
    tagline: savedPack.tagline,
    updatedAt: Date.now(),
  };
  writeLocalOverrides(overrides);

  return {
    ok: true,
    overrides,
    customPacks: nextPacks,
    savedPack,
  };
}

export async function deleteDiyCustomCharacterClient(
  characterId: string
): Promise<DiySnapshotPayload> {
  if (!isCustomCharacterId(characterId)) {
    throw new Error('仅允许删除玩家自建角色');
  }

  if (!isDemoOnlyUrl()) {
    try {
      const res = await fetch('/api/diy/character/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: characterId }),
      });
      if (res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok || data.ok === false) {
          throw new Error(typeof data.error === 'string' ? data.error : '删除自建角色失败');
        }
        return data as unknown as DiySnapshotPayload;
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
    }
  }

  const nextPacks = readLocalCustomPacks().filter((p) => p.id !== characterId);
  writeLocalCustomPacks(nextPacks);
  const overrides = readLocalOverrides();
  delete overrides[characterId];
  writeLocalOverrides(overrides);

  return {
    ok: true,
    overrides,
    customPacks: nextPacks,
  };
}
