import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdapterRegistry } from '../src/adapters/registry';
import { CodexAdapter, DirectChatAdapter, DirectEndpointSession } from '../src/adapters/codex';
import { DshAdapter } from '../src/adapters/dsh';
import type { StartSessionOptions, WorkerAdapter, WorkerSession } from '../src/adapters/types';
import { CharacterCatalog } from '../src/characters';
import { SessionController } from '../src/session';
import { SettingsStore } from '../src/settings-store';
import type { ServerMessage } from '../../src/shared/wire';

const charactersRoot = new URL('../../public/characters/', import.meta.url).pathname;

async function makeSandbox(prefix: string): Promise<string> {
  await mkdir('/tmp/bigfish-c-sandbox/review-fixes', { recursive: true });
  return mkdtemp(`/tmp/bigfish-c-sandbox/review-fixes/${prefix}-`);
}

class NoCompactAdapter implements WorkerAdapter {
  readonly id = 'no-compact';
  starts: StartSessionOptions[] = [];

  async info() {
    return { id: this.id, name: 'No Compact Worker', available: true };
  }
  async listModels() {
    return { models: ['nc-model'] };
  }
  async testConnection() {
    return { ok: true, message: 'ok' };
  }
  async startSession(options: StartSessionOptions): Promise<WorkerSession> {
    this.starts.push(options);
    const sessionId = options.resumeId ?? 'nc-session-1';
    options.onEvent({
      type: 'session_started',
      at: Date.now(),
      sessionId,
      model: options.model,
      cwd: options.cwd,
    });
    return {
      sessionId,
      turnActive: false,
      async send(id, text) {
        options.onEvent({ type: 'user_message', at: Date.now(), id, text });
        options.onEvent({ type: 'thinking', at: Date.now() });
        options.onEvent({
          type: 'tool_start',
          at: Date.now(),
          toolUseId: `tool_${id}`,
          tool: 'read',
          rawName: 'read_file',
          summary: 'read src/index.ts',
          file: 'src/index.ts',
        });
        options.onEvent({
          type: 'tool_end',
          at: Date.now(),
          toolUseId: `tool_${id}`,
          ok: true,
          summary: 'read src/index.ts',
          output: 'export const ok = true;',
        });
        options.onEvent({ type: 'worker_text', at: Date.now(), text: `已完成 ${text}`, final: true });
        options.onEvent({ type: 'turn_done', at: Date.now(), ok: true, summary: 'done' });
      },
      async steer() {},
      async interrupt() {},
      async decidePermission() {},
      async close() {},
    };
  }
}

test('不支持 compact 的执行器（无 compact 能力与 Codex CLI）明确报错且不删改内存与磁盘历史', async () => {
  const root = await makeSandbox('unsupported-compact');
  const fakeCodexExe = join(root, 'fake-codex.mjs');
  await writeFile(
    fakeCodexExe,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli fake'); process.exit(0); }
const send = v => process.stdout.write(JSON.stringify(v) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const q = JSON.parse(line);
  if (q.method === 'initialize') send({ id: q.id, result: {} });
  if (q.method === 'thread/start' || q.method === 'thread/resume') {
    send({
      id: q.id,
      result: {
        thread: { id: 'codex-thread-1', cwd: process.cwd() },
        approvalPolicy: 'on-request',
        sandbox: { type: 'workspaceWrite', excludeSlashTmp: true, excludeTmpdirEnvVar: true, writableRoots: [] },
      },
    });
  }
  if (q.method === 'turn/start') {
    const text = q.params?.input?.[0]?.text || '';
    send({ id: q.id, result: { turn: { id: 't1' } } });
    send({ method: 'turn/started', params: { turn: { id: 't1' } } });
    send({ method: 'item/completed', params: { item: { id: 'm1', type: 'agentMessage', text: 'Codex 回复: ' + text, phase: 'final_answer' } } });
    send({ method: 'turn/completed', params: { turn: { id: 't1', status: 'completed' } } });
  }
});
`,
    { mode: 0o755 }
  );

  try {
    const store = new SettingsStore(join(root, 'settings.json'));
    await store.load();
    const catalog = new CharacterCatalog(charactersRoot);
    await catalog.load();
    const noCompact = new NoCompactAdapter();
    const codexAdapter = new CodexAdapter(join(root, 'codex-home'));
    const broadcasts: ServerMessage[] = [];
    const controller = new SessionController(
      store,
      catalog,
      new AdapterRegistry([noCompact, codexAdapter]),
      msg => broadcasts.push(msg)
    );
    const replies: ServerMessage[] = [];
    const exec = (cmd: any) => controller.command(cmd, msg => replies.push(msg));

    await exec({
      type: 'update_settings',
      patch: {
        projectDir: root,
        voice: { enabled: false },
        worker: { adapter: 'no-compact', model: 'nc-model' },
      },
    });

    // 产生超过 6 条历史事件（3 轮完整对话）
    await exec({ type: 'send', id: 'u1', text: '第一轮审计记录' });
    await exec({ type: 'send', id: 'u2', text: '第二轮审计记录' });
    await exec({ type: 'send', id: 'u3', text: '第三轮审计记录' });

    const beforeWelcome = (await controller.welcome()) as Extract<ServerMessage, { type: 'welcome' }>;
    assert.ok(beforeWelcome.history.length > 12);
    const transcriptPath = join(root, 'transcripts', 'nc-session-1.jsonl');
    const diskBefore = await readFile(transcriptPath, 'utf8');

    replies.length = 0;
    broadcasts.length = 0;
    await exec({ type: 'compact_session' });

    const errMsg = replies.find(m => m.type === 'command_error' && m.commandType === 'compact_session') as
      | Extract<ServerMessage, { type: 'command_error' }>
      | undefined;
    assert.ok(errMsg, '不支持 compact 的 adapter 应明确返回 command_error');
    assert.match(errMsg.message, /不支持/);
    assert.ok(!broadcasts.some(m => m.type === 'event' && m.event.type === 'context_compacted'));
    assert.ok(!broadcasts.some(m => m.type === 'event' && m.event.type === 'context_usage'));

    const afterWelcome = (await controller.welcome()) as Extract<ServerMessage, { type: 'welcome' }>;
    assert.deepEqual(afterWelcome.history, beforeWelcome.history, '压缩失败后内存历史必须零改动');
    assert.equal(await readFile(transcriptPath, 'utf8'), diskBefore, '压缩失败后磁盘 JSONL 历史必须零改动');

    // 验证 Codex CLI 适配器同样明确拒绝且不删历史
    await exec({
      type: 'update_settings',
      patch: {
        worker: {
          adapter: 'codex',
          model: 'gpt-6.1-sol',
          extra: { executable: fakeCodexExe },
        },
      },
    });
    await exec({ type: 'send', id: 'cx1', text: 'Codex 第一轮任务' });
    await exec({ type: 'send', id: 'cx2', text: 'Codex 第二轮任务' });
    const codexBefore = (await controller.welcome()) as Extract<ServerMessage, { type: 'welcome' }>;
    assert.ok(codexBefore.history.some(e => e.type === 'user_message' && e.text === 'Codex 第一轮任务'));

    replies.length = 0;
    broadcasts.length = 0;
    await exec({ type: 'compact_session' });
    const codexErr = replies.find(m => m.type === 'command_error' && m.commandType === 'compact_session') as
      | Extract<ServerMessage, { type: 'command_error' }>
      | undefined;
    assert.ok(codexErr);
    assert.match(codexErr.message, /Codex CLI.*不支持/);
    assert.ok(!broadcasts.some(m => m.type === 'event' && m.event.type === 'context_compacted'));

    const codexAfter = (await controller.welcome()) as Extract<ServerMessage, { type: 'welcome' }>;
    assert.deepEqual(codexAfter.history, codexBefore.history, 'Codex 拒绝压缩后历史事件完整保留');

    await controller.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DSH 调用真实 session/query /compact RPC，使用引擎真实统计或 0（未提供统计），完整保留回看审计历史', async () => {
  const root = await makeSandbox('dsh-real-compact');
  const rpcLogPath = join(root, 'dsh-rpc-log.jsonl');
  const fakeDshExe = join(root, 'fake-dsh-compact.mjs');

  await writeFile(
    fakeDshExe,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) { console.log('0.2.2-rc.1'); process.exit(0); }
const send = v => process.stdout.write(JSON.stringify(v) + '\\n');
let compactCount = 0;
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  const q = JSON.parse(line);
  appendFileSync(${JSON.stringify(rpcLogPath)}, JSON.stringify({ method: q.method, params: q.params }) + '\\n');
  if (q.method === 'initialize') {
    send({ jsonrpc: '2.0', id: q.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } });
    return;
  }
  if (q.method === 'session/resume') {
    send({ jsonrpc: '2.0', id: q.id, result: {} });
    return;
  }
  if (q.method === 'session/prompt') {
    const text = q.params?.contentBlocks?.[0]?.text || '';
    send({ jsonrpc: '2.0', id: q.id, result: { messageId: 'm_' + q.id } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { sessionId: q.params.sessionId, event: { type: 'turn/start', data: { turn: 1 } } } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { sessionId: q.params.sessionId, event: { type: 'assistant/message', data: { stream: [{ type: 'chunk', chunk: { type: 'text', text: '执行完毕：' + text } }] } } } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { sessionId: q.params.sessionId, event: { type: 'turn/end', data: { reason: 'completed', usage: { totalTokens: 50000 }, maxContextTokens: 128000 } } } });
    return;
  }
  if (q.method === 'session/query') {
    const cmdText = q.params?.contentBlocks?.[0]?.text;
    if (cmdText === '/compact') {
      compactCount += 1;
      if (compactCount === 1) {
        // 第一次：真实 DSH 格式（summary 为 TextBlock[]，带真实 shadowedSeqs 与 shadowedTokenCount）
        send({
          jsonrpc: '2.0',
          method: 'session.event',
          params: {
            sessionId: q.params.sessionId,
            event: {
              type: 'compaction/summary',
              data: {
                compactionId: 'cmp-1',
                summary: [{ type: 'text', text: '## Primary Request\\n- 完成鉴权模块重构与会话审计' }],
                shadowedRange: { start: 1, end: 4 },
                shadowedSeqs: [1, 2, 3, 4],
                shadowedTokenCount: 2468,
                provider: 'bigfish-endpoint',
                model: 'deepseek-chat',
              },
            },
          },
        });
        send({
          jsonrpc: '2.0',
          id: q.id,
          result: {
            kind: 'command',
            execution: {
              commandId: 'cmd-1',
              result: {
                kind: 'success',
                text: 'Compacted 4 history items (~2468 tokens).',
                sourceEventSeq: 9,
              },
            },
          },
        });
      } else if (compactCount === 2) {
        // 第二次：引擎返回无 token 统计字段
        send({
          jsonrpc: '2.0',
          method: 'session.event',
          params: {
            sessionId: q.params.sessionId,
            event: {
              type: 'compaction/summary',
              data: {
                compactionId: 'cmp-2',
                summary: [{ type: 'text', text: '二次检查点摘要' }],
                shadowedSeqs: [5, 6],
              },
            },
          },
        });
        send({
          jsonrpc: '2.0',
          id: q.id,
          result: {
            kind: 'command',
            execution: {
              commandId: 'cmd-2',
              result: { kind: 'success', text: 'Compacted.', sourceEventSeq: 12 },
            },
          },
        });
      } else {
        // 第三次：无可压缩历史，不可假成功
        send({
          jsonrpc: '2.0',
          id: q.id,
          result: {
            kind: 'command',
            execution: {
              commandId: 'cmd-3',
              result: { kind: 'success', text: 'No compactable history yet.' },
            },
          },
        });
      }
      return;
    }
  }
  if (q.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: q.id, result: {} });
    process.exit(0);
  }
});
`,
    { mode: 0o755 }
  );

  try {
    const store = new SettingsStore(join(root, 'settings.json'));
    await store.load();
    const catalog = new CharacterCatalog(charactersRoot);
    await catalog.load();
    const dshAdapter = new DshAdapter(join(root, 'dsh-home'));
    const broadcasts: ServerMessage[] = [];
    const controller = new SessionController(
      store,
      catalog,
      new AdapterRegistry([dshAdapter]),
      msg => broadcasts.push(msg)
    );
    const replies: ServerMessage[] = [];
    const exec = (cmd: any) => controller.command(cmd, msg => replies.push(msg));

    await exec({
      type: 'update_settings',
      patch: {
        projectDir: root,
        voice: { enabled: false },
        worker: {
          adapter: 'dsh',
          model: 'deepseek-chat',
          connection: 'agent-default',
          extra: { executable: fakeDshExe },
        },
      },
    });

    for (const i of [1, 2, 3, 4]) {
      await exec({ type: 'send', id: `dsh_u${i}`, text: `第 ${i} 轮 DSH 任务指令` });
      // 等待异步 turn_done 落定
      for (let wait = 0; wait < 50; wait++) {
        const w = (await controller.welcome()) as Extract<ServerMessage, { type: 'welcome' }>;
        if (!w.session?.turnActive && w.history.filter(e => e.type === 'turn_done').length >= i) break;
        await new Promise(r => setTimeout(r, 15));
      }
    }

    // 第 1 次真实压缩：验证真实 RPC 调用、真实引擎数值（2468 而非 50000*0.68=34000）、完整保留 4 轮历史
    broadcasts.length = 0;
    replies.length = 0;
    await exec({ type: 'compact_session' });
    assert.equal(replies.filter(m => m.type === 'command_error').length, 0);

    const compactedEvents1 = broadcasts.filter(
      (m): m is Extract<ServerMessage, { type: 'event' }> => m.type === 'event' && m.event.type === 'context_compacted'
    );
    assert.equal(compactedEvents1.length, 1, '手动压缩只应发出唯一一条 context_compacted 事件');
    const ev1 = compactedEvents1[0].event as Extract<typeof compactedEvents1[0]['event'], { type: 'context_compacted' }>;
    assert.equal(ev1.turnsCompacted, 4);
    assert.equal(ev1.freedTokens, 2468, '必须采用引擎真实统计值，严禁按 68% 估算');
    assert.equal(ev1.afterTokens, undefined);
    assert.match(ev1.summary ?? '', /完成鉴权模块重构与会话审计/);
    assert.ok(
      !broadcasts.some(m => m.type === 'event' && m.event.type === 'context_usage'),
      '引擎未返回压缩后 afterTokens 时不得伪造 context_usage 事件'
    );

    const welcomeAfter1 = (await controller.welcome()) as Extract<ServerMessage, { type: 'welcome' }>;
    for (const i of [1, 2, 3, 4]) {
      assert.ok(
        welcomeAfter1.history.some(e => e.type === 'user_message' && e.text === `第 ${i} 轮 DSH 任务指令`),
        `压缩后第 ${i} 轮用户历史回看记录必须保留`
      );
    }

    const rpcLines = (await readFile(rpcLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l));
    assert.ok(
      rpcLines.some(
        r =>
          r.method === 'session/query' &&
          Array.isArray(r.params?.contentBlocks) &&
          r.params.contentBlocks[0]?.text === '/compact'
      ),
      '必须通过真实 DSH SDK session/query 发送 /compact 原生命令'
    );

    // 第 2 次压缩（无 token 统计）：验证 freedTokens 为 0 且 summary 明确说明未提供统计
    broadcasts.length = 0;
    await exec({ type: 'compact_session' });
    const ev2Msg = broadcasts.find(m => m.type === 'event' && m.event.type === 'context_compacted') as
      | Extract<ServerMessage, { type: 'event' }>
      | undefined;
    assert.ok(ev2Msg && ev2Msg.event.type === 'context_compacted');
    assert.equal(ev2Msg.event.freedTokens, 0);
    assert.match(ev2Msg.event.summary ?? '', /未提供释放 Token 统计/);

    // 第 3 次压缩（DSH 返回 No compactable history yet.）：明确报错，不假成功
    replies.length = 0;
    broadcasts.length = 0;
    await exec({ type: 'compact_session' });
    const err3 = replies.find(m => m.type === 'command_error' && m.commandType === 'compact_session') as
      | Extract<ServerMessage, { type: 'command_error' }>
      | undefined;
    assert.ok(err3, '无可压缩历史时应明确返回错误而非假成功');
    assert.match(err3.message, /暂无可压缩/);
    assert.ok(!broadcasts.some(m => m.type === 'event' && m.event.type === 'context_compacted'));

    await controller.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DirectChat 本地实际压缩内部 messages 且零网络调用，freedTokens=0 并保留完整舞台历史', async () => {
  const root = await makeSandbox('direct-chat-compact');
  const outboundPayloads: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  const mockEndpoint = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    outboundPayloads.push(body);
    const lastUser = [...(body.messages ?? [])].reverse().find((m: any) => m.role === 'user')?.content ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: `模型答复(${outboundPayloads.length}): ${lastUser}` } }],
        usage: { total_tokens: 4200 },
      })
    );
  });
  await new Promise<void>(resolve => mockEndpoint.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(mockEndpoint.address() as { port: number }).port}/v1`;

  try {
    const store = new SettingsStore(join(root, 'settings.json'));
    await store.load();
    const catalog = new CharacterCatalog(charactersRoot);
    await catalog.load();
    const directAdapter = new DirectChatAdapter();
    const broadcasts: ServerMessage[] = [];
    const controller = new SessionController(
      store,
      catalog,
      new AdapterRegistry([directAdapter]),
      msg => broadcasts.push(msg)
    );
    const replies: ServerMessage[] = [];
    const exec = (cmd: any) => controller.command(cmd, msg => replies.push(msg));

    await exec({
      type: 'update_settings',
      patch: {
        projectDir: root,
        voice: { enabled: false },
        worker: {
          adapter: 'direct-chat',
          model: 'deepseek-chat',
          connection: 'endpoint',
          endpoint: { baseUrl, apiKey: 'test-only' },
        },
      },
    });

    await exec({ type: 'send', id: 'dc1', text: '第一轮：初始化数据库表结构 users 与 sessions' });
    await exec({ type: 'send', id: 'dc2', text: '第二轮：补充唯一索引与迁移脚本校验' });
    await exec({ type: 'send', id: 'dc3', text: '第三轮：编写连接池健康检查接口' });
    assert.equal(outboundPayloads.length, 3);
    assert.equal(outboundPayloads[2].messages.length, 6, '压缩前第 3 轮请求包含 system + 5 条历史/当前消息');

    // 执行压缩：不应产生任何新的 HTTP 请求
    broadcasts.length = 0;
    await exec({ type: 'compact_session' });
    assert.equal(outboundPayloads.length, 3, 'DirectChat 压缩必须是本地压缩，不发起额外网络模型调用');

    const compactedMsg = broadcasts.find(m => m.type === 'event' && m.event.type === 'context_compacted') as
      | Extract<ServerMessage, { type: 'event' }>
      | undefined;
    assert.ok(compactedMsg && compactedMsg.event.type === 'context_compacted');
    assert.equal(compactedMsg.event.turnsCompacted, 2);
    assert.equal(compactedMsg.event.freedTokens, 0, 'DirectChat 无分词统计时 freedTokens 必须为 0');
    assert.match(compactedMsg.event.summary ?? '', /未提供释放 Token 统计/);

    // 舞台历史必须完整保留全部 3 轮记录
    const welcomeState = (await controller.welcome()) as Extract<ServerMessage, { type: 'welcome' }>;
    assert.ok(welcomeState.history.some(e => e.type === 'user_message' && e.text.includes('第一轮：初始化数据库')));
    assert.ok(welcomeState.history.some(e => e.type === 'user_message' && e.text.includes('第二轮：补充唯一索引')));
    assert.ok(welcomeState.history.some(e => e.type === 'user_message' && e.text.includes('第三轮：编写连接池')));

    // 发送第 4 轮：验证发给服务端模型的 messages 确实被压缩了！
    await exec({ type: 'send', id: 'dc4', text: '第四轮：输出最终上线清单' });
    assert.equal(outboundPayloads.length, 4);
    const fourthMessages = outboundPayloads[3].messages;
    assert.equal(fourthMessages.length, 4, '压缩后第 4 轮请求仅含带摘要的 system + 最近 1 轮问答(2条) + 当前提问(1条)');
    assert.equal(fourthMessages[0].role, 'system');
    assert.match(fourthMessages[0].content, /【前序对话压缩摘要】/);
    assert.match(fourthMessages[0].content, /第一轮：初始化数据库/);
    assert.ok(!fourthMessages.slice(1).some(m => m.content.includes('第一轮：初始化数据库')));

    // 额外直测空 DirectEndpointSession 压缩不会假成功
    const emptyDirect = new DirectEndpointSession({
      cwd: root,
      model: 'deepseek-chat',
      connection: 'endpoint',
      endpoint: { baseUrl },
      sandbox: 'workspace-write',
      onEvent() {},
    });
    await assert.rejects(emptyDirect.compact(), /暂无可压缩/);

    await controller.close();
  } finally {
    mockEndpoint.closeAllConnections();
    await new Promise<void>(resolve => mockEndpoint.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('运行中与启动期竞态：忙碌时拒绝切换角色与修改模型/项目/大脑配置，不篡改 store 与活跃 worker', async () => {
  const root = await makeSandbox('busy-guards');
  const otherDir = join(root, 'other-project');
  await mkdir(otherDir, { recursive: true });

  let releaseStart: (() => void) | undefined;
  let finishTurn: (() => void) | undefined;
  let closeCalls = 0;

  class ControllableAdapter implements WorkerAdapter {
    readonly id = 'dsh';
    readonly supportsCompact = true;
    starts: StartSessionOptions[] = [];

    async info() {
      return { id: this.id, name: 'Controllable DSH', available: true };
    }
    async listModels() {
      return { models: ['model-init', 'model-hijack'] };
    }
    async testConnection() {
      return { ok: true, message: 'ok' };
    }
    async startSession(options: StartSessionOptions): Promise<WorkerSession> {
      this.starts.push(options);
      await new Promise<void>(resolve => {
        releaseStart = resolve;
      });
      const sessionId = options.resumeId ?? 'ctrl-room-1';
      let active = false;
      options.onEvent({
        type: 'session_started',
        at: Date.now(),
        sessionId,
        model: options.model,
        cwd: options.cwd,
      });
      return {
        sessionId,
        get turnActive() {
          return active;
        },
        async send(id, text) {
          active = true;
          options.onEvent({ type: 'user_message', at: Date.now(), id, text });
          options.onEvent({ type: 'thinking', at: Date.now() });
          finishTurn = () => {
            active = false;
            options.onEvent({
              type: 'worker_text',
              at: Date.now(),
              text: `[${options.model}] 处理完成: ${text}`,
              final: true,
            });
            options.onEvent({ type: 'turn_done', at: Date.now(), ok: true, summary: '完成' });
          };
        },
        async steer() {},
        async interrupt() {
          active = false;
        },
        async decidePermission() {},
        async compact() {
          return { turnsCompacted: 1, freedTokens: 500, summary: 'ok' };
        },
        async close() {
          closeCalls += 1;
          active = false;
        },
      };
    }
  }

  try {
    const store = new SettingsStore(join(root, 'settings.json'));
    await store.load();
    const catalog = new CharacterCatalog(charactersRoot);
    await catalog.load();
    const adapter = new ControllableAdapter();
    const broadcasts: ServerMessage[] = [];
    const controller = new SessionController(
      store,
      catalog,
      new AdapterRegistry([adapter]),
      msg => broadcasts.push(msg)
    );
    const exec = (cmd: any) => {
      const localReplies: ServerMessage[] = [];
      return controller.command(cmd, msg => localReplies.push(msg)).then(() => localReplies);
    };

    await exec({
      type: 'update_settings',
      patch: {
        projectDir: root,
        voice: { enabled: false },
        worker: { adapter: 'dsh', model: 'model-init' },
      },
    });
    const canonicalRoot = store.current.projectDir!;

    // 阶段 1：启动期竞态（send 正在 startSession 异步等待，managementBusy=true 且 worker 尚未建立）
    const pendingSend = exec({ type: 'send', id: 'race-1', text: '长耗时任务' });
    while (!releaseStart) {
      await new Promise(r => setTimeout(r, 5));
    }

    const raceSwitch = await exec({ type: 'switch_character', characterId: 'claude-opus-5-5' });
    assert.ok(raceSwitch.some(m => m.type === 'command_error' && m.commandType === 'switch_character'));
    assert.equal(store.current.activeCharacterId, 'deepseek-v4-pro', '启动期间切角色必须被拒绝且不改设置');

    const raceModel = await exec({ type: 'update_settings', patch: { worker: { model: 'model-hijack' } } });
    assert.ok(raceModel.some(m => m.type === 'command_error' && m.commandType === 'update_settings'));
    assert.equal(store.current.worker.model, 'model-init', '启动期间改模型必须被拒绝且不改设置');

    const raceProject = await exec({ type: 'update_settings', patch: { projectDir: otherDir } });
    assert.ok(raceProject.some(m => m.type === 'command_error' && m.commandType === 'update_settings'));
    assert.equal(store.current.projectDir, canonicalRoot, '启动期间改项目目录必须被拒绝');

    const raceCompact = await exec({ type: 'compact_session' });
    assert.ok(raceCompact.some(m => m.type === 'command_error' && m.commandType === 'compact_session'));

    const raceBaton = await exec({ type: 'baton_pass', toCharacterId: 'claude-opus-5-5' });
    assert.ok(raceBaton.some(m => m.type === 'command_error' && m.commandType === 'baton_pass'));

    // 放行会话启动，进入运行期（turnActive=true，managementBusy=false）
    releaseStart();
    await pendingSend;
    assert.ok(finishTurn, '任务已进入运行中状态');
    assert.equal(closeCalls, 0);

    // 阶段 2：任务运行中（turnActive=true）拦截切换角色、改模型、改项目、改角色大脑
    const busySwitch = await exec({ type: 'switch_character', characterId: 'gemini-4-argon' });
    assert.ok(busySwitch.some(m => m.type === 'command_error' && m.commandType === 'switch_character'));
    assert.equal(store.current.activeCharacterId, 'deepseek-v4-pro');

    const busyCharPatch = await exec({ type: 'update_settings', patch: { activeCharacterId: 'gemini-4-argon' } });
    assert.ok(busyCharPatch.some(m => m.type === 'command_error' && m.commandType === 'update_settings'));
    assert.equal(store.current.activeCharacterId, 'deepseek-v4-pro');

    const busyWorkerPatch = await exec({ type: 'update_settings', patch: { worker: { model: 'model-hijack' } } });
    assert.ok(busyWorkerPatch.some(m => m.type === 'command_error' && m.commandType === 'update_settings'));
    assert.equal(store.current.worker.model, 'model-init');

    const busyBrainPatch = await exec({
      type: 'update_settings',
      patch: { characterBrains: { 'deepseek-v4-pro': { model: 'model-hijack' } } },
    });
    assert.ok(busyBrainPatch.some(m => m.type === 'command_error' && m.commandType === 'update_settings'));
    assert.equal(store.current.characterBrains['deepseek-v4-pro']?.model, undefined);

    const busyDirPatch = await exec({ type: 'update_settings', patch: { projectDir: otherDir } });
    assert.ok(busyDirPatch.some(m => m.type === 'command_error' && m.commandType === 'update_settings'));
    assert.equal(store.current.projectDir, canonicalRoot);
    assert.equal(closeCalls, 0, '忙碌拒绝配置变更时绝不能关闭活跃 worker');

    // 非运行态展示偏好（打字机速度）在运行中仍可安全调整
    const perfPatch = await exec({ type: 'update_settings', patch: { performance: { typingCharsPerSec: 65 } } });
    assert.equal(perfPatch.filter(m => m.type === 'command_error').length, 0);
    assert.equal(store.current.performance.typingCharsPerSec, 65);
    assert.equal(closeCalls, 0);

    // 结束当前轮次后，切角色和改模型恢复可用
    finishTurn!();
    const idleModelPatch = await exec({ type: 'update_settings', patch: { worker: { model: 'model-hijack' } } });
    assert.equal(idleModelPatch.filter(m => m.type === 'command_error').length, 0);
    assert.equal(store.current.worker.model, 'model-hijack');
    assert.equal(closeCalls, 1, '空闲改模型应关闭旧 worker 以便下轮使用新模型');

    const idleSwitch = await exec({ type: 'switch_character', characterId: 'claude-opus-5-5' });
    assert.equal(idleSwitch.filter(m => m.type === 'command_error').length, 0);
    assert.equal(store.current.activeCharacterId, 'claude-opus-5-5');

    await controller.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('独立 Web 真实接力（baton_pass）与空闲换模型正确传递目标模型、历史与交接上下文', async () => {
  const root = await makeSandbox('baton-and-model-switch');

  class RelayAuditAdapter implements WorkerAdapter {
    readonly id = 'dsh';
    readonly supportsCompact = true;
    starts: StartSessionOptions[] = [];
    sends: Array<{ sessionId: string; model: string; id: string; text: string }> = [];
    private seq = 0;

    async info() {
      return { id: this.id, name: 'Relay Audit DSH', available: true };
    }
    async listModels() {
      return { models: ['fish-v1', 'fish-v2', 'dragon-review-v1', 'dragon-review-v2'] };
    }
    async testConnection() {
      return { ok: true, message: 'ok' };
    }
    async startSession(options: StartSessionOptions): Promise<WorkerSession> {
      this.starts.push(options);
      const sessionId = options.resumeId ?? `relay_room_${++this.seq}`;
      options.onEvent({
        type: 'session_started',
        at: Date.now(),
        sessionId,
        model: options.model,
        cwd: options.cwd,
      });
      return {
        sessionId,
        turnActive: false,
        send: async (id, text) => {
          this.sends.push({ sessionId, model: options.model, id, text });
          options.onEvent({ type: 'user_message', at: Date.now(), id, text });
          options.onEvent({ type: 'thinking', at: Date.now() });
          if (sessionId === 'relay_room_1' && this.sends.length === 1) {
            options.onEvent({
              type: 'tool_start',
              at: Date.now(),
              toolUseId: 'edit-auth',
              tool: 'edit',
              rawName: 'str_replace_editor',
              summary: 'edit src/session.ts',
              file: 'src/session.ts',
            });
            options.onEvent({
              type: 'tool_end',
              at: Date.now(),
              toolUseId: 'edit-auth',
              ok: true,
              summary: 'edit src/session.ts',
            });
          }
          options.onEvent({
            type: 'worker_text',
            at: Date.now(),
            text: `[${options.model}] 已完成：${text.split('\n')[0]}`,
            final: true,
          });
          options.onEvent({ type: 'turn_done', at: Date.now(), ok: true, summary: '完成' });
        },
        async steer() {},
        async interrupt() {},
        async decidePermission() {},
        async close() {},
      };
    }
  }

  try {
    const store = new SettingsStore(join(root, 'settings.json'));
    await store.load();
    const catalog = new CharacterCatalog(charactersRoot);
    await catalog.load();
    const adapter = new RelayAuditAdapter();
    const broadcasts: ServerMessage[] = [];
    const controller = new SessionController(
      store,
      catalog,
      new AdapterRegistry([adapter]),
      msg => broadcasts.push(msg)
    );
    const replies: ServerMessage[] = [];
    const exec = (cmd: any) => controller.command(cmd, msg => replies.push(msg));

    await exec({
      type: 'update_settings',
      patch: {
        projectDir: root,
        voice: { enabled: false },
        worker: { adapter: 'dsh', model: 'fish-v1' },
        characterBrains: {
          'deepseek-v4-pro': { model: 'fish-v1' },
          'codex-dragon': { model: 'dragon-review-v1' },
        },
      },
    });

    // 1. 大肥鱼以 fish-v1 执行首轮开发
    await exec({ type: 'send', id: 'f1', text: '实现会话压缩与忙锁保护' });
    assert.equal(adapter.starts.at(-1)?.model, 'fish-v1');
    assert.equal(adapter.sends.at(-1)?.sessionId, 'relay_room_1');

    // 2. 空闲更换大肥鱼模型为 fish-v2，再发消息应在同房间 relay_room_1 用新模型 fish-v2 执行
    await exec({
      type: 'update_settings',
      patch: { characterBrains: { 'deepseek-v4-pro': { model: 'fish-v2' } } },
    });
    await exec({ type: 'send', id: 'f2', text: '补充边界检查' });
    assert.equal(adapter.starts.at(-1)?.model, 'fish-v2');
    assert.equal(adapter.starts.at(-1)?.resumeId, 'relay_room_1');
    assert.equal(adapter.sends.at(-1)?.model, 'fish-v2');

    // 3. 更新接力目标角色 codex-dragon 的模型为 dragon-review-v2，执行 baton_pass 真实接力
    await exec({
      type: 'update_settings',
      patch: { characterBrains: { 'codex-dragon': { model: 'dragon-review-v2' } } },
    });
    broadcasts.length = 0;
    await exec({
      type: 'baton_pass',
      toCharacterId: 'codex-dragon',
      instruction: '重点审查并发竞态与历史保留逻辑',
    });

    assert.equal(store.current.activeCharacterId, 'codex-dragon');
    assert.ok(broadcasts.some(m => m.type === 'event' && m.event.type === 'baton_pass'));

    const relayStart = adapter.starts.at(-1)!;
    assert.equal(relayStart.model, 'dragon-review-v2', '接力会话必须使用目标角色最新配置的专属模型');

    const relaySend = adapter.sends.at(-1)!;
    assert.equal(relaySend.sessionId, 'relay_room_2', '接力应在目标角色独立房间执行');
    assert.equal(relaySend.model, 'dragon-review-v2');
    assert.match(relaySend.text, /【角色换手交接 · Agent Relay】/);
    assert.match(relaySend.text, /src\/session\.ts/, '接力提示词应包含前棒涉及的修改文件');
    assert.match(relaySend.text, /重点审查并发竞态与历史保留逻辑/);

    await controller.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
