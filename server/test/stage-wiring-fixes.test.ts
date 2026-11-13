import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DshStageSource } from '../../packages/dsh-client-ui-p5stage/src/client/DshStageSource';
import { createStageApi, stageStoragePaths } from '../../packages/dsh-client-ui-p5stage/src/stage-api';
import { apply, dualRoute } from '../../packages/dsh-client-ui-p5stage/src/index';
import { createInitialStageState, stageReducer } from '../../src/stage/stageReducer';

const A = 'deepseek-v4-pro', B = 'claude-opus-5-5';
function nativeFixture(entries: any[] = []) {
  const rooms: Record<string, any> = { [A]: { model: 'model-a', sessionId: 'a' }, [B]: { model: 'model-b', sessionId: 'b' } };
  const events: any[] = [], selections: any[] = [], prompts: any[] = [], opened: string[] = [];
  let running = false, rejectSelection = false, rejectPrompt = false;
  const session = { getSnapshot: () => ({ running }), projections: { faceOf: (key: string) => ({ getSnapshot: () => key === 'modelSelection' ? { model: 'model-a' } : '/tmp/work' }) },
    beginSubmission: () => ({ requestId: 'steer-id', abandon() {} }),
    async prompt() { if (rejectPrompt) return { ok: false, error: { message: 'offline' } }; return { ok: true }; } };
  const ctx = { sessions: { binding: (id: string) => ({ session: id === 'a' ? session : { getSnapshot: () => ({ running: false }) }, eventSource: { getSnapshot: () => ({ entries }) } }) },
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
  return { source, ctx, session, rooms, events, selections, prompts, opened, busy: () => { running = true; }, failSelect: () => { rejectSelection = true; }, failPrompt: () => { rejectPrompt = true; } };
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
test('relay passes the user task and answer without injected runtime instructions', async () => {
  const f = nativeFixture([
    { event: { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'read hello.txt' }] } } },
    { event: { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'INTERNAL_RUNTIME_MARKER' }] } } },
    { event: { type: 'assistant/message', data: { content: [{ type: 'text', text: 'file contents' }] } } },
  ]);
  f.source.batonPass(B, 'continue'); await tick();
  const content = JSON.stringify(f.prompts[0].content);
  assert.match(content, /read hello.txt/); assert.match(content, /file contents/);
  assert(!content.includes('INTERNAL_RUNTIME_MARKER'));
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
test('native usage does not invent a capacity and compaction preserves the actual summary blocks', () => {
  const { source } = nativeFixture();
  const events = source.translateDurableEvent({ type: 'assistant/message', data: { content: [{ type: 'text', text: 'done' }], usage: { inputTokens: 123, outputTokens: 7 } } }, '/tmp');
  assert.equal(events.find((e: any) => e.type === 'context_usage').maxTokens, 0);
  const compacted = source.translateDurableEvent({ type: 'compaction/summary', data: { summary: [{ type: 'text', text: 'Keep the acceptance criteria.' }], shadowedSeqs: [1, 2] } }, '/tmp');
  assert.match(compacted[0].summary, /Keep the acceptance criteria/);
  assert.equal(compacted[0].turnsCompacted, 2);
});
test('opening a project creates one session with the requested workspace and model; busy calls are rejected', async () => {
  const f = nativeFixture(); const created: any[] = [], paths: string[] = [];
  (f.ctx as any).workspaces = { async create({ path }: any) { paths.push(path); return { workspaceId: 'project-new' }; } };
  (f.ctx.remote.session as any).create = async (input: any) => { created.push(input); return { ok: true, value: { sessionId: 'new-room' } }; };
  f.source.newSessionInDirectory('/tmp/project-new'); await tick();
  assert.deepEqual(paths, ['/tmp/project-new']);
  assert.equal(created.length, 1); assert.equal(created[0].workspaceId, 'project-new');
  assert.equal(f.selections[0].sessionId, 'new-room'); assert.equal(f.selections[0].model, 'model-a');
  assert.deepEqual(f.opened, ['new-room']);
  f.busy(); f.source.newSessionInDirectory('/tmp/other'); await tick();
  assert.equal(created.length, 1); assert(f.events.some(m => m.type === 'command_error'));
});
test('typing speed is persisted by the native host and restored when a source reconnects', async () => {
  const f = nativeFixture(); let saved = { typingCharsPerSec: 40 };
  const original = f.source.stageRequest;
  f.source.stageRequest = async (input: any) => {
    if (input.op === 'preferences_patch') { saved = { typingCharsPerSec: input.typingCharsPerSec }; return saved; }
    if (input.op === 'preferences_get') return saved;
    return original(input);
  };
  f.source.updateSettings({ performance: { typingCharsPerSec: 85 } }); await tick();
  assert.equal(saved.typingCharsPerSec, 85); assert.equal(f.source.buildPublicSettings().performance.typingCharsPerSec, 85);
  const next: any = new DshStageSource(f.ctx, 'a'); next.stageRequest = f.source.stageRequest;
  await next.ensureRooms(); assert.equal(next.buildPublicSettings().performance.typingCharsPerSec, 85);
});
test('an unrecognized native compact command reports a failure instead of spinning forever', async () => {
  const f = nativeFixture(); (f.session as any).command = async () => ({ ok: true, value: { matched: false } });
  f.source.compactSession(); await tick();
  assert(f.events.some(m => m.type === 'command_error' && m.commandType === 'compact_session'));
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
    assert.equal((await call('preferences_get')).typingCharsPerSec, 40);
    await call('preferences_patch', { typingCharsPerSec: 85 });
    assert.equal((await call('preferences_get')).typingCharsPerSec, 85);
    assert((await call('preferences_patch', { typingCharsPerSec: -1 })).error);
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

test('custom DSH homes never reuse the real installation room store', () => {
  const regular = stageStoragePaths({}, '/test/user');
  const isolated = stageStoragePaths({ DSH_HOME: '/test/isolated-dsh' }, '/test/user');
  assert.equal(regular.directory, '/test/user/.dsh/bigfish-stage/rooms');
  assert.equal(regular.legacy, '/test/user/.config/bigfish-stage/dsh-rooms');
  assert.equal(isolated.directory, '/test/isolated-dsh/bigfish-stage/rooms');
  assert.equal(isolated.legacy, undefined);
});
