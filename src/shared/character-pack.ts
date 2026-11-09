/**
 * 角色包格式（Phase 1 契约）
 *
 * 每个角色是一个文件夹：public/characters/<id>/
 *   character.json   —— 本文件定义的 CharacterPack
 *   art/...          —— 立绘资源，路径写在 art 字段里（相对角色文件夹）
 *
 * 新增角色 = 新增一个文件夹，不改任何代码。
 * 角色只负责「人设 + 演出」，与执行 Agent / 模型互不绑定。
 */
import type { Emotion, StageEventType, ToolKind } from './stage-events';

/**
 * 反应表的键：
 * - 事件类型本身，如 'thinking' / 'permission_request' / 'turn_done'
 * - 带工具种类的细分，如 'tool_start:edit' / 'tool_end:bash'
 * - 失败细分：'tool_end:fail' / 'turn_done:fail'
 * 查找顺序：最细的键优先，找不到再退回事件类型本身。
 */
export type ReactionKey =
  | StageEventType
  | `tool_start:${ToolKind}`
  | `tool_end:${ToolKind}`
  | 'tool_end:fail'
  | 'turn_done:fail';

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

export interface CharacterPack {
  schemaVersion: 1;
  id: string;
  name: string;
  /** 大号英文代号，如 "DEEPSEEK · V4 PRO" */
  codename: string;
  tagline: string;
  themeColor: string;
  accentColor?: string;
  persona: {
    /** 给台词模型的人设说明（第二人称，描述性格、说话方式、梗） */
    systemPrompt: string;
    /** 一句话说话风格，便于 UI 展示 */
    speechStyle: string;
    catchphrases: string[];
  };
  reactions: Partial<Record<ReactionKey, Reaction>>;
  /** 推荐搭配的模型（仅提示，不强制） */
  recommendedModels?: string[];
  art: ArtManifest;
}

/** 服务端发给 UI 的角色列表条目 */
export interface CharacterSummary {
  id: string;
  name: string;
  codename: string;
  themeColor: string;
  /** 可直接用于 <img src> 的 URL，如 /characters/deepseek-v4-pro/art/portrait.png */
  portraitUrl: string | null;
  renderer: ArtManifest['renderer'];
}
