import type { CharacterPack, CharacterUiCopy } from '../shared/character-pack';
import type { Emotion } from '../shared/stage-events';

const GENERIC_EMOTION_LABELS: Record<Emotion, { en: string; zh: string }> = {
  idle: { en: 'IDLE', zh: '待命' },
  thinking: { en: 'THINKING', zh: '思考中' },
  working: { en: 'WORKING', zh: '执行中' },
  happy: { en: 'HAPPY', zh: '任务完成' },
  worried: { en: 'WORRIED', zh: '需要关注' },
  shocked: { en: 'SHOCKED', zh: '等待确认' },
};

export function resolveEmotionLabel(pack: CharacterPack, emotion: Emotion) {
  const generic = GENERIC_EMOTION_LABELS[emotion];
  const label = pack.emotionLabels?.[emotion];
  return { en: label?.en ?? generic.en, zh: label?.zh ?? generic.zh };
}

export function resolveUiCopy(pack: CharacterPack): Required<CharacterUiCopy> {
  const shortName = pack.name.split('（')[0];
  const defaults: Required<CharacterUiCopy> = {
    userTitle: '你',
    inputTitle: 'TASK // 任务指令',
    inputPlaceholder: '输入任务并按 Enter 发送…',
    inputTag: 'TASK // 当前指令',
    sendLabel: '发送 ▶',
    idleHint: `待命舞台：发送右下角任务指令后，${shortName} 的工具调用将在此演出，随后收进右侧「水花记录」。`,
    stageSubtitle: `${shortName} · 工作台`,
  };
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      pack.uiCopy?.[key as keyof CharacterUiCopy] ?? fallback,
    ])
  ) as Required<CharacterUiCopy>;
}

export function defaultCharacterLine(pack: CharacterPack): string {
  return pack.persona.catchphrases[0] || '准备就绪，今天要处理什么任务？';
}
