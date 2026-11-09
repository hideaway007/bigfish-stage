import type { StageEvent } from '../../src/shared/stage-events';
import type { ServerNotification } from '../protocol/ServerNotification';
import type { ServerRequest } from '../protocol/ServerRequest';

// The only module that interprets Codex event/item payloads.
export class CodexToStage {
  private streamed = new Set<string>();
  private steers = new Map<string, string>();
  private started = 0;
  private fileStarts = new Set<string>();
  private openTools = new Set<string>();
  registerSteer(id: string, text: string) { this.steers.set(id, text); }
  transportClosed(reason: string, interrupted: boolean, at = Date.now()): StageEvent[] {
    const events: StageEvent[] = [...this.openTools].map(toolUseId => ({ at, type: 'tool_end', toolUseId, ok: false, summary: `Transport closed: ${reason}` }));
    this.openTools.clear();
    events.push(interrupted ? { at, type: 'interrupted', reason } : { at, type: 'error', message: reason });
    events.push({ at, type: 'turn_done', ok: false, summary: interrupted ? 'interrupted' : reason });
    return events;
  }
  // exec JSONL has no generated protocol; app-server wire payloads are validated by its generated types.
  translate(raw: ServerNotification | ServerRequest | Record<string, any>, at = Date.now()): StageEvent[] {
    const r = raw as Record<string, any>;
    const p = r.params ?? {};
    const out: StageEvent[] = [];
    type Payload<T> = T extends unknown ? Omit<T, 'at'> : never;
    const emit = (e: Payload<StageEvent>) => out.push({ at, ...e } as StageEvent);
    const method = r.method ?? '';
    if (r.type === 'thread.started') emit({ type: 'session_started', sessionId: r.thread_id });
    if (method === 'thread/started') emit({ type: 'session_started', sessionId: p.thread.id, model: p.thread.model, cwd: p.thread.cwd });
    if (r.type === 'turn.started' || method === 'turn/started') { this.started = at; this.streamed.clear(); this.fileStarts.clear(); emit({ type: 'thinking' }); }
    if (method.startsWith('item/reasoning/')) emit({ type: 'thinking' });
    if (method === 'item/agentMessage/delta') { this.streamed.add(p.itemId); emit({ type: 'worker_text', text: p.delta }); }
    if (method === 'item/userMessage' || (method === 'item/started' && p.item?.type === 'userMessage')) {
      const id = p.item?.clientId;
      // Only the worker's userMessage echo counts as acknowledgement, not the steer RPC response.
      if (id && this.steers.has(id)) { emit({ type: 'steer_acked', id }); this.steers.delete(id); }
    }
    if (method.endsWith('/requestApproval') && r.id !== undefined) emit({ type: 'permission_request', requestId: String(r.id), tool: method.includes('fileChange') ? 'edit' : 'bash', rawName: method, summary: p.command ?? p.reason ?? '审批请求', detail: JSON.stringify(p) });
    const item = r.item ?? p.item;
    const begin = r.type === 'item.started' || method === 'item/started';
    const end = r.type === 'item.completed' || method === 'item/completed';
    if (item && (begin || end)) {
      const type = item.type;
      if (type === 'reasoning') emit({ type: 'thinking' });
      if (end && (type === 'agent_message' || type === 'agentMessage')) {
        if (!this.streamed.has(item.id)) emit({ type: 'worker_text', text: item.text, final: item.phase === 'final_answer' });
        else if (item.phase === 'final_answer') emit({ type: 'worker_text', text: '', final: true });
      }
      if (type === 'command_execution' || type === 'commandExecution') {
        if (begin) { this.openTools.add(item.id); emit({ type: 'tool_start', toolUseId: item.id, tool: 'bash', rawName: type, summary: item.command }); }
        if (end) { this.openTools.delete(item.id); emit({ type: 'tool_end', toolUseId: item.id, ok: (item.exit_code ?? item.exitCode) === 0, summary: item.command, output: String(item.aggregated_output ?? item.aggregatedOutput ?? '').slice(0, 4000) }); }
      }
      if (type === 'file_change' || type === 'fileChange') {
        for (const [index, change] of (item.changes ?? []).entries()) {
          const id = `${item.id}:${index}`;
          const tool = change.kind?.type === 'add' || change.kind === 'add' ? 'write' : 'edit';
          // A completed-only event is possible on older exec builds; never duplicate a real start.
          if (!this.fileStarts.has(id)) { this.fileStarts.add(id); this.openTools.add(id); emit({ type: 'tool_start', toolUseId: id, tool, rawName: type, summary: `${tool} ${change.path}`, file: change.path }); }
          if (end) { this.openTools.delete(id); emit({ type: 'tool_end', toolUseId: id, ok: item.status === 'completed', summary: change.path, ...(typeof change.diff === 'string' ? { diff: change.diff } : {}) }); }
        }
      }
    }
    if (method === 'turn/completed') {
      const status = p.turn.status;
      for (const toolUseId of this.openTools) emit({ type: 'tool_end', toolUseId, ok: false, summary: `No completion received before turn ${status}` });
      this.openTools.clear();
      if (status === 'interrupted') emit({ type: 'interrupted', reason: 'Codex turn interrupted' });
      if (p.turn.error) emit({ type: 'error', message: p.turn.error.message });
      emit({ type: 'turn_done', ok: status === 'completed', summary: status, durationMs: at - this.started });
    }
    if (r.type === 'turn.completed') { emit({ type: 'worker_text', text: '', final: true }); emit({ type: 'turn_done', ok: true, durationMs: at - this.started }); }
    if (r.type === 'turn.failed') emit({ type: 'turn_done', ok: false, summary: r.error?.message, durationMs: at - this.started });
    if (r.type === 'error' || method === 'error') emit({ type: 'error', message: r.message ?? p.error?.message ?? JSON.stringify(p) });
    return out;
  }
}
