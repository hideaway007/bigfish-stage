import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import type { StageEvent } from '../../src/shared/stage-events';
import { CodexToStage } from './codex-to-stage';
import { scrub } from './scrub';
const samples = new URL('../samples/', import.meta.url);
const rows = (name: string): any[] => readFileSync(new URL(name, samples), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
function translate(name: string) {
  const mapper = new CodexToStage();
  return rows(`${name}.raw.jsonl`).flatMap(row => {
    if (row.direction === 'out' && row.message.method === 'turn/steer') mapper.registerSteer(row.message.params.clientUserMessageId, row.message.params.input[0].text);
    return row.direction === 'in' ? mapper.translate(row.message, row.at) : [];
  });
}
test('完整真实样本包含读文件、diff、审批决定和成功测试', () => {
  const events = rows('app-full.stage.jsonl') as StageEvent[];
  const diff = events.findIndex(e => e.type === 'tool_end' && e.diff?.includes('+  return a + b;'));
  const approval = events.findIndex(e => e.type === 'permission_request' && e.summary.includes('npm test'));
  const resolved = events.findIndex(e => e.type === 'permission_resolved' && e.allowed);
  const tested = events.findIndex(e => e.type === 'tool_end' && e.ok && e.output?.includes('pass 1'));
  assert.ok(events.some(e => e.type === 'tool_end' && e.output?.includes('return a - b')));
  assert.ok(diff >= 0 && approval > diff && resolved > approval && tested > resolved);
  assert.equal(events.at(-1)?.type, 'turn_done');
});
test('真实 exec 与 app-server 文件改动均只产生一个对应开始事件', () => {
  for (const name of ['app-full', 'exec-full']) {
    const events = translate(name);
    const ids = events.filter(e => e.type === 'tool_start').map(e => e.toolUseId);
    assert.equal(new Set(ids).size, ids.length, name);
    assert.ok(events.some(e => e.type === 'tool_end'));
  }
  assert.ok(!translate('exec-full').some(e => e.type === 'tool_end' && e.diff));
});
test('只有 worker 的插话回显产生 ack，RPC 响应不产生 ack', () => {
  const events = translate('app-steer');
  assert.equal(events.filter(e => e.type === 'steer_acked').length, 1);
  const mapper = new CodexToStage(); mapper.registerSteer('client-id', 'test');
  assert.deepEqual(mapper.translate({ id: 4, result: { turnId: 'turn-id' } }), []);
});
test('打断关闭缺失 completed 的工具且不声明成功', () => {
  const events = translate('app-interrupt');
  assert.ok(events.some(e => e.type === 'tool_end' && !e.ok && e.summary?.includes('No completion')));
  const interrupted = events.findIndex(e => e.type === 'interrupted');
  assert.ok(interrupted >= 0);
  assert.equal((events[interrupted + 1] as Extract<StageEvent, { type: 'turn_done' }>).ok, false);
});
test('exec 传输退出区分主动打断与异常退出', () => {
  const mapper = new CodexToStage();
  mapper.translate({ type: 'item.started', item: { type: 'command_execution', id: 'long', command: 'node long-command.cjs' } });
  assert.deepEqual(mapper.transportClosed('SIGINT requested', true).map(e => e.type), ['tool_end', 'interrupted', 'turn_done']);
  assert.equal(new CodexToStage().transportClosed('exit 1', false)[0].type, 'error');
});
test('输出截断，保留真实的命令失败和本轮失败状态', () => {
  const mapper = new CodexToStage();
  const result = mapper.translate({ type: 'item.completed', item: { type: 'command_execution', id: 'large', command: 'test', exit_code: 1, aggregated_output: 'x'.repeat(5000) } });
  assert.equal((result[0] as Extract<StageEvent, { type: 'tool_end' }>).output?.length, 4000);
  assert.equal((result[0] as Extract<StageEvent, { type: 'tool_end' }>).ok, false);
  const failed = mapper.translate({ type: 'turn.failed', error: { message: 'fixture error' } });
  assert.equal((failed[0] as Extract<StageEvent, { type: 'turn_done' }>).ok, false);
});
test('Gemini 真实样本保留命令、推理活动和审批，不臆造结构化 diff', () => {
  const events = translate('gemini-full');
  assert.ok(events.some(e => e.type === 'thinking'));
  assert.ok(events.some(e => e.type === 'permission_request'));
  assert.ok(events.some(e => e.type === 'tool_end' && e.output?.includes('pass 1')));
  assert.ok(!events.some(e => e.type === 'tool_end' && e.diff));
});
test('脱敏覆盖邮箱、凭据、本地账号和主机身份', () => {
  const value = scrub({ email: 'test@example.invalid', accountId: 'private-account', installationId: 'private-installation', text: `owner ${userInfo().username}, Bearer test-token, sk-test-secret, test@example.invalid` });
  assert.equal(value.email, '[REDACTED]');
  assert.ok(!JSON.stringify(value).includes('private-account'));
  assert.ok(!JSON.stringify(value).includes('test-token'));
  assert.ok(!value.text.includes(userInfo().username));
});
test('提交的 StageEvent 日志均可解析，工具输出至多 4000 字符', () => {
  const types = new Set(['session_started', 'user_message', 'steer_queued', 'steer_acked', 'interrupted', 'thinking', 'worker_text', 'tool_start', 'tool_end', 'permission_request', 'permission_resolved', 'turn_done', 'error']);
  for (const name of readdirSync(samples).filter(n => n.endsWith('.stage.jsonl'))) {
    for (const event of rows(name)) {
      assert.ok(types.has(event.type), name);
      assert.equal(typeof event.at, 'number', name);
      if (event.output) assert.ok(event.output.length <= 4000, name);
    }
  }
});
