import React, { useEffect, useState } from 'react';
import type { ArtManifest } from '../../shared/character-pack';
import type { Emotion } from '../../shared/stage-events';
import { resolveCharacterAssetUrl } from '../characterLoader';

export interface CharacterRendererProps {
  characterId: string;
  characterName: string;
  codename: string;
  art: ArtManifest;
  emotion: Emotion;
  emotionSwitchKey: number;
  characterSwitchKey: number;
  breathing?: boolean;
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
}) => {
  const [fallbackToIdle, setFallbackToIdle] = useState(false);

  useEffect(() => {
    setFallbackToIdle(false);
  }, [characterId, emotion, art]);

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
        key={`${characterSwitchKey}_${emotionSwitchKey}`}
        className={`p5-portrait-art-wrap p5-portrait-bounce p5-live2d-placeholder ${
          breathing ? 'p5-portrait-breathing' : ''
        }`}
        data-testid="live2d-placeholder-card"
        data-model3={model3Url}
        data-expression={activeExpression}
        data-motion-group={activeMotion.group}
        data-motion-index={activeMotion.index ?? 0}
      >
        <div className="p5-live2d-card">
          <div className="p5-live2d-badge">LIVE2D // Live2D 未启用</div>
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
