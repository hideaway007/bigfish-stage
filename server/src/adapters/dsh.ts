import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvalPresentation, displayCommand, displayPath, fileKey, uncoveredGitDiff } from './presentation';
import type { StageEvent, ToolKind } from '../../../src/shared/stage-events';
import { DEFAULT_SETTINGS, type WorkerSettings } from '../../../src/shared/settings';
import type { CompactionResult, ConnectionResult, ModelList, StartSessionOptions, WorkerAdapter, WorkerSession } from './types';
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

export function extractDshSummaryText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((block: any) =>
        block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string'
          ? block.text
          : ''
      )
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

export function parseDshCompactionEvent(data: Record<string, any>): CompactionResult {
  const turnsRaw = Array.isArray(data.shadowedSeqs)
    ? data.shadowedSeqs.length
    : data.shadowedItemCount ?? data.turnsCompacted ?? data.turns;
  const turnsCompacted =
    typeof turnsRaw === 'number' && Number.isFinite(turnsRaw) && turnsRaw >= 0 ? Math.trunc(turnsRaw) : 0;

  const freedRaw = data.freedTokens ?? data.savedTokens ?? data.shadowedTokenCount;
  const hasTokenStats = typeof freedRaw === 'number' && Number.isFinite(freedRaw) && freedRaw > 0;
  const freedTokens = hasTokenStats ? Math.trunc(freedRaw) : 0;

  const afterTokens =
    typeof data.afterTokens === 'number' && Number.isFinite(data.afterTokens) && data.afterTokens >= 0
      ? Math.trunc(data.afterTokens)
      : undefined;
  const maxTokens =
    typeof data.maxTokens === 'number' && Number.isFinite(data.maxTokens) && data.maxTokens > 0 && afterTokens !== undefined
      ? Math.trunc(data.maxTokens)
      : undefined;

  const rawText = extractDshSummaryText(data.summary).replace(/\s+/g, ' ').slice(0, 240);
  let summary: string;
  if (rawText) {
    summary = hasTokenStats || rawText.includes('未提供') ? rawText : `${rawText}（引擎未提供释放 Token 统计）`;
  } else if (hasTokenStats) {
    summary =
      turnsCompacted > 0
        ? `DSH 已压缩 ${turnsCompacted} 项历史记录（引擎报告折叠 ${freedTokens} Tokens）。`
        : `DSH 已完成上下文压缩（引擎报告折叠 ${freedTokens} Tokens）。`;
  } else {
    summary =
      turnsCompacted > 0
        ? `DSH 已压缩 ${turnsCompacted} 项历史记录（引擎未提供释放 Token 统计）。`
        : 'DSH 已完成上下文压缩（引擎未提供释放 Token 统计）。';
  }

  return {
    turnsCompacted,
    freedTokens,
    ...(afterTokens !== undefined ? { afterTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    summary,
  };
}

/** Stateful translation from DSH SDK events into StageEvent. */
export class DshEventMapper {
  private active = false;
  private started = 0;
  private openTools = new Map<string, { tool: ToolKind; rawName: string; summary: string; file?: string; rawFile?: string }>();
  private buffer: SentenceBuffer;
  readonly structuredDiffFiles = new Set<string>();
  private steers = new Set<string>();
  private compactionCapture?: (result: CompactionResult) => void;

  constructor(private output: (event: StageEvent) => void, private cwd = '', private home = '') {
    this.buffer = new SentenceBuffer((text, final) => this.emit({ type: 'worker_text', text, ...(final ? { final } : {}) }));
  }

  private emit(event: Payload<StageEvent>) {
    this.output({ at: Date.now(), ...event } as StageEvent);
  }

  registerSteer(id: string) {
    this.steers.add(id);
  }

  setCompactionCapture(capture?: (result: CompactionResult) => void) {
    this.compactionCapture = capture;
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
        const rawFileVal = args.path || args.file_path || args.file || args.target || '';
        const rawFile = rawFileVal ? String(rawFileVal) : undefined;
        const { summary, file } = formatToolSummary(rawName, args, this.cwd, this.home);
        const tool = mapToolKind(rawName);
        this.openTools.set(callId, { tool, rawName, summary, file, rawFile });
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
        if (!isError && info?.rawFile && typeof diff === 'string' && diff.trim()) {
          this.structuredDiffFiles.add(fileKey(info.rawFile, this.cwd));
        }
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
        const turnTokens = data.usage?.totalTokens ?? data.contextTokens;
        if (typeof turnTokens === 'number' && Number.isFinite(turnTokens) && turnTokens > 0) {
          this.emit({
            type: 'context_usage',
            usedTokens: Math.trunc(turnTokens),
            maxTokens: Number(data.maxContextTokens ?? 1000000),
          });
        }
        if (isError) {
          this.emit({ type: 'error', message: errorMsg });
        }
        this.end(!isError && !isCancelled, errorMsg, isCancelled);
      }

      if (type === 'context/usage' || type === 'token/usage') {
        const used = data.usedTokens ?? data.totalTokens;
        if (typeof used === 'number' && Number.isFinite(used) && used >= 0) {
          this.emit({
            type: 'context_usage',
            usedTokens: Math.trunc(used),
            maxTokens: Number(data.maxTokens ?? 1000000),
          });
        }
      }

      if (
        type === 'compaction/summary' ||
        type === 'context/compacted' ||
        type === 'compaction' ||
        type === 'memory/compacted'
      ) {
        const parsed = parseDshCompactionEvent(data);
        if (this.compactionCapture) {
          this.compactionCapture(parsed);
        } else {
          this.emit({
            type: 'context_compacted',
            turnsCompacted: parsed.turnsCompacted,
            freedTokens: parsed.freedTokens,
            ...(parsed.afterTokens !== undefined ? { afterTokens: parsed.afterTokens } : {}),
            summary: parsed.summary,
          });
        }
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
  private disposed = false;
  private interrupting = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private approvals = new Map<string, { rpcId: number | string; params: any }>();
  private approvalPrefix = randomUUID();
  private beforeDiff = '';
  private completing?: Promise<void>;
  private patchFile?: string;
  private resumeAttempted = false;
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
    if (this.closed || this.disposed || !this.child?.stdin?.writable) throw new Error('DSH 连接已关闭');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private request(method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DSH ${method} 超时`));
      }, timeoutMs);
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

  private async spawnAndInitialize(emitSessionStarted: boolean) {
    const { args, env, patchFile } = await buildDshLaunch(this.options, this.home, process.env);
    this.patchFile = patchFile;
    const executable = this.options.extra?.executable || 'dsh';

    const child = spawn(executable, args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.closed = false;

    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (this.child !== child || !line.trim()) return;
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.fail(new Error('DSH 协议数据无效'));
        child.kill('SIGTERM');
      }
    });

    child.stderr!.resume();
    child.stdin!.on('error', () => {
      if (this.child === child && !this.interrupting && !this.disposed) {
        this.fail(new Error('DSH 输入管道已关闭'));
      }
    });
    child.on('error', (err) => {
      if (this.child === child && !this.interrupting && !this.disposed) {
        this.fail(new Error(`无法启动 DSH (${err.message})，请检查 dsh 命令`));
      }
    });
    child.on('exit', () => {
      if (this.child === child) {
        this.closed = true;
        if (!this.interrupting && !this.disposed) {
          this.fail(new Error('DSH 进程已退出'));
        }
      }
    });

    const provider = this.options.connection === 'endpoint' ? 'bigfish-endpoint' : 'default';
    await this.request('initialize', {
      cwd: this.options.cwd,
      provider,
      model: this.options.model,
      ...(this.options.reasoningEffort ? { reasoningEffort: this.options.reasoningEffort } : {}),
      approvalRequests: true,
      capabilities: { userQuestions: true },
    });

    if (this.options.resumeId && !this.resumeAttempted) {
      this.resumeAttempted = true;
      await this.request('session/resume', { sessionId: this.sessionId }, 1500).catch(() => {});
    }

    if (emitSessionStarted) {
      this.emit({
        type: 'session_started',
        at: Date.now(),
        sessionId: this.sessionId,
        model: this.options.model,
        cwd: this.options.cwd,
      });
    }
  }

  async initialize() {
    await this.spawnAndInitialize(true);
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
      } else if (params.status === 'idle') {
        this.turnActive = false;
      }
    }

    this.mapper.translate(message);

    if (method === 'session.event' && params.event?.type === 'turn/end') {
      this.turnActive = false;
    }
  }

  async send(id: string, text: string) {
    if (this.disposed) throw new Error('DSH 连接已关闭，请新建或恢复会话');
    if (this.turnActive) throw new Error('任务进行中，请使用插话');
    if (this.closed || !this.child?.stdin?.writable) {
      await this.spawnAndInitialize(false);
    }
    this.turnActive = true;
    this.completing = undefined;
    this.beforeDiff = await this.gitDiff();
    this.mapper.begin();
    this.emit({ type: 'user_message', at: Date.now(), id, text });
    try {
      await this.request('session/prompt', {
        sessionId: this.sessionId,
        contentBlocks: [{ type: 'text', text }],
      });
    } catch (error) {
      if (this.interrupting || !this.turnActive) return;
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
    this.interrupting = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('用户喊停'));
    }
    this.pending.clear();
    this.mapper.end(false, '用户喊停', true);
    const child = this.child;
    if (child && !this.closed) {
      try {
        this.sendWire({ jsonrpc: '2.0', id: ++this.sequence, method: 'shutdown', params: {} });
      } catch {}
      child.kill('SIGINT');
    }
    this.closed = true;
    await this.finish(false, '用户喊停', true);
    this.interrupting = false;
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

  async compact(): Promise<CompactionResult> {
    if (this.disposed) throw new Error('DSH 连接已关闭，请新建或恢复会话');
    if (this.turnActive) throw new Error('任务进行中无法执行记忆凝炼，请等待本轮完成');
    if (this.closed || !this.child?.stdin?.writable) {
      await this.spawnAndInitialize(false);
    }

    let captured: CompactionResult | undefined;
    this.mapper.setCompactionCapture((res) => {
      captured = res;
    });

    try {
      const response = await this.request('session/query', {
        sessionId: this.sessionId,
        contentBlocks: [{ type: 'text', text: '/compact' }],
      });

      if (!response || typeof response !== 'object') {
        throw new Error('DSH 返回了无效的上下文压缩响应');
      }
      if (response.kind === 'prompt') {
        throw new Error('当前 DSH 运行时未启用 /compact 原生压缩命令');
      }
      if (response.kind !== 'command') {
        throw new Error('DSH 未能以原生命令方式执行 /compact');
      }

      const cmdResult = response.execution?.result;
      if (!cmdResult || cmdResult.kind === 'error') {
        const msg =
          typeof cmdResult?.text === 'string' && cmdResult.text.trim()
            ? cmdResult.text.trim()
            : 'DSH 上下文压缩执行失败';
        throw new Error(msg);
      }

      if (captured) return captured;

      const resultText = typeof cmdResult.text === 'string' ? cmdResult.text.trim() : '';
      if (cmdResult.sourceEventSeq === undefined && (!resultText || /no compactable history/i.test(resultText))) {
        throw new Error('当前会话暂无可压缩的历史上下文');
      }

      const officialMatch = /^Compacted\s+(\d+)\s+history items\s+\(~(\d+)\s+tokens\)\./i.exec(resultText);
      if (officialMatch) {
        const turnsCompacted = Number(officialMatch[1]);
        const freedTokens = Number(officialMatch[2]);
        return {
          turnsCompacted,
          freedTokens,
          summary:
            freedTokens > 0
              ? `DSH 已压缩 ${turnsCompacted} 项历史记录（引擎报告折叠 ${freedTokens} Tokens）。`
              : `DSH 已压缩 ${turnsCompacted} 项历史记录（引擎未提供释放 Token 统计）。`,
        };
      }

      return {
        turnsCompacted: 0,
        freedTokens: 0,
        summary: resultText
          ? `${resultText}（引擎未提供释放 Token 统计）`
          : 'DSH 已完成上下文压缩（引擎未提供释放 Token 统计）。',
      };
    } finally {
      this.mapper.setCompactionCapture(undefined);
    }
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
      try {
        this.sendWire({ jsonrpc: '2.0', id: item.rpcId, result: { outcome: 'cancelled' } });
      } catch {}
      this.emit({ type: 'permission_resolved', at: Date.now(), requestId: id, allowed: false });
    }
    this.approvals.clear();
    this.turnActive = false;
    this.mapper.end(ok, summary, interrupted);
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
    this.disposed = true;
    if (this.turnActive && !this.completing) this.completing = this.finish(false, '会话已关闭', true);
    await this.completing;
    this.mapper.dispose();
    if (this.child) {
      try {
        this.sendWire({ jsonrpc: '2.0', id: ++this.sequence, method: 'shutdown', params: {} });
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
  readonly supportsCompact = true;

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
