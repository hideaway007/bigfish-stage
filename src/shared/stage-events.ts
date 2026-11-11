/**
 * Stage 事件协议（前后端唯一共享舞台事件契约）
 */

export type Emotion =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'happy'
  | 'worried'
  | 'shocked';

export type ToolKind = 'read' | 'edit' | 'write' | 'bash' | 'search' | 'web' | 'task' | 'other';

export type CharacterTouchZone = 'head' | 'face' | 'body' | 'prop';

interface Base {
  /** 毫秒时间戳 */
  at: number;
}

export type StageEvent = Base &
  (
    // ── 会话 ──
    | { type: 'session_started'; sessionId: string; model?: string; cwd?: string; characterId?: string }
    | { type: 'user_message'; id: string; text: string }
    /** 用户在任务进行中插话：先进入排队状态 */
    | { type: 'steer_queued'; id: string; text: string }
    /** Worker 真正读到了这条插话 */
    | { type: 'steer_acked'; id: string }
    | { type: 'interrupted'; reason?: string }

    // ── Worker（DeepSeek Harness / Direct API）原始活动 ──
    | { type: 'thinking' }
    /** Worker 的原始文字输出，final=true 表示这一轮的最终回答 */
    | { type: 'worker_text'; text: string; final?: boolean }
    | {
        type: 'tool_start';
        toolUseId: string;
        tool: ToolKind;
        /** 执行 Agent 的原始工具或事件名，如 Edit / Bash */
        rawName: string;
        /** 一行人类可读摘要，如 "Edit src/app.ts" */
        summary: string;
        file?: string;
      }
    | {
        type: 'tool_end';
        toolUseId: string;
        ok: boolean;
        summary?: string;
        /** unified diff，仅 edit/write 时提供 */
        diff?: string;
        /** 截断后的输出（终端输出、读取结果等），建议 ≤ 4000 字符 */
        output?: string;
      }
    | {
        type: 'permission_request';
        requestId: string;
        tool: ToolKind;
        rawName: string;
        summary: string;
        /** 完整细节：命令全文、文件路径、diff 等，原样展示给用户 */
        detail: string;
      }
    | { type: 'permission_resolved'; requestId: string; allowed: boolean }
    | {
        type: 'turn_done';
        ok: boolean;
        summary?: string;
        durationMs?: number;
        costUsd?: number;
      }
    | { type: 'error'; message: string }

    // ── DSH 扩展特性：上下文警戒槽 (Context Meter) 与 记忆凝炼压缩 (Compaction) ──
    | {
        type: 'context_usage';
        usedTokens: number;
        maxTokens: number;
      }
    | {
        type: 'context_compacted';
        turnsCompacted: number;
        freedTokens: number;
        afterTokens?: number;
        summary?: string;
      }

    // ── P5 怪盗团协同演出事件：换手接力 (Baton Pass) & 场外副官插嘴 (Sub-Navigator) ──
    | {
        type: 'baton_pass';
        fromCharacterId: string;
        toCharacterId: string;
        summary: string;
      }
    | {
        type: 'sub_navigator_line';
        characterId: string;
        emotion: Emotion;
        text: string;
        lineId?: string;
      }

    // ── 前台角色台词与触摸互动 ──
    | {
        type: 'character_line';
        characterId: string;
        emotion: Emotion;
        text: string;
        /** 台词唯一 ID */
        lineId?: string;
        /** preset = 角色包预置台词；model = 台词模型生成；touch = 部位触摸彩蛋 */
        source?: 'preset' | 'model' | 'touch';
        /** 若存在：用本句替换之前那句 preset 台词 */
        replacesLineId?: string;
        /** 若来自部位触摸互动，记录触摸区域 */
        touchZone?: CharacterTouchZone;
      }
  );

export type StageEventType = StageEvent['type'];
