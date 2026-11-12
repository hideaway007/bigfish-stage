/**
 * 角色包格式（Phase 2 契约：支持分部位触摸互动反应）
 */
import type { CharacterTouchZone, Emotion, StageEventType, ToolKind } from './stage-events';

export type ReactionKey =
  | StageEventType
  | `tool_start:${ToolKind}`
  | `tool_end:${ToolKind}`
  | 'tool_end:fail'
  | 'turn_done:fail'
  | `touch:${CharacterTouchZone}`;

export interface Reaction {
  emotion: Emotion;
  /** 预置台词，随机取一句；可用占位符 {file} {tool} {summary} */
  lines: string[];
}

export type ArtManifest =
  | {
      renderer: 'sprites';
      /** 每个表情一张图（相对角色文件夹的路径）。缺失的表情回退到 idle */
      emotions: Partial<Record<Emotion, string>> & { idle: string };
      /** 队伍栏 / 设置页用的小头像 */
      portrait?: string;
    }
  | {
      renderer: 'live2d';
      /** .model3.json 路径（相对角色文件夹） */
      model3: string;
      expressions: Partial<Record<Emotion, string>>;
      motions: Partial<Record<Emotion, { group: string; index?: number }>>;
      portrait?: string;
    };

/** 情绪徽章文案：左上角表情标签。缺省时 UI 用通用文案 */
export type EmotionLabels = Partial<Record<Emotion, { en?: string; zh: string }>>;

/** 分部位触摸热区提示文案（如 head="摸摸呆毛"） */
export type TouchZoneLabels = Partial<Record<CharacterTouchZone, string>>;

/** 随角色变化的舞台文案，全部可选；缺省时 UI 用中性通用文案 */
export interface CharacterUiCopy {
  userTitle?: string;
  inputTitle?: string;
  inputPlaceholder?: string;
  inputTag?: string;
  sendLabel?: string;
  idleHint?: string;
  stageSubtitle?: string;
}

export interface CharacterPack {
  schemaVersion: 1;
  id: string;
  name: string;
  codename: string;
  tagline: string;
  themeColor: string;
  accentColor?: string;
  persona: {
    systemPrompt: string;
    speechStyle: string;
    catchphrases: string[];
  };
  reactions: Partial<Record<ReactionKey, Reaction>>;
  /** 分部位点击互动反应（可选，也可写在 reactions['touch:head'] 中） */
  touchReactions?: Partial<Record<CharacterTouchZone, Reaction>>;
  touchZoneLabels?: TouchZoneLabels;
  recommendedModels?: string[];
  art: ArtManifest;
  emotionLabels?: EmotionLabels;
  uiCopy?: CharacterUiCopy;
}

/** 服务端发给 UI 的角色列表条目 */
export interface CharacterSummary {
  id: string;
  name: string;
  codename: string;
  themeColor: string;
  portraitUrl: string | null;
  renderer: ArtManifest['renderer'];
}
