#!/usr/bin/env node
const { spawn } = require('node:child_process');
const path = require('node:path');
const {
  resolveRuntimePaths,
  ensureBigfishProfile,
  buildDshSpawnEnv,
} = require('../electron/runtime.cjs');

function buildCliArgs(rawArgs) {
  const hasExplicitProfile = rawArgs.some(
    (arg) => arg === '--profile' || arg.startsWith('--profile=')
  );
  return hasExplicitProfile ? [...rawArgs] : ['--profile', 'bigfish', ...rawArgs];
}

function main() {
  const rawArgs = process.argv.slice(2);
  const initOnly = rawArgs.includes('--init-only');
  const forwardArgs = rawArgs.filter((arg) => arg !== '--init-only');

  const appRoot = path.resolve(__dirname, '..');
  const runtimePaths = resolveRuntimePaths({
    appRoot,
    isPackaged: false,
  });

  const profileInfo = ensureBigfishProfile({
    appRoot: runtimePaths.appRoot,
    pluginDir: runtimePaths.pluginDir,
  });

  if (initOnly) {
    console.log(`[BigFish DSH] Profile 已就绪：${profileInfo.profileDir}`);
    return;
  }

  const { dshBin, env } = buildDshSpawnEnv({
    cwd: runtimePaths.launchCwd,
  });
  const dshArgs = buildCliArgs(forwardArgs);

  const child = spawn(dshBin, dshArgs, {
    cwd: runtimePaths.launchCwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(dshBin),
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('error', (err) => {
    const hint =
      err && err.code === 'ENOENT'
        ? '请确认本机已安装 DeepSeek Harness CLI（dsh），或通过环境变量 DSH_BIN=/path/to/dsh 指定可执行文件路径。'
        : '';
    console.error(
      `[BigFish DSH] 无法启动 dsh (${dshBin}): ${err.message}${hint ? `\n${hint}` : ''}`
    );
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main();
