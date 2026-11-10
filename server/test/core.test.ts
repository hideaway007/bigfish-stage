import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { StageEvent } from '../../src/shared/stage-events';
import { CharacterCatalog, findReaction } from '../src/characters';
import { deepMerge, publicSettings, SettingsStore } from '../src/settings-store';
import { SentenceBuffer } from '../src/text-buffer';
import { validOrigin } from '../src/index';
import { eventFact, Voice } from '../src/voice/voice';
import { parseCommand } from '../src/session';

const fixtures = new URL('./fixtures/characters/', import.meta.url).pathname;
async function character() { const catalog = new CharacterCatalog(fixtures); await catalog.load(); return catalog.get('deepseek-v4-pro')!; }
async function temporary() { await mkdir('/tmp/bigfish-c-sandbox/unit', { recursive: true }); return mkdtemp('/tmp/bigfish-c-sandbox/unit/test-'); }

test('反应表：失败 > 工具细分 > 事件类型', async () => {
  const pack = await character();
  assert.equal(findReaction(pack, { type: 'tool_end', at: 0, toolUseId: '1', ok: false }, 'bash'), pack.reactions['tool_end:fail']);
  assert.equal(findReaction(pack, { type: 'tool_end', at: 0, toolUseId: '1', ok: true }, 'bash'), pack.reactions['tool_end:bash']);
  assert.equal(findReaction(pack, { type: 'tool_end', at: 0, toolUseId: '1', ok: true }, 'read'), pack.reactions.tool_end);
  assert.equal(findReaction(pack, { type: 'tool_start', at: 0, toolUseId: '1', tool: 'edit', rawName: 'edit', summary: '' }), pack.reactions['tool_start:edit']);
});
test('文字增量：标点、空闲计时、final 刷新，无逐 token 广播', async () => {
  const output: { text: string; final?: boolean }[] = [];
  const buffer = new SentenceBuffer((text, final) => output.push({ text, final }), 15);
  buffer.push('你'); buffer.push('好'); assert.equal(output.length, 0);
  buffer.push('。下一'); assert.equal(output[0].text, '你好。');
  await delay(30); assert.equal(output[1].text, '下一');
  buffer.push('句'); buffer.flush(true); assert.deepEqual(output[2], { text: '句', final: true });
  buffer.close();
});
test('旧设置默认合并；worker Key 不进入 PublicSettings，undefined 保留而空串清除', async () => {
  const directory = await temporary(), path = join(directory, 'settings.json');
  try {
    const legacy = { ...structuredClone(DEFAULT_SETTINGS), worker: { adapter: 'dsh', model: 'legacy-model', sandbox: 'workspace-write' } };
    await writeFile(path, JSON.stringify(legacy));
    const store = new SettingsStore(path); await store.load();
    assert.equal(store.current.worker.connection, 'endpoint');
    assert.deepEqual(store.current.worker.endpoint, DEFAULT_SETTINGS.worker.endpoint);
    assert.equal(store.current.worker.model, 'legacy-model');
    await store.update({ worker: { endpoint: { apiKey: 'worker-private-secret' } } });
    await store.update({ worker: { connection: 'agent-default', endpoint: { apiKey: undefined, baseUrl: 'https://example.invalid/v1/' } } });
    assert.equal(store.current.worker.endpoint.apiKey, 'worker-private-secret');
    const visible = publicSettings(store.current);
    assert.equal(visible.worker.endpoint.apiKeySet, true);
    assert.ok(!('apiKey' in visible.worker.endpoint));
    assert.ok(!JSON.stringify(visible).includes('worker-private-secret'));
    assert.equal(visible.worker.endpoint.baseUrl, 'https://example.invalid/v1');
    const reloaded = new SettingsStore(path); await reloaded.load();
    assert.equal(reloaded.current.worker.connection, 'agent-default');
    assert.equal(reloaded.current.worker.endpoint.apiKey, 'worker-private-secret');
    await store.update({ worker: { endpoint: { apiKey: '' } } });
    assert.equal(store.public.worker.endpoint.apiKeySet, false);
    assert.ok(!('apiKey' in store.current.worker.endpoint));
    await assert.rejects(store.update({ worker: { endpoint: { baseUrl: 'https://user:secret@example.invalid/v1' } } }));
    await assert.rejects(store.update({ worker: { endpoint: { baseUrl: 'file:///tmp' } } }));
    await assert.rejects(store.update({ worker: { connection: 'invalid' as any } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('深合并、清除密钥、PublicSettings 脱敏与 600 持久化', async () => {
  const directory = await temporary();
  try {
    const path = join(directory, 'settings.json'), store = new SettingsStore(path); await store.load();
    await store.update({ voice: { endpoint: { apiKey: 'unit-secret', model: 'test-model' } } });
    assert.equal(store.current.voice.endpoint.baseUrl, DEFAULT_SETTINGS.voice.endpoint.baseUrl);
    assert.equal(store.public.voice.endpoint.apiKeySet, true);
    assert.ok(!JSON.stringify(store.public).includes('unit-secret'));
    assert.ok(!('apiKey' in store.public.voice.endpoint));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const reloaded = new SettingsStore(path); await reloaded.load(); assert.equal(reloaded.current.voice.endpoint.model, 'test-model');
    await store.update({ voice: { endpoint: { apiKey: '' } } }); assert.equal(store.public.voice.endpoint.apiKeySet, false);
    assert.ok(!(await readFile(path, 'utf8')).includes('unit-secret'));
    assert.equal(({} as any).polluted, undefined);
    deepMerge({}, JSON.parse('{"__proto__":{"polluted":true}}')); assert.equal(({} as any).polluted, undefined);
    await assert.rejects(store.update({ voice: { endpoint: { baseUrl: 'file:///private' } } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Origin 严格限定本机 HTTP 来源', () => {
  for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5300', 'http://localhost']) assert.equal(validOrigin(origin), true, origin);
  for (const origin of [undefined, 'null', 'https://localhost:5300', 'http://localhost.evil:5300', 'http://127.0.0.2:5300', 'http://user@localhost:5300', 'http://localhost:5300/path', 'http://localhost:5300?x=1', 'http://localhost:5300#x']) assert.equal(validOrigin(origin), false, String(origin));
});
test('命令验证拒绝无效输入', () => {
  assert.throws(() => parseCommand({ type: 'permission_decision', requestId: '1', allowed: 'yes' }));
  assert.throws(() => parseCommand({ type: 'send', id: '1', text: '' }));
  assert.throws(() => parseCommand({ type: 'list_models', target: 'other' }));
  assert.equal(parseCommand({ type: 'stop' }).type, 'stop');
});
test('台词：即时 preset、模型替换、限流、账本无原始输出、禁用与切角作废', async () => {
  const bodies: any[] = [];
  const endpoint = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body)); await delay(35);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: '咕噜，还在处理这轮任务。' } }] }));
  });
  await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(endpoint.address() as any).port}/v1`, pack = await character(), output: StageEvent[] = [];
  const settings = { ...DEFAULT_SETTINGS.voice, maxLinesPerMinute: 1, endpoint: { baseUrl, model: 'test' } };
  const voice = new Voice(event => output.push(event));
  try {
    voice.configure(pack, settings);
    const started = performance.now(); voice.handle({ type: 'thinking', at: Date.now() });
    assert.ok(performance.now() - started < 50); assert.equal((output[0] as any).source, 'preset');
    voice.handle({ type: 'thinking', at: Date.now() }); assert.equal(output.length, 1);
    voice.handle({ type: 'tool_end', at: 0, toolUseId: 'x', ok: false, output: 'RAW_SECRET_OUTPUT' });
    await delay(110);
    const model = output.find(e => e.type === 'character_line' && e.source === 'model') as Extract<StageEvent, { type: 'character_line' }>;
    assert.ok(model); assert.equal(model.replacesLineId, (output[0] as any).lineId);
    assert.equal(bodies.length, 1); assert.ok(!JSON.stringify(bodies).includes('RAW_SECRET_OUTPUT'));
    assert.ok(!eventFact({ type: 'tool_end', at: 0, toolUseId: 'x', ok: false, output: 'SECRET' })!.includes('SECRET'));
    voice.reset(); voice.configure(pack, { ...settings, maxLinesPerMinute: 10 });
    voice.handle({ type: 'thinking', at: 0 });
    voice.configure({ ...pack, id: 'other' }, { ...settings, maxLinesPerMinute: 10 });
    const before = output.length; await delay(90); assert.equal(output.length, before);
    voice.configure(pack, { ...settings, enabled: false }); voice.handle({ type: 'permission_request', at: 0, requestId: 'p', tool: 'bash', rawName: 'approval', summary: '', detail: '' });
    assert.equal((output.at(-1) as any).source, 'preset'); const count = bodies.length; await delay(75); assert.equal(bodies.length, count);
  } finally { voice.close(); endpoint.closeAllConnections(); await new Promise<void>(resolve => endpoint.close(() => resolve())); }
});
