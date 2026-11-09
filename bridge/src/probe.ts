import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { scrub } from './scrub';
import { fileURLToPath } from 'node:url';
import { AppServerSpike } from './appserver-spike';
import { execSpike } from './exec-spike';
import { defaultModel } from './runtime';
import type { StageEvent } from '../../src/shared/stage-events';

const samples = fileURLToPath(new URL('../samples/', import.meta.url));
const name = process.argv[2] ?? 'app-full';
const model = process.env.BRIDGE_MODEL ?? defaultModel;
mkdirSync(samples, { recursive: true });
const rawPath = `${samples}${name}.raw.jsonl`, stagePath = `${samples}${name}.stage.jsonl`;
writeFileSync(rawPath, ''); writeFileSync(stagePath, '');
const raw = (direction: string, message: any) => appendFileSync(rawPath, JSON.stringify(scrub({ at: Date.now(), direction, message })) + '\n');
const stage = (event: StageEvent) => { appendFileSync(stagePath, JSON.stringify(scrub(event)) + '\n'); console.log(JSON.stringify(event)); };
const full = 'Read add.js and add.test.js. Fix add by apply_patch (do not use shell to edit). Then run exactly npm test using shell tool with sandbox_permissions="require_escalated" and justification="May I run npm test for the bridge approval experiment?" so that the client can decide. Do not run tests without requesting approval. Reply briefly. Remember context marker ORANGE_OTTER_42.';
const waitFor = (client: AppServerSpike, predicate: (m: any) => boolean, timeout = 120_000) => new Promise<any>((resolve, reject) => {
  const listener = (m: any) => { if (predicate(m)) { cleanup(); resolve(m); } };
  const closed = () => { cleanup(); reject(new Error('server closed while waiting')); };
  const timer = setTimeout(() => { cleanup(); reject(new Error('probe wait timeout')); }, timeout);
  const cleanup = () => { clearTimeout(timer); client.off('message', listener); client.off('closed', closed); };
  client.on('message', listener); client.on('closed', closed);
});
const done = (client: AppServerSpike) => waitFor(client, m => m.method === 'turn/completed');
async function run() {
  if (name.startsWith('exec')) {
    let session = process.env.BRIDGE_RESUME;
    let interruptScheduled = false;
    const run = execSpike(name.includes('full') ? full : name.includes('resume') ? 'What context marker did I ask you to remember? No tools.' : 'Remember marker EXEC_OTTER_17. Run node long-command.cjs exec-interrupt-finished.txt and then reply done.', { model, resume: session, onStage: event => {
      stage(event);
      if (name.includes('interrupt') && event.type === 'tool_start' && !interruptScheduled) {
        interruptScheduled = true;
        setTimeout(() => { raw('control', { action: 'SIGINT', session }); run.interrupt(); }, 500);
      }
    }, onRaw: (d, m) => { raw(d, m); if (m?.thread_id) session = m.thread_id; } });
    const timer = setTimeout(() => run.child.kill('SIGTERM'), 120_000);
    await run.exited; clearTimeout(timer); raw('result', { session });
    if (name.includes('interrupt')) { await new Promise(resolve => setTimeout(resolve, 21000)); raw('measurement', { sentinelExistsAfter21s: existsSync('/tmp/p5-bridge-sandbox/exec-interrupt-finished.txt') }); }
    return;
  }
  let client = new AppServerSpike(stage, raw);
  client.on('approval', request => { raw('control', { action: 'approvalDecision', allowed: !name.includes('deny') }); client.approve(request, !name.includes('deny')); });
  try {
    const started = await client.start(model, process.env.BRIDGE_RESUME);
    raw('control', { sandbox: started.sandbox, approvalPolicy: started.approvalPolicy });
    if (name === 'app-errors') {
      try { await client.request('turn/steer', { threadId: client.threadId, expectedTurnId: 'no-active-turn', input: [{ type: 'text', text: 'test', text_elements: [] }] }); }
      catch (error) { stage({ type: 'error', at: Date.now(), message: String(error) }); }
    } else if (name === 'latency') {
      for (let i = 0; i < 3; i++) {
        const sent = Date.now(); let firstEvent: number | undefined, firstText: number | undefined;
        const timing = (m: any) => { if (m.method) firstEvent ??= Date.now() - sent; if (m.method === 'item/agentMessage/delta') firstText ??= Date.now() - sent; };
        client.on('message', timing);
        const complete = done(client); await client.say(`Reply exactly PONG_${i}. No tools.`); await complete;
        client.off('message', timing); raw('measurement', { run: i + 1, firstEventMs: firstEvent, firstTextMs: firstText, totalMs: Date.now() - sent });
      }
    } else if (name.includes('steer') || name.includes('interrupt')) {
      const command = waitFor(client, m => m.method === 'item/started' && m.params.item.type === 'commandExecution');
      const complete = done(client);
      await client.say('Remember marker BLUE_BADGER_73. Run node long-command.cjs app-interrupt-finished.txt and then report. Do not run anything else.');
      await command;
      if (name.includes('steer')) await client.steer('After the current command, reply STEER_SEEN and the remembered marker. Do not run more commands.');
      else { await new Promise(resolve => setTimeout(resolve, 500)); await client.stop(); }
      await complete;
      const followup = done(client); await client.say('What context marker did I ask you to remember? Reply only the marker, no tools.'); await followup;
      const thread = client.threadId; client.close();
      client = new AppServerSpike(stage, raw);
      await client.start(model, thread);
      const resumed = done(client); await client.say('Again, what context marker did I ask you to remember? No tools.'); await resumed;
      if (name.includes('interrupt')) { await new Promise(resolve => setTimeout(resolve, 21000)); raw('measurement', { sentinelExistsAfter21s: existsSync('/tmp/p5-bridge-sandbox/app-interrupt-finished.txt') }); }
    } else {
      const complete = done(client);
      await client.say(name.includes('resume') ? 'What context marker did I ask you to remember? No tools.' : name.includes('deny') ? 'Run exactly npm test once using sandbox_permissions="require_escalated" and justification="May I run npm test?". If denied, report that and stop. Do not retry or run a sandbox fallback. Do not edit files.' : full); await complete;
    }
  } finally { client.close(); }
}
run().catch(error => { raw('failure', { message: String(error) }); console.error(error); process.exitCode = 1; });
