import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CHARACTER_VOICES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type CharacterBrainSettings,
  type ProviderEndpoint,
  type PublicizeCharacterBrain,
  type PublicSettings,
  type SettingsPatch,
} from '../../src/shared/settings';

export const defaultSettingsPath = () => join(homedir(), '.config/bigfish-stage/settings.json');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!object(base) || !object(patch)) return structuredClone(patch as T);
  const result = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || value === undefined) continue;
    result[key] = object(value) && object(result[key]) ? deepMerge(result[key], value) : structuredClone(value);
  }
  return result as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validateHttpEndpoint(endpoint: unknown, label = '模型接口'): ProviderEndpoint {
  assert(object(endpoint) && typeof endpoint.baseUrl === 'string' && (endpoint.apiKey === undefined || typeof endpoint.apiKey === 'string'), `${label}无效`);
  const url = new URL(endpoint.baseUrl);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, `${label}地址必须是 HTTP(S) 地址且不能内嵌凭据`);
  return {
    baseUrl: endpoint.baseUrl.replace(/\/+$/, ''),
    ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
  };
}

export function validateSettings(value: unknown): AppSettings {
  assert(object(value), '设置必须是对象');
  const merged = deepMerge(DEFAULT_SETTINGS, value);
  const s = merged as unknown as AppSettings;
  const str = (v: unknown): v is string => typeof v === 'string';
  const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

  assert(s.version === 1 && str(s.activeCharacterId) && /^[\w-]+$/.test(s.activeCharacterId), '角色或设置版本无效');
  assert(s.projectDir === null || str(s.projectDir), '项目目录无效');
  assert(Array.isArray(s.recentProjects) && s.recentProjects.every(str), '最近项目列表无效');
  assert(object(s.worker) && str(s.worker.adapter) && str(s.worker.model) && !!s.worker.model.trim(), '执行 Agent 设置无效');
  assert(['read-only', 'workspace-write'].includes(s.worker.sandbox), '沙箱设置无效');
  assert(s.worker.extra === undefined || (object(s.worker.extra) && Object.values(s.worker.extra).every(str)), '适配器选项无效');
  assert(['endpoint', 'agent-default'].includes(s.worker.connection), '执行 Agent 连接方式无效');
  assert(object(s.voice) && typeof s.voice.enabled === 'boolean' && object(s.voice.endpoint), '台词设置无效');

  const ep = s.voice.endpoint;
  assert(str(ep.model) && !!ep.model.trim(), '模型接口无效');
  const cleanVoiceBase = validateHttpEndpoint(ep, '模型接口');
  const cleanWorkerEp = validateHttpEndpoint(s.worker.endpoint, '模型接口');

  assert(num(s.voice.maxLinesPerMinute, 0, 60) && object(s.performance) && num(s.performance.typingCharsPerSec, 1, 1000), '限流或打字速度无效');

  // Validate per-character brains
  const cleanBrains: Record<string, CharacterBrainSettings> = {};
  if (object(s.characterBrains)) {
    for (const [charId, rawBrain] of Object.entries(s.characterBrains)) {
      if (!/^[\w-]+$/.test(charId) || !object(rawBrain)) continue;
      const b = rawBrain as CharacterBrainSettings;
      const entry: CharacterBrainSettings = {};
      if (str(b.model) && b.model.trim()) entry.model = b.model.trim();
      if (typeof b.useCustomEndpoint === 'boolean') entry.useCustomEndpoint = b.useCustomEndpoint;
      if (b.endpoint && object(b.endpoint) && str(b.endpoint.baseUrl) && b.endpoint.baseUrl.trim()) {
        entry.endpoint = validateHttpEndpoint(b.endpoint, `角色 ${charId} 接口`);
      }
      if (b.activeSessionId === null || (str(b.activeSessionId) && b.activeSessionId.trim())) {
        entry.activeSessionId = b.activeSessionId ? b.activeSessionId.trim() : null;
      }
      if (str(b.rolePrompt) && b.rolePrompt.trim()) {
        entry.rolePrompt = b.rolePrompt.trim().slice(0, 500);
      }
      cleanBrains[charId] = entry;
    }
  }

  // Validate TTS settings
  const rawTts = object(s.tts) ? s.tts : DEFAULT_SETTINGS.tts;
  assert(typeof rawTts.enabled === 'boolean', 'TTS 开关无效');
  assert(['google-cloud', 'openai-tts'].includes(rawTts.provider), 'TTS 服务商无效');
  const cleanTtsEp = validateHttpEndpoint(rawTts.endpoint ?? DEFAULT_SETTINGS.tts.endpoint, 'TTS 接口');
  const speakingRate = num(rawTts.speakingRate, 0.5, 2.0) ? rawTts.speakingRate : 1.04;
  const cleanVoices: Record<string, string> = { ...DEFAULT_CHARACTER_VOICES };
  if (object(rawTts.characterVoices)) {
    for (const [charId, vName] of Object.entries(rawTts.characterVoices)) {
      if (/^[\w-]+$/.test(charId) && str(vName) && vName.trim()) {
        cleanVoices[charId] = vName.trim();
      }
    }
  }

  return {
    version: 1,
    activeCharacterId: s.activeCharacterId,
    projectDir: s.projectDir,
    recentProjects: s.recentProjects.slice(0, 20),
    worker: {
      adapter: s.worker.adapter,
      model: s.worker.model,
      sandbox: s.worker.sandbox,
      connection: s.worker.connection,
      endpoint: cleanWorkerEp,
      ...(s.worker.extra ? { extra: { ...s.worker.extra } } : {}),
    },
    characterBrains: cleanBrains,
    voice: {
      enabled: s.voice.enabled,
      maxLinesPerMinute: s.voice.maxLinesPerMinute,
      endpoint: { ...cleanVoiceBase, model: ep.model },
    },
    tts: {
      enabled: rawTts.enabled,
      provider: rawTts.provider,
      characterVoices: cleanVoices,
      endpoint: cleanTtsEp,
      ...(str(rawTts.gcpProject) && rawTts.gcpProject.trim() ? { gcpProject: rawTts.gcpProject.trim() } : {}),
      speakingRate,
    },
    performance: { typingCharsPerSec: s.performance.typingCharsPerSec },
  };
}

export function publicSettings(settings: AppSettings): PublicSettings {
  const clean = structuredClone(settings);
  const { apiKey: voiceKey, ...voiceEndpoint } = clean.voice.endpoint;
  const { apiKey: workerKey, ...workerEndpoint } = clean.worker.endpoint;
  const { apiKey: ttsKey, ...ttsEndpoint } = clean.tts.endpoint;

  const publicBrains: Record<string, PublicizeCharacterBrain> = {};
  for (const [charId, brain] of Object.entries(clean.characterBrains ?? {})) {
    const { endpoint, ...rest } = brain;
    publicBrains[charId] = {
      ...rest,
      ...(endpoint ? { endpoint: { baseUrl: endpoint.baseUrl, apiKeySet: !!endpoint.apiKey } } : {}),
    };
  }

  return {
    ...clean,
    worker: { ...clean.worker, endpoint: { ...workerEndpoint, apiKeySet: !!workerKey } },
    characterBrains: publicBrains,
    voice: { ...clean.voice, endpoint: { ...voiceEndpoint, apiKeySet: !!voiceKey } },
    tts: { ...clean.tts, endpoint: { ...ttsEndpoint, apiKeySet: !!ttsKey } },
  };
}

export class SettingsStore {
  private value: AppSettings = structuredClone(DEFAULT_SETTINGS);
  constructor(readonly path = defaultSettingsPath()) {}
  get current(): AppSettings { return structuredClone(this.value); }
  get public(): PublicSettings { return publicSettings(this.value); }
  async load() {
    try {
      this.value = validateSettings(deepMerge(DEFAULT_SETTINGS, JSON.parse(await readFile(this.path, 'utf8'))));
      await chmod(this.path, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('无法读取本地设置文件，请检查 JSON 与设置格式');
      }
    }
    let dirValid = false;
    if (this.value.projectDir) {
      try {
        dirValid = (await stat(this.value.projectDir)).isDirectory();
      } catch {
        dirValid = false;
      }
    }
    if (!this.value.projectDir || !dirValid) {
      const envDir = process.env.BIGFISH_PROJECT_DIR || null;
      this.value.projectDir = envDir;
      if (envDir) {
        this.value.recentProjects = [
          envDir,
          ...this.value.recentProjects.filter(p => p !== envDir && !p.startsWith('/private/tmp/')),
        ].slice(0, 20);
      }
    }
  }
  async update(patch: SettingsPatch): Promise<AppSettings> {
    const next = validateSettings(deepMerge(this.value, patch));
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.path);
    this.value = next;
    return this.current;
  }
}
