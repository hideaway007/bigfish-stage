import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { StageEvent } from '../../src/shared/stage-events';
import {
  buildDshLaunch,
  DshAdapter,
  DshEventMapper,
  mapToolKind,
  parseToolArgs,
  formatToolSummary,
} from '../src/adapters/dsh';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

test('DSH 工具类型映射与参数解析准确', () => {
  assert.equal(mapToolKind('bash'), 'bash');
  assert.equal(mapToolKind('execute_terminal_cmd'), 'bash');
  assert.equal(mapToolKind('fs_read'), 'read');
  assert.equal(mapToolKind('file_search'), 'search');
  assert.equal(mapToolKind('str_replace_editor'), 'edit');
  assert.equal(mapToolKind('fs_write'), 'write');
  assert.equal(mapToolKind('web_fetch'), 'web');
  assert.equal(mapToolKind('subagent_spawn'), 'task');
  assert.equal(mapToolKind('random_unrecognized_tool'), 'other');

  assert.deepEqual(parseToolArgs('{"command":"ls"}'), { command: 'ls' });
  assert.deepEqual(parseToolArgs({ command: 'ls' }), { command: 'ls' });
  assert.deepEqual(parseToolArgs(null), {});

  const bashSummary = formatToolSummary('bash', { command: 'echo hello' }, '/app', '/home/user');
  assert.ok(bashSummary.summary.includes('echo hello'));

  const fileSummary = formatToolSummary('fs_read', { path: '/app/src/index.ts' }, '/app', '/home/user');
  assert.equal(fileSummary.summary, 'fs_read src/index.ts');
  assert.equal(fileSummary.file, 'src/index.ts');
});

test('DSH 启动参数：自定义 Endpoint 生成动态 Patch YAML 配置', async () => {
  const tmp = await mkdtemp('/tmp/bigfish-dsh-test-');
  try {
    const inheritedEnv = { PATH: '/bin' };
    const settings = {
      ...DEFAULT_SETTINGS.worker,
      connection: 'endpoint' as const,
      endpoint: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-sk-123' },
      model: 'deepseek-chat',
    };
    const { args, patchFile } = await buildDshLaunch(settings, tmp, inheritedEnv);
    assert.ok(args.includes('--profile'));
    assert.ok(args.includes('sdk'));
    assert.ok(args.includes('--patch'));
    assert.ok(patchFile);
    assert.ok(patchFile.endsWith('dsh-endpoint-patch.yml'));
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('DshEventMapper：事件流式翻译（思考、文字、工具调用、完成）', () => {
  const events: StageEvent[] = [];
  const mapper = new DshEventMapper((e) => events.push(e), '/workspace', '/home/user');

  mapper.begin();

  // 1. turn/start -> thinking
  mapper.translate({
    method: 'session.event',
    params: {
      event: { type: 'turn/start', data: { turn: 1 } },
    },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'thinking');

  // 2. assistant/message -> worker_text
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'assistant/message',
        data: {
          turn: 1,
          stream: [
            { type: 'chunk', chunk: { type: 'text', text: '你好！' } },
            { type: 'chunk', chunk: { type: 'text', text: '这是测试。' } },
          ],
        },
      },
    },
  });

  // 3. tool/call -> tool_start (read should NOT pollute structuredDiffFiles)
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'tool/call',
        data: {
          callId: 'call-read',
          name: 'fs_read',
          arguments: JSON.stringify({ path: '/workspace/src/app.ts' }),
        },
      },
    },
  });
  assert.equal(mapper.structuredDiffFiles.size, 0);
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'tool/result',
        data: {
          callId: 'call-read',
          message: { content: [{ type: 'text', text: 'content' }], isError: false },
        },
      },
    },
  });
  assert.equal(mapper.structuredDiffFiles.size, 0);

  // 3b. tool/call + tool/result with diff -> records fileKey in structuredDiffFiles
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'tool/call',
        data: {
          callId: 'call-edit',
          name: 'str_replace_editor',
          arguments: JSON.stringify({ path: '/workspace/src/app.ts' }),
        },
      },
    },
  });
  assert.equal(mapper.structuredDiffFiles.size, 0);
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'tool/result',
        data: {
          callId: 'call-edit',
          meta: { diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n' },
          message: { content: [{ type: 'text', text: 'edited' }], isError: false },
        },
      },
    },
  });
  assert.equal(mapper.structuredDiffFiles.size, 1);

  // 3c. bash tool/call -> tool_start
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'tool/call',
        data: {
          callId: 'call-1',
          name: 'bash',
          arguments: JSON.stringify({ command: 'git status' }),
        },
      },
    },
  });

  const toolStart = events.find((e): e is Extract<StageEvent, { type: 'tool_start' }> => e.type === 'tool_start' && e.tool === 'bash');
  assert.ok(toolStart);
  assert.equal(toolStart.tool, 'bash');
  assert.ok(toolStart.summary.includes('git status'));

  // 4. tool/result -> tool_end
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'tool/result',
        data: {
          callId: 'call-1',
          message: {
            content: [{ type: 'text', text: 'On branch main' }],
            isError: false,
          },
        },
      },
    },
  });

  const toolEnd = events.find((e): e is Extract<StageEvent, { type: 'tool_end' }> => e.type === 'tool_end' && e.toolUseId === 'call-1');
  assert.ok(toolEnd);
  assert.equal(toolEnd.ok, true);
  assert.ok(toolEnd.output?.includes('On branch main'));

  // 5. turn/end -> turn_done
  mapper.translate({
    method: 'session.event',
    params: {
      event: {
        type: 'turn/end',
        data: { reason: 'completed' },
      },
    },
  });

  const turnDone = events.find((e) => e.type === 'turn_done');
  assert.ok(turnDone);
  assert.equal(turnDone.ok, true);

  mapper.dispose();
});

test('DSH 适配器生命周期模拟与会话建立', async () => {
  const root = await mkdtemp('/tmp/bigfish-dsh-fake-');
  const fakeDshScript = join(root, 'fake-dsh.mjs');

  await writeFile(
    fakeDshScript,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) {
  console.log('0.2.2-rc.1');
  process.exit(0);
}
const send = (v) => process.stdout.write(JSON.stringify(v) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const q = JSON.parse(line);
  if (q.method === 'initialize') {
    send({ jsonrpc: '2.0', id: q.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } });
  }
  if (q.method === 'session/prompt') {
    send({ jsonrpc: '2.0', id: q.id, result: { messageId: 'msg-01' } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'turn/start', data: { turn: 1 } } } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'assistant/message', data: { stream: [{ type: 'chunk', chunk: { type: 'text', text: '大肥鱼就绪！' } }] } } } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'turn/end', data: { reason: 'completed' } } } });
  }
  if (q.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: q.id, result: {} });
    process.exit(0);
  }
});
`,
    { mode: 0o755 }
  );

  const adapter = new DshAdapter(join(root, 'home'));
  const info = await adapter.info({ ...DEFAULT_SETTINGS.worker, extra: { executable: fakeDshScript } });
  assert.equal(info.available, true);
  assert.ok(info.name.includes('0.2.2-rc.1'));

  const events: StageEvent[] = [];
  const session = await adapter.startSession({
    ...DEFAULT_SETTINGS.worker,
    cwd: root,
    extra: { executable: fakeDshScript },
    onEvent: (e) => events.push(e),
  });

  assert.equal(session.turnActive, false);
  await session.send('msg-1', '测试问候');

  // 等待 turn_done 事件接收
  let attempts = 0;
  while (!events.some((e) => e.type === 'turn_done') && attempts++ < 50) {
    await delay(20);
  }

  assert.ok(events.some((e) => e.type === 'session_started'));
  assert.ok(events.some((e) => e.type === 'thinking'));
  assert.ok(events.some((e) => e.type === 'turn_done'));

  await session.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

test('DSH 适配器权限审批与插话机制', async () => {
  const root = await mkdtemp('/tmp/bigfish-dsh-approval-');
  const fakeDshScript = join(root, 'fake-dsh-approval.mjs');

  await writeFile(
    fakeDshScript,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) {
  console.log('0.2.2-rc.1');
  process.exit(0);
}
const send = (v) => process.stdout.write(JSON.stringify(v) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const q = JSON.parse(line);
  if (q.method === 'initialize') {
    send({ jsonrpc: '2.0', id: q.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } });
  }
  if (q.method === 'session/prompt') {
    send({ jsonrpc: '2.0', id: q.id, result: { messageId: 'msg-02' } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'turn/start', data: { turn: 1 } } } });
    // 发起审批请求
    send({ jsonrpc: '2.0', id: 99, method: 'approval/request', params: { toolName: 'bash', reason: '需要执行 rm 命令' } });
  }
  if (q.id === 99 && q.result) {
    // 审批被做出后完成任务
    send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'turn/end', data: { reason: 'completed' } } } });
  }
  if (q.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: q.id, result: {} });
    process.exit(0);
  }
});
`,
    { mode: 0o755 }
  );

  const adapter = new DshAdapter(join(root, 'home'));
  const events: StageEvent[] = [];
  const session = await adapter.startSession({
    ...DEFAULT_SETTINGS.worker,
    cwd: root,
    extra: { executable: fakeDshScript },
    onEvent: (e) => events.push(e),
  });

  await session.send('msg-2', '开始测试审批');

  let attempts = 0;
  while (!events.some((e) => e.type === 'permission_request') && attempts++ < 50) {
    await delay(20);
  }

  const req = events.find((e) => e.type === 'permission_request');
  assert.ok(req);
  assert.equal(req.tool, 'bash');
  assert.ok(req.detail.includes('需要执行 rm 命令'));

  // 决定允许执行
  await session.decidePermission(req.requestId, true);

  const resolved = events.find((e) => e.type === 'permission_resolved');
  assert.ok(resolved);
  assert.equal(resolved.allowed, true);

  while (!events.some((e) => e.type === 'turn_done') && attempts++ < 50) {
    await delay(20);
  }
  assert.ok(events.some((e) => e.type === 'turn_done'));

  await session.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

test('DSH 会话：interrupt 终止子进程后再次 send 自动拉起同 sessionId 子进程继续对话', async () => {
  const root = await mkdtemp('/tmp/bigfish-dsh-interrupt-');
  const fakeDshScript = join(root, 'fake-dsh-interrupt.mjs');

  await writeFile(
    fakeDshScript,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) {
  console.log('0.2.2-rc.1');
  process.exit(0);
}
const send = (v) => process.stdout.write(JSON.stringify(v) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const q = JSON.parse(line);
  if (q.method === 'initialize') {
    send({ jsonrpc: '2.0', id: q.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } });
  }
  if (q.method === 'session/prompt') {
    const text = q.params?.contentBlocks?.[0]?.text || '';
    send({ jsonrpc: '2.0', id: q.id, result: { messageId: 'msg-int' } });
    send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'turn/start', data: { turn: 1 } } } });
    if (text === 'slow-task') {
      // Simulate long-running task waiting to be interrupted
    } else {
      send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'assistant/message', data: { stream: [{ type: 'chunk', chunk: { type: 'text', text: '中断后恢复成功：' + q.params.sessionId } }] } } } });
      send({ jsonrpc: '2.0', method: 'session.event', params: { event: { type: 'turn/end', data: { reason: 'completed' } } } });
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

  const adapter = new DshAdapter(join(root, 'home'));
  const events: StageEvent[] = [];
  const session = await adapter.startSession({
    ...DEFAULT_SETTINGS.worker,
    cwd: root,
    extra: { executable: fakeDshScript },
    onEvent: (e) => events.push(e),
  });

  const initialSessionId = session.sessionId;
  await session.send('turn-1', 'slow-task');
  let attempts = 0;
  while (!events.some((e) => e.type === 'thinking') && attempts++ < 50) {
    await delay(20);
  }
  await session.interrupt();
  assert.equal(session.turnActive, false);
  assert.ok(events.some((e) => e.type === 'interrupted'));

  // Wait briefly for killed child process exit event
  await delay(50);

  // Send a second message in the same session after interrupt
  events.length = 0;
  await session.send('turn-2', 'after-interrupt');
  attempts = 0;
  while (!events.some((e) => e.type === 'turn_done') && attempts++ < 50) {
    await delay(20);
  }

  assert.equal(session.sessionId, initialSessionId);
  assert.ok(events.some((e) => e.type === 'worker_text' && e.text.includes(initialSessionId)));
  assert.ok(events.some((e) => e.type === 'turn_done' && e.ok));

  await session.close();
  await assert.rejects(session.send('turn-3', 'after-close'), /DSH 连接已关闭/);
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

