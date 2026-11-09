import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPresentation, displayCommand, displayPath, uncoveredGitDiff, unwrapShellCommand } from '../src/adapters/presentation';
import { CodexEventMapper } from '../src/adapters/codex';
import type { StageEvent } from '../../src/shared/stage-events';

const cwd = '/private/tmp/bigfish-final/project';

test('命令展示解开 zsh/bash/sh 包装，正确处理单引号、双引号及转义', () => {
  const cases = [
    ["/bin/zsh -lc 'cat math.js'", 'cat math.js'],
    ['bash -c "cat math.js"', 'cat math.js'],
    [String.raw`/bin/bash -c "printf '%s\n' 'a b'"`, String.raw`printf '%s\n' 'a b'`],
    [String.raw`/bin/sh -c 'printf '\''%s\n'\'' '\''a b'\'''`, String.raw`printf '%s\n' 'a b'`],
    [String.raw`zsh -lc 'echo '"'"'quoted'"'"''`, "echo 'quoted'"],
    ["sh -c 'echo first\necho second'", 'echo first\necho second'],
  ];
  for (const [wrapped, expected] of cases) assert.equal(unwrapShellCommand(wrapped), expected, wrapped);
  for (const plain of ['cat math.js', "sh -c 'cat math.js' | sort", "sh -c 'unterminated", 'python -c "print(1)"', 'sh -c "cat x" extra']) {
    assert.equal(unwrapShellCommand(plain), plain);
  }
});

test('项目内路径相对化，兼容 macOS 临时路径别名且不误匹配同名前缀目录', () => {
  assert.equal(displayPath('/tmp/bigfish-final/project/math.js', cwd), 'math.js');
  assert.equal(displayPath('/private/tmp/bigfish-final/project/src/math.js', '/tmp/bigfish-final/project'), 'src/math.js');
  assert.equal(displayPath('src/../math.js', cwd), 'math.js');
  assert.equal(displayPath(cwd, cwd), '.');
  assert.equal(displayPath('/tmp/bigfish-final/project-other/math.js', cwd), '/tmp/bigfish-final/project-other/math.js');
  assert.equal(displayPath('/Users/test/other/file.js', cwd, '/Users/test'), '~/other/file.js');
  assert.equal(displayPath('/Users/test-other/file.js', cwd, '/Users/test'), '/Users/test-other/file.js');
  assert.equal(displayCommand("/bin/zsh -lc 'cat /tmp/bigfish-final/project/math.js'", cwd), 'cat math.js');
  assert.equal(displayCommand(`cat "${cwd}/my file.js" /tmp/bigfish-final/project-other/x`, cwd), 'cat "my file.js" /tmp/bigfish-final/project-other/x');
  assert.equal(displayCommand(`cd ${cwd} && cat /Users/test/config`, cwd, '/Users/test'), 'cd . && cat ~/config');
});

test('审批只展示原因、解包后的命令及可读 cwd，不泄漏协议对象', () => {
  const protocol = { reason: '需要验证修复', command: "/bin/zsh -lc 'npm test'", cwd: '/tmp/bigfish-final/project',
    kind: 'command', threadId: 'protocol-thread', turnId: 'protocol-turn', itemId: 'protocol-item' };
  const display = approvalPresentation(protocol, cwd);
  assert.deepEqual(display, { summary: '需要验证修复', detail: 'npm test\ncwd: .' });
  assert.ok(!JSON.stringify(display).includes('protocol-'));
  assert.ok(!display.detail.includes('{'));
  assert.deepEqual(approvalPresentation({ command: "bash -c 'cat math.js'", cwd: `${cwd}/src` }, cwd), { summary: 'cat math.js', detail: 'cat math.js\ncwd: src' });
  assert.equal(approvalPresentation({ reason: ' ', command: 'npm test', cwd: '/Users/test/other' }, cwd, '/Users/test').detail, 'npm test\ncwd: ~/other');
  assert.deepEqual(approvalPresentation({ reason: '允许修改文件' }, cwd), { summary: '允许修改文件', detail: '文件修改审批\ncwd: .' });
});

const patch = (file: string, value = 'after') => `diff --git a/${file} b/${file}\nindex 1111111..2222222 100644\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-before\n+${value}\n`;

test('Git 回退完全跳过已由结构化 diff 覆盖的文件，兼容绝对及相对路径', () => {
  const after = patch('math.js');
  for (const file of ['math.js', '/tmp/bigfish-final/project/math.js', `${cwd}/math.js`]) {
    assert.equal(uncoveredGitDiff('', after, new Set([file]), cwd), '');
  }
  assert.equal(uncoveredGitDiff('', after, new Set(), cwd), after);
});

test('Git 回退只保留本轮变化且没有结构化 diff 的文件，不重复旧改动', () => {
  const stable = patch('untouched.js'), previous = patch('shell.js', 'old'), shell = patch('shell.js', 'new');
  const before = stable + previous, after = stable + patch('math.js') + shell;
  assert.equal(uncoveredGitDiff(before, after, new Set(['math.js']), cwd), shell);
  assert.equal(uncoveredGitDiff(after, after, new Set(), cwd), '');
  assert.equal(uncoveredGitDiff('', patch('math.js') + patch('math.js.bak'), new Set(['math.js']), cwd), patch('math.js.bak'));
});

test('Git 回退按完整文件段处理空格、删除、重命名与二进制文件', () => {
  const deleted = 'diff --git a/old.js b/old.js\ndeleted file mode 100644\n--- a/old.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n';
  const renamed = 'diff --git a/old name.js b/new name.js\nsimilarity index 100%\nrename from old name.js\nrename to new name.js\n';
  const binary = 'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n';
  const quoted = 'diff --git "a/tab\\tname.js" "b/tab\\tname.js"\n--- "a/tab\\tname.js"\n+++ "b/tab\\tname.js"\n@@ -1 +1 @@\n-old\n+new\n';
  const after = patch('my file.js') + deleted + renamed + binary + quoted;
  assert.equal(uncoveredGitDiff('', after, new Set(['my file.js', 'old.js', 'new name.js', 'image.png', 'tab\tname.js']), cwd), '');
});

test('映射卡片展示短命令和相对路径，rawName 保持原值且覆盖记录每轮清空', () => {
  const events: StageEvent[] = [], mapper = new CodexEventMapper(e => events.push(e), cwd);
  try {
    mapper.begin();
    mapper.translate({ method: 'item/started', params: { item: { type: 'commandExecution', id: 'cmd', command: "/bin/zsh -lc 'cat math.js'" } } });
    assert.ok(events.some(e => e.type === 'tool_start' && e.summary === 'cat math.js' && e.rawName === 'commandExecution'));
    mapper.translate({ method: 'item/completed', params: { item: { type: 'fileChange', id: 'edit', status: 'completed', changes: [
      { path: '/tmp/bigfish-final/project/math.js', kind: { type: 'update' }, diff: '-old\n+new' },
      { path: `${cwd}/empty.js`, kind: { type: 'update' }, diff: '' },
    ] } } });
    assert.ok(events.some(e => e.type === 'tool_start' && e.file === 'math.js' && e.summary === 'edit math.js' && e.rawName === 'fileChange'));
    assert.ok(events.some(e => e.type === 'tool_end' && e.summary === 'math.js' && e.diff === '-old\n+new'));
    assert.equal(uncoveredGitDiff('', patch('math.js') + patch('empty.js'), mapper.structuredDiffFiles, cwd), patch('empty.js'));
    mapper.end(true, 'done'); mapper.begin();
    assert.equal(mapper.structuredDiffFiles.size, 0);
  } finally { mapper.dispose(); }
});
