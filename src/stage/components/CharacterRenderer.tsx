import React, { useEffect, useRef, useState } from 'react';
import type { ArtManifest } from '../../shared/character-pack';
import type { CharacterTouchZone, Emotion } from '../../shared/stage-events';
import {
  getCachedCharacterPack,
  resolveCharacterAssetUrl,
} from '../characterLoader';
import { notifyUserGesture, playSfx } from '../sfx';
import { getTouchZoneHint, pickTouchStamp } from '../touchReactions';

interface EmotionPosePreset {
  turn: number;
  tilt: number;
  gaze: number;
  eyeL: number;
  eyeR: number;
  mouth: number;
  brow: number;
  body: number;
  shoulder: number;
  wind: number;
}

const LIVE2D_EMOTION_PRESETS: Record<Emotion, EmotionPosePreset> = {
  idle: {
    turn: 0,
    tilt: 0,
    gaze: 0,
    eyeL: 1,
    eyeR: 1,
    mouth: 0.9,
    brow: 0,
    body: 0,
    shoulder: 0,
    wind: 0.35,
  },
  thinking: {
    turn: -4.0,
    tilt: -5.0,
    gaze: -0.6,
    eyeL: 1,
    eyeR: 1,
    mouth: 0.0,
    brow: 0.45,
    body: -0.35,
    shoulder: -0.2,
    wind: 0.28,
  },
  working: {
    turn: 2.5,
    tilt: 2.0,
    gaze: 0.25,
    eyeL: 1,
    eyeR: 1,
    mouth: 0.95,
    brow: 0.65,
    body: 0.4,
    shoulder: 0.85,
    wind: 0.72,
  },
  happy: {
    turn: 1.8,
    tilt: 4.5,
    gaze: 0,
    eyeL: 1,
    eyeR: 1,
    mouth: 1.0,
    brow: 0.85,
    body: 0.35,
    shoulder: 0.9,
    wind: 0.6,
  },
  worried: {
    turn: -2.5,
    tilt: -3.5,
    gaze: -0.4,
    eyeL: 1,
    eyeR: 1,
    mouth: 0.0,
    brow: -0.85,
    body: -0.25,
    shoulder: -0.45,
    wind: 0.25,
  },
  shocked: {
    turn: 0,
    tilt: 1.8,
    gaze: 0,
    eyeL: 1,
    eyeR: 1,
    mouth: 1.0,
    brow: 1.0,
    body: 0.25,
    shoulder: 1.0,
    wind: 0.85,
  },
};

let live2dVendorPromise: Promise<void> | null = null;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-live2d-src="${src}"]`);
    if (existing) {
      if ((existing as HTMLScriptElement).dataset.loaded === 'true') {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.live2dSrc = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
}

function ensureLive2DVendorLoaded(vendorBaseUrl: string): Promise<void> {
  const win = window as unknown as {
    Live2DCubismCore?: unknown;
    PIXI?: { live2d?: { Live2DModel?: unknown } };
  };
  if (win.Live2DCubismCore && win.PIXI?.live2d?.Live2DModel) {
    return Promise.resolve();
  }
  if (!live2dVendorPromise) {
    const candidates = Array.from(
      new Set([vendorBaseUrl, '/vendor/live2d'])
    );
    live2dVendorPromise = (async () => {
      let lastErr: unknown = null;
      for (const base of candidates) {
        try {
          if (!win.Live2DCubismCore) {
            await loadScriptOnce(`${base}/live2dcubismcore.min.js`);
          }
          if (!win.PIXI) {
            await loadScriptOnce(`${base}/pixi.min.js`);
          }
          if (!win.PIXI?.live2d?.Live2DModel) {
            await loadScriptOnce(`${base}/cubism4.min.js`);
          }
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr ?? new Error('Failed to load Live2D vendor scripts');
    })().catch((err) => {
      live2dVendorPromise = null;
      throw err;
    });
  }
  return live2dVendorPromise;
}

function resolveTouchZoneFromRatio(
  rx: number,
  ry: number
): CharacterTouchZone {
  if (ry < 0.24) return 'head';
  if (ry < 0.42) return 'face';
  if (ry <= 0.78) {
    if (rx < 0.34 || rx > 0.66) return 'prop';
    return 'body';
  }
  return rx < 0.3 || rx > 0.7 ? 'prop' : 'body';
}

interface TouchStampItem {
  id: number;
  x: number;
  y: number;
  text: string;
  zone: CharacterTouchZone;
}

const AMBIENT_SPARK_SEEDS = [
  { left: '16%', bottom: '18%', delay: '0s', dur: '4.2s', size: '8px' },
  { left: '78%', bottom: '24%', delay: '0.8s', dur: '3.7s', size: '10px' },
  { left: '24%', bottom: '52%', delay: '1.5s', dur: '4.6s', size: '7px' },
  { left: '84%', bottom: '58%', delay: '2.1s', dur: '3.9s', size: '9px' },
  { left: '12%', bottom: '36%', delay: '2.7s', dur: '4.4s', size: '6px' },
  { left: '72%', bottom: '72%', delay: '1.2s', dur: '4.1s', size: '8px' },
];

export interface CharacterRendererProps {
  characterId: string;
  characterName: string;
  codename: string;
  art: ArtManifest;
  emotion: Emotion;
  emotionSwitchKey: number;
  characterSwitchKey: number;
  breathing?: boolean;
  talking?: boolean;
  onTouchZone?: (zone: CharacterTouchZone) => void;
}

export const CharacterRenderer: React.FC<CharacterRendererProps> = ({
  characterId,
  characterName,
  codename,
  art,
  emotion,
  emotionSwitchKey,
  characterSwitchKey,
  breathing = false,
  talking = false,
  onTouchZone,
}) => {
  const [fallbackToIdle, setFallbackToIdle] = useState(false);
  const [live2dReady, setLive2dReady] = useState(false);
  const [live2dError, setLive2dError] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<CharacterTouchZone | null>(null);
  const [joltActive, setJoltActive] = useState<boolean>(false);
  const [stamps, setStamps] = useState<TouchStampItem[]>([]);

  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emotionRef = useRef<Emotion>(emotion);
  const breathingRef = useRef<boolean>(breathing);
  const talkingRef = useRef<boolean>(talking);
  const joltTimerRef = useRef<number | null>(null);
  const stampTimersRef = useRef<Set<number>>(new Set());

  emotionRef.current = emotion;
  breathingRef.current = breathing;
  talkingRef.current = talking;

  useEffect(() => {
    setFallbackToIdle(false);
  }, [characterId, emotion, art]);

  // Procedural syllable --voice-amp pulse when typewriter talking is active
  useEffect(() => {
    if (!talking) {
      if (stageWrapRef.current) {
        stageWrapRef.current.style.setProperty('--voice-amp', '0');
      }
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const t = now / 1000;
      const amp =
        0.22 +
        0.5 * Math.abs(Math.sin(t * 9.8) * Math.cos(t * 3.9)) +
        0.12 * Math.abs(Math.sin(t * 16.5));
      stageWrapRef.current?.style.setProperty(
        '--voice-amp',
        Math.min(0.92, amp).toFixed(3)
      );
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      if (stageWrapRef.current) {
        stageWrapRef.current.style.setProperty('--voice-amp', '0');
      }
    };
  }, [talking]);

  useEffect(() => {
    return () => {
      if (joltTimerRef.current !== null) {
        window.clearTimeout(joltTimerRef.current);
      }
      for (const t of stampTimersRef.current) {
        window.clearTimeout(t);
      }
      stampTimersRef.current.clear();
    };
  }, []);

  const handleFramePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = stageWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const nx = rx * 2 - 1;
    const ny = ry * 2 - 1;

    el.style.setProperty('--tilt-rx', `${(-ny * 3.5).toFixed(2)}deg`);
    el.style.setProperty('--tilt-ry', `${(nx * 3.5).toFixed(2)}deg`);
    el.style.setProperty('--shift-x', `${(nx * 6.5).toFixed(1)}px`);
    el.style.setProperty('--shift-y', `${(ny * 3.5).toFixed(1)}px`);
    el.style.setProperty('--rim-x', `${(-nx * 8.5).toFixed(1)}px`);
    el.style.setProperty('--rim-y', `${(6 - ny * 4.5).toFixed(1)}px`);

    const nextZone = resolveTouchZoneFromRatio(rx, ry);
    setHoverZone((prev) => (prev === nextZone ? prev : nextZone));
  };

  const handleFramePointerLeave = () => {
    const el = stageWrapRef.current;
    if (el) {
      el.style.setProperty('--tilt-rx', '0deg');
      el.style.setProperty('--tilt-ry', '0deg');
      el.style.setProperty('--shift-x', '0px');
      el.style.setProperty('--shift-y', '0px');
      el.style.setProperty('--rim-x', '-4px');
      el.style.setProperty('--rim-y', '6px');
    }
    setHoverZone(null);
  };

  const handleFrameClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = stageWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const rx = Math.max(0, Math.min(1, clickX / rect.width));
    const ry = Math.max(0, Math.min(1, clickY / rect.height));
    const zone = resolveTouchZoneFromRatio(rx, ry);

    notifyUserGesture();
    playSfx('select');

    // Trigger snappy spring squish/jolt
    setJoltActive(false);
    if (joltTimerRef.current !== null) {
      window.clearTimeout(joltTimerRef.current);
    }
    window.requestAnimationFrame(() => {
      setJoltActive(true);
      joltTimerRef.current = window.setTimeout(() => {
        joltTimerRef.current = null;
        setJoltActive(false);
      }, 380);
    });

    // Spawn 900ms P5 comic onomatopoeia stamp right at click coordinates
    const stampId = Date.now() + Math.floor(Math.random() * 1000);
    const stampText = pickTouchStamp(characterId, zone);
    setStamps((prev) => [
      ...prev.slice(-4),
      { id: stampId, x: clickX, y: clickY, text: stampText, zone },
    ]);
    const removeTimer = window.setTimeout(() => {
      stampTimersRef.current.delete(removeTimer);
      setStamps((prev) => prev.filter((s) => s.id !== stampId));
    }, 900);
    stampTimersRef.current.add(removeTimer);

    onTouchZone?.(zone);
  };

  useEffect(() => {
    if (art.renderer !== 'live2d') return;
    const wrap = stageWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const rawModel3Url =
      resolveCharacterAssetUrl(characterId, art.model3) ?? art.model3;
    const model3Url = `${rawModel3Url}${rawModel3Url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const vendorBaseUrl = `/characters/${characterId}/art/live2d/vendor`;

    let disposed = false;
    let pixiApp: {
      screen: { width: number; height: number };
      stage: { addChild: (child: unknown) => void };
      destroy: (removeView?: boolean, stageOptions?: unknown) => void;
    } | null = null;
    let resizeObs: ResizeObserver | null = null;

    setLive2dReady(false);
    setLive2dError(null);

    const mouseTarget = { x: 0, y: 0 };
    const handlePointerMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      mouseTarget.x = Math.max(-1, Math.min(1, nx));
      mouseTarget.y = Math.max(-1, Math.min(1, ny));
    };

    const handlePointerLeave = () => {
      mouseTarget.x = 0;
      mouseTarget.y = 0;
    };
    wrap.addEventListener('pointermove', handlePointerMove);
    wrap.addEventListener('pointerleave', handlePointerLeave);

    void (async () => {
      try {
        await ensureLive2DVendorLoaded(vendorBaseUrl);
        if (disposed) return;

        const PIXI = (window as unknown as {
          PIXI: {
            Application: new (opts: Record<string, unknown>) => typeof pixiApp;
            live2d: {
              Live2DModel: {
                from: (
                  url: string,
                  opts?: Record<string, unknown>
                ) => Promise<{
                  scale: { set: (s: number) => void };
                  position: { set: (x: number, y: number) => void };
                  internalModel: {
                    width: number;
                    height: number;
                    updateNaturalMovements: () => void;
                    updateFocus: () => void;
                    motionManager?: { stopAllMotions: () => void };
                    coreModel: {
                      setParameterValueById: (id: string, val: number) => void;
                    };
                    on: (event: string, fn: () => void) => void;
                  };
                  destroy: () => void;
                }>;
              };
            };
          };
        }).PIXI;

        const app = new PIXI.Application({
          view: canvas,
          resizeTo: wrap,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });
        pixiApp = app;

        const model = await PIXI.live2d.Live2DModel.from(model3Url, {
          autoInteract: false,
        });
        if (disposed || !app) {
          model.destroy();
          return;
        }

        app.stage.addChild(model);
        model.internalModel.updateNaturalMovements = () => {};
        model.internalModel.updateFocus = () => {};
        model.internalModel.motionManager?.stopAllMotions();

        const natW = model.internalModel.width || 1145;
        const natH = model.internalModel.height || 1374;
        const contentW = 1020;
        const contentH = 1360;
        const contentCenterX = 574;
        const fit = () => {
          if (!app) return;
          const scale = Math.max(
            app.screen.width / contentW,
            app.screen.height / contentH
          );
          model.scale.set(scale);
          const posX = app.screen.width / 2 - contentCenterX * scale;
          const minBottomY = app.screen.height - natH * scale;
          const topAnchorY = -6 * scale;
          const posY = Math.max(minBottomY, topAnchorY);
          model.position.set(posX, posY);
        };
        fit();
        resizeObs = new ResizeObserver(fit);
        resizeObs.observe(wrap);

        const smooth: Record<string, number> = {};
        const springs = [
          { x: 0, v: 0 },
          { x: 0, v: 0 },
          { x: 0, v: 0 },
        ];
        const startTime = performance.now();
        let lastTime = startTime;

        const updateLive2D = () => {
          const now = performance.now();
          const t = now / 1000;
          const it = (now - startTime) / 1000;
          const dt = Math.min(0.1, (now - lastTime) / 1000);
          lastTime = now;

          const preset =
            LIVE2D_EMOTION_PRESETS[emotionRef.current] ??
            LIVE2D_EMOTION_PRESETS.idle;
          const isActiveTurn = breathingRef.current;

          const idleWave =
            Math.sin(it * (isActiveTurn ? 1.5 : 0.9)) * 0.6 +
            Math.sin(it * 0.41) * 0.4;
          const breathCycle =
            (1 - Math.cos((it * 2 * Math.PI) / (isActiveTurn ? 2.6 : 4.2))) / 2;

          let eyeL = preset.eyeL;
          let eyeR = preset.eyeR;
          const blinkPeriod = it % 4.2;
          if (blinkPeriod > 4.0) {
            const bp = blinkPeriod - 4.0; // 0 .. 0.20s crisp natural blink
            let blinkFactor = 1.0;
            if (bp < 0.06) {
              blinkFactor = 1.0 - bp / 0.06;
            } else if (bp < 0.12) {
              blinkFactor = 0.0;
            } else {
              blinkFactor = Math.min(1.0, (bp - 0.12) / 0.08);
            }
            eyeL *= blinkFactor;
            eyeR *= blinkFactor;
          }

          let mouthVal = preset.mouth;
          if (talkingRef.current) {
            const maxOpen =
              emotionRef.current === 'worried' || emotionRef.current === 'thinking'
                ? 0.55
                : 1.0;
            mouthVal = Math.max(
              0.05,
              Math.min(
                maxOpen,
                0.5 +
                  0.45 * Math.sin(t * 10.5) * Math.cos(t * 4.1) +
                  0.15 * Math.sin(t * 17.0)
              )
            );
          }

          const targets: Record<string, number> = {
            ParamAngleX: Math.max(
              -8,
              Math.min(8, preset.turn + idleWave * 3.0 + mouseTarget.x * 4.5)
            ),
            ParamAngleZ: Math.max(
              -10,
              Math.min(10, preset.tilt + idleWave * 2.4 + mouseTarget.x * 2.5)
            ),
            ParamEyeBallX: Math.max(
              -1,
              Math.min(1, preset.gaze + mouseTarget.x * 0.75)
            ),
            ParamEyeLOpen: eyeL,
            ParamEyeROpen: eyeR,
            ParamMouthOpenY: mouthVal,
            ParamBrowLY: preset.brow,
            ParamBrowRY:
              emotionRef.current === 'thinking' ? -preset.brow * 0.8 : preset.brow,
            ParamBreath: breathCycle,
            ParamBodySway: Math.max(
              -1,
              Math.min(1, preset.body + idleWave * 0.28 + mouseTarget.x * 0.2)
            ),
            ParamShoulderLift: Math.max(
              -1,
              Math.min(
                1,
                preset.shoulder +
                  breathCycle * 0.32 +
                  Math.sin(it * 2.1) * 0.18
              )
            ),
          };

          const core = model.internalModel.coreModel;
          for (const [id, val] of Object.entries(targets)) {
            if (id === 'ParamEyeLOpen' || id === 'ParamEyeROpen') {
              smooth[id] = val;
              core.setParameterValueById(id, val);
              continue;
            }
            const tau =
              id.includes('Eye') || id === 'ParamMouthOpenY' ? 0.035 : 0.12;
            if (smooth[id] === undefined) {
              smooth[id] = val;
            } else {
              smooth[id] += (val - smooth[id]) * (1 - Math.exp(-dt / tau));
            }
            core.setParameterValueById(id, smooth[id]);
          }

          const wind = preset.wind;
          const headImpulse =
            (smooth.ParamAngleX || 0) * 0.045 +
            (smooth.ParamAngleZ || 0) * 0.035;
          const gust =
            wind * (0.35 * Math.sin(t * 1.4) + 0.2 * Math.sin(t * 2.3 + 0.8));
          const physicsIds = [
            'ParamHairSwing',
            'ParamHairRight',
            'ParamHairFront',
          ];
          for (let i = 0; i < 3; i++) {
            const s = springs[i];
            const target =
              headImpulse * [1.0, 0.9, 1.35][i] +
              gust * [1.0, -0.85, 1.2][i];
            const stiffness = [18, 16, 24][i];
            const damping = [6.5, 6.2, 5.5][i];
            s.v += (stiffness * (target - s.x) - damping * s.v) * dt;
            s.x = Math.max(-1, Math.min(1, s.x + s.v * dt));
            core.setParameterValueById(physicsIds[i], s.x);
          }
        };

        model.internalModel.on('beforeModelUpdate', updateLive2D);
        setLive2dReady(true);
      } catch (err) {
        if (!disposed) {
          setLive2dError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      disposed = true;
      wrap.removeEventListener('pointermove', handlePointerMove);
      wrap.removeEventListener('pointerleave', handlePointerLeave);
      resizeObs?.disconnect();
      if (pixiApp) {
        try {
          pixiApp.destroy(false, { children: true });
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, [art, characterId]);

  const pack = getCachedCharacterPack(characterId);
  const isSpeakingNow = talking;
  const zoneHintText = hoverZone ? getTouchZoneHint(pack, hoverZone) : null;

  const renderStageOverlays = () => (
    <>
      {/* Ambient character-themed floating particles/sparks */}
      <div className="p5-portrait-sparks" aria-hidden="true">
        {AMBIENT_SPARK_SEEDS.map((seed, idx) => (
          <span
            key={idx}
            className="p5-portrait-spark"
            style={
              {
                left: seed.left,
                bottom: seed.bottom,
                width: seed.size,
                height: seed.size,
                animationDelay: seed.delay,
                animationDuration: seed.dur,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Reactive speaking glow ring driven by --voice-amp */}
      <div
        className={`p5-portrait-voice-aura ${
          isSpeakingNow ? 'is-speaking' : ''
        } ${breathing ? 'is-active-turn' : ''}`}
        aria-hidden="true"
      />

      {/* Floating soundwave / star equalizer bars near collar/cheek when speaking */}
      {isSpeakingNow && (
        <div
          className="p5-voice-eq-badge"
          data-testid="character-voice-equalizer"
          aria-hidden="true"
        >
          <span className="p5-voice-eq-star">★</span>
          <span className="p5-voice-eq-bar bar-1" />
          <span className="p5-voice-eq-bar bar-2" />
          <span className="p5-voice-eq-bar bar-3" />
          <span className="p5-voice-eq-bar bar-4" />
          <span className="p5-voice-eq-bar bar-5" />
        </div>
      )}

      {/* Subtle hit-zone prompt tag on hover */}
      {zoneHintText && (
        <div className="p5-touch-zone-hint" aria-hidden="true">
          ✦ {zoneHintText}
        </div>
      )}

      {/* Floating P5 comic onomatopoeia stamps at click coordinates */}
      {stamps.map((s) => (
        <div
          key={s.id}
          className={`p5-touch-stamp zone-${s.zone}`}
          data-testid="character-touch-stamp"
          style={{ left: `${s.x}px`, top: `${s.y}px` }}
          aria-hidden="true"
        >
          <span>{s.text}</span>
        </div>
      ))}
    </>
  );

  if (art.renderer === 'live2d') {
    const model3Url =
      resolveCharacterAssetUrl(characterId, art.model3) ?? art.model3;
    const portraitUrl = resolveCharacterAssetUrl(characterId, art.portrait);
    const activeExpression =
      art.expressions[emotion] ?? art.expressions.idle ?? 'default';
    const activeMotion = art.motions[emotion] ??
      art.motions.idle ?? { group: 'Idle', index: 0 };

    return (
      <div
        ref={stageWrapRef}
        key={`live2d_${characterId}_${characterSwitchKey}`}
        className={`p5-portrait-art-wrap p5-portrait-bounce p5-live2d-placeholder ${
          breathing ? 'p5-portrait-breathing' : ''
        } ${isSpeakingNow ? 'is-speaking' : ''} ${
          joltActive ? 'is-touch-jolt' : ''
        }`}
        data-testid="live2d-placeholder-card"
        data-live2d-status={live2dError ? 'error' : live2dReady ? 'ready' : 'loading'}
        data-character-id={characterId}
        data-emotion={emotion}
        data-model3={model3Url}
        data-expression={activeExpression}
        data-motion-group={activeMotion.group}
        data-motion-index={activeMotion.index ?? 0}
        style={{ position: 'relative', width: '100%', height: '100%' }}
        onPointerMove={handleFramePointerMove}
        onPointerLeave={handleFramePointerLeave}
        onClick={handleFrameClick}
      >
        {renderStageOverlays()}
        <canvas
          ref={canvasRef}
          data-testid="character-portrait"
          role="img"
          aria-label={`${characterName} Live2D`}
          style={{
            width: '100%',
            height: '100%',
            display: live2dError ? 'none' : 'block',
          }}
        />
        {!live2dReady && (
          <div
            className="p5-live2d-card"
            style={{ position: 'absolute', inset: 'auto' }}
          >
            <div className="p5-live2d-badge">
              {live2dError ? 'LIVE2D // 加载失败' : 'LIVE2D // 正在加载模型…'}
            </div>
            {portraitUrl && (
              <img
                src={portraitUrl}
                alt={characterName}
                className="p5-live2d-thumb"
              />
            )}
            <div className="p5-live2d-title">{characterName}</div>
            <div className="p5-live2d-sub">{codename}</div>
            <div className="p5-live2d-meta">
              <div>
                MODEL3: <code>{model3Url}</code>
              </div>
              <div>
                EXP: <code>{activeExpression}</code> · MOTION:{' '}
                <code>
                  {activeMotion.group}[{activeMotion.index ?? 0}]
                </code>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // renderer === 'sprites'
  const idleUrl =
    resolveCharacterAssetUrl(characterId, art.emotions.idle) ??
    `/characters/${characterId}/art/idle.png`;
  const targetRel = fallbackToIdle
    ? art.emotions.idle
    : art.emotions[emotion] ?? art.emotions.idle;
  const spriteUrl =
    resolveCharacterAssetUrl(characterId, targetRel) ?? idleUrl;

  return (
    <div
      ref={stageWrapRef}
      key={`${characterSwitchKey}_${emotionSwitchKey}`}
      className={`p5-portrait-art-wrap p5-portrait-bounce p5-char-switch-anim emotion-${emotion} ${
        breathing ? 'p5-portrait-breathing' : ''
      } ${isSpeakingNow ? 'is-speaking' : ''}`}
      data-character-id={characterId}
      data-emotion={emotion}
      onPointerMove={handleFramePointerMove}
      onPointerLeave={handleFramePointerLeave}
      onClick={handleFrameClick}
    >
      {renderStageOverlays()}
      <div className="p5-portrait-parallax-rig">
        <div className="p5-portrait-breath-rig">
          <div
            className={`p5-portrait-voice-rig ${
              joltActive ? 'is-touch-jolt' : ''
            }`}
          >
            <img
              src={spriteUrl}
              alt={`${characterName} - ${emotion}`}
              className="p5-portrait-img"
              data-testid="character-portrait"
              draggable={false}
              onError={() => {
                if (!fallbackToIdle && spriteUrl !== idleUrl) {
                  setFallbackToIdle(true);
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
