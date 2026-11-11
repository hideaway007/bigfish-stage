/**
 * 舞台音效模块 (`src/stage/sfx.ts`)
 *
 * 真实音频由 `public/sfx/manifest.json` 声明：首次播放时只请求一次清单，
 * 清单里列出的文件会被加载并缓存到 WebAudio AudioBuffer 中，
 * 若未加载完成则使用 WebAudio 合成器即时发声。
 */

export type SfxName =
  | 'hover'
  | 'select'
  | 'allow'
  | 'deny'
  | 'switch'
  | 'send'
  | 'type'
  | 'complete'
  | 'compaction';

export const SFX_NAMES: SfxName[] = [
  'hover',
  'select',
  'allow',
  'deny',
  'switch',
  'send',
  'type',
  'complete',
  'compaction',
];

const SFX_BASE = '/sfx/';
const SFX_MANIFEST_URL = '/sfx/manifest.json?v=3';
const SFX_CACHE_BUSTER = '?v=3';

const MUTE_STORAGE_KEY = 'p5_stage_sfx_muted';
const DEDUPE_WINDOW_MS = 38;

const GAIN_BY_SFX: Record<SfxName, number> = {
  hover: 0.28,
  select: 0.52,
  allow: 0.58,
  deny: 0.52,
  switch: 0.62,
  send: 0.62,
  type: 0.26,
  complete: 0.6,
  compaction: 0.62,
};

type MuteListener = (muted: boolean) => void;

let mutedState: boolean = readInitialMuted();
const muteListeners = new Set<MuteListener>();

let userGestureUnlocked = false;
let audioCtx: AudioContext | null = null;
let preloadedAll = false;

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
  send: 0,
  type: 0,
  complete: 0,
  compaction: 0,
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

function preloadAllBuffers(ctx: AudioContext): void {
  if (preloadedAll) return;
  preloadedAll = true;
  for (const name of SFX_NAMES) {
    void tryLoadMp3Buffer(name, ctx);
  }
}

export function notifyUserGesture(): void {
  userGestureUnlocked = true;
  const ctx = getOrCreateAudioContext();
  if (ctx) {
    preloadAllBuffers(ctx);
  }
}

function attachGlobalGestureUnlock(): void {
  if (typeof window === 'undefined') return;

  const unlock = () => {
    userGestureUnlocked = true;
    const ctx = getOrCreateAudioContext();
    if (ctx) {
      preloadAllBuffers(ctx);
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

  // Global automatic UI button click & hover SFX
  window.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest('button, a');
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      const testId = btn.getAttribute('data-testid') || '';
      if (testId === 'sfx-mute-btn') return;
      if (testId === 'stage-send-btn') {
        playSfx('send');
        return;
      }
      if (testId === 'trigger-compaction-btn') {
        playSfx('compaction');
        return;
      }
      if (testId.startsWith('party-member-') || testId.startsWith('char-card-')) {
        return; // SwitchTransition plays 'switch'
      }
      playSfx('select');
    },
    { capture: true, passive: true }
  );

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
        if (typeof f === 'string' && /^[\w.-]+\.(mp3|ogg|wav|m4a)$/i.test(f)) {
          result[name] = f;
        }
      }
    } catch {
      // ignore
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
      const res = await fetch(SFX_BASE + file + SFX_CACHE_BUSTER);
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

function playDecodedBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  name: SfxName
): void {
  try {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = GAIN_BY_SFX[name] ?? 0.5;
    if (name === 'type') {
      // Subtle JRPG dialogue pitch variation so speech blips sound lively and organic
      source.playbackRate.value = 0.94 + Math.random() * 0.14;
    } else if (name === 'hover') {
      source.playbackRate.value = 0.98 + Math.random() * 0.05;
    }
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  } catch {
    // ignore playback errors
  }
}

function playSynthesizedSfx(ctx: AudioContext, name: SfxName): void {
  try {
    const now = ctx.currentTime;

    switch (name) {
      case 'hover':
      case 'type': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(name === 'type' ? 660 : 880, now);
        osc.frequency.exponentialRampToValueAtTime(
          name === 'type' ? 920 : 1320,
          now + 0.028
        );

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(
          name === 'type' ? 0.04 : 0.055,
          now + 0.005
        );
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.032);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
        break;
      }

      case 'select':
      case 'send': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.setValueAtTime(860, now + 0.022);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.11, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.065);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
        break;
      }

      case 'allow':
      case 'complete':
      case 'compaction': {
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
        gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.16);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.165);
        osc2.stop(now + 0.165);
        break;
      }

      case 'deny': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(293.66, now + 0.05);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.085, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.135);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
        break;
      }

      case 'switch': {
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
        gain.gain.linearRampToValueAtTime(0.11, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.125);

        osc.connect(gain);
        sub.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        sub.start(now);
        osc.stop(now + 0.13);
        sub.stop(now + 0.13);
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
  const dedupeMs = name === 'type' ? 55 : DEDUPE_WINDOW_MS;
  if (nowMs - prevMs < dedupeMs) {
    return;
  }
  lastPlayedAtMap.set(name, nowMs);
  playCounts[name] = (playCounts[name] ?? 0) + 1;

  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  const cached = decodedBufferCache.get(name);
  if (cached) {
    playDecodedBuffer(ctx, cached, name);
    return;
  }

  if (missingFileSet.has(name)) {
    playSynthesizedSfx(ctx, name);
    return;
  }

  // Play synth immediately on first hit while MP3 decodes into cache
  playSynthesizedSfx(ctx, name);
  void tryLoadMp3Buffer(name, ctx);
}
