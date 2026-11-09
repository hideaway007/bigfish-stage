/**
 * Stage 事件协议（A / B 两个任务共用的唯一契约）
 *
 * - 任务 A（假数据原型）：用 StageEvent[] 写剧本，UI 只认这些事件。
 * - 任务 B（桥接验证）：把执行 Agent（本阶段为 Codex CLI）的真实输出翻译成这些事件，按 JSON Lines 输出。
 *
 * 两边对齐在这里，之后 UI 换成真实数据源时一行 UI 代码都不用改。
 * 要改这个文件，必须在任务报告里写明改了什么、为什么。
 */

export type Emotion =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'happy'
  | 'worried'
  | 'shocked';

export type ToolKind = 'read' | 'edit' | 'write' | 'bash' | 'search' | 'web' | 'task' | 'other';

interface Base {
  /** 毫秒时间戳 */
  at: number;
}

export type StageEvent = Base &
  (
    // ── 会话 ──
    | { type: 'session_started'; sessionId: string; model?: string; cwd?: string }
    | { type: 'user_message'; id: string; text: string }
    /** 用户在任务进行中插话：先进入排队状态 */
    | { type: 'steer_queued'; id: string; text: string }
    /** Worker 真正读到了这条插话（例如 --replay-user-messages 回显） */
    | { type: 'steer_acked'; id: string }
    | { type: 'interrupted'; reason?: string }

    // ── Worker（执行 Agent，如 Codex / Claude Code）原始活动 ──
    | { type: 'thinking' }
    /** Worker 的原始文字输出，不带人设。final=true 表示这一轮的最终回答 */
    | { type: 'worker_text'; text: string; final?: boolean }
    | {
        type: 'tool_start';
        toolUseId: string;
        tool: ToolKind;
        /** 执行 Agent 的原始工具或事件名，如 Edit / Bash / command_execution */
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

    // ── 前台角色（任务 A 手写；以后由前台人设模型生成，B 不产生）──
    | {
        type: 'character_line';
        characterId: string;
        emotion: Emotion;
        text: string;
        /** 台词唯一 ID（Phase 1 起由服务端填写；剧本模式可省略） */
        lineId?: string;
        /** preset = 角色包预置台词（即时）；model = 台词模型生成（稍后） */
        source?: 'preset' | 'model';
        /** 若存在：用本句替换之前那句 preset 台词（UI 原地替换，不新增一条） */
        replacesLineId?: string;
      }
  );

export type StageEventType = StageEvent['type'];
