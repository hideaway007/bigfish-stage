import { readFileSync, writeFileSync } from 'node:fs';
import { CodexToStage } from './codex-to-stage';
import type { StageEvent } from '../../src/shared/stage-events';
const base = new URL('../samples/', import.meta.url);
for (const name of process.argv.slice(2)) {
  const read = (suffix: string) => readFileSync(new URL(`${name}.${suffix}.jsonl`, base), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const raw = read('raw');
  const old = read('stage') as StageEvent[];
  const local = old.filter(event => ['user_message', 'steer_queued', 'permission_resolved'].includes(event.type));
  const mapper = new CodexToStage();
  const output: StageEvent[] = [];
  let index = 0, interrupted = false, terminal = false;
  const addLocal = (event: StageEvent) => { if (event.type === 'steer_queued') mapper.registerSteer(event.id, event.text); output.push(event); };
  for (const row of raw) {
    while (index < local.length && local[index].at < row.at) addLocal(local[index++]);
    if (row.direction === 'control' && row.message.action === 'SIGINT') interrupted = true;
    if (row.direction === 'in') {
      const translated = mapper.translate(row.message, row.at);
      if (translated.some(event => event.type === 'turn_done')) terminal = true;
      output.push(...translated);
    }
    if (row.direction === 'result' && !terminal) {
      const fallback = old.find(event => event.type === 'interrupted' || event.type === 'error');
      output.push(...mapper.transportClosed(interrupted ? 'SIGINT requested' : fallback?.type === 'interrupted' ? fallback.reason ?? 'interrupted' : 'exec closed without a terminal event', interrupted || fallback?.type === 'interrupted', row.at));
      terminal = true;
    }
  }
  while (index < local.length) addLocal(local[index++]);
  output.sort((a, b) => a.at - b.at);
  writeFileSync(new URL(`${name}.stage.jsonl`, base), output.map(event => JSON.stringify(event)).join('\n') + '\n');
}
