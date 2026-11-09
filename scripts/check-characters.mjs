#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CHARACTERS_DIR = path.join(ROOT_DIR, 'public', 'characters');

const VALID_EMOTIONS = new Set([
  'idle',
  'thinking',
  'working',
  'happy',
  'worried',
  'shocked',
]);

const VALID_TOOL_KINDS = new Set([
  'read',
  'edit',
  'write',
  'bash',
  'search',
  'web',
  'task',
  'other',
]);

const VALID_STAGE_EVENT_TYPES = new Set([
  'session_started',
  'user_message',
  'steer_queued',
  'steer_acked',
  'interrupted',
  'thinking',
  'worker_text',
  'tool_start',
  'tool_end',
  'permission_request',
  'permission_resolved',
  'turn_done',
  'error',
  'character_line',
]);

function isValidReactionKey(key) {
  if (VALID_STAGE_EVENT_TYPES.has(key)) return true;
  if (key === 'tool_end:fail' || key === 'turn_done:fail') return true;
  if (key.startsWith('tool_start:')) {
    return VALID_TOOL_KINDS.has(key.slice('tool_start:'.length));
  }
  if (key.startsWith('tool_end:')) {
    return VALID_TOOL_KINDS.has(key.slice('tool_end:'.length));
  }
  return false;
}

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function validateCharacterDir(dirName) {
  const charDir = path.join(CHARACTERS_DIR, dirName);
  const manifestPath = path.join(charDir, 'character.json');
  const errors = [];

  if (!fs.existsSync(manifestPath)) {
    errors.push(`Missing character.json in public/characters/${dirName}`);
    return { ok: false, errors };
  }

  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    errors.push(`Invalid JSON in ${manifestPath}: ${err.message}`);
    return { ok: false, errors };
  }

  if (pack.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${JSON.stringify(pack.schemaVersion)})`);
  }
  if (pack.id !== dirName) {
    errors.push(`id "${pack.id}" does not match folder name "${dirName}"`);
  }
  for (const field of ['name', 'codename', 'tagline', 'themeColor']) {
    if (!isNonEmptyString(pack[field])) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (pack.accentColor !== undefined && !isNonEmptyString(pack.accentColor)) {
    errors.push(`accentColor must be a non-empty string when provided`);
  }

  // Persona check
  if (!pack.persona || typeof pack.persona !== 'object') {
    errors.push(`persona must be an object`);
  } else {
    if (!isNonEmptyString(pack.persona.systemPrompt)) {
      errors.push(`persona.systemPrompt must be a non-empty string`);
    }
    if (!isNonEmptyString(pack.persona.speechStyle)) {
      errors.push(`persona.speechStyle must be a non-empty string`);
    }
    if (
      !Array.isArray(pack.persona.catchphrases) ||
      pack.persona.catchphrases.length === 0 ||
      !pack.persona.catchphrases.every(isNonEmptyString)
    ) {
      errors.push(`persona.catchphrases must be a non-empty string[]`);
    }
  }

  // Reactions check
  if (!pack.reactions || typeof pack.reactions !== 'object') {
    errors.push(`reactions must be an object`);
  } else {
    for (const [rKey, reaction] of Object.entries(pack.reactions)) {
      if (!isValidReactionKey(rKey)) {
        errors.push(`Invalid ReactionKey "${rKey}"`);
      }
      if (!reaction || typeof reaction !== 'object') {
        errors.push(`Reaction "${rKey}" must be an object`);
        continue;
      }
      if (!VALID_EMOTIONS.has(reaction.emotion)) {
        errors.push(`Reaction "${rKey}" has invalid emotion "${reaction.emotion}"`);
      }
      if (
        !Array.isArray(reaction.lines) ||
        reaction.lines.length === 0 ||
        !reaction.lines.every(isNonEmptyString)
      ) {
        errors.push(`Reaction "${rKey}".lines must be a non-empty string[]`);
      }
    }
  }

  // Recommended models check
  if (
    pack.recommendedModels !== undefined &&
    (!Array.isArray(pack.recommendedModels) ||
      !pack.recommendedModels.every(isNonEmptyString))
  ) {
    errors.push(`recommendedModels must be string[] when provided`);
  }

  // Art manifest & referenced files check
  if (!pack.art || typeof pack.art !== 'object') {
    errors.push(`art must be an object`);
  } else if (pack.art.renderer === 'sprites') {
    if (!pack.art.emotions || typeof pack.art.emotions !== 'object') {
      errors.push(`art.emotions must be an object for sprites renderer`);
    } else {
      if (!isNonEmptyString(pack.art.emotions.idle)) {
        errors.push(`art.emotions.idle is required for sprites renderer`);
      }
      for (const [emo, relFile] of Object.entries(pack.art.emotions)) {
        if (!VALID_EMOTIONS.has(emo)) {
          errors.push(`art.emotions has invalid emotion key "${emo}"`);
        }
        if (!isNonEmptyString(relFile)) {
          errors.push(`art.emotions.${emo} must be a non-empty string`);
          continue;
        }
        const resolved = path.resolve(charDir, relFile);
        if (!resolved.startsWith(charDir)) {
          errors.push(`art.emotions.${emo} path escapes character directory: ${relFile}`);
        } else if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
          errors.push(`Referenced sprite image does not exist: public/characters/${dirName}/${relFile}`);
        }
      }
    }
    if (pack.art.portrait !== undefined) {
      if (!isNonEmptyString(pack.art.portrait)) {
        errors.push(`art.portrait must be a non-empty string`);
      } else {
        const resolvedPortrait = path.resolve(charDir, pack.art.portrait);
        if (!fs.existsSync(resolvedPortrait) || !fs.statSync(resolvedPortrait).isFile()) {
          errors.push(`Referenced portrait image does not exist: public/characters/${dirName}/${pack.art.portrait}`);
        }
      }
    }
  } else if (pack.art.renderer === 'live2d') {
    if (!isNonEmptyString(pack.art.model3)) {
      errors.push(`art.model3 is required for live2d renderer`);
    } else {
      const resolvedModel = path.resolve(charDir, pack.art.model3);
      if (!fs.existsSync(resolvedModel)) {
        errors.push(`Referenced live2d model3 does not exist: public/characters/${dirName}/${pack.art.model3}`);
      }
    }
  } else {
    errors.push(`art.renderer must be "sprites" or "live2d" (got ${JSON.stringify(pack.art.renderer)})`);
  }

  return { ok: errors.length === 0, errors, pack };
}

function main() {
  if (!fs.existsSync(CHARACTERS_DIR)) {
    console.error(`ERROR: Characters directory not found: ${CHARACTERS_DIR}`);
    process.exit(1);
  }

  const entries = fs
    .readdirSync(CHARACTERS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (entries.length === 0) {
    console.error(`ERROR: No character directories found in ${CHARACTERS_DIR}`);
    process.exit(1);
  }

  let hasErrors = false;
  for (const dirName of entries) {
    const res = validateCharacterDir(dirName);
    if (!res.ok) {
      hasErrors = true;
      console.error(`✗ Character pack [${dirName}] FAILED:`);
      for (const err of res.errors) {
        console.error(`  - ${err}`);
      }
    } else {
      const emotionCount =
        res.pack.art.renderer === 'sprites'
          ? Object.keys(res.pack.art.emotions).length
          : 0;
      const reactionCount = Object.keys(res.pack.reactions).length;
      console.log(
        `✓ Character pack [${dirName}] OK (${res.pack.codename} / ${res.pack.name}, renderer=${res.pack.art.renderer}, sprites=${emotionCount}, reactions=${reactionCount})`
      );
    }
  }

  if (hasErrors) {
    process.exit(1);
  }
  console.log(`All ${entries.length} character packs passed validation.`);
}

main();
