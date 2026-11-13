const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  isInsideAsarArchive,
  buildAugmentedPath,
  resolveDshBinary,
  resolveNodeBinary,
  buildDshSpawnEnv,
  resolveRuntimePaths,
  ensureBigfishProfile,
  verifyPackagedAppDir,
} = require('./runtime.cjs');

function makeTempDir(prefix = 'bigfish-runtime-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExecutable(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode: 0o755 });
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
}

function createFakeAppCheckout(rootDir, { withBuiltPlugin = true } = {}) {
  const pluginDir = path.join(rootDir, 'packages', 'dsh-client-ui-p5stage');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ name: 'bigfish-stage', private: true }, null, 2)
  );
  fs.writeFileSync(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({ name: '@bigfish/dsh-client-ui-p5stage', private: true }, null, 2)
  );
  if (withBuiltPlugin) {
    fs.mkdirSync(path.join(pluginDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'lib', 'index.js'), 'export default {};\n');
    fs.writeFileSync(path.join(pluginDir, 'lib', 'client.js'), '// client\n');
  }
  fs.mkdirSync(path.join(rootDir, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'electron', 'main.cjs'), '// main\n');
  fs.writeFileSync(path.join(rootDir, 'electron', 'preload.cjs'), '// preload\n');
  fs.writeFileSync(path.join(rootDir, 'electron', 'runtime.cjs'), '// runtime\n');
  fs.mkdirSync(path.join(rootDir, 'public', 'characters', 'deepseek-v4-pro'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(rootDir, 'public', 'characters', 'deepseek-v4-pro', 'character.json'),
    '{"id":"deepseek-v4-pro"}\n'
  );
  fs.mkdirSync(path.join(rootDir, 'public', 'sfx'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'public', 'sfx', 'manifest.json'), '{"files":{}}\n');
  return { rootDir, pluginDir };
}

test('ensureBigfishProfile initializes clean profile and preserves user config on re-run', (t) => {
  const tempRoot = makeTempDir();
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dshHome = path.join(tempRoot, 'isolated-dsh-home');
  const checkout = createFakeAppCheckout(path.join(tempRoot, 'checkout'));

  const result = ensureBigfishProfile({
    appRoot: checkout.rootDir,
    dshHome,
    homeDir: tempRoot,
    env: {},
  });

  assert.equal(result.profileDir, path.join(dshHome, 'profiles', 'bigfish'));
  const profilePkg = JSON.parse(
    fs.readFileSync(path.join(result.profileDir, 'package.json'), 'utf8')
  );
  assert.deepEqual(profilePkg.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
  ]);
  assert.equal(
    fs.readFileSync(path.join(result.profileDir, 'cordis.yml'), 'utf8'),
    '[]\n'
  );
  assert.match(
    fs.readFileSync(path.join(result.profileDir, 'cordis.patch.yml'), 'utf8'),
    /@bigfish\/dsh-client-ui-p5stage/
  );

  const linkedPkg = JSON.parse(
    fs.readFileSync(path.join(result.pluginLinkPath, 'package.json'), 'utf8')
  );
  assert.equal(linkedPkg.name, '@bigfish/dsh-client-ui-p5stage');

  // Simulate user saving settings in cordis.yml; re-run must not overwrite it
  const customCordis = '[{"id":"custom-user-provider"}]\n';
  fs.writeFileSync(path.join(result.profileDir, 'cordis.yml'), customCordis);
  ensureBigfishProfile({
    appRoot: checkout.rootDir,
    dshHome,
    homeDir: tempRoot,
    env: {},
  });
  assert.equal(
    fs.readFileSync(path.join(result.profileDir, 'cordis.yml'), 'utf8'),
    customCordis
  );
});

test('ensureBigfishProfile repairs dangling symlink when app directory moves', (t) => {
  const tempRoot = makeTempDir();
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dshHome = path.join(tempRoot, 'dsh-home');
  const oldApp = createFakeAppCheckout(path.join(tempRoot, 'old-location'));
  const newApp = createFakeAppCheckout(path.join(tempRoot, 'new-location'));

  const first = ensureBigfishProfile({
    appRoot: oldApp.rootDir,
    dshHome,
    homeDir: tempRoot,
    env: {},
  });
  assert.equal(fs.realpathSync(first.pluginLinkPath), fs.realpathSync(oldApp.pluginDir));

  // Delete old location so existing symlink becomes a broken/dangling symlink
  fs.rmSync(oldApp.rootDir, { recursive: true, force: true });
  assert.equal(fs.existsSync(first.pluginLinkPath), false);
  assert.equal(fs.lstatSync(first.pluginLinkPath).isSymbolicLink(), true);

  const second = ensureBigfishProfile({
    appRoot: newApp.rootDir,
    dshHome,
    homeDir: tempRoot,
    env: {},
  });
  assert.equal(fs.realpathSync(second.pluginLinkPath), fs.realpathSync(newApp.pluginDir));
});

test('resolveDshBinary and resolveNodeBinary discover nvm/fnm installations and respect DSH_BIN', (t) => {
  if (process.platform === 'win32') return;
  const tempHome = makeTempDir();
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

  const nvmOldBin = path.join(tempHome, '.nvm', 'versions', 'node', 'v18.20.0', 'bin');
  const nvmNewBin = path.join(tempHome, '.nvm', 'versions', 'node', 'v22.14.0', 'bin');
  const fnmMacBin = path.join(
    tempHome,
    'Library',
    'Application Support',
    'fnm',
    'node-versions',
    'v22.11.0',
    'installation',
    'bin'
  );

  writeExecutable(path.join(nvmOldBin, 'node'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(nvmNewBin, 'node'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(fnmMacBin, 'dsh'), '#!/bin/sh\nexit 0\n');

  const minimalGuiEnv = { PATH: '/usr/bin:/bin' };
  const augPath = buildAugmentedPath({
    homeDir: tempHome,
    env: minimalGuiEnv,
    platform: 'darwin',
  });

  assert.equal(
    resolveNodeBinary({
      homeDir: tempHome,
      env: minimalGuiEnv,
      platform: 'darwin',
      augmentedPath: augPath,
    }),
    path.join(nvmNewBin, 'node')
  );
  assert.equal(
    resolveDshBinary({
      homeDir: tempHome,
      env: minimalGuiEnv,
      platform: 'darwin',
      augmentedPath: augPath,
    }),
    path.join(fnmMacBin, 'dsh')
  );

  // Explicit DSH_BIN must take precedence even when other dsh binaries exist
  writeExecutable(path.join(tempHome, '.local', 'bin', 'dsh'), '#!/bin/sh\nexit 0\n');
  const customDsh = path.join(tempHome, 'custom-tools', 'my-dsh');
  writeExecutable(customDsh, '#!/bin/sh\nexit 0\n');

  const spawnSpec = buildDshSpawnEnv({
    homeDir: tempHome,
    env: { PATH: '/usr/bin:/bin', DSH_BIN: customDsh },
    platform: 'darwin',
  });
  assert.equal(spawnSpec.dshBin, customDsh);
  assert.ok(spawnSpec.env.PATH.split(':').includes(path.dirname(customDsh)));
  assert.ok(spawnSpec.env.PATH.split(':').includes(nvmNewBin));

  // Non-existent explicit DSH_BIN path must NOT silently fall back to ~/.local/bin/dsh
  const missingExplicit = path.join(tempHome, 'missing', 'dsh');
  assert.equal(
    resolveDshBinary({
      homeDir: tempHome,
      env: { PATH: '/usr/bin:/bin', DSH_BIN: missingExplicit },
      platform: 'darwin',
    }),
    missingExplicit
  );
});

test('resolveRuntimePaths avoids .asar paths and selects real disk cwd & pluginDir', (t) => {
  const tempRoot = makeTempDir();
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const fakeHome = path.join(tempRoot, 'user-home');
  fs.mkdirSync(fakeHome, { recursive: true });

  // 1) Packaged app with asar: false -> Resources/app/electron
  const resourcesDir = path.join(tempRoot, 'BigFish Stage.app', 'Contents', 'Resources');
  const packagedApp = createFakeAppCheckout(path.join(resourcesDir, 'app'));

  const packagedPaths = resolveRuntimePaths({
    moduleDir: path.join(packagedApp.rootDir, 'electron'),
    isPackaged: true,
    resourcesPath: resourcesDir,
    homeDir: fakeHome,
    env: {},
  });

  assert.equal(isInsideAsarArchive(packagedPaths.appRoot), false);
  assert.equal(isInsideAsarArchive(packagedPaths.pluginDir), false);
  assert.equal(isInsideAsarArchive(packagedPaths.launchCwd), false);
  assert.equal(packagedPaths.appRoot, fs.realpathSync(packagedApp.rootDir));
  assert.equal(packagedPaths.launchCwd, fs.realpathSync(fakeHome));
  assert.equal(verifyPackagedAppDir(packagedApp.rootDir), true);

  // 2) Defensive fallback if moduleDir ever points inside app.asar/electron
  const unpackedDir = createFakeAppCheckout(path.join(resourcesDir, 'app.asar.unpacked'));
  fs.rmSync(packagedApp.rootDir, { recursive: true, force: true });
  const fallbackPaths = resolveRuntimePaths({
    moduleDir: path.join(resourcesDir, 'app.asar', 'electron'),
    isPackaged: true,
    resourcesPath: resourcesDir,
    homeDir: fakeHome,
    env: {},
  });
  assert.equal(fallbackPaths.appRoot, fs.realpathSync(unpackedDir.rootDir));
  assert.equal(isInsideAsarArchive(fallbackPaths.launchCwd), false);
});

test('scripts/run-dsh.cjs initializes bigfish profile on fresh machine without opening Electron', (t) => {
  if (process.platform === 'win32') return;
  const tempRoot = makeTempDir();
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const isolatedHome = path.join(tempRoot, 'home');
  const isolatedDshHome = path.join(tempRoot, 'dsh-home');
  const recordFile = path.join(tempRoot, 'invocation.json');
  const fakeDshBin = path.join(tempRoot, 'bin', 'fake-dsh');

  fs.mkdirSync(isolatedHome, { recursive: true });
  writeExecutable(
    fakeDshBin,
    `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(
  ${JSON.stringify(recordFile)},
  JSON.stringify({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    dshHome: process.env.DSH_HOME,
  }),
  'utf8'
);
`
  );

  const runnerScript = path.resolve(__dirname, '..', 'scripts', 'run-dsh.cjs');
  execFileSync(process.execPath, [runnerScript, '--no-open', '--port', '62000'], {
    env: {
      ...process.env,
      HOME: isolatedHome,
      DSH_HOME: isolatedDshHome,
      DSH_BIN: fakeDshBin,
    },
    stdio: 'pipe',
  });

  const recorded = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.deepEqual(recorded.args, ['--profile', 'bigfish', '--no-open', '--port', '62000']);
  assert.equal(recorded.dshHome, isolatedDshHome);

  const linkPath = path.join(
    isolatedDshHome,
    'profiles',
    'bigfish',
    'node_modules',
    '@bigfish',
    'dsh-client-ui-p5stage'
  );
  assert.ok(fs.existsSync(path.join(linkPath, 'package.json')));
});
