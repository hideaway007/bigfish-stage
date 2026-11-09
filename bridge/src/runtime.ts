import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export const sandbox = '/tmp/p5-bridge-sandbox';
export function runtime() {
  mkdirSync(sandbox, { recursive: true });
  if (lstatSync(sandbox).isSymbolicLink()) throw new Error('Sandbox must not be a symlink');
  const cwd = realpathSync(sandbox);
  // Isolate Codex history/config writes as well as model-generated file writes.
  const home = resolve(cwd, '.codex');
  mkdirSync(home, { recursive: true });
  return { cwd, env: { ...process.env, CODEX_HOME: home }, args: [
    '-c', 'model_provider="local"',
    '-c', 'model_providers.local.name="Local magpie"',
    '-c', 'model_providers.local.base_url="http://127.0.0.1:3425/v1"',
    '-c', 'model_providers.local.wire_api="responses"',
    '-c', 'model_providers.local.requires_openai_auth=false',
    '-c', 'sandbox_mode="workspace-write"',
    '-c', 'sandbox_workspace_write.exclude_slash_tmp=true',
    '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
    '-c', 'approval_policy="on-request"',
  ] };
}
export const defaultModel = 'gpt-6-luna';
export const textInput = (text: string) => [{ type: 'text' as const, text, text_elements: [] }];
