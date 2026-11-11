// Codex-specific protocol handling stays in this adapter. Based on bridge/src/appserver-spike.ts
// and bridge/src/codex-to-stage.ts; the Phase 0 files remain read-only.
import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { approvalPresentation, displayCommand, displayPath, fileKey, uncoveredGitDiff } from './presentation';
import type { StageEvent, ToolKind } from '../../../src/shared/stage-events';
import { DEFAULT_SETTINGS, type WorkerSettings } from '../../../src/shared/settings';
import type { ModelList, StartSessionOptions, WorkerAdapter, WorkerSession } from './types';
import { SentenceBuffer } from '../text-buffer';
import { listEndpointModels, testEndpoint } from '../voice/endpoint';

const runFile = promisify(execFile);
/** Pure launch configuration: credentials only travel in the child environment. */
export function buildCodexLaunch(settings: Pick<WorkerSettings, 'connection' | 'endpoint' | 'sandbox'>, isolatedHome: string, inheritedEnv: NodeJS.ProcessEnv) {
  const args = [
    '-c', `sandbox_mode=${JSON.stringify(settings.sandbox)}`, '-c', 'approval_policy="on-request"',
    '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
    '-c', 'sandbox_workspace_write.writable_roots=[]',
  ];
  const env = { ...inheritedEnv };
  delete env.BIGFISH_WORKER_API_KEY;
  if (settings.connection === 'endpoint') {
    env.CODEX_HOME = isolatedHome;
    args.push(
      '-c', 'model_provider="bigfish"', '-c', 'model_providers.bigfish.name="Big Fish endpoint"',
      '-c', `model_providers.bigfish.base_url=${JSON.stringify(settings.endpoint.baseUrl)}`,
      '-c', 'model_providers.bigfish.wire_api="responses"', '-c', 'model_providers.bigfish.requires_openai_auth=false',
    );
    if (settings.endpoint.apiKey) {
      env.BIGFISH_WORKER_API_KEY = settings.endpoint.apiKey;
      args.push('-c', 'model_providers.bigfish.env_key="BIGFISH_WORKER_API_KEY"');
    }
  }
  return { args: [...args, 'app-server', '--stdio'], env };
}
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
  readonly structuredDiffFiles = new Set<string>();
  constructor(private output: (event: StageEvent) => void, private cwd = '', private home = '') {
    this.buffer = new SentenceBuffer((text, final) => this.emit({ type: 'worker_text', text, ...(final ? { final } : {}) }));
  }
  private emit(event: Payload<StageEvent>) { this.output({ at: Date.now(), ...event } as StageEvent); }
  registerSteer(id: string) { this.steers.add(id); }
  begin() { this.active = true; this.started = Date.now(); this.streamed.clear(); this.fileStarts.clear(); this.structuredDiffFiles.clear(); }
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
      const summary = displayCommand(item.command ?? '', this.cwd, this.home);
      if (begin) { this.openTools.add(item.id); this.emit({ type: 'tool_start', toolUseId: item.id, tool: 'bash', rawName: item.type, summary }); }
      if (end) { this.openTools.delete(item.id); this.emit({ type: 'tool_end', toolUseId: item.id, ok: item.exitCode === 0, summary, output: String(item.aggregatedOutput ?? '').slice(0, 4000) }); }
    }
    if (item.type === 'fileChange') {
      for (const [index, change] of (item.changes ?? []).entries()) {
        const id = `${item.id}:${index}`, tool: ToolKind = change.kind?.type === 'add' ? 'write' : 'edit';
        const file = displayPath(change.path, this.cwd, this.home);
        if (!this.fileStarts.has(id)) { this.fileStarts.add(id); this.openTools.add(id); this.emit({ type: 'tool_start', toolUseId: id, tool, rawName: item.type, summary: `${tool} ${file}`, file }); }
        if (end) {
          this.openTools.delete(id);
          if (item.status === 'completed' && typeof change.diff === 'string' && change.diff.trim()) this.structuredDiffFiles.add(fileKey(change.path, this.cwd));
          this.emit({ type: 'tool_end', toolUseId: id, ok: item.status === 'completed', summary: file, ...(typeof change.diff === 'string' ? { diff: change.diff } : {}) });
        }
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
    // Providers may echo credentials in error text; redact before events reach history/logs.
    const key = options.connection === 'endpoint' ? options.endpoint.apiKey : undefined;
    const redact = (value: unknown): unknown => typeof value === 'string' && key ? value.split(key).join('[REDACTED]')
      : Array.isArray(value) ? value.map(redact)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)])) : value;
    this.emit = key ? event => options.onEvent(redact(event) as StageEvent) : options.onEvent;
    this.mapper = new CodexEventMapper(this.emit, options.cwd, homedir());
    const { args, env } = buildCodexLaunch(options, home, process.env);
    this.child = spawn(options.extra?.executable ?? 'codex', args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
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
          ...approvalPresentation(p, this.options.cwd, homedir()) });
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
    try { return (await runFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', 'diff', '--relative', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], { cwd: this.options.cwd, timeout: 5000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
    catch { return ''; } // Non-git directories and repositories without HEAD have no diff fallback.
  }
  private async finish(ok: boolean, summary: string, interrupted = false) {
    clearTimeout(this.interruptTimer);
    const diff = uncoveredGitDiff(this.beforeDiff, await this.gitDiff(), this.mapper.structuredDiffFiles, this.options.cwd);
    if (diff) {
      const id = `git-diff-${Date.now()}`;
      this.emit({ type: 'tool_start', at: Date.now(), toolUseId: id, tool: 'edit', rawName: 'git_diff', summary: '本轮补充的 Git 文件差异' });
      this.emit({ type: 'tool_end', at: Date.now(), toolUseId: id, ok: true, summary: 'Git diff HEAD', diff });
    }
    for (const id of this.approvals.keys()) this.resolvePermission(id, false);
    this.turnId = ''; this.turnActive = false;
    this.mapper.end(ok, summary, interrupted);
  }
  async initializeTransport() {
    await this.request('initialize', { clientInfo: { name: 'bigfish_stage', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    this.sendWire({ method: 'initialized' });
  }
  async listModels(): Promise<ModelList> {
    const models = new Set<string>();
    let cursor: string | null = null;
    do {
      const result = await this.request('model/list', { cursor, limit: 100 });
      if (!Array.isArray(result.data)) throw new Error('Codex 模型列表格式无效');
      for (const entry of result.data) if (typeof entry.model === 'string') models.add(entry.model);
      cursor = result.nextCursor ?? null;
    } while (cursor);
    return { models: [...models] };
  }
  async initialize() {
    await this.initializeTransport();
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

export class DirectEndpointSession implements WorkerSession {
  sessionId: string;
  turnActive = false;
  private closed = false;
  private controller?: AbortController;
  private readonly emit: (event: StageEvent) => void;
  private history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content:
        '你是 P5 舞台上的 AI 编程搭档（大肥鱼 / 哈基米 / Claude 娘 / Codex 娘）。请直接、自然、专业地用中文回答店长（用户）的问题或完成任务。',
    },
  ];

  constructor(private options: StartSessionOptions) {
    this.sessionId = options.resumeId || `ses_${randomUUID().slice(0, 8)}`;
    const key = options.connection === 'endpoint' ? options.endpoint.apiKey : undefined;
    const redact = (value: unknown): unknown =>
      typeof value === 'string' && key
        ? value.split(key).join('[REDACTED]')
        : Array.isArray(value)
          ? value.map(redact)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]))
            : value;
    this.emit = key ? (event) => options.onEvent(redact(event) as StageEvent) : options.onEvent;
  }

  async initialize() {
    this.emit({
      type: 'session_started',
      at: Date.now(),
      sessionId: this.sessionId,
      model: this.options.model,
      cwd: this.options.cwd,
    });
  }

  async send(id: string, text: string) {
    if (this.turnActive) throw new Error('任务运行中，请使用插话');
    if (this.closed) throw new Error('连接已关闭，请新建会话');
    this.turnActive = true;
    const startedAt = Date.now();
    this.controller = new AbortController();

    this.emit({ type: 'user_message', at: startedAt, id, text });
    this.emit({ type: 'thinking', at: Date.now() });
    this.history.push({ role: 'user', content: text });

    try {
      const baseUrl = this.options.endpoint.baseUrl.replace(/\/+$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.options.endpoint.apiKey) {
        headers.Authorization = `Bearer ${this.options.endpoint.apiKey}`;
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          messages: this.history.slice(-14),
        }),
        signal: this.controller.signal,
      });

      if (!res.ok) {
        throw new Error(`模型接口响应异常 (HTTP ${res.status})`);
      }

      const data = (await res.json()) as any;
      const replyText =
        data?.choices?.[0]?.message?.content?.trim() ||
        '收到啦！大肥鱼随时待命捏～';

      this.history.push({ role: 'assistant', content: replyText });

      if (data?.usage?.total_tokens) {
        this.emit({
          type: 'context_usage',
          at: Date.now(),
          usedTokens: Number(data.usage.total_tokens),
          maxTokens: 1000000,
        });
      }

      this.emit({
        type: 'worker_text',
        at: Date.now(),
        text: replyText,
        final: true,
      });
      this.turnActive = false;
      this.emit({
        type: 'turn_done',
        at: Date.now(),
        ok: true,
        summary: replyText,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.turnActive = false;
      if ((error as Error).name === 'AbortError') {
        this.emit({
          type: 'interrupted',
          at: Date.now(),
          reason: '已停止当前对话',
        });
        this.emit({
          type: 'turn_done',
          at: Date.now(),
          ok: false,
          summary: '已停止',
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      this.emit({
        type: 'error',
        at: Date.now(),
        message: (error as Error).message,
      });
      this.emit({
        type: 'turn_done',
        at: Date.now(),
        ok: false,
        summary: (error as Error).message,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      this.controller = undefined;
    }
  }

  async steer(id: string, text: string) {
    this.emit({ type: 'steer_queued', at: Date.now(), id, text });
    this.emit({ type: 'steer_acked', at: Date.now(), id });
    this.history.push({ role: 'user', content: `补充要求：${text}` });
  }

  async interrupt() {
    this.controller?.abort();
  }

  async decidePermission(requestId: string, allowed: boolean) {
    this.emit({
      type: 'permission_resolved',
      at: Date.now(),
      requestId,
      allowed,
    });
  }

  async close() {
    this.closed = true;
    this.controller?.abort();
  }
}

export class DirectChatAdapter implements WorkerAdapter {
  readonly id = 'direct-chat';
  async info() {
    return { id: this.id, name: 'OpenAI 兼容直连对话 (无工具)', available: true };
  }
  async listModels(settings: WorkerSettings = DEFAULT_SETTINGS.worker): Promise<ModelList> {
    return listEndpointModels({ ...settings.endpoint, model: settings.model });
  }
  async testConnection(settings: WorkerSettings) {
    return testEndpoint({ ...settings.endpoint, model: settings.model });
  }
  async startSession(options: StartSessionOptions): Promise<WorkerSession> {
    const cwd = await realpath(options.cwd);
    const session = new DirectEndpointSession({ ...options, cwd });
    await session.initialize();
    return session;
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
  async listModels(settings: WorkerSettings = DEFAULT_SETTINGS.worker): Promise<ModelList> {
    if (settings.connection === 'endpoint') return listEndpointModels({ ...settings.endpoint, model: settings.model });
    const client = new CodexSession({ ...settings, cwd: process.cwd(), onEvent() {} }, this.home);
    try { await client.initializeTransport(); return await client.listModels(); }
    catch { return { models: [], error: '无法读取 Agent 自带配置的模型列表，请检查 Codex 登录与配置' }; }
    finally { await client.close(); }
  }
  async testConnection(settings: WorkerSettings) {
    const available = await this.info(settings);
    if (!available.available) return { ok: false, message: available.unavailableReason! };
    if (settings.connection === 'endpoint') return testEndpoint({ ...settings.endpoint, model: settings.model });
    const start = Date.now(), result = await this.listModels(settings);
    return result.error ? { ok: false, message: result.error, latencyMs: Date.now() - start }
      : { ok: true, message: 'Codex 已加载本机配置并返回模型列表；模型连接将在执行任务时验证', latencyMs: Date.now() - start };
  }
  async startSession(options: StartSessionOptions): Promise<WorkerSession> {
    const cwd = await realpath(options.cwd);
    if (options.connection === 'endpoint') await mkdir(this.home, { recursive: true, mode: 0o700 });
    const session = new CodexSession({ ...options, cwd }, this.home);
    try { await session.initialize(); return session; }
    catch (error) { options.onEvent({ type: 'error', at: Date.now(), message: (error as Error).message }); await session.close(); throw error; }
  }
}
