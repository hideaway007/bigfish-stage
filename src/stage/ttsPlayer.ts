import React, { useEffect, useState } from 'react';
import { notifyUserGesture, playSfx } from './sfx';

const TTS_MUTE_STORAGE_KEY = 'p5_tts_muted';

export interface TtsAmplitudeState {
  speaking: boolean;
  characterId: string | null;
  lineId?: string;
  amplitude: number;
}

export interface IncomingTtsAudioFrame {
  characterId: string;
  lineId?: string;
  text?: string;
  audioBase64: string;
  mimeType: string;
  error?: string;
}

type AmplitudeListener = (state: TtsAmplitudeState) => void;
type TtsMuteListener = (muted: boolean) => void;

function readStoredTtsMuted(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TTS_MUTE_STORAGE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredTtsMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TTS_MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

let ttsMuted: boolean = readStoredTtsMuted() ?? true;
const muteListeners = new Set<TtsMuteListener>();
const amplitudeListeners = new Set<AmplitudeListener>();

let currentState: TtsAmplitudeState = {
  speaking: false,
  characterId: null,
  amplitude: 0,
};

let ttsAudioCtx: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let activeGain: GainNode | null = null;
let activeAnalyser: AnalyserNode | null = null;
let rafHandle: number | null = null;
let playbackSeq = 0;
let lastSampleMs = 0;
let smoothedAmp = 0;

function emitAmplitude(next: TtsAmplitudeState): void {
  currentState = next;
  for (const cb of amplitudeListeners) {
    cb(next);
  }
}

function getOrCreateTtsAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ttsAudioCtx) {
    if (ttsAudioCtx.state === 'suspended') {
      void ttsAudioCtx.resume().catch(() => {});
    }
    return ttsAudioCtx;
  }
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ttsAudioCtx = new Ctor();
    if (ttsAudioCtx.state === 'suspended') {
      void ttsAudioCtx.resume().catch(() => {});
    }
    return ttsAudioCtx;
  } catch {
    return null;
  }
}

// Unlock singleton TTS AudioContext on first user interaction
if (typeof window !== 'undefined') {
  const unlockTts = () => {
    if (ttsAudioCtx && ttsAudioCtx.state === 'suspended') {
      void ttsAudioCtx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', unlockTts, {
    capture: true,
    passive: true,
  });
  window.addEventListener('keydown', unlockTts, {
    capture: true,
    passive: true,
  });
}

export function hasStoredTtsMutePreference(): boolean {
  return readStoredTtsMuted() !== null;
}

export function isTtsMuted(): boolean {
  return ttsMuted;
}

export function setTtsMuted(nextMuted: boolean, persist = true): void {
  const normalized = Boolean(nextMuted);
  if (persist) {
    writeStoredTtsMuted(normalized);
  }
  if (ttsMuted === normalized) {
    if (normalized) stopTtsPlayback();
    return;
  }
  ttsMuted = normalized;
  if (normalized) {
    stopTtsPlayback();
  }
  for (const cb of muteListeners) {
    cb(ttsMuted);
  }
}

export function syncTtsFromServerEnabled(serverEnabled: boolean): void {
  // If user never explicitly clicked local mute yet, follow server setting;
  // or when server setting explicitly changes during session, keep UI synced.
  setTtsMuted(!serverEnabled, true);
}

export function toggleTtsMuted(): boolean {
  const next = !ttsMuted;
  setTtsMuted(next, true);
  if (!next) {
    notifyUserGesture();
    playSfx('select');
  }
  return next;
}

export function subscribeTtsMuted(cb: TtsMuteListener): () => void {
  muteListeners.add(cb);
  return () => {
    muteListeners.delete(cb);
  };
}

export function getTtsAmplitudeState(): TtsAmplitudeState {
  return currentState;
}

export function subscribeTtsAmplitude(cb: AmplitudeListener): () => void {
  amplitudeListeners.add(cb);
  cb(currentState);
  return () => {
    amplitudeListeners.delete(cb);
  };
}

export function stopTtsPlayback(): void {
  playbackSeq += 1;
  if (rafHandle !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (activeSource) {
    try {
      activeSource.onended = null;
      activeSource.stop();
    } catch {
      // ignore already stopped node
    }
    try {
      activeSource.disconnect();
    } catch {
      // ignore
    }
    activeSource = null;
  }
  if (activeGain) {
    try {
      activeGain.disconnect();
    } catch {
      // ignore
    }
    activeGain = null;
  }
  if (activeAnalyser) {
    try {
      activeAnalyser.disconnect();
    } catch {
      // ignore
    }
    activeAnalyser = null;
  }
  smoothedAmp = 0;
  if (currentState.speaking || currentState.amplitude !== 0) {
    emitAmplitude({
      speaking: false,
      characterId: null,
      amplitude: 0,
    });
  }
}

function decodeBase64ToArrayBuffer(rawBase64: string): ArrayBuffer {
  const commaIdx = rawBase64.indexOf(',');
  const clean = (commaIdx >= 0 ? rawBase64.slice(commaIdx + 1) : rawBase64).replace(
    /\s+/g,
    ''
  );
  const binary = window.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function playTtsAudioFrame(
  frame: IncomingTtsAudioFrame
): Promise<void> {
  if (ttsMuted) return;
  if (frame.error || !frame.audioBase64) return;

  // Cancel any previous line cleanly before starting the new one
  stopTtsPlayback();
  const mySeq = ++playbackSeq;

  const ctx = getOrCreateTtsAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    const rawBuf = decodeBase64ToArrayBuffer(frame.audioBase64);
    const audioBuffer = await ctx.decodeAudioData(rawBuf.slice(0));
    if (mySeq !== playbackSeq || ttsMuted) {
      return;
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.45;
    gain.gain.value = 0.92;

    source.buffer = audioBuffer;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    activeSource = source;
    activeGain = gain;
    activeAnalyser = analyser;
    smoothedAmp = 0.18;
    lastSampleMs = 0;

    const floatBuf = new Float32Array(analyser.fftSize);
    const byteBuf = new Uint8Array(analyser.fftSize);

    emitAmplitude({
      speaking: true,
      characterId: frame.characterId,
      lineId: frame.lineId,
      amplitude: 0.18,
    });

    const sampleLoop = (now: number) => {
      if (mySeq !== playbackSeq || !activeAnalyser) return;
      // Sample RMS at ~30fps (~33ms)
      if (now - lastSampleMs >= 32) {
        lastSampleMs = now;
        let sumSq = 0;
        if (typeof activeAnalyser.getFloatTimeDomainData === 'function') {
          activeAnalyser.getFloatTimeDomainData(floatBuf);
          for (let i = 0; i < floatBuf.length; i += 1) {
            const v = floatBuf[i];
            sumSq += v * v;
          }
          sumSq /= floatBuf.length;
        } else {
          activeAnalyser.getByteTimeDomainData(byteBuf);
          for (let i = 0; i < byteBuf.length; i += 1) {
            const v = (byteBuf[i] - 128) / 128;
            sumSq += v * v;
          }
          sumSq /= byteBuf.length;
        }
        const rms = Math.sqrt(sumSq);
        const normalized = Math.min(1, Math.max(0, (rms - 0.008) * 4.4));
        // Fast attack, smooth release for crisp lip-sync
        const alpha = normalized > smoothedAmp ? 0.62 : 0.36;
        smoothedAmp = smoothedAmp + (normalized - smoothedAmp) * alpha;

        emitAmplitude({
          speaking: true,
          characterId: frame.characterId,
          lineId: frame.lineId,
          amplitude: Number(smoothedAmp.toFixed(3)),
        });
      }
      rafHandle = window.requestAnimationFrame(sampleLoop);
    };

    source.onended = () => {
      if (mySeq !== playbackSeq) return;
      stopTtsPlayback();
    };

    source.start(0);
    rafHandle = window.requestAnimationFrame(sampleLoop);
  } catch {
    if (mySeq === playbackSeq) {
      stopTtsPlayback();
    }
  }
}

/**
 * 为 ?demo=1 离线剧本演示生成一段轻柔悦耳的角色音高韵律短语音 WAV (Base64)，
 * 让试听按钮与口型振幅驱动在无后端的纯演示模式下也能真实走通 Web Audio AnalyserNode！
 */
export function buildDemoVoicePreviewWavBase64(
  characterId: string,
  textLength = 16
): string {
  const sampleRate = 16000;
  const syllables = Math.max(4, Math.min(10, Math.round(textLength / 3)));
  const durationSec = Math.min(1.6, 0.22 + syllables * 0.13);
  const numSamples = Math.floor(sampleRate * durationSec);

  const baseFreqMap: Record<string, number> = {
    'deepseek-v4-pro': 392.0, // G4 元气清亮
    'gemini-4-argon': 440.0, // A4 甜酷灵动
    'claude-opus-5-5': 329.63, // E4 温柔知性
    'codex-dragon': 293.66, // D4 轻柔困倦
  };
  const baseFreq = baseFreqMap[characterId] ?? 370.0;
  const intervals = [1.0, 1.125, 1.25, 1.125, 1.333, 1.25, 1.0];

  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  const sylDur = durationSec / syllables;
  let phase = 0;
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const sylIdx = Math.min(syllables - 1, Math.floor(t / sylDur));
    const localT = (t - sylIdx * sylDur) / sylDur;
    const env =
      Math.sin(Math.PI * Math.min(1, localT * 1.12)) *
      (localT < 0.86 ? 1 : Math.max(0, (1 - localT) / 0.14));
    const freq =
      baseFreq *
      intervals[sylIdx % intervals.length] *
      (1 + 0.012 * Math.sin(t * 28));
    phase += (2 * Math.PI * freq) / sampleRate;
    // Soft warm harmonic blend
    const wave =
      (0.68 * Math.sin(phase) +
        0.22 * Math.sin(phase * 2) +
        0.1 * Math.sin(phase * 3)) *
      env *
      0.22;
    const clamped = Math.max(-1, Math.min(1, wave));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let bin = '';
  const chunkSize = 4096;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return typeof window !== 'undefined' ? window.btoa(bin) : '';
}

export interface TtsMuteButtonProps {
  onToggleServerSync?: (enabled: boolean) => void;
}

export const TtsMuteButton: React.FC<TtsMuteButtonProps> = ({
  onToggleServerSync,
}) => {
  const [muted, setMuted] = useState<boolean>(isTtsMuted);
  const [speaking, setSpeaking] = useState<boolean>(
    () => getTtsAmplitudeState().speaking
  );

  useEffect(() => {
    const unsubMute = subscribeTtsMuted(setMuted);
    const unsubAmp = subscribeTtsAmplitude((st) => setSpeaking(st.speaking));
    return () => {
      unsubMute();
      unsubAmp();
    };
  }, []);

  return React.createElement(
    'button',
    {
      type: 'button',
      className: `p5-pill-btn p5-tts-toggle-btn ${
        muted ? 'is-muted' : 'is-unmuted'
      } ${speaking && !muted ? 'is-speaking' : ''}`,
      'data-testid': 'tts-mute-btn',
      'aria-pressed': muted,
      'aria-label': muted ? '开启角色语音播报' : '关闭角色语音播报',
      title:
        muted
          ? '角色语音已关闭（点击开启实时 TTS 语音播报）'
          : '角色语音已开启（点击静音角色 TTS 语音）',
      onClick: () => {
        notifyUserGesture();
        const nextMuted = toggleTtsMuted();
        onToggleServerSync?.(!nextMuted);
      },
    },
    React.createElement('span', null, muted ? '🔇 语音关' : '🔊 语音')
  );
};
