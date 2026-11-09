import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { StageEvent } from '../../src/shared/stage-events';
import { buildCodexLaunch, CodexAdapter } from '../src/adapters/codex';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { createServer } from 'node:http';

async function fakeCodex(mode: 'normal' | 'never' | 'crash' | 'approval' | 'readOnly' | 'secret') {
  await mkdir('/tmp/bigfish-c-sandbox/unit', { recursive: true });
  const root = await mkdtemp('/tmp/bigfish-c-sandbox/unit/codex-'), executable = join(root, 'fake-codex.mjs');
  await writeFile(executable, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const mode = ${JSON.stringify(mode)};
if (process.argv.includes('--version')) { console.log('codex-cli fake'); process.exit(0); }
writeFileSync(${JSON.stringify(join(root, 'launch.json'))}, JSON.stringify(process.argv.slice(2)));
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({input: process.stdin}).on('line', line => {
  const q = JSON.parse(line);
  if (q.method === 'initialize') send({id:q.id, result:{}});
  if (q.method === 'model/list') send({id:q.id, result:{data:[{model:q.params.cursor?'second-model':'agent-model'}], nextCursor:q.params.cursor?null:'page2'}});
  if (q.method === 'thread/start' || q.method === 'thread/resume') send({id:q.id, result:{ thread:{id:'mock-thread', cwd:process.cwd()}, approvalPolicy:mode === 'never'?'never':'on-request', sandbox: mode === 'readOnly'?{type:'readOnly'}:{type:'workspaceWrite', excludeSlashTmp:true, excludeTmpdirEnvVar:true, writableRoots:[]} }});
  if (q.method === 'turn/start') setTimeout(() => {
    send({id:q.id,result:{turn:{id:'turn1'}}});
    send({method:'turn/started',params:{turn:{id:'turn1'}}});
    send({method:'item/started',params:{item:{type:'commandExecution',id:'cmd',command:'mock'}}});
    if (mode === 'secret') {
      send({method:'error',params:{error:{message:'provider echoed '+process.env.BIGFISH_WORKER_API_KEY}}});
      send({method:'turn/completed',params:{turn:{id:'turn1',status:'failed',error:{message:process.env.BIGFISH_WORKER_API_KEY}}}});
    }
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
test('启动参数：两种连接均强制安全策略；自定义接口的 Key 仅进入环境变量', () => {
  const inherited = { CODEX_HOME: '/user-codex', PATH: '/bin', BIGFISH_WORKER_API_KEY: 'stale-key' };
  const settings = { ...DEFAULT_SETTINGS.worker, endpoint: { baseUrl: 'https://provider.example/v1', apiKey: 'worker-test-secret' } };
  for (const connection of ['endpoint', 'agent-default'] as const) {
    for (const sandbox of ['read-only', 'workspace-write'] as const) {
      const { args, env } = buildCodexLaunch({ ...settings, connection, sandbox }, '/isolated', inherited);
      for (const arg of [`sandbox_mode="${sandbox}"`, 'approval_policy="on-request"', 'sandbox_workspace_write.exclude_slash_tmp=true', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', 'sandbox_workspace_write.writable_roots=[]']) assert.ok(args.includes(arg));
      assert.ok(!args.join(' ').includes(settings.endpoint.apiKey));
      assert.ok(!args.some(arg => arg.includes('bypass')));
      if (connection === 'endpoint') {
        assert.equal(env.CODEX_HOME, '/isolated');
        assert.equal(env.BIGFISH_WORKER_API_KEY, settings.endpoint.apiKey);
        assert.ok(args.includes('model_providers.bigfish.base_url="https://provider.example/v1"'));
        assert.ok(args.includes('model_providers.bigfish.env_key="BIGFISH_WORKER_API_KEY"'));
      } else {
        assert.equal(env.CODEX_HOME, inherited.CODEX_HOME);
        assert.equal(env.BIGFISH_WORKER_API_KEY, undefined);
        assert.ok(!args.some(arg => /model_provider|base_url|env_key/.test(arg)));
      }
    }
  }
  const noKey = buildCodexLaunch(DEFAULT_SETTINGS.worker, '/isolated', inherited);
  assert.equal(noKey.env.BIGFISH_WORKER_API_KEY, undefined);
  assert.ok(!noKey.args.some(arg => arg.includes('env_key')));
  const normalHome = buildCodexLaunch({ ...settings, connection: 'agent-default' }, '/isolated', {});
  assert.ok(!('CODEX_HOME' in normalHome.env));
  assert.equal(inherited.BIGFISH_WORKER_API_KEY, 'stale-key');
});

test('模型列表与连接测试分别使用自定义接口和 Agent 自带配置', async () => {
  const fake = await fakeCodex('normal');
  const requests: { url?: string; auth?: string }[] = [];
  const endpoint = createServer(async (req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    for await (const _chunk of req) { /* Drain request body. */ }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/v1/models' ? { data: [{ id: 'endpoint-model' }] } : { choices: [{}] }));
  });
  await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  try {
    const settings = { ...DEFAULT_SETTINGS.worker, extra: { executable: fake.executable }, endpoint: { baseUrl: `http://127.0.0.1:${(endpoint.address() as any).port}/v1`, apiKey: 'endpoint-secret' } };
    assert.deepEqual((await fake.adapter.listModels(settings)).models, ['endpoint-model']);
    assert.equal((await fake.adapter.testConnection(settings)).ok, true);
    assert.deepEqual(requests, [{ url: '/v1/models', auth: 'Bearer endpoint-secret' }, { url: '/v1/chat/completions', auth: 'Bearer endpoint-secret' }]);
    const agent = { ...settings, connection: 'agent-default' as const };
    assert.deepEqual((await fake.adapter.listModels(agent)).models, ['agent-model', 'second-model']);
    assert.equal((await fake.adapter.testConnection(agent)).ok, true);
    assert.equal(requests.length, 2);
    const args: string[] = JSON.parse(await readFile(join(fake.root, 'launch.json'), 'utf8'));
    assert.ok(!args.some(arg => arg.includes('model_provider')));
  } finally {
    endpoint.closeAllConnections(); await new Promise<void>(resolve => endpoint.close(() => resolve()));
    await rm(fake.root, { recursive: true, force: true });
  }
});

test('每次启动显式覆盖 provider/审批/沙箱；拒绝实际 never 策略', async () => {
  const fake = await fakeCodex('never'), events: StageEvent[] = [];
  try {
    await assert.rejects(fake.adapter.startSession({ ...DEFAULT_SETTINGS.worker, cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write', extra: { executable: fake.executable }, onEvent: e => events.push(e) }), /实际权限策略/);
    const args = JSON.parse(await readFile(join(fake.root, 'launch.json'), 'utf8'));
    for (const arg of ['approval_policy="on-request"', 'sandbox_mode="workspace-write"', 'sandbox_workspace_write.exclude_slash_tmp=true', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', 'sandbox_workspace_write.writable_roots=[]']) assert.ok(args.includes(arg));
    assert.ok(events.some(e => e.type === 'error')); assert.ok(!events.some(e => e.type === 'session_started'));
  } finally { await rm(fake.root, { recursive: true, force: true }); }
});
test('服务商错误回显的 worker Key 在事件与历史入口前脱敏', async () => {
  const fake = await fakeCodex('secret'), events: StageEvent[] = [], apiKey = 'worker-echo-secret';
  const session = await fake.adapter.startSession({ ...DEFAULT_SETTINGS.worker, cwd: fake.root,
    endpoint: { ...DEFAULT_SETTINGS.worker.endpoint, apiKey }, extra: { executable: fake.executable }, onEvent: e => events.push(e) });
  try {
    await session.send('secret', 'test'); await eventually(() => events.some(e => e.type === 'turn_done'));
    assert.ok(events.some(e => e.type === 'error' && e.message.includes('[REDACTED]')));
    assert.ok(!JSON.stringify(events).includes(apiKey));
    assert.ok(!(await readFile(join(fake.root, 'launch.json'), 'utf8')).includes(apiKey));
  } finally { await session.close(); await rm(fake.root, { recursive: true, force: true }); }
});

test('Agent 自带登录也拒绝回显的 never 策略', async () => {
  const fake = await fakeCodex('never');
  try {
    await assert.rejects(fake.adapter.startSession({ ...DEFAULT_SETTINGS.worker, connection: 'agent-default', cwd: fake.root, extra: { executable: fake.executable }, onEvent() {} }), /实际权限策略/);
  } finally { await rm(fake.root, { recursive: true, force: true }); }
});

test('turn ID 返回前的 stop 会排队并收齐终态', async () => {
  const fake = await fakeCodex('normal'), events: StageEvent[] = [];
  const session = await fake.adapter.startSession({ ...DEFAULT_SETTINGS.worker, cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write', extra: { executable: fake.executable }, onEvent: e => events.push(e) });
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
  const session = await fake.adapter.startSession({ ...DEFAULT_SETTINGS.worker, cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write', extra: { executable: fake.executable }, onEvent: e => events.push(e) });
  try {
    await session.send('crash', 'test'); await eventually(() => events.some(e => e.type === 'turn_done'));
    assert.equal(session.turnActive, false); assert.ok(events.some(e => e.type === 'tool_end' && !e.ok));
    assert.ok(events.some(e => e.type === 'turn_done' && !e.ok));
    await assert.rejects(session.send('closed', 'test'), /连接已关闭/);
  } finally { await session.close(); await rm(fake.root, { recursive: true, force: true }); }
});
test('审批 ID 带连接随机前缀，恢复同一 thread 也不会误用旧决定', async () => {
  const fake = await fakeCodex('approval'), events: StageEvent[] = [];
  const options = { ...DEFAULT_SETTINGS.worker, cwd: fake.root, model: 'gpt-6-luna', sandbox: 'workspace-write' as const, extra: { executable: fake.executable }, onEvent: (e: StageEvent) => events.push(e) };
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
  const session = await fake.adapter.startSession({ ...DEFAULT_SETTINGS.worker, cwd: fake.root, model: 'gpt-6-luna', sandbox: 'read-only', extra: { executable: fake.executable }, onEvent() {} });
  try { assert.equal(session.sessionId, 'mock-thread'); }
  finally { await session.close(); await rm(fake.root, { recursive: true, force: true }); }
});
