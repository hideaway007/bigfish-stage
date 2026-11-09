/** Explicit real-model acceptance run: four Codex turns maximum; npm test never invokes it. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type { ClientCommand, ServerMessage } from '../../src/shared/wire';
import { startServer } from '../src/index';
import { scrubFixture } from './scrub';

const run = promisify(execFile), root = '/tmp/bigfish-c-sandbox', project = join(root, 'project');
await mkdir(project, { recursive: true });
await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'local-acceptance-fixture', private: true, scripts: { test: 'node --test add.test.cjs' } }));
await writeFile(join(project, 'add.cjs'), 'module.exports = (a, b) => a - b;\n');
await writeFile(join(project, 'add.test.cjs'), "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst add = require('./add.cjs');\ntest('adds numbers', () => assert.equal(add(2, 3), 5));\n");
await rm(join(project, 'stop-should-not-exist.txt'), { force: true });
await rm(join(project, 'denied-should-not-exist.txt'), { force: true });
await run('git', ['init', '-b', 'task-c-server'], { cwd: project });
await run('git', ['add', 'package.json', 'add.cjs', 'add.test.cjs'], { cwd: project });
try { await run('git', ['-c', 'user.name=Fixture Tester', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initialize intentionally failing local fixture'], { cwd: project }); } catch { /* A repeated run may already have the same fixture committed. */ }
await assert.rejects(run('npm', ['test'], { cwd: project }));
console.log('沙盒就绪，初始 npm test 按预期失败。');
const app = await startServer({ port: 0, settingsPath: join(root, 'state/settings.json'), charactersRoot: new URL('./fixtures/characters/', import.meta.url).pathname });
const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`, { origin: 'http://localhost:5173' });
const messages: ServerMessage[] = [];
socket.on('message', bytes => { const m = JSON.parse(bytes.toString()) as ServerMessage; messages.push(m); if (m.type === 'event' && ['permission_request', 'turn_done', 'interrupted', 'steer_acked'].includes(m.event.type)) console.log(JSON.stringify(scrubFixture(m))); });
const send = (command: ClientCommand) => socket.send(JSON.stringify(command));
function wait(predicate: (message: ServerMessage) => boolean, from = 0, timeoutMs = 180_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const existing = messages.slice(from).find(predicate); if (existing) { resolve(existing); return; }
    const timer = setTimeout(() => { socket.off('message', listen); reject(new Error('等待真实流程消息超时')); }, timeoutMs);
    const listen = (bytes: Buffer) => {
      const m = JSON.parse(bytes.toString()) as ServerMessage;
      if (m.type === 'command_error') { clearTimeout(timer); socket.off('message', listen); reject(new Error(`${m.commandType}: ${m.message}`)); }
      else if (predicate(m)) { clearTimeout(timer); socket.off('message', listen); resolve(m); }
    };
    socket.on('message', listen);
  });
}
const event = (type: string) => (m: ServerMessage) => m.type === 'event' && m.event.type === type;
let split = 0, turns = 0;
try {
  await new Promise<void>((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject); });
  send({ type: 'hello', protocolVersion: 1 }); await wait(m => m.type === 'welcome');
  send({ type: 'update_settings', patch: { projectDir: project, activeCharacterId: 'deepseek-v4-pro', worker: { adapter: 'codex', model: 'gpt-6-luna', sandbox: 'workspace-write' }, voice: { enabled: true, maxLinesPerMinute: 6, endpoint: { baseUrl: 'http://127.0.0.1:3425/v1', model: 'remote-magpie/antigravity/gemini-3.8-flash', apiKey: '' } } } });
  await wait(m => m.type === 'settings');
  for (const target of ['worker', 'voice'] as const) {
    const from = messages.length;
    send({ type: 'list_models', target });
    const listed = await wait(m => m.type === 'models' && m.target === target, from);
    assert.ok(listed.models.length > 0, listed.error);
    send({ type: 'test_connection', target });
    const connected = await wait(m => m.type === 'connection_test' && m.target === target, from);
    assert.equal(connected.ok, true, connected.message);
  }
  send({ type: 'new_session' }); const started = await wait(m => m.type === 'session' && m.session !== null); const sessionId = started.session.sessionId;
  split = messages.length;
  turns++; send({ type: 'send', id: 'repair', text: '只在当前项目工作，不要运行 git。记住暗号 BLUE_FISH_42。读取 add.cjs 与 add.test.cjs，修复加法实现，然后执行 npm test 验证。重要：执行 npm test 时请明确请求 require_escalated（sandbox_permissions），由客户端用户审批；不要在审批前运行测试。如果请求被拒绝不要重试。完成后简短报告。' });
  await wait(event('tool_start'), split);
  const approval = await wait(event('permission_request'), split);
  send({ type: 'permission_decision', requestId: approval.event.requestId, allowed: true });
  const done = await wait(event('turn_done'), split); assert.equal(done.event.ok, true);
  await run('npm', ['test'], { cwd: project });
  await wait(m => m.type === 'event' && m.event.type === 'character_line' && m.event.source === 'model', split, 15_000);
  const presetIds = new Set(messages.filter(m => m.type === 'event' && m.event.type === 'character_line' && m.event.source === 'preset').map(m => (m as any).event.lineId));
  assert.ok(messages.some(m => m.type === 'event' && m.event.type === 'character_line' && m.event.source === 'model' && presetIds.has(m.event.replacesLineId)));
  await writeFile(new URL('./fixtures/e2e-repair.jsonl', import.meta.url), messages.map(m => JSON.stringify(scrubFixture(m))).join('\n') + '\n');
  console.log('修复、真实 allow、npm test 和模型替换台词均通过。');

  split = messages.length;
  turns++; send({ type: 'send', id: 'interrupt', text: `请立即只执行一个长命令：node -e "setTimeout(()=>require('node:fs').writeFileSync('stop-should-not-exist.txt','unexpected'),20000)"。不要改命令，不要拆分，不要用其他工具；它用于验证中断。只在当前目录工作。` });
  await wait(m => m.type === 'event' && m.event.type === 'tool_start' && m.event.summary.includes('stop-should-not-exist'), split);
  send({ type: 'steer', id: 'steer-live', text: '插话验证：当前命令结束后只回复收到，不要再运行任何命令。' });
  await wait(m => m.type === 'event' && m.event.type === 'steer_acked' && m.event.id === 'steer-live', split);
  send({ type: 'stop' }); await wait(event('interrupted'), split); const stopped = await wait(event('turn_done'), split); assert.equal(stopped.event.ok, false);
  await assert.rejects(readFile(join(project, 'stop-should-not-exist.txt')));
  await writeFile(new URL('./fixtures/e2e-steer-stop.jsonl', import.meta.url), messages.slice(split).map(m => JSON.stringify(scrubFixture(m))).join('\n') + '\n');
  console.log('真实 steer 回显与 stop 收尾均通过。');

  split = messages.length;
  send({ type: 'resume_session', sessionId }); await wait(m => m.type === 'session' && m.session?.sessionId === sessionId, split);
  turns++; send({ type: 'send', id: 'resume', text: '不要用任何工具。我们这段会话开始时要求你记住的暗号是什么？只回复暗号。' });
  await wait(event('turn_done'), split);
  assert.ok(messages.slice(split).some(m => m.type === 'event' && m.event.type === 'worker_text' && m.event.text.includes('BLUE_FISH_42')));
  await writeFile(new URL('./fixtures/e2e-resume.jsonl', import.meta.url), messages.slice(split).map(m => JSON.stringify(scrubFixture(m))).join('\n') + '\n');

  split = messages.length;
  turns++; send({ type: 'send', id: 'deny', text: `只请求执行一次 shell 命令 node -e "require('node:fs').writeFileSync('denied-should-not-exist.txt','unexpected')"，必须请求 require_escalated（sandbox_permissions）由客户端审批。用户拒绝后不要重试、不要用其他方式创建文件，简短报告拒绝结果。` });
  const denied = await wait(event('permission_request'), split); send({ type: 'permission_decision', requestId: denied.event.requestId, allowed: false });
  await wait(event('turn_done'), split); await assert.rejects(readFile(join(project, 'denied-should-not-exist.txt')));
  await writeFile(new URL('./fixtures/e2e-deny.jsonl', import.meta.url), messages.slice(split).map(m => JSON.stringify(scrubFixture(m))).join('\n') + '\n');
  await assert.rejects(readFile(join(project, 'stop-should-not-exist.txt')));
  console.log(`真实流程通过，Codex 本次 ${turns} 轮，模型 gpt-6-luna；停止的延迟写入经过后续轮次后仍未发生。`);
} finally {
  await writeFile(new URL('./fixtures/e2e-all.jsonl', import.meta.url), messages.map(m => JSON.stringify(scrubFixture(m))).join('\n') + '\n');
  socket.terminate(); await app.close();
}
