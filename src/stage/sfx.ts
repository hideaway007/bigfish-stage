/**
 * 舞台音效模块 (`src/stage/sfx.ts`)
 *
 * 真实音频由 `public/sfx/manifest.json` 声明：首次播放时只请求一次清单，
 * 清单里列出的文件才会被加载（`{ "files": { "hover": "hover.mp3" } }`），
 * 没列出的音效一律使用 WebAudio 合成音，因此不会产生任何 404。
 * 名称与格式详见 `public/sfx/README.md`。
 *
 * 遵循浏览器自动播放策略：仅在首次用户手势之后才创建 / 恢复 AudioContext。
 * 静音状态持久化在 localStorage。
 */

export type SfxName = 'hover' | 'select' | 'allow' | 'deny' | 'switch';

export const SFX_NAMES: SfxName[] = ['hover', 'select', 'allow', 'deny', 'switch'];

const SFX_BASE = '/sfx/';
const SFX_MANIFEST_URL = '/sfx/manifest.json';

const MUTE_STORAGE_KEY = 'p5_stage_sfx_muted';
const DEDUPE_WINDOW_MS = 38;

type MuteListener = (muted: boolean) => void;

let mutedState: boolean = readInitialMuted();
const muteListeners = new Set<MuteListener>();

let userGestureUnlocked = false;
let audioCtx: AudioContext | null = null;

const decodedBufferCache = new Map<SfxName, AudioBuffer>();
const missingFileSet = new Set<SfxName>();
const inflightFetchMap = new Map<SfxName, Promise<AudioBuffer | null>>();
const lastPlayedAtMap = new Map<SfxName, number>();

const playCounts: Record<SfxName, number> = {
  hover: 0,
  select: 0,
  allow: 0,
  deny: 0,
  switch: 0,
};

export interface SfxDebugSnapshot {
  muted: boolean;
  userGestureUnlocked: boolean;
  audioContextState: string;
  playCounts: Record<SfxName, number>;
  synthesizedFallbacks: SfxName[];
  loadedMp3s: SfxName[];
}

declare global {
  interface Window {
    __P5_SFX_DEBUG__?: () => SfxDebugSnapshot;
  }
}

function readInitialMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMutedToStorage(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // ignore storage quota / privacy mode errors
  }
}

export function isSfxMuted(): boolean {
  return mutedState;
}

export function setSfxMuted(nextMuted: boolean): void {
  const normalized = Boolean(nextMuted);
  if (mutedState === normalized) return;
  mutedState = normalized;
  writeMutedToStorage(mutedState);
  for (const listener of muteListeners) {
    listener(mutedState);
  }
}

export function toggleSfxMuted(): boolean {
  const next = !mutedState;
  setSfxMuted(next);
  if (!next) {
    notifyUserGesture();
    playSfx('select');
  }
  return next;
}

export function subscribeSfxMuted(listener: MuteListener): () => void {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}

export function notifyUserGesture(): void {
  userGestureUnlocked = true;
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {
      // ignore resume errors in headless environments
    });
  }
}

function attachGlobalGestureUnlock(): void {
  if (typeof window === 'undefined') return;

  const unlock = () => {
    userGestureUnlocked = true;
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
  };

  window.addEventListener('pointerdown', unlock, {
    capture: true,
    passive: true,
  });
  window.addEventListener('mousedown', unlock, {
    capture: true,
    passive: true,
  });
  window.addEventListener('keydown', unlock, {
    capture: true,
    passive: true,
  });
  window.addEventListener('touchstart', unlock, {
    capture: true,
    passive: true,
  });

  window.__P5_SFX_DEBUG__ = (): SfxDebugSnapshot => ({
    muted: mutedState,
    userGestureUnlocked,
    audioContextState: audioCtx ? audioCtx.state : 'uninitialized',
    playCounts: { ...playCounts },
    synthesizedFallbacks: Array.from(missingFileSet),
    loadedMp3s: Array.from(decodedBufferCache.keys()),
  });
}

attachGlobalGestureUnlock();

function getOrCreateAudioContext(): AudioContext | null {
  if (!userGestureUnlocked || typeof window === 'undefined') {
    return null;
  }
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  try {
    audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

let manifestPromise: Promise<Partial<Record<SfxName, string>>> | null = null;

function loadManifest(): Promise<Partial<Record<SfxName, string>>> {
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    const result: Partial<Record<SfxName, string>> = {};
    try {
      const res = await fetch(SFX_MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) return result;
      const json = (await res.json()) as { files?: Record<string, unknown> };
      const files = json && typeof json === 'object' ? json.files : null;
      if (!files || typeof files !== 'object') return result;
      for (const name of SFX_NAMES) {
        const f = files[name];
        // 只接受 /sfx/ 目录下的纯文件名
        if (typeof f === 'string' && /^[\w.-]+\.(mp3|ogg|wav|m4a)$/i.test(f)) {
          result[name] = f;
        }
      }
    } catch {
      // 缺失或损坏的清单视为空
    }
    return result;
  })();
  return manifestPromise;
}

async function tryLoadMp3Buffer(
  name: SfxName,
  ctx: AudioContext
): Promise<AudioBuffer | null> {
  if (decodedBufferCache.has(name)) {
    return decodedBufferCache.get(name)!;
  }
  if (missingFileSet.has(name)) {
    return null;
  }
  const existingPromise = inflightFetchMap.get(name);
  if (existingPromise) {
    return existingPromise;
  }

  const loadPromise = (async (): Promise<AudioBuffer | null> => {
    try {
      const manifest = await loadManifest();
      const file = manifest[name];
      if (!file) {
        missingFileSet.add(name);
        return null;
      }
      const res = await fetch(SFX_BASE + file);
      if (!res.ok) {
        missingFileSet.add(name);
        return null;
      }
      const raw = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(raw.slice(0));
      decodedBufferCache.set(name, decoded);
      return decoded;
    } catch {
      missingFileSet.add(name);
      return null;
    } finally {
      inflightFetchMap.delete(name);
    }
  })();

  inflightFetchMap.set(name, loadPromise);
  return loadPromise;
}

function playDecodedBuffer(ctx: AudioContext, buffer: AudioBuffer): void {
  try {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.45;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  } catch {
    // ignore playback errors
  }
}

/**
 * WebAudio 合成器回退音效：短促、干净、无外部音频文件依赖
 */
function playSynthesizedSfx(ctx: AudioContext, name: SfxName): void {
  try {
    const now = ctx.currentTime;

    switch (name) {
      case 'hover': {
        // 轻巧高音滴声 (880Hz -> 1320Hz, 35ms)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.035);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.055, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.038);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
        break;
      }

      case 'select': {
        // 利落的刀片游标切换双音 (540Hz -> 810Hz, 55ms)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.setValueAtTime(810, now + 0.022);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.075, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.058);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
        break;
      }

      case 'allow': {
        // MAX 允许：明亮上扬双音确认 (C6 1046.5Hz -> G6 1568Hz, 145ms)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'triangle';
        osc2.type = 'sine';

        osc1.frequency.setValueAtTime(1046.5, now);
        osc1.frequency.setValueAtTime(1567.98, now + 0.055);

        osc2.frequency.setValueAtTime(523.25, now);
        osc2.frequency.setValueAtTime(783.99, now + 0.055);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.095, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.145);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.15);
        osc2.stop(now + 0.15);
        break;
      }

      case 'deny': {
        // LOW 拒绝：克制下行双音 (440Hz -> 293.66Hz, 135ms)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(293.66, now + 0.05);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.065, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.135);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
        break;
      }

      case 'switch': {
        // 队伍换人：柔和清透水花滑音 (D5 587Hz -> A5 880Hz, 115ms)
        const osc = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        sub.type = 'triangle';

        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.095);

        sub.frequency.setValueAtTime(293.66, now);
        sub.frequency.exponentialRampToValueAtTime(440, now + 0.095);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.07, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.115);

        osc.connect(gain);
        sub.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        sub.start(now);
        osc.stop(now + 0.12);
        sub.stop(now + 0.12);
        break;
      }
    }
  } catch {
    // ignore WebAudio synthesis errors
  }
}

export function playSfx(name: SfxName): void {
  if (mutedState) return;
  if (!userGestureUnlocked) return;

  const nowMs =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prevMs = lastPlayedAtMap.get(name) ?? -Infinity;
  if (nowMs - prevMs < DEDUPE_WINDOW_MS) {
    return;
  }
  lastPlayedAtMap.set(name, nowMs);
  playCounts[name] += 1;

  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  const cached = decodedBufferCache.get(name);
  if (cached) {
    playDecodedBuffer(ctx, cached);
    return;
  }

  if (missingFileSet.has(name)) {
    playSynthesizedSfx(ctx, name);
    return;
  }

  void tryLoadMp3Buffer(name, ctx).then((buffer) => {
    if (mutedState) return;
    if (buffer) {
      playDecodedBuffer(ctx, buffer);
    } else {
      playSynthesizedSfx(ctx, name);
    }
  });
}
