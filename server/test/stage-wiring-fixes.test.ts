import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DshStageSource } from '../../packages/dsh-client-ui-p5stage/src/client/DshStageSource';
import { createStageApi } from '../../packages/dsh-client-ui-p5stage/src/stage-api';
import { apply, dualRoute } from '../../packages/dsh-client-ui-p5stage/src/index';
import { createInitialStageState, stageReducer } from '../../src/stage/stageReducer';

const A = 'deepseek-v4-pro', B = 'claude-opus-5-5';
function nativeFixture() {
  const rooms: Record<string, any> = { [A]: { model: 'model-a', sessionId: 'a' }, [B]: { model: 'model-b', sessionId: 'b' } };
  const events: any[] = [], selections: any[] = [], prompts: any[] = [], opened: string[] = [];
  let running = false, rejectSelection = false, rejectPrompt = false;
  const session = { getSnapshot: () => ({ running }), projections: { faceOf: (key: string) => ({ getSnapshot: () => key === 'modelSelection' ? { model: 'model-a' } : '/tmp/work' }) },
    beginSubmission: () => ({ requestId: 'steer-id', abandon() {} }),
    async prompt() { if (rejectPrompt) return { ok: false, error: { message: 'offline' } }; return { ok: true }; } };
  const ctx = { sessions: { binding: (id: string) => ({ session: id === 'a' ? session : { getSnapshot: () => ({ running: false }) }, eventSource: { getSnapshot: () => ({ entries: [] }) } }) },
    remote: { session: { async selectModel(input: any) { if (rejectSelection) throw new Error('unavailable model'); selections.push(input); return { ok: true }; },
      async prompt(input: any) { prompts.push(input); return { ok: true }; } } }, uiWorkspace: { openSession: (id: string) => opened.push(id) } };
  const source: any = new DshStageSource(ctx, 'a');
  source.activeCharacterId = A;
  source.bindCallbacks({ onServerMessage: (e: any) => events.push(e), onConnectionChange() {} });
  source.stageRequest = async (input: any) => {
    if (input.op === 'rooms_patch') rooms[input.characterId] = { ...rooms[input.characterId], ...(input.model ? { model: input.model } : {}), ...(input.sessionId ? { sessionId: input.sessionId } : {}) };
    return structuredClone(rooms);
  };
  source.refreshModelCatalog = async () => {};
  return { source, rooms, events, selections, prompts, opened, busy: () => { running = true; }, failSelect: () => { rejectSelection = true; }, failPrompt: () => { rejectPrompt = true; } };
}
const tick = () => new Promise(r => setImmediate(r));

test('editing an off-stage character saves its brain without changing the active session', async () => {
  const f = nativeFixture();
  await f.source.updateModelSettings({ characterBrains: { [B]: { model: 'model-b2' } } });
  assert.equal(f.rooms[B].model, 'model-b2'); assert.equal(f.selections.length, 0);
  assert.equal(f.source.buildPublicSettings().activeCharacterId, A);
});
test('relay selects the target model and submits to the target room before opening it', async () => {
  const f = nativeFixture(); await f.source.changeRoom(B, 'please review');
  assert.equal(f.selections[0].sessionId, 'b'); assert.equal(f.selections[0].model, 'model-b');
  assert.equal(f.prompts[0].sessionId, 'b'); assert.deepEqual(f.opened, ['b']);
  assert(f.events.some(m => m.event?.type === 'baton_pass'));
});
test('failed routing and busy turns never display a successful handoff or change room', async () => {
  for (const failure of ['busy', 'failSelect'] as const) { const f = nativeFixture(); f[failure](); await f.source.changeRoom(B, 'review');
    assert.equal(f.opened.length, 0); assert.equal(f.prompts.length, 0); assert(!f.events.some(m => m.event?.type === 'baton_pass'));
    assert(f.events.some(m => m.type === 'command_error')); }
});
test('steer distinguishes transport acceptance, consumption and failure', async () => {
  const f = nativeFixture(); f.source.steer('change requirement'); await tick();
  assert(f.events.some(m => m.event?.type === 'steer_submitted')); assert(!f.events.some(m => m.event?.type === 'steer_acked'));
  const consumed = f.source.translateDurableEvent({ type: 'user/message', data: { source: { kind: 'user', rpcId: 'steer-id' }, content: [{ type: 'text', text: 'change requirement' }] } }, '/tmp');
  assert(consumed.some((e: any) => e.type === 'steer_acked'));
  f.failPrompt(); f.source.steer('next'); await tick(); assert(f.events.some(m => m.event?.type === 'steer_failed'));
});
test('mixed tool narration is preserved and unknown compression usage is never fabricated', () => {
  const { source } = nativeFixture();
  const events = source.translateDurableEvent({ type: 'assistant/message', data: { content: [{ type: 'text', text: 'reason for action' }, { type: 'tool-call', id: 't1', name: 'read', input: {} }] } }, '/tmp');
  assert(events.some((e: any) => e.type === 'worker_text' && e.text === 'reason for action' && e.final === false));
  const compressed = source.translateDurableEvent({ type: 'compaction/summary', data: { summary: 'summary' } }, '/tmp');
  assert.equal(compressed[0].freedTokens, 0);
});
test('approval queue retains the other request when one resolves', () => {
  let state = createInitialStageState();
  for (const requestId of ['first', 'second']) state = stageReducer(state, { type: 'STAGE_EVENT', event: { type: 'permission_request', at: 1, requestId, tool: 'bash', rawName: 'bash', summary: requestId, detail: 'details' } });
  assert.equal(state.pendingPermission?.requestId, 'first');
  state = stageReducer(state, { type: 'STAGE_EVENT', event: { type: 'permission_resolved', at: 2, requestId: 'second', allowed: false } });
  assert.equal(state.pendingPermission?.requestId, 'first');
  state = stageReducer(state, { type: 'STAGE_EVENT', event: { type: 'permission_resolved', at: 3, requestId: 'first', allowed: true } });
  assert.equal(state.pendingPermission, null);
});
test('host uses authenticated DSH fetch registration; legacy assets retain a Node handler', () => {
  const raw: any[] = [], protectedRoutes: any[] = [];
  apply({ webServer: { register: (r: any) => raw.push(r) }, connection: { fetch: { register: (r: any) => protectedRoutes.push(r) } }, effect: (f: any) => f(), on() {} });
  assert.deepEqual(raw.map(r => r.path), ['/characters', '/sfx']);
  assert(raw.every(r => typeof r.resource === 'function' && typeof r.handler === 'function'));
  assert.equal(protectedRoutes[0].path, '/api/bigfish-stage');
});
test('stage API persists isolated rooms and performs real git operations in a temporary repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bigfish-stage-api-'));
  try {
    const cwd = join(root, 'repo'); await mkdir(cwd);
    const api = createStageApi(join(root, 'rooms'));
    const call = async (op: string, extra = {}) => (await api(new Request('http://localhost/api/bigfish-stage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, op, ...extra }) }))).json();
    await call('rooms_patch', { characterId: B, model: 'saved-model', sessionId: 'saved-room' });
    assert.equal((await call('rooms_get'))[B].model, 'saved-model');
    assert((await call('rooms_patch', { characterId: '__proto__', model: 'x' })).error);
    const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await writeFile(join(cwd, 'a.txt'), 'old\n'); git('add', '.'); git('commit', '-m', 'initial');
    await writeFile(join(cwd, 'a.txt'), 'changed\n'); const status = await call('git_status'); assert.equal(status.files[0].path, 'a.txt'); assert(status.diff.includes('+changed'));
    assert.equal((await call('git_revert', { path: '../outside' })).ok, false);
    assert.equal((await call('git_revert', { path: 'a.txt' })).ok, true); assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'old\n');
    await writeFile(join(cwd, 'a.txt'), 'ready\n'); assert.equal((await call('git_commit', { message: 'save' })).ok, true);
    assert.equal((await call('git_status')).files.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
