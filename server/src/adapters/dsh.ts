import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvalPresentation, displayCommand, displayPath, uncoveredGitDiff } from './presentation';
import type { StageEvent, ToolKind } from '../../../src/shared/stage-events';
import { DEFAULT_SETTINGS, type WorkerSettings } from '../../../src/shared/settings';
import type { ConnectionResult, ModelList, StartSessionOptions, WorkerAdapter, WorkerSession } from './types';
import { SentenceBuffer } from '../text-buffer';
import { listEndpointModels, testEndpoint } from '../voice/endpoint';

const runFile = promisify(execFile);

type Payload<T> = T extends unknown ? Omit<T, 'at'> : never;
type Wire = { jsonrpc?: string; id?: string | number; method?: string; params?: any; result?: any; error?: any };

export function mapToolKind(name: string): ToolKind {
  const lower = name.toLowerCase();
  if (lower.includes('bash') || lower.includes('terminal') || lower.includes('pwsh') || lower.includes('cmd')) return 'bash';
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep') || lower.includes('glob')) return 'search';
  if (lower.includes('read') || lower.includes('view') || lower.includes('cat')) return 'read';
  if (lower.includes('write') || lower.includes('create') || lower.includes('save')) return 'write';
  if (lower.includes('edit') || lower.includes('replace') || lower.includes('patch')) return 'edit';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('http') || lower.includes('browse')) return 'web';
  if (lower.includes('task') || lower.includes('subagent') || lower.includes('workflow') || lower.includes('agent')) return 'task';
  return 'other';
}

export function parseToolArgs(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return {};
}

export function formatToolSummary(toolName: string, args: Record<string, any>, cwd: string, home: string): { summary: string; file?: string } {
  const kind = mapToolKind(toolName);
  if (kind === 'bash') {
    const cmd = args.command || args.cmd || args.script || '';
    return { summary: displayCommand(String(cmd), cwd, home) };
  }
  const filePath = args.path || args.file_path || args.file || args.target || '';
  if (filePath) {
    const file = displayPath(String(filePath), cwd, home);
    return { summary: `${toolName} ${file}`, file };
  }
  const query = args.query || args.pattern || args.description || '';
  if (query) {
    return { summary: `${toolName} "${String(query).slice(0, 60)}"` };
  }
  return { summary: toolName };
}

/** Stateful translation from DSH SDK events into StageEvent. */
export class DshEventMapper {
  private active = false;
  private started = 0;
  private openTools = new Map<string, { tool: ToolKind; rawName: string; summary: string; file?: string }>();
  private buffer: SentenceBuffer;
  readonly structuredDiffFiles = new Set<string>();
  private steers = new Set<string>();

  constructor(private output: (event: StageEvent) => void, private cwd = '', private home = '') {
    this.buffer = new SentenceBuffer((text, final) => this.emit({ type: 'worker_text', text, ...(final ? { final } : {}) }));
  }

  private emit(event: Payload<StageEvent>) {
    this.output({ at: Date.now(), ...event } as StageEvent);
  }

  registerSteer(id: string) {
    this.steers.add(id);
  }

  begin() {
    this.active = true;
    this.started = Date.now();
    this.structuredDiffFiles.clear();
  }

  end(ok: boolean, summary: string, interrupted = false) {
    if (!this.active) return;
    this.active = false;
    this.buffer.flush(true);
    for (const [toolUseId, info] of this.openTools.entries()) {
      this.emit({ type: 'tool_end', toolUseId, ok: false, summary: `任务结束，工具未完成: ${info.summary}` });
    }
    this.openTools.clear();
    this.steers.clear();
    if (interrupted) this.emit({ type: 'interrupted', reason: summary });
    this.emit({ type: 'turn_done', ok, summary, durationMs: Date.now() - this.started });
  }

  translate(message: Wire) {
    const method = message.method ?? '';
    const params = message.params ?? {};

    if (method === 'session.event') {
      const ev = params.event;
      if (!ev) return;
      const type = ev.type ?? '';
      const data = ev.data ?? {};

      if (type === 'turn/start') {
        this.emit({ type: 'thinking' });
      }

      if (type === 'assistant/message') {
        const stream = data.stream;
        if (Array.isArray(stream)) {
          for (const item of stream) {
            if (item.type === 'text-chunks' && Array.isArray(item.texts)) {
              for (const t of item.texts) this.buffer.push(t);
            } else if (item.type === 'chunk' && item.chunk?.type === 'text' && typeof item.chunk.text === 'string') {
              this.buffer.push(item.chunk.text);
            }
          }
        } else if (data.message?.content && Array.isArray(data.message.content)) {
          for (const block of data.message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              this.buffer.push(block.text);
            }
          }
        }
        if (data.interrupted) {
          this.emit({ type: 'interrupted', reason: '模型输出被打断' });
        }
      }

      if (type === 'tool/call') {
        const callId = String(data.callId || randomUUID());
        const rawName = String(data.name || 'tool');
        const args = parseToolArgs(data.arguments);
        const { summary, file } = formatToolSummary(rawName, args, this.cwd, this.home);
        const tool = mapToolKind(rawName);
        this.openTools.set(callId, { tool, rawName, summary, file });
        if (file) this.structuredDiffFiles.add(file);
        this.emit({ type: 'tool_start', toolUseId: callId, tool, rawName, summary, file });
      }

      if (type === 'tool/result') {
        const callId = String(data.callId || data.message?.toolCallId || '');
        const info = this.openTools.get(callId);
        const isError = Boolean(data.error || data.message?.isError);
        let output = '';
        if (data.message?.content && Array.isArray(data.message.content)) {
          output = data.message.content.map((c: any) => c.text || '').join('\n');
        } else if (typeof data.meta === 'string') {
          output = data.meta;
        }
        const diff = typeof data.meta?.diff === 'string' ? data.meta.diff : undefined;
        this.openTools.delete(callId);
        this.emit({
          type: 'tool_end',
          toolUseId: callId,
          ok: !isError,
          summary: info?.summary,
          diff,
          output: output.slice(0, 4000),
        });
      }

      if (type === 'turn/end') {
        const reasonObj = data.reason;
        const kind = typeof reasonObj === 'object' && reasonObj !== null ? reasonObj.kind : reasonObj;
        const isError = kind === 'error';
        const isCancelled = kind === 'cancelled';
        const errorMsg = typeof reasonObj === 'object' && reasonObj?.error?.message ? reasonObj.error.message : (typeof reasonObj === 'string' ? reasonObj : '本轮完成');
        if (isError) {
          this.emit({ type: 'error', message: errorMsg });
        }
        this.end(!isError && !isCancelled, errorMsg, isCancelled);
      }
    }

    if (method === 'session.status') {
      if (params.status === 'idle' && this.active) {
        this.end(true, '待机');
      }
    }
  }

  dispose() {
    this.buffer.close();
    this.openTools.clear();
    this.steers.clear();
    this.active = false;
  }
}

/** Pure launch helper generating child process args and env */
export async function buildDshLaunch(
  settings: Pick<WorkerSettings, 'connection' | 'endpoint' | 'sandbox' | 'extra' | 'model'>,
  isolatedHome: string,
  inheritedEnv: NodeJS.ProcessEnv
): Promise<{ args: string[]; env: NodeJS.ProcessEnv; patchFile?: string }> {
  const env = { ...inheritedEnv };
  const args = ['--profile', 'sdk'];
  let patchFile: string | undefined;

  if (settings.connection === 'endpoint') {
    await mkdir(isolatedHome, { recursive: true, mode: 0o700 });
    patchFile = join(isolatedHome, 'dsh-endpoint-patch.yml');
    env.BIGFISH_WORKER_API_KEY = settings.endpoint.apiKey || 'dummy-local-key';
    const yaml = `
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      bigfish-endpoint:
        displayName: Big Fish Endpoint
        api: openai-completions
        baseURL: ${JSON.stringify(settings.endpoint.baseUrl)}
        apiKeyEnv: "BIGFISH_WORKER_API_KEY"
        models:
          - id: ${JSON.stringify(settings.model)}
            name: ${JSON.stringify(settings.model)}
`;
    await writeFile(patchFile, yaml, { mode: 0o600 });
    args.push('--patch', patchFile);
  }

  return { args, env, patchFile };
}

export class DshSession implements WorkerSession {
  readonly sessionId: string;
  turnActive = false;
  private child: ReturnType<typeof spawn>;
  private mapper: DshEventMapper;
  private sequence = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private approvals = new Map<string, { rpcId: number | string; params: any }>();
  private approvalPrefix = randomUUID();
  private beforeDiff = '';
  private completing?: Promise<void>;
  private patchFile?: string;
  private readonly emit: (event: StageEvent) => void;

  constructor(private options: StartSessionOptions, private home: string) {
    this.sessionId = options.resumeId || randomUUID();
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
    this.mapper = new DshEventMapper(this.emit, options.cwd, homedir());

    // child is created asynchronously in initialize()
    this.child = null as any;
  }

  private sendWire(message: Wire) {
    if (this.closed || !this.child?.stdin?.writable) throw new Error('DSH 连接已关闭');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DSH ${method} 超时`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.sendWire({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async initialize() {
    const { args, env, patchFile } = await buildDshLaunch(this.options, this.home, process.env);
    this.patchFile = patchFile;
    const executable = this.options.extra?.executable || 'dsh';

    this.child = spawn(executable, args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    createInterface({ input: this.child.stdout! }).on('line', (line) => {
      if (!line.trim()) return;
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.fail(new Error('DSH 协议数据无效'));
        this.child.kill('SIGTERM');
      }
    });

    this.child.stderr!.resume();
    this.child.stdin!.on('error', () => this.fail(new Error('DSH 输入管道已关闭')));
    this.child.on('error', (err) => this.fail(new Error(`无法启动 DSH (${err.message})，请检查 dsh 命令`)));
    this.child.on('exit', () => {
      this.closed = true;
      this.fail(new Error('DSH 进程已退出'));
    });

    const provider = this.options.connection === 'endpoint' ? 'bigfish-endpoint' : 'magpie';
    await this.request('initialize', {
      cwd: this.options.cwd,
      provider,
      model: this.options.model,
      approvalRequests: true,
      capabilities: { userQuestions: true },
    });

    this.emit({
      type: 'session_started',
      at: Date.now(),
      sessionId: this.sessionId,
      model: this.options.model,
      cwd: this.options.cwd,
    });
  }

  private receive(message: Wire) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(Number(message.id));
        message.error ? pending.reject(new Error(`DSH RPC 失败 (${message.error.message || message.error.code})`)) : pending.resolve(message.result);
      }
      return;
    }

    const method = message.method ?? '';
    const params = message.params ?? {};

    if (method === 'approval/request' && message.id !== undefined) {
      const requestId = `${this.approvalPrefix}:${message.id}`;
      this.approvals.set(requestId, { rpcId: message.id, params });
      const toolName = params.toolName || 'tool';
      const tool = mapToolKind(toolName);
      this.emit({
        type: 'permission_request',
        at: Date.now(),
        requestId,
        tool,
        rawName: toolName,
        summary: `${toolName} 请求执行`,
        detail: params.reason || `${toolName} 请求权限确认`,
      });
      return;
    }

    if (method === 'session.status') {
      if (params.status === 'running') {
        this.turnActive = true;
      }
    }

    this.mapper.translate(message);
  }

  async send(id: string, text: string) {
    if (this.turnActive) throw new Error('任务进行中，请使用插话');
    this.turnActive = true;
    this.beforeDiff = await this.gitDiff();
    this.mapper.begin();
    this.emit({ type: 'user_message', at: Date.now(), id, text });
    try {
      await this.request('session/prompt', {
        sessionId: this.sessionId,
        contentBlocks: [{ type: 'text', text }],
      });
    } catch (error) {
      this.completing = this.finish(false, '无法开始任务');
      await this.completing;
      throw error;
    }
  }

  async steer(id: string, text: string) {
    if (!this.turnActive || this.completing) throw new Error('没有可插话的进行中任务');
    this.mapper.registerSteer(id);
    this.emit({ type: 'steer_queued', at: Date.now(), id, text });
    await this.request('session/prompt', {
      sessionId: this.sessionId,
      contentBlocks: [{ type: 'text', text }],
    });
    this.emit({ type: 'steer_acked', at: Date.now(), id });
  }

  async interrupt() {
    if (!this.turnActive) return;
    this.mapper.end(false, '用户喊停', true);
    try {
      await this.request('shutdown', {});
    } catch {}
    this.child?.kill('SIGINT');
    await this.finish(false, '用户喊停', true);
  }

  async decidePermission(requestId: string, allowed: boolean) {
    const item = this.approvals.get(requestId);
    if (!item) throw new Error('审批已结束或不存在');
    this.approvals.delete(requestId);
    this.sendWire({
      jsonrpc: '2.0',
      id: item.rpcId,
      result: { outcome: allowed ? 'allowed-once' : 'rejected' },
    });
    this.emit({ type: 'permission_resolved', at: Date.now(), requestId, allowed });
  }

  private async gitDiff(): Promise<string> {
    try {
      return (
        await runFile(
          'git',
          ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', 'diff', '--relative', '--no-ext-diff', '--no-textconv', 'HEAD', '--'],
          { cwd: this.options.cwd, timeout: 5000, maxBuffer: 2 * 1024 * 1024 }
        )
      ).stdout;
    } catch {
      return '';
    }
  }

  private async finish(ok: boolean, summary: string, interrupted = false) {
    const diff = uncoveredGitDiff(this.beforeDiff, await this.gitDiff(), this.mapper.structuredDiffFiles, this.options.cwd);
    if (diff) {
      const id = `git-diff-${Date.now()}`;
      this.emit({ type: 'tool_start', at: Date.now(), toolUseId: id, tool: 'edit', rawName: 'git_diff', summary: '本轮补充的 Git 文件差异' });
      this.emit({ type: 'tool_end', at: Date.now(), toolUseId: id, ok: true, summary: 'Git diff HEAD', diff });
    }
    for (const [id, item] of this.approvals.entries()) {
      this.sendWire({ jsonrpc: '2.0', id: item.rpcId, result: { outcome: 'cancelled' } });
      this.emit({ type: 'permission_resolved', at: Date.now(), requestId: id, allowed: false });
    }
    this.approvals.clear();
    this.turnActive = false;
  }

  private fail(error: Error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    if (this.turnActive && !this.completing) {
      this.emit({ type: 'error', at: Date.now(), message: error.message });
      this.completing = this.finish(false, error.message, false);
    }
  }

  async close() {
    if (this.turnActive && !this.completing) this.completing = this.finish(false, '会话已关闭', true);
    await this.completing;
    this.mapper.dispose();
    if (this.child) {
      try {
        await this.request('shutdown', {});
      } catch {}
      this.child.stdin?.end();
      this.child.kill('SIGTERM');
    }
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('会话已关闭'));
    }
    this.pending.clear();
    if (this.patchFile) {
      await rm(this.patchFile, { force: true }).catch(() => {});
    }
  }
}

export class DshAdapter implements WorkerAdapter {
  readonly id = 'dsh';

  constructor(private home: string) {}

  async info(settings?: WorkerSettings) {
    try {
      const { stdout } = await runFile(settings?.extra?.executable ?? 'dsh', ['--version'], { timeout: 5000 });
      return { id: this.id, name: `DeepSeek Harness (${stdout.trim()})`, available: true };
    } catch {
      return { id: this.id, name: 'DeepSeek Harness (DSH)', available: false, unavailableReason: '未安装或找不到 dsh 命令' };
    }
  }

  async listModels(settings: WorkerSettings = DEFAULT_SETTINGS.worker): Promise<ModelList> {
    if (settings.connection === 'endpoint') {
      return listEndpointModels({ ...settings.endpoint, model: settings.model });
    }
    return {
      models: [
        'remote-magpie/auto/deepseek-v4.1-flash',
        'deepseek-chat',
        'deepseek-reasoner',
        'deepseek-coder',
      ],
    };
  }

  async testConnection(settings: WorkerSettings): Promise<ConnectionResult> {
    const available = await this.info(settings);
    if (!available.available) return { ok: false, message: available.unavailableReason! };
    if (settings.connection === 'endpoint') {
      return testEndpoint({ ...settings.endpoint, model: settings.model });
    }
    const start = Date.now();
    try {
      await runFile(settings.extra?.executable ?? 'dsh', ['--version'], { timeout: 5000 });
      return {
        ok: true,
        message: 'DSH 运行时就绪，支持通过 SDK stdio 启动 Agent 会话',
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message, latencyMs: Date.now() - start };
    }
  }

  async startSession(options: StartSessionOptions): Promise<WorkerSession> {
    const session = new DshSession({ ...options, cwd: await realpath(options.cwd) }, this.home);
    try {
      await session.initialize();
      return session;
    } catch (error) {
      options.onEvent({ type: 'error', at: Date.now(), message: (error as Error).message });
      await session.close();
      throw error;
    }
  }
}
