import React, { useEffect, useRef, useState } from 'react';
import type { ArtManifest } from '../../shared/character-pack';
import type { Emotion } from '../../shared/stage-events';
import { resolveCharacterAssetUrl } from '../characterLoader';

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
    live2dVendorPromise = (async () => {
      await loadScriptOnce(`${vendorBaseUrl}/live2dcubismcore.min.js`);
      await loadScriptOnce(`${vendorBaseUrl}/pixi.min.js`);
      await loadScriptOnce(`${vendorBaseUrl}/cubism4.min.js`);
    })().catch((err) => {
      live2dVendorPromise = null;
      throw err;
    });
  }
  return live2dVendorPromise;
}

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
}) => {
  const [fallbackToIdle, setFallbackToIdle] = useState(false);
  const [live2dReady, setLive2dReady] = useState(false);
  const [live2dError, setLive2dError] = useState<string | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emotionRef = useRef<Emotion>(emotion);
  const breathingRef = useRef<boolean>(breathing);
  const talkingRef = useRef<boolean>(talking);

  emotionRef.current = emotion;
  breathingRef.current = breathing;
  talkingRef.current = talking;

  useEffect(() => {
    setFallbackToIdle(false);
  }, [characterId, emotion, art]);

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
      >
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
      key={`${characterSwitchKey}_${emotionSwitchKey}`}
      className={`p5-portrait-art-wrap p5-portrait-bounce p5-char-switch-anim emotion-${emotion} ${
        breathing ? 'p5-portrait-breathing' : ''
      }`}
      data-character-id={characterId}
      data-emotion={emotion}
    >
      <img
        src={spriteUrl}
        alt={`${characterName} - ${emotion}`}
        className="p5-portrait-img"
        data-testid="character-portrait"
        onError={() => {
          if (!fallbackToIdle && spriteUrl !== idleUrl) {
            setFallbackToIdle(true);
          }
        }}
      />
    </div>
  );
};
