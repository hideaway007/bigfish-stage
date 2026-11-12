// packages/dsh-client-ui-p5stage/src/index.ts
import { existsSync } from "node:fs";
import { readFile as readFile2, stat as stat2 } from "node:fs/promises";
import { extname as extname2, join as join2, resolve as resolve2, sep as sep2 } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/diy-store.ts
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

// src/shared/diy-character.ts
var MAX_PERSONA_CHARS = 8e3;
var MAX_DIY_IMAGE_BYTES = 5 * 1024 * 1024;
function isCustomCharacterId(id) {
  return /^custom-[a-z0-9][a-z0-9-]{0,62}$/.test(id);
}
function buildDefaultDiyReactions(shortName, userTitle, catchphrases) {
  const greet = catchphrases[0]?.trim() || `${userTitle}\uFF0C${shortName}\u5DF2\u5C31\u4F4D\uFF01\u4ECA\u5929\u6211\u4EEC\u8981\u63A8\u8FDB\u54EA\u4E00\u9879\u4EFB\u52A1\uFF1F`;
  return {
    session_started: {
      emotion: "idle",
      lines: [
        greet,
        `${shortName}\u51C6\u5907\u5B8C\u6BD5\uFF0C${userTitle}\u968F\u65F6\u4E0B\u8FBE\u6307\u4EE4\u5427\uFF01`
      ]
    },
    user_message: {
      emotion: "thinking",
      lines: [
        `\u6536\u5230\uFF0C${userTitle}\uFF01\u8BA9\u6211\u5148\u7406\u6E05\u4EFB\u52A1\u8109\u7EDC\u3002`,
        `\u660E\u767D\uFF01${shortName}\u9A6C\u4E0A\u5F00\u59CB\u5206\u6790\u9700\u6C42\u3002`
      ]
    },
    thinking: {
      emotion: "thinking",
      lines: [
        "\u6B63\u5728\u63A8\u6F14\u65B9\u6848\u7EC6\u8282\u4E0E\u4E0A\u4E0B\u6587\uFF0C\u8BF7\u7A0D\u5019\u2026\u2026",
        `\u8BA9\u6211\u4ED4\u7EC6\u6838\u5BF9\u4E00\u4E0B\u5173\u952E\u903B\u8F91\uFF0C\u9A6C\u4E0A\u7ED9${userTitle}\u7B54\u590D\u3002`
      ]
    },
    tool_start: {
      emotion: "working",
      lines: [
        `\u5F00\u59CB\u6267\u884C {tool}\uFF1A{summary}`,
        `${shortName}\u884C\u52A8\u4E2D\u2014\u2014\u6B63\u5728\u5904\u7406 {file}\uFF01`
      ]
    },
    tool_end: {
      emotion: "working",
      lines: [
        "\u8FD9\u4E00\u6B65\u64CD\u4F5C\u5DF2\u5B8C\u6210\uFF0C\u6B63\u5728\u68C0\u67E5\u8FD4\u56DE\u7ED3\u679C\u3002",
        "{summary} \u5904\u7406\u5B8C\u6BD5\uFF0C\u7EE7\u7EED\u63A8\u8FDB\u4E0B\u4E00\u6B65\u3002"
      ]
    },
    "tool_end:fail": {
      emotion: "worried",
      lines: [
        "\u54A6\uFF0C\u8FD9\u4E00\u6B65\u8FD4\u56DE\u4E86\u5F02\u5E38\uFF1A{summary}\uFF0C\u8BA9\u6211\u6392\u67E5\u4E00\u4E0B\u539F\u56E0\u3002",
        "\u9047\u5230\u4E00\u70B9\u62A5\u9519\u963B\u788D\uFF0C\u522B\u62C5\u5FC3\uFF0C\u6211\u9A6C\u4E0A\u5B9A\u4F4D\u95EE\u9898\u3002"
      ]
    },
    permission_request: {
      emotion: "shocked",
      lines: [
        `${userTitle}\uFF0C\u63A5\u4E0B\u6765\u9700\u8981\u6267\u884C\u53D7\u63A7\u64CD\u4F5C\uFF08{summary}\uFF09\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u653E\u884C\uFF1F`
      ]
    },
    permission_resolved: {
      emotion: "idle",
      lines: [`\u6536\u5230${userTitle}\u7684\u51B3\u5B9A\uFF0C\u6309\u6307\u793A\u7EE7\u7EED\u3002`]
    },
    turn_done: {
      emotion: "happy",
      lines: [
        `\u672C\u8F6E\u5904\u7406\u544A\u4E00\u6BB5\u843D\u5566\uFF0C\u8BF7${userTitle}\u9A8C\u6536\u7ED3\u679C\uFF01`,
        ...catchphrases[1] ? [catchphrases[1]] : []
      ]
    },
    "turn_done:fail": {
      emotion: "worried",
      lines: [`\u672C\u8F6E\u4EFB\u52A1\u672A\u80FD\u987A\u5229\u8D70\u5B8C\uFF0C${userTitle}\u770B\u770B\u4E0A\u9762\u7684\u62A5\u9519\u4FE1\u606F\uFF0C\u6211\u4EEC\u4E00\u8D77\u8C03\u6574\u4E0B\uFF1F`]
    },
    error: {
      emotion: "worried",
      lines: ["\u6267\u884C\u8FC7\u7A0B\u4E2D\u51FA\u73B0\u5F02\u5E38\uFF1A{summary}"]
    }
  };
}

// server/src/characters.ts
var emotions = ["idle", "thinking", "working", "happy", "worried", "shocked"];
var touchZones = ["head", "face", "body", "prop"];
var safeAsset = (value) => typeof value === "string" && !!value && !value.startsWith("/") && !value.includes("\\") && !value.includes(":") && !value.split("/").includes("..");
function isValidReaction(reaction) {
  const r = reaction;
  return Boolean(
    r && emotions.includes(r.emotion) && Array.isArray(r.lines) && r.lines.length > 0 && r.lines.every((v) => typeof v === "string" && !!v.trim())
  );
}
function validateCharacter(value, directoryId) {
  const c = value;
  if (!c || c.schemaVersion !== 1 || c.id !== directoryId || !/^[\w-]+$/.test(c.id) || ![c.name, c.codename, c.tagline, c.themeColor, c.persona?.systemPrompt, c.persona?.speechStyle].every((v) => typeof v === "string") || !Array.isArray(c.persona?.catchphrases) || !c.persona.catchphrases.every((v) => typeof v === "string") || !c.reactions || typeof c.reactions !== "object" || Array.isArray(c.reactions)) {
    throw new Error(`\u89D2\u8272\u5305\u683C\u5F0F\u65E0\u6548: ${directoryId}`);
  }
  for (const reaction of Object.values(c.reactions)) {
    if (!isValidReaction(reaction)) throw new Error(`\u89D2\u8272\u53CD\u5E94\u8868\u65E0\u6548: ${directoryId}`);
  }
  if (c.touchReactions !== void 0) {
    if (!c.touchReactions || typeof c.touchReactions !== "object" || Array.isArray(c.touchReactions)) {
      throw new Error(`\u89D2\u8272\u89E6\u6478\u53CD\u5E94\u8868\u65E0\u6548: ${directoryId}`);
    }
    for (const [zone, reaction] of Object.entries(c.touchReactions)) {
      if (!touchZones.includes(zone) || !isValidReaction(reaction)) {
        throw new Error(`\u89D2\u8272\u89E6\u6478\u53CD\u5E94\u9879\u65E0\u6548: ${directoryId}.${zone}`);
      }
    }
  }
  if (!c.art || c.art.renderer !== "sprites" && c.art.renderer !== "live2d") throw new Error(`\u89D2\u8272\u7ACB\u7ED8\u683C\u5F0F\u65E0\u6548: ${directoryId}`);
  if (c.art.portrait !== void 0 && !safeAsset(c.art.portrait)) throw new Error("\u89D2\u8272\u5934\u50CF\u8DEF\u5F84\u65E0\u6548");
  if (c.art.renderer === "sprites") {
    if (!safeAsset(c.art.emotions?.idle) || !Object.values(c.art.emotions).every(safeAsset)) throw new Error("\u89D2\u8272\u8868\u60C5\u8DEF\u5F84\u65E0\u6548");
  } else if (!safeAsset(c.art.model3) || !c.art.expressions || !c.art.motions) {
    throw new Error("Live2D \u89D2\u8272\u683C\u5F0F\u65E0\u6548");
  }
  return c;
}

// server/src/diy-store.ts
var defaultDiyDir = () => join(homedir(), ".config/bigfish-stage/diy");
var ALLOWED_IMAGE_MIMES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};
var OPTIONAL_EMOTIONS = [
  "thinking",
  "working",
  "happy",
  "worried",
  "shocked"
];
function decodeImageDataUrl(dataUrl, label) {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error(`${label}\u56FE\u7247\u683C\u5F0F\u4E0D\u53D7\u652F\u6301\uFF08\u8BF7\u4E0A\u4F20 PNG / JPG / WebP / GIF\uFF09`);
  }
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_IMAGE_MIMES[mime];
  if (!ext) {
    throw new Error(`${label}\u56FE\u7247\u683C\u5F0F\u4E0D\u53D7\u652F\u6301\uFF1A${mime}\uFF08\u4EC5\u652F\u6301 PNG / JPG / WebP / GIF\uFF09`);
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (bytes.byteLength === 0) {
    throw new Error(`${label}\u56FE\u7247\u5185\u5BB9\u4E3A\u7A7A`);
  }
  if (bytes.byteLength > MAX_DIY_IMAGE_BYTES) {
    throw new Error(`${label}\u56FE\u7247\u8D85\u8FC7 5MB \u4E0A\u9650\uFF0C\u8BF7\u538B\u7F29\u540E\u518D\u8BD5`);
  }
  return { bytes, ext };
}
function sanitizeColor(color, fallback) {
  const clean = (color ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
}
function makeCustomCharacterId(rawName) {
  const ascii = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  const suffix = randomUUID().slice(0, 8);
  return ascii ? `custom-${ascii}-${suffix}` : `custom-char-${suffix}`;
}
async function atomicWriteFile(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true, mode: 448 });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmp, data, { mode: 384, flag: "wx" });
  await rename(tmp, filePath);
  await chmod(filePath, 384);
}
function cleanPersonaOverride(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("\u6027\u683C\u8BBE\u5B9A\u6570\u636E\u683C\u5F0F\u65E0\u6548");
  }
  const obj = raw;
  const rolePrompt = typeof obj.rolePrompt === "string" ? obj.rolePrompt.trim() : "";
  if (rolePrompt.length > MAX_PERSONA_CHARS) {
    throw new Error(`\u6027\u683C\u5B9A\u4F4D\u5185\u5BB9\u8FC7\u957F\uFF08\u5F53\u524D ${rolePrompt.length} \u5B57\uFF0C\u4E0A\u9650 ${MAX_PERSONA_CHARS} \u5B57\uFF09`);
  }
  const sourceFileName = typeof obj.sourceFileName === "string" && obj.sourceFileName.trim() ? obj.sourceFileName.trim().slice(0, 120) : void 0;
  const selfTitle = typeof obj.selfTitle === "string" && obj.selfTitle.trim() ? obj.selfTitle.trim().slice(0, 24) : void 0;
  const userTitle = typeof obj.userTitle === "string" && obj.userTitle.trim() ? obj.userTitle.trim().slice(0, 24) : void 0;
  const tagline = typeof obj.tagline === "string" && obj.tagline.trim() ? obj.tagline.trim().slice(0, 80) : void 0;
  if (!rolePrompt && !selfTitle && !userTitle && !tagline) {
    throw new Error("\u8BF7\u81F3\u5C11\u586B\u5199\u6027\u683C\u4E0E\u804C\u8D23\u5B9A\u4F4D\u5185\u5BB9\u3001\u79F0\u547C\u6216\u7B80\u4ECB\u6807\u8BED\u4E4B\u4E00");
  }
  return {
    rolePrompt,
    ...sourceFileName ? { sourceFileName } : {},
    ...selfTitle ? { selfTitle } : {},
    ...userTitle ? { userTitle } : {},
    ...tagline ? { tagline } : {},
    updatedAt: typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now()
  };
}
var DiyStore = class {
  constructor(rootDir = defaultDiyDir()) {
    this.rootDir = rootDir;
    this.overridesPath = join(this.rootDir, "overrides.json");
    this.charactersDir = join(this.rootDir, "characters");
  }
  overridesPath;
  charactersDir;
  overrides = {};
  writeQueue = Promise.resolve();
  async load() {
    try {
      const raw = JSON.parse(await readFile(this.overridesPath, "utf8"));
      const next = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [charId, item] of Object.entries(raw)) {
          if (!/^[\w-]+$/.test(charId)) continue;
          try {
            next[charId] = cleanPersonaOverride(item);
          } catch {
          }
        }
      }
      this.overrides = next;
    } catch (err) {
      if (err.code !== "ENOENT") {
        this.overrides = {};
      }
    }
  }
  getOverrides() {
    return structuredClone(this.overrides);
  }
  async listCustomPacks() {
    let entries;
    try {
      entries = await readdir(this.charactersDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    const packs = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isCustomCharacterId(entry.name)) continue;
      try {
        const jsonPath = join(this.charactersDir, entry.name, "character.json");
        const parsed = JSON.parse(await readFile(jsonPath, "utf8"));
        packs.push(validateCharacter(parsed, entry.name));
      } catch {
      }
    }
    packs.sort((a, b) => a.id.localeCompare(b.id));
    return packs;
  }
  async snapshot() {
    const customPacks = await this.listCustomPacks();
    return {
      ok: true,
      overrides: this.getOverrides(),
      customPacks
    };
  }
  async saveOverride(characterId, override) {
    if (!characterId || !/^[\w-]+$/.test(characterId)) {
      throw new Error("\u89D2\u8272 ID \u65E0\u6548");
    }
    const task = async () => {
      if (override === null) {
        delete this.overrides[characterId];
      } else {
        this.overrides[characterId] = cleanPersonaOverride(override);
      }
      await atomicWriteFile(this.overridesPath, JSON.stringify(this.overrides, null, 2) + "\n");
    };
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.catch(() => {
    });
    await run;
    return this.getOverrides();
  }
  async saveCustomCharacter(input) {
    if (!input || typeof input !== "object") {
      throw new Error("\u89D2\u8272\u914D\u7F6E\u53C2\u6570\u65E0\u6548");
    }
    const name2 = (input.name ?? "").trim().slice(0, 48);
    if (!name2) {
      throw new Error("\u8BF7\u586B\u5199\u89D2\u8272\u540D\u79F0");
    }
    const rolePrompt = (input.rolePrompt ?? "").trim();
    if (!rolePrompt) {
      throw new Error("\u8BF7\u5BFC\u5165\u6216\u586B\u5199\u89D2\u8272\u7684\u6027\u683C\u4E0E\u804C\u8D23\u5B9A\u4F4D\u5185\u5BB9");
    }
    if (rolePrompt.length > MAX_PERSONA_CHARS) {
      throw new Error(`\u6027\u683C\u5B9A\u4F4D\u5185\u5BB9\u8FC7\u957F\uFF08\u5F53\u524D ${rolePrompt.length} \u5B57\uFF0C\u4E0A\u9650 ${MAX_PERSONA_CHARS} \u5B57\uFF09`);
    }
    let id;
    let existingPack = null;
    if (input.id) {
      if (!isCustomCharacterId(input.id)) {
        throw new Error("\u81EA\u5EFA\u89D2\u8272 ID \u683C\u5F0F\u65E0\u6548");
      }
      id = input.id;
      try {
        const raw = JSON.parse(await readFile(join(this.charactersDir, id, "character.json"), "utf8"));
        existingPack = validateCharacter(raw, id);
      } catch {
        existingPack = null;
      }
    } else {
      id = makeCustomCharacterId(name2);
    }
    const charDir = resolve(join(this.charactersDir, id));
    const safeRoot = resolve(this.charactersDir);
    if (!charDir.startsWith(safeRoot + sep)) {
      throw new Error("\u975E\u6CD5\u7684\u89D2\u8272\u76EE\u5F55\u8DEF\u5F84");
    }
    const artDir = join(charDir, "art");
    await mkdir(artDir, { recursive: true, mode: 448 });
    const prevSprites = existingPack?.art.renderer === "sprites" ? existingPack.art : void 0;
    let idleRel = prevSprites?.emotions.idle ?? "";
    if (input.idleDataUrl?.trim()) {
      const { bytes, ext } = decodeImageDataUrl(input.idleDataUrl, "\u4E3B\u7ACB\u7ED8 ");
      idleRel = `art/idle${ext}`;
      await atomicWriteFile(join(charDir, idleRel), bytes);
    }
    if (!idleRel) {
      throw new Error("\u65B0\u5EFA DIY \u89D2\u8272\u8BF7\u81F3\u5C11\u4E0A\u4F20\u4E00\u5F20\u4E3B\u7ACB\u7ED8\uFF08\u5F85\u673A\u5F62\u8C61\uFF09");
    }
    let portraitRel = prevSprites?.portrait ?? idleRel;
    if (input.portraitDataUrl?.trim()) {
      const { bytes, ext } = decodeImageDataUrl(input.portraitDataUrl, "\u89D2\u8272\u5934\u50CF ");
      portraitRel = `art/portrait${ext}`;
      await atomicWriteFile(join(charDir, portraitRel), bytes);
    } else if (!prevSprites?.portrait) {
      portraitRel = idleRel;
    }
    const emotionsMap = {
      ...prevSprites?.emotions ?? {},
      idle: idleRel
    };
    if (input.emotionsDataUrls && typeof input.emotionsDataUrls === "object") {
      for (const emo of OPTIONAL_EMOTIONS) {
        const rawUrl = input.emotionsDataUrls[emo];
        if (typeof rawUrl === "string" && rawUrl.trim()) {
          const { bytes, ext } = decodeImageDataUrl(rawUrl, `${emo} \u8868\u60C5\u7ACB\u7ED8 `);
          const rel = `art/${emo}${ext}`;
          await atomicWriteFile(join(charDir, rel), bytes);
          emotionsMap[emo] = rel;
        }
      }
    }
    const shortName = name2.split("\uFF08")[0].trim() || name2;
    const selfTitle = (input.selfTitle ?? "").trim().slice(0, 24) || "\u6211";
    const userTitle = (input.userTitle ?? "").trim().slice(0, 24) || "\u5E97\u957F";
    const codename = (input.codename ?? "").trim().slice(0, 36) || `DIY \xB7 ${shortName.toUpperCase()}`;
    const tagline = (input.tagline ?? "").trim().slice(0, 80) || `${shortName} \xB7 \u73A9\u5BB6\u81EA\u5B9A\u4E49\u4E13\u5C5E\u642D\u6863`;
    const themeColor = sanitizeColor(input.themeColor, "#E60012");
    const accentColor = sanitizeColor(input.accentColor, "#FACC15");
    const cleanCatchphrases = (input.catchphrases ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
    if (cleanCatchphrases.length === 0) {
      cleanCatchphrases.push(`${userTitle}\uFF0C${shortName}\u968F\u65F6\u5F85\u547D\uFF01`);
    }
    const pack = {
      schemaVersion: 1,
      id,
      name: name2,
      codename,
      tagline,
      themeColor,
      accentColor,
      persona: {
        systemPrompt: [
          `\u4F60\u662F\u300C${shortName}\u300D\uFF0C\u81EA\u79F0\u300C${selfTitle}\u300D\uFF0C\u79F0\u547C\u7528\u6237\u4E3A\u300C${userTitle}\u300D\u3002`,
          rolePrompt,
          "\u6BCF\u6B21\u821E\u53F0\u77ED\u53F0\u8BCD\u53EA\u8BF4\u4E00\u884C\u7B80\u4F53\u4E2D\u6587\uFF0C\u6700\u591A40\u5B57\uFF1B\u4F9D\u636E\u771F\u5B9E\u8FDB\u5EA6\u8BF4\u8BDD\uFF0C\u4E0D\u7F16\u9020\u5B8C\u6210\u7ED3\u679C\u3002"
        ].join("\n"),
        speechStyle: rolePrompt.replace(/\s+/g, " ").slice(0, 140),
        catchphrases: cleanCatchphrases
      },
      reactions: existingPack?.reactions && Object.keys(existingPack.reactions).length > 0 ? existingPack.reactions : buildDefaultDiyReactions(shortName, userTitle, cleanCatchphrases),
      uiCopy: {
        userTitle,
        inputTitle: `TASK // \u547C\u53EB${shortName}`,
        inputPlaceholder: `\u5411${shortName}\u4E0B\u8FBE\u4EFB\u52A1\u6307\u4EE4\u5E76\u6309 Enter \u53D1\u9001\u2026`,
        inputTag: "TASK // \u5F53\u524D\u6307\u4EE4",
        sendLabel: "\u51FA\u51FB \u25B6",
        idleHint: `\u5F85\u547D\u821E\u53F0\uFF1A\u53D1\u9001\u6307\u4EE4\u540E\uFF0C${shortName}\u7684\u5DE5\u5177\u8C03\u7528\u5C06\u5728\u6B64\u5B9E\u65F6\u6F14\u51FA\u3002`,
        stageSubtitle: `${shortName} \xB7 \u4E13\u5C5E\u5DE5\u4F5C\u53F0`
      },
      art: {
        renderer: "sprites",
        portrait: portraitRel,
        emotions: emotionsMap
      }
    };
    const validated = validateCharacter(pack, id);
    await atomicWriteFile(join(charDir, "character.json"), JSON.stringify(validated, null, 2) + "\n");
    await this.saveOverride(id, {
      sourceFileName: input.sourceFileName,
      rolePrompt,
      selfTitle,
      userTitle,
      tagline,
      updatedAt: Date.now()
    });
    return validated;
  }
  async deleteCustomCharacter(characterId) {
    if (!isCustomCharacterId(characterId)) {
      throw new Error("\u4EC5\u5141\u8BB8\u5220\u9664\u81EA\u5EFA\u89D2\u8272\uFF08custom-*\uFF09");
    }
    const targetDir = resolve(join(this.charactersDir, characterId));
    const safeRoot = resolve(this.charactersDir);
    if (!targetDir.startsWith(safeRoot + sep)) {
      throw new Error("\u89D2\u8272\u76EE\u5F55\u8DEF\u5F84\u65E0\u6548");
    }
    await rm(targetDir, { recursive: true, force: true });
    await this.saveOverride(characterId, null);
  }
  /**
   * 安全解析自建角色静态资源文件路径（供 /characters/<id>/... 回退使用）
   */
  async resolveCustomAssetFile(relUrlPath) {
    if (!relUrlPath || relUrlPath.includes("\0") || relUrlPath.includes("\\")) return null;
    const cleanRel = relUrlPath.replace(/^\/+/, "");
    const firstSlash = cleanRel.indexOf("/");
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
};
async function handleDiyApiAction(store, method, pathname, searchParams, rawBody) {
  const cleanPath = pathname.replace(/\/+$/, "") || "/api/diy";
  const upper = method.toUpperCase();
  try {
    if (upper === "GET" && cleanPath === "/api/diy") {
      const snap = await store.snapshot();
      return { status: 200, body: snap };
    }
    if (upper === "POST" && cleanPath === "/api/diy/override") {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const characterId = typeof parsed?.characterId === "string" ? parsed.characterId.trim() : "";
      const overrideVal = parsed?.override === null ? null : parsed?.override;
      await store.saveOverride(characterId, overrideVal);
      const snap = await store.snapshot();
      return {
        status: 200,
        body: snap,
        mutated: true
      };
    }
    if (upper === "POST" && cleanPath === "/api/diy/character") {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const savedPack = await store.saveCustomCharacter(parsed);
      const snap = await store.snapshot();
      return {
        status: 200,
        body: { ...snap, savedPack },
        mutated: true
      };
    }
    if (upper === "DELETE" && cleanPath === "/api/diy/character" || upper === "POST" && cleanPath === "/api/diy/character/delete") {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const targetId = typeof parsed?.id === "string" && parsed.id.trim() || (searchParams.get("id") ?? "").trim();
      await store.deleteCustomCharacter(targetId);
      const snap = await store.snapshot();
      return {
        status: 200,
        body: snap,
        mutated: true,
        deletedCharacterId: targetId
      };
    }
    return { status: 404, body: { ok: false, error: "\u672A\u77E5\u7684 DIY \u63A5\u53E3\u8DEF\u5F84" } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "\u5904\u7406 DIY \u914D\u7F6E\u5931\u8D25";
    return { status: 400, body: { ok: false, error: message } };
  }
}

// packages/dsh-client-ui-p5stage/src/index.ts
var MIME_TYPES = {
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".moc3": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".md": "text/markdown; charset=utf-8"
};
var pkgDir = resolve2(fileURLToPath(new URL("..", import.meta.url)));
var repoPublicDir = [resolve2(pkgDir, "public"), resolve2(pkgDir, "../../public")].find(
  (dir) => existsSync(join2(dir, "characters"))
) ?? resolve2(pkgDir, "public");
function createStaticPrefixResource(mountPrefix, rootDir, fallbackStore) {
  const normalizedRoot = resolve2(rootDir);
  return async (request) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const rel = pathname.startsWith(mountPrefix) ? pathname.slice(mountPrefix.length).replace(/^\/+/, "") : "";
    if (!rel) {
      return new Response("Not Found", { status: 404 });
    }
    const targetPath = resolve2(join2(normalizedRoot, rel));
    if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + sep2)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const info = await stat2(targetPath);
      if (info.isFile()) {
        const ext = extname2(targetPath).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "content-type": contentType,
              "content-length": String(info.size),
              "cache-control": "no-cache"
            }
          });
        }
        const bytes = await readFile2(targetPath);
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-length": String(bytes.byteLength),
            "cache-control": "no-cache"
          }
        });
      }
    } catch {
    }
    if (fallbackStore) {
      const customAsset = await fallbackStore.resolveCustomAssetFile(rel);
      if (customAsset) {
        const contentType = MIME_TYPES[customAsset.ext] ?? "application/octet-stream";
        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "content-type": contentType,
              "content-length": String(customAsset.size),
              "cache-control": "no-cache"
            }
          });
        }
        const bytes = await readFile2(customAsset.target);
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-length": String(bytes.byteLength),
            "cache-control": "no-cache"
          }
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  };
}
var name = "ui-p5stage-host";
var inject = ["webServer"];
var HEAD_FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
  '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=JetBrains+Mono:wght@500;700;800&family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet" />'
].join("");
function apply(ctx) {
  if (!ctx.webServer) return;
  const charactersDir = join2(repoPublicDir, "characters");
  const sfxDir = join2(repoPublicDir, "sfx");
  const diyStore = new DiyStore();
  const diyLoaded = diyStore.load().catch(() => {
  });
  ctx.effect(
    () => ctx.webServer.register({
      kind: "prefix",
      path: "/api/diy",
      resource: async (request) => {
        await diyLoaded;
        const url = new URL(request.url, "http://127.0.0.1");
        const method = request.method || "GET";
        let rawBody;
        if (method !== "GET" && method !== "HEAD") {
          rawBody = await request.text();
          if (rawBody.length > 32 * 1024 * 1024) {
            return new Response(
              JSON.stringify({ ok: false, error: "\u4E0A\u4F20\u5185\u5BB9\u8FC7\u5927\uFF08\u603B\u8BA1\u4E0A\u9650 32MB\uFF09" }),
              { status: 413, headers: { "content-type": "application/json; charset=utf-8" } }
            );
          }
        }
        const res = await handleDiyApiAction(
          diyStore,
          method,
          decodeURIComponent(url.pathname),
          url.searchParams,
          rawBody
        );
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-cache"
          }
        });
      }
    })
  );
  ctx.effect(
    () => ctx.webServer.register({
      kind: "prefix",
      path: "/characters",
      resource: createStaticPrefixResource("/characters", charactersDir, diyStore)
    })
  );
  ctx.effect(
    () => ctx.webServer.register({
      kind: "prefix",
      path: "/sfx",
      resource: createStaticPrefixResource("/sfx", sfxDir)
    })
  );
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "html",
      placement: "head",
      html: HEAD_FONT_LINKS
    });
  });
}
export {
  apply,
  inject,
  name
};
