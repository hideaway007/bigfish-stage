import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { StageEvent } from '../../src/shared/stage-events';
import { CodexAdapter } from '../src/adapters/codex';

async function fakeCodex(mode: 'normal' | 'never' | 'crash' | 'approval' | 'readOnly') {
  await mkdir('/tmp/bigfish-c-sandbox/unit', { recursive: true });
  const root = await mkdtemp('/tmp/bigfish-c-sandbox/unit/codex-'), executable = join(root, 'fake-codex.mjs');
  await writeFile(executable, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const mode = ${JSON.stringify(mode)};
writeFileSync(${JSON.stringify(join(root, 'launch.json'))}, JSON.stringify(process.argv.slice(2)));
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({input: process.stdin}).on('line', line => {
  const q = JSON.parse(line);
  if (q.method === 'initialize') send({id:q.id, result:{}});
  if (q.method === 'thread/start' || q.method === 'thread/resume') send({id:q.id, result:{ thread:{id:'mock-thread', cwd:process.cwd()}, approvalPolicy:mode === 'never'?'never':'on-request', sandbox: mode === 'readOnly'?{type:'readOnly'}:{type:'workspaceWrite', excludeSlashTmp:true, excludeTmpdirEnvVar:true, writableRoots:[]} }});
  if (q.method === 'turn/start') setTimeout(() => {
    send({id:q.id,result:{turn:{id:'turn1'}}});
    send({method:'turn/started',params:{turn:{id:'turn1'}}});
    send({method:'item/started',params:{item:{type:'commandExecution',id:'cmd',command:'mock'}}});
    if (mode === 'crash') process.exit(2);
    if (mode === 'approval') send({id:7,method:'item/commandExecution/requestApproval',params:{command:'mock',reason:'test'}});
  }, 40);
  if (q.method === 'turn/interrupt') {
    send({id:q.id,result:{}});
    send({method:'turn/completed',params:{turn:{id:'turn1',status:'interrupted'}}});
  }
  if (!q.method && q.id === 7) send({method:'turn/completed',params:{turn:{id:'turn1',status:'completed'}}});
});
`, { mode: 0o700 });
  return { root, executable, adapter: new CodexAdapter(join(root, 'home')) };
}
async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await delay(10); }
  throw new Error('等待适配器事件超时');
}
test('每次启动显式覆盖 provider/审批/沙箱；拒绝实际 never 策略', async () => {
  const fake = await fakeCodex('never'), events: StageEvent[] = [];
  try {
    await assert.rejects(fake.adapter.startSession({ cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write', extra: { executable: fake.executable }, onEvent: e => events.push(e) }), /实际权限策略/);
    const args = JSON.parse(await readFile(join(fake.root, 'launch.json'), 'utf8'));
    for (const arg of ['approval_policy="on-request"', 'sandbox_mode="workspace-write"', 'sandbox_workspace_write.exclude_slash_tmp=true', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', 'sandbox_workspace_write.writable_roots=[]']) assert.ok(args.includes(arg));
    assert.ok(events.some(e => e.type === 'error')); assert.ok(!events.some(e => e.type === 'session_started'));
  } finally { await rm(fake.root, { recursive: true, force: true }); }
});
test('turn ID 返回前的 stop 会排队并收齐终态', async () => {
  const fake = await fakeCodex('normal'), events: StageEvent[] = [];
  const session = await fake.adapter.startSession({ cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write', extra: { executable: fake.executable }, onEvent: e => events.push(e) });
  try {
    const send = session.send('early', 'test'); await session.interrupt(); await send;
    await eventually(() => events.some(e => e.type === 'turn_done'));
    assert.equal(session.turnActive, false); assert.ok(events.some(e => e.type === 'interrupted'));
    assert.equal(events.filter(e => e.type === 'turn_done').length, 1);
    assert.ok(events.some(e => e.type === 'tool_end' && !e.ok));
  } finally { await session.close(); await rm(fake.root, { recursive: true, force: true }); }
});
test('子进程意外退出会补齐工具与失败终态', async () => {
  const fake = await fakeCodex('crash'), events: StageEvent[] = [];
  const session = await fake.adapter.startSession({ cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write', extra: { executable: fake.executable }, onEvent: e => events.push(e) });
  try {
    await session.send('crash', 'test'); await eventually(() => events.some(e => e.type === 'turn_done'));
    assert.equal(session.turnActive, false); assert.ok(events.some(e => e.type === 'tool_end' && !e.ok));
    assert.ok(events.some(e => e.type === 'turn_done' && !e.ok));
    await assert.rejects(session.send('closed', 'test'), /连接已关闭/);
  } finally { await session.close(); await rm(fake.root, { recursive: true, force: true }); }
});
test('审批 ID 带连接随机前缀，恢复同一 thread 也不会误用旧决定', async () => {
  const fake = await fakeCodex('approval'), events: StageEvent[] = [];
  const options = { cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write' as const, extra: { executable: fake.executable }, onEvent: (e: StageEvent) => events.push(e) };
  let session = await fake.adapter.startSession(options);
  try {
    await session.send('one', 'test'); await eventually(() => events.some(e => e.type === 'permission_request'));
    const first = events.find(e => e.type === 'permission_request') as Extract<StageEvent, { type: 'permission_request' }>;
    await session.decidePermission(first.requestId, false); await eventually(() => !session.turnActive); await session.close();
    events.length = 0;
    session = await fake.adapter.startSession({ ...options, resumeId: 'mock-thread' });
    await session.send('two', 'test'); await eventually(() => events.some(e => e.type === 'permission_request'));
    const second = events.find(e => e.type === 'permission_request') as Extract<StageEvent, { type: 'permission_request' }>;
    assert.notEqual(first.requestId, second.requestId);
    await assert.rejects(session.decidePermission(first.requestId, true), /审批已结束或不存在/);
    await session.decidePermission(second.requestId, true); await eventually(() => !session.turnActive);
  } finally { await session.close(); await rm(fake.root, { recursive: true, force: true }); }
});
test('read-only 设置也核验实际策略', async () => {
  const fake = await fakeCodex('readOnly');
  const session = await fake.adapter.startSession({ cwd: fake.root, model: 'gpt-6-luna', sandbox: 'read-only', extra: { executable: fake.executable }, onEvent() {} });
  try { assert.equal(session.sessionId, 'mock-thread'); }
  finally { await session.close(); await rm(fake.root, { recursive: true, force: true }); }
});
