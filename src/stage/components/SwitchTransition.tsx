import React, { useEffect, useRef, useState } from 'react';
import {
  isSfxMuted,
  notifyUserGesture,
  playSfx,
  subscribeSfxMuted,
  toggleSfxMuted,
} from '../sfx';
import '../polish.css';

export interface SwitchTransitionProps {
  characterId: string;
  characterSwitchKey: number;
  name: string;
  codename: string;
  tagline?: string;
  themeColor: string;
  accentColor?: string;
  portraitUrl?: string | null;
}

interface ActiveWipeState {
  wipeKey: number;
  characterId: string;
  shortName: string;
  fullName: string;
  codename: string;
  tagline?: string;
  themeColor: string;
  accentColor: string;
  portraitUrl?: string | null;
  reducedMotion: boolean;
}

const WIPE_DURATION_MS = 620;
const WIPE_REDUCED_DURATION_MS = 180;

function prefersReducedMotionNow(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const SwitchTransition: React.FC<SwitchTransitionProps> = ({
  characterId,
  characterSwitchKey,
  name,
  codename,
  tagline,
  themeColor,
  accentColor,
  portraitUrl,
}) => {
  const hasMountedRef = useRef<boolean>(false);
  const prevSwitchKeyRef = useRef<number>(characterSwitchKey);
  const prevCharIdRef = useRef<string>(characterId);
  const timerRef = useRef<number | null>(null);

  const [activeWipe, setActiveWipe] = useState<ActiveWipeState | null>(null);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      prevSwitchKeyRef.current = characterSwitchKey;
      prevCharIdRef.current = characterId;
      return;
    }

    const switchKeyAdvanced = characterSwitchKey !== prevSwitchKeyRef.current;
    const charChanged = characterId !== prevCharIdRef.current;

    prevSwitchKeyRef.current = characterSwitchKey;
    prevCharIdRef.current = characterId;

    if (!switchKeyAdvanced || !charChanged) {
      return;
    }

    playSfx('switch');

    const reducedMotion = prefersReducedMotionNow();
    const duration = reducedMotion ? WIPE_REDUCED_DURATION_MS : WIPE_DURATION_MS;
    const shortName = name.split('（')[0] || name;

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    setActiveWipe({
      wipeKey: characterSwitchKey,
      characterId,
      shortName,
      fullName: name,
      codename,
      tagline,
      themeColor,
      accentColor: accentColor || themeColor,
      portraitUrl,
      reducedMotion,
    });

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setActiveWipe(null);
    }, duration);
  }, [
    characterId,
    characterSwitchKey,
    name,
    codename,
    tagline,
    themeColor,
    accentColor,
    portraitUrl,
  ]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!activeWipe) return null;

  const wipeStyle = {
    '--wipe-theme-color': activeWipe.themeColor,
    '--wipe-accent-color': activeWipe.accentColor,
  } as React.CSSProperties;

  return (
    <div
      key={`switch_wipe_${activeWipe.wipeKey}`}
      className={`p5-switch-wipe ${
        activeWipe.reducedMotion ? 'is-reduced-motion' : ''
      }`}
      style={wipeStyle}
      data-testid="switch-transition-wipe"
      data-character-id={activeWipe.characterId}
      aria-hidden="true"
    >
      {/* Diagonal speed lines & slanted wipe blades */}
      <div className="p5-switch-wipe-backdrop" />
      <div className="p5-switch-wipe-blade p5-switch-wipe-blade--top" />
      <div className="p5-switch-wipe-blade p5-switch-wipe-blade--main" />
      <div className="p5-switch-wipe-blade p5-switch-wipe-blade--bottom" />
      <div className="p5-switch-wipe-speedlines" />

      {/* Slanted character nameplate cut-in */}
      <div className="p5-switch-wipe-card">
        {activeWipe.portraitUrl && (
          <div className="p5-switch-wipe-avatar-box">
            <img
              src={activeWipe.portraitUrl}
              alt={activeWipe.shortName}
              className="p5-switch-wipe-avatar"
            />
          </div>
        )}
        <div className="p5-switch-wipe-copy">
          <span className="p5-switch-wipe-kicker">
            PARTY SWITCH // 鱼塘换人入场
          </span>
          <div
            className="p5-switch-wipe-codename"
            data-testid="switch-wipe-codename"
          >
            {activeWipe.codename}
          </div>
          <div className="p5-switch-wipe-name" data-testid="switch-wipe-name">
            {activeWipe.fullName}
          </div>
          {activeWipe.tagline && (
            <div className="p5-switch-wipe-tagline">{activeWipe.tagline}</div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * HUD 音效静音切换按钮（状态持久化到 localStorage）
 */
export const SfxMuteButton: React.FC = () => {
  const [muted, setMuted] = useState<boolean>(isSfxMuted);

  useEffect(() => {
    return subscribeSfxMuted((next) => {
      setMuted(next);
    });
  }, []);

  return (
    <button
      type="button"
      className={`p5-top-btn p5-hud-mute-btn ${muted ? 'is-muted' : 'is-unmuted'}`}
      data-testid="sfx-mute-toggle"
      aria-pressed={muted}
      aria-label={muted ? '开启舞台音效' : '静音舞台音效'}
      title={
        muted
          ? '舞台音效：已静音（点击开启，状态自动保存）'
          : '舞台音效：已开启（点击静音，状态自动保存）'
      }
      onClick={() => {
        notifyUserGesture();
        toggleSfxMuted();
      }}
    >
      <svg
        className="p5-hud-mute-icon"
        viewBox="0 0 16 16"
        width="13"
        height="13"
        aria-hidden="true"
      >
        <path
          d="M2 6h3l4-3.5v11L5 10H2V6z"
          fill="currentColor"
        />
        {muted ? (
          <path
            d="M11 5.5l3.5 5M14.5 5.5l-3.5 5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        ) : (
          <>
            <path
              d="M11.2 5.2a4.2 4.2 0 0 1 0 5.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M13.2 3.5a6.8 6.8 0 0 1 0 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      <span className="p5-hud-mute-label">{muted ? 'MUTE' : 'SFX'}</span>
    </button>
  );
};
