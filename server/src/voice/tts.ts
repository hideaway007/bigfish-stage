import { execFile, spawn } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_CHARACTER_VOICES, type TtsSettings } from '../../../src/shared/settings';

const runFile = promisify(execFile);

export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';

const CHARACTER_ACTING_STYLES: Record<string, string> = {
  'deepseek-v4-pro':
    '[Genshin Impact / Blue Archive official anime CV style, high-pitched sweet kawaii 2D anime girl head-voice, bouncy anime intonation, cute breathy warmth, crystal-clear Mandarin articulation, zero adult newsreader tone] [giggle]',
  'gemini-4-argon':
    '[Genshin Impact / Honkai Star Rail official anime CV style, bright youthful high-pitched tsundere anime catgirl voice, playful smug teasing anime pitch inflections, energetic snappy rhythm, crystal-clear Mandarin articulation]',
  'claude-opus-5-5':
    '[Anime ojou-sama / Frieren & Violet Evergarden style 2D anime heroine CV, soft airy youthful silver-bell anime girl voice, gentle dreamy breathiness with subtle dry wit, crystal-clear Mandarin articulation, NOT mature corporate woman] [soft sigh]',
  'codex-dragon':
    '[Anime fantasy dragon goddess / Genshin Impact Raiden & Shenhe style 2D anime CV, ethereal breathy crystal-clear anime maiden voice, graceful anime cadence, crystal-clear Mandarin articulation]',
};

export interface SynthesizedSpeech {
  audioBase64: string;
  mimeType: string;
}

export function cleanSpeechText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/（[^）]{1,18}）/g, '')
    .replace(/\([^)]{1,18}\)/g, '')
    .replace(/[#*_~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

/**
 * Normalize legacy Chirp3 voice IDs (e.g. "cmn-CN-Chirp3-HD-Leda" -> "Leda")
 * into Gemini 3.8 Flash TTS prebuiltVoiceConfig voice names.
 */
export function normalizeGeminiVoiceName(rawVoice: string, characterId: string): string {
  const trimmed = rawVoice.trim();
  const stripped = trimmed
    .replace(/^[a-z]{2,3}-[A-Z]{2}-Chirp3-HD-/i, '')
    .replace(/^[a-z]{2,3}-[A-Z]{2}-(?:Neural2|Wavenet|Standard)-/i, '');
  if (/^[A-Z][a-z]{2,20}$/.test(stripped)) {
    if (stripped === 'Achernar') return 'Kore';
    return stripped;
  }
  return DEFAULT_CHARACTER_VOICES[characterId] || 'Leda';
}

function curlJsonRequest(
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: string,
  timeoutSec = 18
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const cfgLines = [
      `url = "${url.replace(/["\\]/g, '\\$&')}"`,
      `request = "${method}"`,
      `max-time = ${timeoutSec}`,
      'silent',
      'show-error',
      'write-out = "\\n__HTTP_STATUS__:%{http_code}"',
    ];
    for (const [k, v] of Object.entries(headers)) {
      const cleanVal = v.replace(/[\r\n"]/g, '');
      cfgLines.push(`header = "${k}: ${cleanVal}"`);
    }
    if (body !== undefined) {
      const escaped = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      cfgLines.push(`data = "${escaped}"`);
    }

    const child = spawn('/usr/bin/curl', ['--happy-eyeballs-timeout-ms', '250', '-K', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => reject(err));
    child.on('close', code => {
      const marker = '\n__HTTP_STATUS__:';
      const idx = stdout.lastIndexOf(marker);
      if (idx >= 0) {
        const status = Number(stdout.slice(idx + marker.length).trim()) || 0;
        const respBody = stdout.slice(0, idx);
        if (status > 0) {
          resolve({ status, body: respBody });
          return;
        }
      }
      reject(new Error(stderr.trim() || `网络请求失败 (curl exit ${code})`));
    });
    child.stdin.write(cfgLines.join('\n') + '\n');
    child.stdin.end();
  });
}

export class TtsService {
  private cache = new Map<string, SynthesizedSpeech>();
  private cachedGcloudBin: string | null | undefined;
  private cachedAccessToken: { token: string; expiresAt: number } | null = null;
  private inflightToken: Promise<string> | null = null;
  private cachedQuotaProject: string | null = null;
  private inflightProject: Promise<string | undefined> | null = null;

  constructor(private readonly customFetch?: typeof fetch) {}

  /** Pre-warm Google Cloud OAuth token & quota project in background on server boot so first line has 0 auth delay */
  warmUp(gcpProject?: string): void {
    if (this.customFetch) return;
    void (async () => {
      try {
        const gcloud = await this.resolveGcloudBinary();
        const token = await this.getGcloudAccessToken(gcloud);
        await this.resolveQuotaProject(gcloud, token, gcpProject);
      } catch {}
    })();
  }

  private setCache(key: string, val: SynthesizedSpeech) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, val);
    if (this.cache.size > 80) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  private gcloudEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: `${join(homedir(), '.homebrew/bin')}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
    };
  }

  private async httpJson(
    url: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    bodyObj?: unknown
  ): Promise<{ status: number; body: string }> {
    const bodyStr = bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined;
    if (this.customFetch) {
      const res = await this.customFetch(url, {
        method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(12_000),
      });
      return { status: res.status, body: await res.text() };
    }
    return curlJsonRequest(url, method, headers, bodyStr, 12);
  }

  private async resolveGcloudBinary(): Promise<string | null> {
    if (this.cachedGcloudBin !== undefined) return this.cachedGcloudBin;
    const candidates = [
      process.env.GCLOUD_BIN,
      join(homedir(), '.homebrew/bin/gcloud'),
      '/opt/homebrew/bin/gcloud',
      '/usr/local/bin/gcloud',
      '/usr/bin/gcloud',
    ].filter((v): v is string => Boolean(v));

    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        this.cachedGcloudBin = candidate;
        return candidate;
      } catch {}
    }
    try {
      const { stdout } = await runFile('which', ['gcloud'], { timeout: 2500, env: this.gcloudEnv() });
      const resolved = stdout.trim();
      if (resolved) {
        this.cachedGcloudBin = resolved;
        return resolved;
      }
    } catch {}
    this.cachedGcloudBin = null;
    return null;
  }

  private async getGcloudAccessToken(gcloud: string | null): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > now) {
      return this.cachedAccessToken.token;
    }
    if (this.inflightToken) return this.inflightToken;
    const p = this.fetchGcloudAccessTokenUncached(gcloud).finally(() => {
      this.inflightToken = null;
    });
    this.inflightToken = p;
    return p;
  }

  private async fetchGcloudAccessTokenUncached(gcloud: string | null): Promise<string> {
    const now = Date.now();
    const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.config/gcloud/application_default_credentials.json');
    try {
      const adc = JSON.parse(await readFile(adcPath, 'utf8')) as {
        client_id?: string;
        client_secret?: string;
        refresh_token?: string;
      };
      if (adc.client_id && adc.client_secret && adc.refresh_token) {
        const formBody = new URLSearchParams({
          client_id: adc.client_id,
          client_secret: adc.client_secret,
          refresh_token: adc.refresh_token,
          grant_type: 'refresh_token',
        }).toString();
        const res = await curlJsonRequest(
          'https://oauth2.googleapis.com/token',
          'POST',
          { 'Content-Type': 'application/x-www-form-urlencoded' },
          formBody,
          14
        );
        if (res.status >= 200 && res.status < 300) {
          const tokJson = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
          if (tokJson.access_token) {
            const ttlMs = Math.max(60_000, ((tokJson.expires_in ?? 3600) - 120) * 1000);
            this.cachedAccessToken = { token: tokJson.access_token, expiresAt: now + ttlMs };
            return tokJson.access_token;
          }
        }
      }
    } catch {}

    if (gcloud) {
      const env = this.gcloudEnv();
      const commands = [
        ['auth', 'print-access-token'],
        ['auth', 'application-default', 'print-access-token'],
      ];
      for (const args of commands) {
        try {
          const { stdout } = await runFile(gcloud, args, { timeout: 10_000, env });
          const token = stdout.trim();
          if (token) {
            this.cachedAccessToken = { token, expiresAt: now + 40 * 60_000 };
            return token;
          }
        } catch {}
      }
    }
    throw new Error('未找到可用的 Google Cloud 登录凭证，请配置 API Key 或执行 gcloud auth login');
  }

  private async discoverLocalGcloudProjects(): Promise<string[]> {
    const found = new Set<string>();
    const gdir = join(homedir(), '.config/gcloud');
    const scanDir = async (dir: string, depth = 0) => {
      if (depth > 3) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(full, depth + 1);
          } else if (entry.name.startsWith('config_') || entry.name.endsWith('.log') || entry.name.endsWith('.json')) {
            try {
              const raw = await readFile(full, 'utf8');
              const matches = raw.match(/\bproject-[0-9a-f-]{15,35}\b/g) ?? [];
              for (const m of matches) found.add(m);
              const cfgMatch = raw.match(/^\s*project\s*=\s*([a-z][a-z0-9-]{4,29})\s*$/m);
              if (cfgMatch?.[1]) found.add(cfgMatch[1]);
            } catch {}
          }
        }
      } catch {}
    };
    await scanDir(gdir);
    return [...found];
  }

  private async resolveQuotaProject(gcloud: string | null, token: string, configured?: string): Promise<string | undefined> {
    const explicit = configured?.trim() || process.env.GOOGLE_CLOUD_QUOTA_PROJECT?.trim();
    if (explicit) return explicit;
    if (this.cachedQuotaProject) return this.cachedQuotaProject;
    if (this.inflightProject) return this.inflightProject;

    const p = (async () => {
      const candidates = await this.discoverLocalGcloudProjects();
      if (candidates.length === 0 && gcloud) {
        const env = this.gcloudEnv();
        try {
          const { stdout } = await runFile(gcloud, ['projects', 'list', '--format=value(projectId)'], { timeout: 8_000, env });
          for (const line of stdout.split(/\r?\n/)) {
            const proj = line.trim();
            if (proj && !candidates.includes(proj)) candidates.push(proj);
          }
        } catch {}
      }

      const probes = await Promise.all(
        candidates.slice(0, 10).map(async projectId => {
          try {
            const res = await this.httpJson('https://texttospeech.googleapis.com/v1/voices?languageCode=cmn-CN', 'GET', {
              Authorization: `Bearer ${token}`,
              'x-goog-user-project': projectId,
            });
            return res.status >= 200 && res.status < 300 ? projectId : null;
          } catch {
            return null;
          }
        })
      );
      const hit = probes.find(Boolean) ?? undefined;
      if (hit) this.cachedQuotaProject = hit;
      return hit ?? candidates[0];
    })().finally(() => {
      this.inflightProject = null;
    });
    this.inflightProject = p;
    return p;
  }

  resolveVoiceForCharacter(characterId: string, settings: TtsSettings, packDefaultVoice?: string): string {
    const raw =
      settings.characterVoices?.[characterId]?.trim() ||
      packDefaultVoice?.trim() ||
      DEFAULT_CHARACTER_VOICES[characterId] ||
      'Leda';
    return normalizeGeminiVoiceName(raw, characterId);
  }

  async synthesize(
    text: string,
    characterId: string,
    settings: TtsSettings,
    packDefaultVoice?: string
  ): Promise<SynthesizedSpeech | null> {
    const cleanText = cleanSpeechText(text);
    if (!cleanText) return null;

    const voiceName = this.resolveVoiceForCharacter(characterId, settings, packDefaultVoice);
    const rate = Math.max(0.7, Math.min(1.4, settings.speakingRate || 1.04));
    const cacheKey = `${settings.provider}:${GEMINI_TTS_MODEL}:${voiceName}:${rate.toFixed(2)}:${cleanText}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return hit;

    if (settings.provider === 'openai-tts') {
      const base = settings.endpoint.baseUrl.replace(/\/+$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (settings.endpoint.apiKey) headers.Authorization = `Bearer ${settings.endpoint.apiKey}`;
      const fetchFn = this.customFetch ?? fetch;
      const res = await fetchFn(`${base}/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'tts-1',
          voice: 'nova',
          input: cleanText,
          speed: rate,
          response_format: 'mp3',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`TTS 接口返回 HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const result: SynthesizedSpeech = { audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg' };
      this.setCache(cacheKey, result);
      return result;
    }

    const styleTag = CHARACTER_ACTING_STYLES[characterId] || CHARACTER_ACTING_STYLES['deepseek-v4-pro'];
    const styledPrompt = `${styleTag} ${cleanText}`;

    // If an explicit API Key is configured (e.g. AI Studio / Cloud API key or unit test mock), support key-based Gemini TTS
    if (settings.endpoint.apiKey?.trim()) {
      const key = encodeURIComponent(settings.endpoint.apiKey.trim());
      const base = (settings.endpoint.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
      const isCloudTtsHost = base.includes('texttospeech.googleapis.com');
      const url = isCloudTtsHost
        ? `${base}/v1beta1/text:synthesize?key=${key}`
        : `${base}/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${key}`;
      const payload = isCloudTtsHost
        ? {
            input: { text: cleanText, prompt: styleTag.replace(/^\[|\]$/g, '') },
            voice: { languageCode: 'cmn-CN', name: voiceName, modelName: 'gemini-2.5-flash-tts' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
          }
        : {
            contents: [{ role: 'user', parts: [{ text: styledPrompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                languageCode: 'cmn-CN',
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
            },
          };

      const res = await this.httpJson(url, 'POST', { 'Content-Type': 'application/json' }, payload);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Gemini TTS 响应失败 (HTTP ${res.status})${res.body ? `: ${res.body.slice(0, 120)}` : ''}`);
      }
      const parsed = JSON.parse(res.body) as any;
      const inline = parsed?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (inline?.data) {
        const out: SynthesizedSpeech = { audioBase64: inline.data, mimeType: inline.mimeType || 'audio/wav' };
        this.setCache(cacheKey, out);
        return out;
      }
      if (parsed?.audioContent) {
        const out: SynthesizedSpeech = { audioBase64: parsed.audioContent, mimeType: 'audio/mpeg' };
        this.setCache(cacheKey, out);
        return out;
      }
      throw new Error('Gemini TTS 未返回有效音频数据');
    }

    // Primary path: Google Cloud Vertex AI Global `gemini-3.8-flash-tts` via local gcloud / ADC OAuth
    const gcloud = await this.resolveGcloudBinary();
    const token = await this.getGcloudAccessToken(gcloud);
    const quotaProject = await this.resolveQuotaProject(gcloud, token, settings.gcpProject);
    if (!quotaProject) {
      throw new Error('未找到可用的 Google Cloud 项目，请在高级设置填写 GCP Project ID');
    }

    const vertexUrl = `https://aiplatform.googleapis.com/v1beta1/projects/${encodeURIComponent(quotaProject)}/locations/global/publishers/google/models/${GEMINI_TTS_MODEL}:generateContent`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': quotaProject,
    };

    const res = await this.httpJson(vertexUrl, 'POST', headers, {
      contents: [{ role: 'user', parts: [{ text: styledPrompt }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Gemini 3.8 Flash TTS 响应失败 (HTTP ${res.status})${res.body ? `: ${res.body.slice(0, 140)}` : ''}`);
    }

    const json = JSON.parse(res.body) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      }>;
    };
    const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) {
      throw new Error('Gemini 3.8 Flash TTS 未返回音频流');
    }

    const result: SynthesizedSpeech = {
      audioBase64: inline.data,
      mimeType: inline.mimeType || 'audio/wav',
    };
    this.setCache(cacheKey, result);
    return result;
  }

  async testConnection(settings: TtsSettings): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const sample = await this.synthesize('你好呀，今天想一起完成什么任务捏？', 'deepseek-v4-pro', settings);
      if (!sample?.audioBase64) {
        return { ok: false, message: '语音接口未返回有效音频', latencyMs: Date.now() - start };
      }
      return {
        ok: true,
        message: settings.provider === 'google-cloud'
          ? 'Google Cloud · Gemini 3.8 Flash TTS 情感语音已连通！'
          : 'OpenAI 兼容 TTS 语音接口已连通！',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        ok: false,
        message: (error as Error).message,
        latencyMs: Date.now() - start,
      };
    }
  }
}
