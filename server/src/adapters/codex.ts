// Codex-specific protocol handling stays in this adapter. Based on bridge/src/appserver-spike.ts
// and bridge/src/codex-to-stage.ts; the Phase 0 files remain read-only.
import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { StageEvent, ToolKind } from '../../../src/shared/stage-events';
import type { WorkerSettings } from '../../../src/shared/settings';
import type { StartSessionOptions, WorkerAdapter, WorkerSession } from './types';
import { SentenceBuffer } from '../text-buffer';
import { listEndpointModels, testEndpoint } from '../voice/endpoint';

const runFile = promisify(execFile);
const gateway = { baseUrl: 'http://127.0.0.1:3425/v1', model: 'gpt-6-luna' };
type Payload<T> = T extends unknown ? Omit<T, 'at'> : never;
type Wire = { id?: string | number; method?: string; params?: any; result?: any; error?: any };
const textInput = (text: string) => [{ type: 'text', text, text_elements: [] }];

export function verifyEffectivePolicy(result: any, sandbox: WorkerSettings['sandbox'], cwd?: string) {
  const policy = result?.sandbox;
  const expected = sandbox === 'workspace-write' ? 'workspaceWrite' : 'readOnly';
  if (result?.approvalPolicy !== 'on-request' || policy?.type !== expected
    || (sandbox === 'workspace-write' && (!policy.excludeSlashTmp || !policy.excludeTmpdirEnvVar))
    || (policy?.writableRoots?.length && (!cwd || policy.writableRoots.some((root: string) => root !== cwd)))
    || (cwd && result?.thread?.cwd !== cwd)) throw new Error('Codex 回显的实际权限策略与预期不符，已拒绝开工');
}

/** Stateful translation plus completion repair; unit-testable without a child process. */
export class CodexEventMapper {
  private active = false;
  private started = 0;
  private openTools = new Set<string>();
  private streamed = new Set<string>();
  private fileStarts = new Set<string>();
  private steers = new Set<string>();
  private buffer: SentenceBuffer;
  constructor(private output: (event: StageEvent) => void) {
    this.buffer = new SentenceBuffer((text, final) => this.emit({ type: 'worker_text', text, ...(final ? { final } : {}) }));
  }
  private emit(event: Payload<StageEvent>) { this.output({ at: Date.now(), ...event } as StageEvent); }
  registerSteer(id: string) { this.steers.add(id); }
  begin() { this.active = true; this.started = Date.now(); this.streamed.clear(); this.fileStarts.clear(); }
  end(ok: boolean, summary: string, interrupted = false) {
    if (!this.active) return;
    this.active = false;
    this.buffer.flush();
    for (const toolUseId of this.openTools) this.emit({ type: 'tool_end', toolUseId, ok: false, summary: `任务结束，工具未返回: ${summary}` });
    this.openTools.clear(); this.steers.clear();
    if (interrupted) this.emit({ type: 'interrupted', reason: summary });
    this.emit({ type: 'turn_done', ok, summary, durationMs: Date.now() - this.started });
  }
  translate(message: Wire) {
    const method = message.method ?? '', p = message.params ?? {}, item = p.item;
    if (method === 'turn/started') this.emit({ type: 'thinking' });
    if (method.startsWith('item/reasoning/') || (method === 'item/started' && item?.type === 'reasoning')) return;
    if (method === 'item/agentMessage/delta') { this.streamed.add(p.itemId); this.buffer.push(p.delta); }
    if ((method === 'item/started' || method === 'item/completed' || method === 'item/userMessage') && item?.type === 'userMessage' && this.steers.delete(item.clientId)) this.emit({ type: 'steer_acked', id: item.clientId });
    if (method === 'error') this.emit({ type: 'error', message: p.error?.message ?? 'Codex 执行错误' });
    const begin = method === 'item/started', end = method === 'item/completed';
    if (!item || (!begin && !end)) return;
    if (end && item.type === 'agentMessage') {
      if (!this.streamed.has(item.id)) this.buffer.push(item.text ?? '');
      this.buffer.flush(item.phase === 'final_answer');
    }
    if (item.type === 'commandExecution') {
      if (begin) { this.openTools.add(item.id); this.emit({ type: 'tool_start', toolUseId: item.id, tool: 'bash', rawName: item.type, summary: item.command }); }
      if (end) { this.openTools.delete(item.id); this.emit({ type: 'tool_end', toolUseId: item.id, ok: item.exitCode === 0, summary: item.command, output: String(item.aggregatedOutput ?? '').slice(0, 4000) }); }
    }
    if (item.type === 'fileChange') {
      for (const [index, change] of (item.changes ?? []).entries()) {
        const id = `${item.id}:${index}`, tool: ToolKind = change.kind?.type === 'add' ? 'write' : 'edit';
        if (!this.fileStarts.has(id)) { this.fileStarts.add(id); this.openTools.add(id); this.emit({ type: 'tool_start', toolUseId: id, tool, rawName: item.type, summary: `${tool} ${change.path}`, file: change.path }); }
        if (end) { this.openTools.delete(id); this.emit({ type: 'tool_end', toolUseId: id, ok: item.status === 'completed', summary: change.path, ...(typeof change.diff === 'string' ? { diff: change.diff } : {}) }); }
      }
    }
  }
  dispose() { this.buffer.close(); }
}

class CodexSession implements WorkerSession {
  sessionId = '';
  turnActive = false;
  private turnId = '';
  private sequence = 0;
  private closed = false;
  private child: ReturnType<typeof spawn>;
  private mapper: CodexEventMapper;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private approvals = new Map<string, Wire>();
  private approvalPrefix = randomUUID();
  private beforeDiff = '';
  private completing?: Promise<void>;
  private interruptTimer?: NodeJS.Timeout;
  private stopRequested = false;
  private interruptSent = false;
  private readonly emit: (event: StageEvent) => void;
  constructor(private options: StartSessionOptions, home: string) {
    this.emit = options.onEvent;
    this.mapper = new CodexEventMapper(this.emit);
    const args = [
      '-c', 'model_provider="local"', '-c', 'model_providers.local.name="Local magpie"',
      '-c', 'model_providers.local.base_url="http://127.0.0.1:3425/v1"',
      '-c', 'model_providers.local.wire_api="responses"', '-c', 'model_providers.local.requires_openai_auth=false',
      '-c', `sandbox_mode="${options.sandbox}"`, '-c', 'approval_policy="on-request"',
      '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
      '-c', 'sandbox_workspace_write.writable_roots=[]',
      'app-server', '--stdio',
    ];
    this.child = spawn(options.extra?.executable ?? 'codex', args, { cwd: options.cwd, env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout! }).on('line', line => {
      try { this.receive(JSON.parse(line)); } catch { this.fail(new Error('Codex 协议数据无效')); this.child.kill('SIGTERM'); }
    });
    // Consume stderr, never log raw protocol/provider data or credentials.
    this.child.stderr!.resume();
    this.child.stdin!.on('error', () => this.fail(new Error('Codex 输入管道已关闭')));
    this.child.on('error', () => this.fail(new Error('无法启动 Codex，请检查可执行文件')));
    this.child.on('exit', () => { this.closed = true; this.fail(new Error('Codex 进程已退出')); });
  }
  private sendWire(message: Wire) {
    if (this.closed || !this.child.stdin!.writable) throw new Error('Codex 连接已关闭');
    this.child.stdin!.write(JSON.stringify(message) + '\n');
  }
  private request(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} 超时`)); }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.sendWire({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private receive(message: Wire) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(Number(message.id));
        message.error ? pending.reject(new Error(`Codex RPC 失败 (${message.error.code ?? 'unknown'})`)) : pending.resolve(message.result);
      }
      return;
    }
    const p = message.params ?? {};
    if (message.method === 'turn/started') {
      this.turnId = p.turn.id;
      if (this.stopRequested) void this.interrupt().catch(error => { this.fail(error); this.child.kill('SIGTERM'); });
    }
    if (message.method === 'turn/completed') {
      if (!this.turnActive || this.completing) return;
      const turn = p.turn;
      if (turn.error) this.emit({ type: 'error', at: Date.now(), message: turn.error.message ?? 'Codex 本轮执行失败' });
      this.completing = this.finish(turn.status === 'completed', turn.status, turn.status === 'interrupted');
      return;
    }
    if (message.method && message.id !== undefined) {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
        const requestId = `${this.approvalPrefix}:${message.id}`;
        this.approvals.set(requestId, message);
        this.emit({ type: 'permission_request', at: Date.now(), requestId, tool: message.method.includes('fileChange') ? 'edit' : 'bash', rawName: message.method,
          summary: p.command ?? p.reason ?? '审批请求', detail: JSON.stringify(p, null, 2) });
      } else this.sendWire({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } });
      return;
    }
    if (message.method === 'serverRequest/resolved') this.resolvePermission(`${this.approvalPrefix}:${p.requestId}`, false);
    this.mapper.translate(message);
  }
  private resolvePermission(id: string, allowed: boolean) {
    if (!this.approvals.delete(id)) return;
    this.emit({ type: 'permission_resolved', at: Date.now(), requestId: id, allowed });
  }
  private fail(error: Error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    if (this.turnActive && !this.completing) {
      this.emit({ type: 'error', at: Date.now(), message: error.message });
      this.completing = this.finish(false, error.message, this.stopRequested);
    }
  }
  private async gitDiff(): Promise<string> {
    try { return (await runFile('git', ['-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], { cwd: this.options.cwd, timeout: 5000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
    catch { return ''; } // Non-git directories and repositories without HEAD have no diff fallback.
  }
  private async finish(ok: boolean, summary: string, interrupted = false) {
    clearTimeout(this.interruptTimer);
    const diff = await this.gitDiff();
    if (diff && diff !== this.beforeDiff) {
      const id = `git-diff-${Date.now()}`;
      this.emit({ type: 'tool_start', at: Date.now(), toolUseId: id, tool: 'edit', rawName: 'git_diff', summary: '本轮结束时的 Git 文件差异（含现有未提交改动）' });
      this.emit({ type: 'tool_end', at: Date.now(), toolUseId: id, ok: true, summary: 'Git diff HEAD', diff });
    }
    for (const id of this.approvals.keys()) this.resolvePermission(id, false);
    this.turnId = ''; this.turnActive = false;
    this.mapper.end(ok, summary, interrupted);
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'bigfish_stage', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    this.sendWire({ method: 'initialized' });
    const params = { cwd: this.options.cwd, model: this.options.model, sandbox: this.options.sandbox, approvalPolicy: 'on-request', approvalsReviewer: 'user' };
    const result = await this.request(this.options.resumeId ? 'thread/resume' : 'thread/start', { ...params, ...(this.options.resumeId ? { threadId: this.options.resumeId } : {}) });
    verifyEffectivePolicy(result, this.options.sandbox, this.options.cwd);
    this.sessionId = result.thread.id;
    this.emit({ type: 'session_started', at: Date.now(), sessionId: this.sessionId, model: this.options.model, cwd: this.options.cwd });
  }
  async send(id: string, text: string) {
    if (this.turnActive) throw new Error('任务运行中，请使用插话');
    if (this.closed) throw new Error('Codex 连接已关闭，请新建或恢复会话');
    this.turnActive = true; this.stopRequested = false; this.interruptSent = false; this.completing = undefined; this.mapper.begin();
    this.beforeDiff = await this.gitDiff();
    this.emit({ type: 'user_message', at: Date.now(), id, text });
    try {
      const result = await this.request('turn/start', { threadId: this.sessionId, input: textInput(text) });
      if (this.turnActive) this.turnId = result.turn.id;
      if (this.stopRequested) await this.interrupt();
    } catch (error) { this.completing = this.finish(false, '无法开始任务'); await this.completing; throw error; }
  }
  async steer(id: string, text: string) {
    if (!this.turnActive || !this.turnId || this.completing) throw new Error('没有可插话的进行中任务');
    this.mapper.registerSteer(id);
    this.emit({ type: 'steer_queued', at: Date.now(), id, text });
    await this.request('turn/steer', { threadId: this.sessionId, expectedTurnId: this.turnId, clientUserMessageId: id, input: textInput(text) });
  }
  async interrupt() {
    if (!this.turnActive) return;
    this.stopRequested = true;
    // A stop during turn/start is queued until the server supplies a turn ID.
    if (!this.turnId || this.interruptSent) return;
    this.interruptSent = true;
    // If Codex never returns a terminal event, terminate transport and repair the UI.
    this.interruptTimer = setTimeout(() => {
      if (!this.completing) this.completing = this.finish(false, '打断超时，已关闭执行进程', true);
      this.child.kill('SIGTERM');
    }, 5000);
    await this.request('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId });
  }
  async decidePermission(requestId: string, allowed: boolean) {
    const request = this.approvals.get(requestId);
    if (!request) throw new Error('审批已结束或不存在');
    this.sendWire({ id: request.id, result: { decision: allowed ? 'accept' : 'decline' } });
    this.resolvePermission(requestId, allowed);
  }
  async close() {
    clearTimeout(this.interruptTimer);
    if (this.turnActive && !this.completing) this.completing = this.finish(false, '会话已关闭', true);
    await this.completing;
    this.mapper.dispose();
    this.child.stdin!.end(); this.child.kill('SIGTERM');
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('会话已关闭')); }
    this.pending.clear();
  }
}

export class CodexAdapter implements WorkerAdapter {
  readonly id = 'codex';
  constructor(private home: string) {}
  async info(settings?: WorkerSettings) {
    try {
      await runFile(settings?.extra?.executable ?? 'codex', ['--version'], { timeout: 5000 });
      return { id: this.id, name: 'Codex CLI', available: true };
    } catch { return { id: this.id, name: 'Codex CLI', available: false, unavailableReason: '找不到可用的 codex 可执行文件' }; }
  }
  listModels() { return listEndpointModels(gateway); }
  async testConnection(settings: WorkerSettings) {
    const available = await this.info(settings);
    return available.available ? testEndpoint({ ...gateway, model: settings.model }) : { ok: false, message: available.unavailableReason! };
  }
  async startSession(options: StartSessionOptions): Promise<WorkerSession> {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const session = new CodexSession({ ...options, cwd: await realpath(options.cwd) }, this.home);
    try { await session.initialize(); return session; }
    catch (error) { options.onEvent({ type: 'error', at: Date.now(), message: (error as Error).message }); await session.close(); throw error; }
  }
}
