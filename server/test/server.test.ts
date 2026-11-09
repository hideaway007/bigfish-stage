import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startServer } from '../src/index';
import { AdapterRegistry } from '../src/adapters/registry';
import type { StartSessionOptions, WorkerAdapter, WorkerSession } from '../src/adapters/types';
import type { ServerMessage } from '../../src/shared/wire';

class TestAdapter implements WorkerAdapter {
  id = 'test'; starts: StartSessionOptions[] = []; active = false;
  async info() { return { id: this.id, name: '测试适配器', available: true }; }
  async listModels() { return { models: ['test-model'] }; }
  async testConnection() { return { ok: true, message: 'ok' }; }
  async startSession(options: StartSessionOptions): Promise<WorkerSession> {
    this.starts.push(options); const adapter = this;
    return { sessionId: options.resumeId ?? 'test-session', get turnActive() { return adapter.active; },
      async send(id, text) { if (adapter.active) throw new Error('active'); adapter.active = true; options.onEvent({ type: 'user_message', at: Date.now(), id, text }); options.onEvent({ type: 'thinking', at: Date.now() }); },
      async steer(id, text) { options.onEvent({ type: 'steer_queued', at: 0, id, text }); options.onEvent({ type: 'steer_acked', at: 0, id }); },
      async interrupt() { adapter.active = false; options.onEvent({ type: 'interrupted', at: 0 }); options.onEvent({ type: 'turn_done', at: 0, ok: false }); },
      async decidePermission(requestId, allowed) { options.onEvent({ type: 'permission_resolved', at: 0, requestId, allowed }); }, async close() { adapter.active = false; } };
  }
}
function connect(port: number, origin = 'http://localhost:5173') {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin }); const messages: ServerMessage[] = [];
  socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
  const wait = (predicate: (message: ServerMessage) => boolean, from = 0) => new Promise<ServerMessage>((resolve, reject) => {
    const existing = messages.slice(from).find(predicate); if (existing) { resolve(existing); return; }
    const timeout = setTimeout(() => { socket.off('message', listen); reject(new Error('测试等待消息超时')); }, 2000);
    function listen(bytes: Buffer) { const message = JSON.parse(bytes.toString()); if (predicate(message)) { clearTimeout(timeout); socket.off('message', listen); resolve(message); } }
    socket.on('message', listen);
  });
  return { socket, messages, wait, send: (command: unknown) => socket.send(JSON.stringify(command)) };
}
test('真实 HTTP/WS：握手、设置、动态适配器、停止、重连、历史上限、Origin 和静态文件', async () => {
  await mkdir('/tmp/bigfish-c-sandbox/unit', { recursive: true });
  const root = await mkdtemp('/tmp/bigfish-c-sandbox/unit/http-'), adapter = new TestAdapter();
  await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>test</title>');
  const app = await startServer({ port: 0, settingsPath: join(root, 'settings.json'), charactersRoot: new URL('./fixtures/characters/', import.meta.url).pathname, distRoot: join(root, 'dist'), registry: new AdapterRegistry([adapter]) });
  const clients: WebSocket[] = [];
  try {
    assert.equal((app.server.address() as any).address, '127.0.0.1');
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/characters/deepseek-v4-pro/character.json`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/characters/%2e%2e%2fsettings.json`)).status, 404);
    await new Promise<void>((resolve, reject) => {
      const bad = new WebSocket(`ws://127.0.0.1:${app.port}/ws`, { origin: 'http://evil.example' }); clients.push(bad);
      bad.on('unexpected-response', (_request, response) => { assert.equal(response.statusCode, 403); response.resume(); bad.terminate(); resolve(); }); bad.on('error', () => {});
      bad.on('open', () => reject(new Error('接受了恶意 Origin')));
    });
    const client = connect(app.port); clients.push(client.socket); await new Promise(resolve => client.socket.on('open', resolve));
    client.send({ type: 'hello', protocolVersion: 1 }); const welcome = await client.wait(m => m.type === 'welcome'); assert.equal((welcome as any).session, null);
    client.send({ type: 'send', id: 'missing-project', text: 'test' }); await client.wait(m => m.type === 'command_error');
    client.send({ type: 'update_settings', patch: { projectDir: '/missing-project-123' } }); await client.wait(m => m.type === 'command_error' && m.commandType === 'update_settings');
    client.send({ type: 'update_settings', patch: { projectDir: root, worker: { adapter: 'test', model: 'first' }, voice: { enabled: false, endpoint: { apiKey: 'secret-only-on-disk' } } } });
    await client.wait(m => m.type === 'settings');
    client.send({ type: 'send', id: 'first', text: 'test' }); await client.wait(m => m.type === 'event' && m.event.type === 'thinking');
    assert.equal(adapter.starts.length, 1); assert.equal(adapter.starts[0].model, 'first');
    let from = client.messages.length;
    client.send({ type: 'update_settings', patch: { worker: { model: 'next' } } }); await client.wait(m => m.type === 'settings', from);
    assert.equal(adapter.starts.length, 1); assert.equal(adapter.active, true);
    client.send({ type: 'steer', id: 's', text: '插话' }); await client.wait(m => m.type === 'event' && m.event.type === 'steer_acked');
    client.send({ type: 'stop' }); await client.wait(m => m.type === 'event' && m.event.type === 'turn_done');
    from = client.messages.length; client.send({ type: 'new_session' }); await client.wait(m => m.type === 'session' && m.session !== null, from); assert.equal(adapter.starts[1].model, 'next');
    client.send({ type: 'resume_session', sessionId: 'resume-id' }); await client.wait(m => m.type === 'session' && m.session?.sessionId === 'resume-id');
    for (let i = 0; i < 2010; i++) adapter.starts.at(-1)!.onEvent({ type: 'worker_text', at: 0, text: String(i) });
    const reconnect = connect(app.port); clients.push(reconnect.socket); await new Promise(resolve => reconnect.socket.on('open', resolve));
    reconnect.send({ type: 'hello', protocolVersion: 1 }); const reconnected = await reconnect.wait(m => m.type === 'welcome');
    assert.equal((reconnected as any).history.length, 2000); assert.equal((reconnected as any).session.sessionId, 'resume-id');
    assert.ok(!JSON.stringify(client.messages).includes('secret-only-on-disk'));
    client.send({ type: 'list_models', target: 'worker' }); assert.deepEqual((await client.wait(m => m.type === 'models') as any).models, ['test-model']);
    client.send({ type: 'test_connection', target: 'worker' }); assert.equal((await client.wait(m => m.type === 'connection_test') as any).ok, true);
  } finally { for (const socket of clients) socket.terminate(); await app.close(); await rm(root, { recursive: true, force: true }); }
});
