import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import type { StageEvent } from '../../src/shared/stage-events';
import type { ThreadStartParams } from '../protocol/v2/ThreadStartParams';
import type { ThreadResumeParams } from '../protocol/v2/ThreadResumeParams';
import type { TurnSteerParams } from '../protocol/v2/TurnSteerParams';
import type { TurnStartParams } from '../protocol/v2/TurnStartParams';
import { CodexToStage } from './codex-to-stage';
import { runtime, defaultModel, textInput } from './runtime';

export class AppServerSpike extends EventEmitter {
  private config = runtime();
  private child = spawn('codex', [...this.config.args, 'app-server', '--stdio'], { cwd: this.config.cwd, env: this.config.env });
  private mapper = new CodexToStage();
  private sequence = 0;
  private closing = false;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  threadId = '';
  turnId = '';
  constructor(readonly onStage: (event: StageEvent) => void = e => console.log(JSON.stringify(e)), readonly onRaw: (direction: string, message: any) => void = () => {}) {
    super();
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message: any;
      try { message = JSON.parse(line); } catch { this.onStage({ type: 'error', at: Date.now(), message: `Invalid JSON: ${line.slice(0, 200)}` }); return; }
      this.onRaw('in', message);
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result); }
      }
      if (message.method === 'turn/started') this.turnId = message.params.turn.id;
      if (message.method === 'turn/completed') this.turnId = '';
      for (const event of this.mapper.translate(message)) this.onStage(event);
      if (message.method && message.id !== undefined) this.emit('approval', message);
      this.emit('message', message);
    });
    this.child.stderr.on('data', b => this.onRaw('stderr', b.toString()));
    this.child.on('error', error => { this.fail(error); this.onStage({ type: 'error', at: Date.now(), message: error.message }); });
    this.child.on('exit', (code, signal) => {
      const reason = `app-server exited: ${code ?? signal}`;
      this.fail(new Error(reason));
      if (this.turnId) { for (const event of this.mapper.transportClosed(reason, this.closing)) this.onStage(event); this.turnId = ''; }
      this.emit('closed', code, signal);
    });
  }
  private fail(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  private send(message: any) { this.onRaw('out', message); this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method: string, params: any): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 90_000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async start(model = defaultModel, resume?: string) {
    await this.request('initialize', { clientInfo: { name: 'p5_bridge_spike', title: 'P5 bridge spike', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    this.send({ method: 'initialized' });
    const params: ThreadStartParams = { cwd: this.config.cwd, model, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
    const result = resume ? await this.request('thread/resume', { ...params, threadId: resume } satisfies ThreadResumeParams) : await this.request('thread/start', params);
    if (result.sandbox?.type !== 'workspaceWrite' || result.approvalPolicy !== 'on-request' || !result.sandbox.excludeSlashTmp || !result.sandbox.excludeTmpdirEnvVar) throw new Error('Server did not honor sandbox/approval overrides');
    this.threadId = result.thread.id;
    return result;
  }
  async say(text: string) {
    if (this.turnId) throw new Error('任务运行中，请用 /steer 或 /stop');
    this.onStage({ type: 'user_message', at: Date.now(), id: crypto.randomUUID(), text });
    return this.request('turn/start', { threadId: this.threadId, input: textInput(text) } satisfies TurnStartParams);
  }
  async steer(text: string) {
    const id = crypto.randomUUID();
    if (!this.turnId) throw new Error('没有进行中的任务');
    this.mapper.registerSteer(id, text);
    this.onStage({ type: 'steer_queued', at: Date.now(), id, text });
    return this.request('turn/steer', { threadId: this.threadId, expectedTurnId: this.turnId, clientUserMessageId: id, input: textInput(text) } satisfies TurnSteerParams);
  }
  stop() { return this.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }); }
  approve(request: any, allowed: boolean) {
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method)) {
      this.send({ id: request.id, error: { code: -32601, message: 'Unsupported client request' } }); return;
    }
    this.send({ id: request.id, result: { decision: allowed ? 'accept' : 'decline' } });
    this.onStage({ type: 'permission_resolved', at: Date.now(), requestId: String(request.id), allowed });
  }
  close() { if (this.closing) return; this.closing = true; this.child.stdin.end(); this.child.kill('SIGTERM'); }
}

async function main() {
  const client = new AppServerSpike();
  const approvals: any[] = [];
  client.on('approval', request => { approvals.push(request); console.error(`审批 ${request.id}: ${request.params.command ?? request.method}，输入 y/n`); });
  client.on('message', message => {
    if (message.method === 'serverRequest/resolved') {
      const index = approvals.findIndex(request => request.id === message.params.requestId);
      if (index >= 0) approvals.splice(index, 1);
    }
  });
  try { await client.start(process.env.BRIDGE_MODEL ?? defaultModel, process.env.BRIDGE_RESUME); }
  catch (error) { client.close(); throw error; }
  console.error('输入消息；/steer 内容；/stop；/quit。stdout 为 StageEvent JSONL。');
  const lines = createInterface({ input: process.stdin });
  lines.on('line', async line => {
    try {
      if (line === '/quit') { lines.close(); client.close(); }
      else if (line === '/stop') await client.stop();
      else if (approvals.length) { if (!/^[yn]$/i.test(line.trim())) { console.error('请先输入 y 或 n'); return; } client.approve(approvals.shift(), /^y$/i.test(line.trim())); }
      else if (line.startsWith('/steer ')) await client.steer(line.slice(7));
      else if (line.trim()) await client.say(line);
    } catch (error) { console.log(JSON.stringify({ type: 'error', at: Date.now(), message: String(error) } satisfies StageEvent)); }
  });
  lines.on('close', () => client.close());
  process.on('SIGINT', () => { lines.close(); client.close(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
