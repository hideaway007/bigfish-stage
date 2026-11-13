import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AdapterRegistry } from '../src/adapters/registry';
import type { StartSessionOptions, WorkerAdapter, WorkerSession } from '../src/adapters/types';
import { CharacterCatalog } from '../src/characters';
import { SessionController } from '../src/session';
import { SettingsStore } from '../src/settings-store';
import { commitGitAll, getGitStatus, revertGitFile } from '../src/git-ops';
import type { ServerMessage } from '../../src/shared/wire';

const runFile = promisify(execFile);

class MockBrainAdapter implements WorkerAdapter {
  id = 'dsh';
  readonly supportsCompact = true;
  starts: StartSessionOptions[] = [];
  compactions = 0;
  private seq = 0;

  async info() {
    return { id: this.id, name: 'DeepSeek Harness', available: true };
  }
  async listModels() {
    return { models: ['deepseek-chat', 'deepseek-reasoner'] };
  }
  async testConnection() {
    return { ok: true, message: 'ok' };
  }
  async startSession(options: StartSessionOptions): Promise<WorkerSession> {
    this.starts.push(options);
    const sid = options.resumeId ?? `room_${++this.seq}`;
    let active = false;
    return {
      sessionId: sid,
      get turnActive() {
        return active;
      },
      async send(id, text) {
        active = true;
        options.onEvent({ type: 'user_message', at: Date.now(), id, text });
        options.onEvent({ type: 'thinking', at: Date.now() });
        options.onEvent({ type: 'worker_text', at: Date.now(), text: `[${options.model}] 回复: ${text}`, final: true });
        active = false;
        options.onEvent({ type: 'turn_done', at: Date.now(), ok: true, summary: '完成' });
      },
      async steer() {},
      async interrupt() {
        active = false;
      },
      async decidePermission() {},
      compact: async () => {
        this.compactions += 1;
        return {
          turnsCompacted: 1,
          freedTokens: 1200,
          summary: 'DSH 已将前序对话压缩为结构化检查点。',
        };
      },
      async close() {
        active = false;
      },
    };
  }
}

test('Phase 2：每角色独立大脑模型与独立房间 JSONL 持久化回放、记忆凝炼、换手接力与触摸', async () => {
  await mkdir('/tmp/bigfish-c-sandbox/unit', { recursive: true });
  const root = await mkdtemp('/tmp/bigfish-c-sandbox/unit/p2-');
  const charactersRoot = new URL('../../public/characters/', import.meta.url).pathname;

  try {
    const store = new SettingsStore(join(root, 'settings.json'));
    await store.load();
    const catalog = new CharacterCatalog(charactersRoot);
    await catalog.load();
    const adapter = new MockBrainAdapter();
    const messages: ServerMessage[] = [];

    const controller = new SessionController(
      store,
      catalog,
      new AdapterRegistry([adapter]),
      msg => messages.push(msg)
    );

    const replies: ServerMessage[] = [];
    const sendCmd = (cmd: any) => controller.command(cmd, msg => replies.push(msg));

    await sendCmd({
      type: 'update_settings',
      patch: {
        projectDir: root,
        voice: { enabled: false },
        characterBrains: {
          'deepseek-v4-pro': { model: 'deepseek-chat' },
          'claude-opus-5-5': { model: 'deepseek-reasoner' },
        },
      },
    });

    await sendCmd({ type: 'send', id: 'm1', text: '大肥鱼帮我写登录页' });
    assert.equal(adapter.starts.at(-1)?.model, 'deepseek-chat');

    await sendCmd({ type: 'switch_character', characterId: 'claude-opus-5-5' });
    await sendCmd({ type: 'send', id: 'm2', text: 'Claude娘帮我审架构' });
    assert.equal(adapter.starts.at(-1)?.model, 'deepseek-reasoner');

    messages.length = 0;
    await sendCmd({ type: 'switch_character', characterId: 'deepseek-v4-pro' });
    const restoredSessionMsg = messages.find(m => m.type === 'session' && m.session?.sessionId === 'room_1') as Extract<ServerMessage, { type: 'session' }> | undefined;
    assert.ok(restoredSessionMsg, '切回大肥鱼应自动恢复她的独立会话 room_1');
    assert.ok(
      restoredSessionMsg.history?.some(e => e.type === 'user_message' && e.text === '大肥鱼帮我写登录页'),
      '切回大肥鱼应完整还原磁盘持久化的聊天历史'
    );

    messages.length = 0;
    await sendCmd({ type: 'compact_session' });
    const compactedEv = messages.find(m => m.type === 'event' && m.event.type === 'context_compacted');
    assert.ok(compactedEv, 'compact_session 应发出真实的 context_compacted 事件');
    assert.equal(adapter.compactions, 1, 'compact_session 应调用底层执行器的真实 compact 能力');
    const welcomeAfterCompact = await controller.welcome();
    assert.ok(
      welcomeAfterCompact.type === 'welcome' &&
        welcomeAfterCompact.history.some(e => e.type === 'user_message' && e.text === '大肥鱼帮我写登录页'),
      '压缩后应完整保留舞台回看审计记录，不删除历史消息'
    );

    messages.length = 0;
    await sendCmd({ type: 'interact_character', characterId: 'deepseek-v4-pro', zone: 'head' });
    const touchEv = messages.find(m => m.type === 'event' && m.event.type === 'character_line' && m.event.source === 'touch');
    assert.ok(touchEv, '点击立绘热区应触发专属互动台词');

    messages.length = 0;
    await sendCmd({ type: 'baton_pass', toCharacterId: 'codex-dragon', instruction: '排查边界条件' });
    assert.ok(messages.some(m => m.type === 'event' && m.event.type === 'baton_pass'), '应发出 baton_pass 事件');
    assert.equal(store.current.activeCharacterId, 'codex-dragon');

    await controller.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Phase 2：Git 战利品状态查询、单文件安全撤回、路径穿越拦截与一键提交', async () => {
  await mkdir('/tmp/bigfish-c-sandbox/unit', { recursive: true });
  const repo = await mkdtemp('/tmp/bigfish-c-sandbox/unit/gitops-');
  try {
    await runFile('git', ['init', repo]);
    await runFile('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
    await runFile('git', ['-C', repo, 'config', 'user.name', 'Tester']);
    await writeFile(join(repo, 'hello.txt'), 'line1\n');
    await runFile('git', ['-C', repo, 'add', 'hello.txt']);
    await runFile('git', ['-C', repo, 'commit', '-m', 'init']);

    await writeFile(join(repo, 'hello.txt'), 'line1\nline2\n');
    await writeFile(join(repo, 'temp.txt'), 'untracked\n');

    const st1 = await getGitStatus(repo);
    assert.equal(st1.isRepo, true);
    assert.equal(st1.files.length, 2);
    assert.ok(st1.diff.includes('+line2'));

    const badRevert = await revertGitFile(repo, '../outside.txt');
    assert.equal(badRevert.ok, false);

    const rev1 = await revertGitFile(repo, 'hello.txt');
    assert.equal(rev1.ok, true);
    assert.equal(await readFile(join(repo, 'hello.txt'), 'utf8'), 'line1\n');

    const cm = await commitGitAll(repo, 'feat: add temp file');
    assert.equal(cm.ok, true);

    const st2 = await getGitStatus(repo);
    assert.equal(st2.files.length, 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
