import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { StageEvent } from '../../src/shared/stage-events';
import { CodexToStage } from './codex-to-stage';
import { runtime, defaultModel } from './runtime';

export function execSpike(prompt: string, options: { model?: string; resume?: string; onStage?: (e: StageEvent) => void; onRaw?: (direction: string, message: any) => void } = {}) {
  const config = runtime();
  const args = [...config.args, 'exec', ...(options.resume ? ['resume', options.resume] : []), '--json', '--skip-git-repo-check', '-m', options.model ?? defaultModel, prompt];
  const child = spawn('codex', args, { cwd: config.cwd, env: config.env });
  // exec reads piped stdin to EOF even when a positional prompt is supplied.
  // It is not a channel for live steering.
  child.stdin.end();
  const mapper = new CodexToStage();
  const stage = options.onStage ?? (event => console.log(JSON.stringify(event)));
  let done = false;
  let interruptionRequested = false;
  options.onRaw?.('out', { args, cwd: config.cwd });
  stage({ type: 'user_message', at: Date.now(), id: crypto.randomUUID(), text: prompt });
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const raw = JSON.parse(line);
      options.onRaw?.('in', raw);
      for (const event of mapper.translate(raw)) { if (event.type === 'turn_done') done = true; stage(event); }
    } catch (error) { stage({ type: 'error', at: Date.now(), message: String(error) }); }
  });
  child.stderr.on('data', data => options.onRaw ? options.onRaw('stderr', data.toString()) : process.stderr.write(data));
  child.on('error', error => stage({ type: 'error', at: Date.now(), message: error.message }));
  const exited = new Promise<void>(resolve => child.on('close', (code, signal) => {
    if (!done) {
      for (const event of mapper.transportClosed(interruptionRequested ? 'SIGINT requested' : signal ?? `exec exited ${code} without turn.completed`, Boolean(signal || interruptionRequested))) stage(event);
    }
    resolve();
  }));
  return { child, exited, interrupt() { interruptionRequested = true; child.kill('SIGINT'); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prompt = process.argv.slice(2).join(' ');
  if (!prompt) { console.error('用法: npx tsx src/exec-spike.ts "任务描述"；BRIDGE_RESUME 可指定会话'); process.exitCode = 1; }
  else {
    const run = execSpike(prompt, { model: process.env.BRIDGE_MODEL, resume: process.env.BRIDGE_RESUME });
    const interrupt = () => run.interrupt();
    process.on('SIGINT', interrupt);
    run.exited.finally(() => process.off('SIGINT', interrupt));
  }
}
