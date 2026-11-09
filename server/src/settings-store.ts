import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, type AppSettings, type PublicSettings, type SettingsPatch } from '../../src/shared/settings';

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
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function validateSettings(value: unknown): AppSettings {
  assert(object(value), '设置必须是对象');
  const s = value as unknown as AppSettings;
  const str = (v: unknown) => typeof v === 'string';
  const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  assert(s.version === 1 && str(s.activeCharacterId) && /^[\w-]+$/.test(s.activeCharacterId), '角色或设置版本无效');
  assert(s.projectDir === null || str(s.projectDir), '项目目录无效');
  assert(Array.isArray(s.recentProjects) && s.recentProjects.every(str), '最近项目列表无效');
  assert(object(s.worker) && str(s.worker.adapter) && str(s.worker.model) && !!s.worker.model.trim(), '执行 Agent 设置无效');
  assert(['read-only', 'workspace-write'].includes(s.worker.sandbox), '沙箱设置无效');
  assert(s.worker.extra === undefined || (object(s.worker.extra) && Object.values(s.worker.extra).every(str)), '适配器选项无效');
  assert(object(s.voice) && typeof s.voice.enabled === 'boolean' && object(s.voice.endpoint), '台词设置无效');
  const ep = s.voice.endpoint;
  assert(str(ep.baseUrl) && str(ep.model) && !!ep.model.trim() && (ep.apiKey === undefined || str(ep.apiKey)), '模型接口无效');
  const url = new URL(ep.baseUrl);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, '模型地址必须是 HTTP(S) 地址且不能内嵌凭据');
  assert(num(s.voice.maxLinesPerMinute, 0, 60) && object(s.performance) && num(s.performance.typingCharsPerSec, 1, 1000), '限流或打字速度无效');
  // Whitelist the public contract; never persist or echo arbitrary fields from a client.
  return {
    version: 1, activeCharacterId: s.activeCharacterId, projectDir: s.projectDir,
    recentProjects: s.recentProjects.slice(0, 20),
    worker: { adapter: s.worker.adapter, model: s.worker.model, sandbox: s.worker.sandbox, ...(s.worker.extra ? { extra: { ...s.worker.extra } } : {}) },
    voice: { enabled: s.voice.enabled, maxLinesPerMinute: s.voice.maxLinesPerMinute,
      endpoint: { baseUrl: ep.baseUrl.replace(/\/+$/, ''), model: ep.model, ...(ep.apiKey ? { apiKey: ep.apiKey } : {}) } },
    performance: { typingCharsPerSec: s.performance.typingCharsPerSec },
  };
}
export function publicSettings(settings: AppSettings): PublicSettings {
  const clean = structuredClone(settings);
  const { apiKey, ...endpoint } = clean.voice.endpoint;
  return { ...clean, voice: { ...clean.voice, endpoint: { ...endpoint, apiKeySet: !!apiKey } } };
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
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取本地设置文件，请检查 JSON 与设置格式'); }
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
