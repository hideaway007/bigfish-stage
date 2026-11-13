const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const POSIX_SYSTEM_DEFAULT_DIRS = new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin']);

function isInsideAsarArchive(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  return targetPath
    .split(/[\\/]+/)
    .some((segment) => segment.toLowerCase().endsWith('.asar'));
}

function isExistingDirectory(dirPath) {
  if (!dirPath || isInsideAsarArchive(dirPath)) return false;
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function parseVersionSegments(name) {
  const match = String(name).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [
    Number(match[1] || 0),
    Number(match[2] || 0),
    Number(match[3] || 0),
  ];
}

function compareVersionDesc(a, b) {
  const va = parseVersionSegments(a);
  const vb = parseVersionSegments(b);
  if (va && vb) {
    for (let i = 0; i < 3; i += 1) {
      if (va[i] !== vb[i]) return vb[i] - va[i];
    }
  } else if (va) {
    return -1;
  } else if (vb) {
    return 1;
  }
  return String(b).localeCompare(String(a));
}

function listSortedSubdirs(parentDir, filterFn) {
  if (!isExistingDirectory(parentDir)) return [];
  try {
    return fs
      .readdirSync(parentDir)
      .filter((entry) => (!filterFn || filterFn(entry)) && isExistingDirectory(path.join(parentDir, entry)))
      .sort(compareVersionDesc);
  } catch {
    return [];
  }
}

function collectCandidateBinDirs(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const platform = options.platform || process.platform;
  const isWin = platform === 'win32';
  const candidates = [];

  if (env.NVM_BIN) {
    candidates.push(env.NVM_BIN);
  }
  const nvmDir = env.NVM_DIR || (homeDir ? path.join(homeDir, '.nvm') : null);
  if (nvmDir) {
    const nvmNodesRoot = path.join(nvmDir, 'versions', 'node');
    for (const ver of listSortedSubdirs(nvmNodesRoot)) {
      candidates.push(isWin ? path.join(nvmNodesRoot, ver) : path.join(nvmNodesRoot, ver, 'bin'));
    }
  }
  if (isWin && env.NVM_SYMLINK) {
    candidates.push(env.NVM_SYMLINK);
  }

  if (env.FNM_MULTISHELL_PATH) {
    if (!isWin) candidates.push(path.join(env.FNM_MULTISHELL_PATH, 'bin'));
    candidates.push(env.FNM_MULTISHELL_PATH);
  }
  const fnmRoots = [
    env.FNM_DIR,
    homeDir ? path.join(homeDir, '.local', 'share', 'fnm') : null,
    homeDir ? path.join(homeDir, 'Library', 'Application Support', 'fnm') : null,
    homeDir ? path.join(homeDir, '.fnm') : null,
    env.XDG_DATA_HOME ? path.join(env.XDG_DATA_HOME, 'fnm') : null,
  ].filter(Boolean);

  for (const fnmRoot of fnmRoots) {
    const versionsRoot = path.join(fnmRoot, 'node-versions');
    for (const ver of listSortedSubdirs(versionsRoot)) {
      const installDir = path.join(versionsRoot, ver, 'installation');
      candidates.push(isWin ? installDir : path.join(installDir, 'bin'));
    }
  }

  if (homeDir) {
    const localLib = path.join(homeDir, '.local', 'lib');
    for (const entry of listSortedSubdirs(localLib, (name) => name.startsWith('node-'))) {
      candidates.push(path.join(localLib, entry, 'bin'));
    }

    candidates.push(path.join(homeDir, '.local', 'bin'));
    candidates.push(env.VOLTA_HOME ? path.join(env.VOLTA_HOME, 'bin') : path.join(homeDir, '.volta', 'bin'));
    candidates.push(path.join(homeDir, '.asdf', 'shims'));
    candidates.push(path.join(homeDir, '.local', 'share', 'mise', 'shims'));
    if (env.PNPM_HOME) candidates.push(env.PNPM_HOME);
    candidates.push(path.join(homeDir, 'Library', 'pnpm'));
    candidates.push(path.join(homeDir, '.local', 'share', 'pnpm'));
    candidates.push(path.join(homeDir, '.npm-global', 'bin'));
    candidates.push(path.join(homeDir, '.bun', 'bin'));
  }

  if (!isWin) {
    candidates.push(
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin'
    );
  }

  const seen = new Set();
  const existing = [];
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    if (isExistingDirectory(dir)) {
      existing.push(dir);
    }
  }
  return existing;
}

function hasPathSeparator(value) {
  return /[\\/]/.test(value) || value.startsWith('.');
}

function buildAugmentedPath(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const cwd = options.cwd || process.cwd();
  const delimiter = platform === 'win32' ? ';' : ':';
  const rawPath = env.PATH ?? env.Path ?? '';
  const currentEntries = String(rawPath)
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);

  const explicitDirs = [];
  for (const rawOverride of [env.DSH_BIN, env.NODE_BIN]) {
    if (rawOverride && rawOverride.trim() && hasPathSeparator(rawOverride.trim())) {
      const resolved = path.resolve(cwd, rawOverride.trim());
      const dir = path.dirname(resolved);
      if (isExistingDirectory(dir)) {
        explicitDirs.push(dir);
      }
    }
  }

  const userCurrent =
    platform === 'win32'
      ? currentEntries
      : currentEntries.filter((entry) => !POSIX_SYSTEM_DEFAULT_DIRS.has(entry));
  const sysCurrent =
    platform === 'win32'
      ? []
      : currentEntries.filter((entry) => POSIX_SYSTEM_DEFAULT_DIRS.has(entry));

  const discovered = collectCandidateBinDirs(options);
  const merged = Array.from(
    new Set([...explicitDirs, ...userCurrent, ...discovered, ...sysCurrent])
  );
  return merged.join(delimiter);
}

function isExecutableFile(filePath, platform = process.platform) {
  if (!filePath || isInsideAsarArchive(filePath)) return false;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function resolveExecutableInPath(commandName, pathValue, options = {}) {
  if (!commandName) return null;
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const delimiter = platform === 'win32' ? ';' : ':';
  const dirs = String(pathValue || '')
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);

  const extensions =
    platform === 'win32'
      ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
      : [''];

  for (const dir of dirs) {
    if (platform === 'win32') {
      const hasExt = path.extname(commandName) !== '';
      if (hasExt) {
        const direct = path.join(dir, commandName);
        if (isExecutableFile(direct, platform)) return direct;
      }
      for (const ext of extensions) {
        const candidate = path.join(dir, `${commandName}${ext}`);
        if (isExecutableFile(candidate, platform)) return candidate;
        const lowerCandidate = path.join(dir, `${commandName}${ext.toLowerCase()}`);
        if (isExecutableFile(lowerCandidate, platform)) return lowerCandidate;
      }
    } else {
      const candidate = path.join(dir, commandName);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

function resolveDshBinary(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const augmentedPath = options.augmentedPath || buildAugmentedPath(options);

  if (typeof env.DSH_BIN === 'string' && env.DSH_BIN.trim()) {
    const custom = env.DSH_BIN.trim();
    if (hasPathSeparator(custom)) {
      return path.resolve(cwd, custom);
    }
    return resolveExecutableInPath(custom, augmentedPath, options) || custom;
  }

  return resolveExecutableInPath('dsh', augmentedPath, options) || 'dsh';
}

function resolveNodeBinary(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const augmentedPath = options.augmentedPath || buildAugmentedPath(options);

  if (typeof env.NODE_BIN === 'string' && env.NODE_BIN.trim()) {
    const custom = env.NODE_BIN.trim();
    if (hasPathSeparator(custom)) {
      return path.resolve(cwd, custom);
    }
    return resolveExecutableInPath(custom, augmentedPath, options) || custom;
  }

  return resolveExecutableInPath('node', augmentedPath, options) || 'node';
}

function buildDshSpawnEnv(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const delimiter = platform === 'win32' ? ';' : ':';
  const basePath = buildAugmentedPath(options);
  const dshBin = resolveDshBinary({ ...options, augmentedPath: basePath });
  const nodeBin = resolveNodeBinary({ ...options, augmentedPath: basePath });

  const prependDirs = [];
  for (const resolved of [dshBin, nodeBin]) {
    if (resolved && hasPathSeparator(resolved)) {
      const dir = path.dirname(resolved);
      if (isExistingDirectory(dir)) {
        prependDirs.push(dir);
      }
    }
  }

  const finalPath = Array.from(
    new Set([...prependDirs, ...basePath.split(delimiter).filter(Boolean)])
  ).join(delimiter);

  const spawnEnv = {
    ...env,
    PATH: finalPath,
  };
  if (platform === 'win32' && 'Path' in spawnEnv) {
    spawnEnv.Path = finalPath;
  }

  return {
    dshBin,
    nodeBin,
    env: spawnEnv,
  };
}

function toUnpackedAsarCandidate(targetPath) {
  if (!targetPath || !isInsideAsarArchive(targetPath)) return null;
  return targetPath.replace(/\.asar([\\/]|$)/i, '.asar.unpacked$1');
}

function resolveRuntimePaths(options = {}) {
  const env = options.env || process.env;
  const moduleDir = options.moduleDir || __dirname;
  const isPackaged = Boolean(options.isPackaged);
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const homeDir = options.homeDir || os.homedir();

  const parentFromModule = path.resolve(moduleDir, '..');
  const appRootCandidates = [
    options.appRoot,
    env.BIGFISH_APP_ROOT,
    parentFromModule,
    toUnpackedAsarCandidate(parentFromModule),
    resourcesPath ? path.join(resourcesPath, 'app') : null,
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked') : null,
    resourcesPath,
  ].filter(Boolean);

  let resolvedAppRoot = null;
  for (const candidate of appRootCandidates) {
    if (!isExistingDirectory(candidate)) continue;
    const pluginManifest = path.join(
      candidate,
      'packages',
      'dsh-client-ui-p5stage',
      'package.json'
    );
    if (fs.existsSync(pluginManifest)) {
      resolvedAppRoot = fs.realpathSync(candidate);
      break;
    }
  }

  if (!resolvedAppRoot) {
    const fallbackDir = appRootCandidates.find((candidate) => isExistingDirectory(candidate));
    if (!fallbackDir) {
      throw new Error(
        `无法定位真实磁盘上的 BigFish Stage 资源目录（moduleDir=${moduleDir}）。请确认打包配置已禁用 asar 或包含完整插件目录。`
      );
    }
    resolvedAppRoot = fs.realpathSync(fallbackDir);
  }

  const pluginDir = path.join(resolvedAppRoot, 'packages', 'dsh-client-ui-p5stage');
  const publicDir = path.join(resolvedAppRoot, 'public');

  const cwdCandidates = [
    options.cwd,
    env.BIGFISH_WORK_DIR,
    env.BIGFISH_PROJECT_DIR,
    !isPackaged ? resolvedAppRoot : null,
    homeDir,
    resolvedAppRoot,
    os.tmpdir(),
  ].filter(Boolean);

  let launchCwd = null;
  for (const candidate of cwdCandidates) {
    if (isExistingDirectory(candidate)) {
      try {
        launchCwd = fs.realpathSync(candidate);
      } catch {
        launchCwd = path.resolve(candidate);
      }
      break;
    }
  }

  if (!launchCwd) {
    throw new Error('无法找到可用于启动 DSH 的真实磁盘工作目录。');
  }

  return {
    appRoot: resolvedAppRoot,
    pluginDir,
    publicDir,
    launchCwd,
  };
}

function ensureBigfishProfile(input = {}) {
  const options = typeof input === 'string' ? { appRoot: input } : input;
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const platform = options.platform || process.platform;

  const appRoot = options.appRoot || path.resolve(__dirname, '..');
  const targetPluginDir =
    options.pluginDir || path.join(appRoot, 'packages', 'dsh-client-ui-p5stage');

  if (isInsideAsarArchive(targetPluginDir)) {
    throw new Error(
      `DSH 插件目录位于虚拟 asar 归档内，外部 DSH 进程无法读取：${targetPluginDir}`
    );
  }

  const pluginPkgPath = path.join(targetPluginDir, 'package.json');
  if (!fs.existsSync(pluginPkgPath)) {
    throw new Error(`未找到 DSH 舞台插件清单文件：${pluginPkgPath}`);
  }

  const dshHome = options.dshHome || env.DSH_HOME || path.join(homeDir, '.dsh');
  const profileDir = path.join(dshHome, 'profiles', 'bigfish');
  fs.mkdirSync(profileDir, { recursive: true });

  const pkgPath = path.join(profileDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: 'dsh-profile-bigfish',
          private: true,
          dependencies: {},
          dsh: {
            profile: {
              bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
            },
          },
        },
        null,
        2
      ) + '\n'
    );
  }

  const cordisYmlPath = path.join(profileDir, 'cordis.yml');
  if (!fs.existsSync(cordisYmlPath)) {
    fs.writeFileSync(cordisYmlPath, '[]\n');
  }

  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  if (!fs.existsSync(patchPath)) {
    fs.writeFileSync(
      patchPath,
      [
        '# bigfish profile — P5 Agent Stage over DeepSeek Harness',
        '- id: ui-chat',
        '  disabled: true',
        '- id: ui-brand-official',
        '  disabled: true',
        '- id: ui-sidebar',
        '  disabled: true',
        '- id: ui-settings-account',
        '  disabled: true',
        '- insert:',
        '    - id: ui-p5stage',
        "      name: '@bigfish/dsh-client-ui-p5stage'",
        '',
      ].join('\n')
    );
  }

  const scopeDir = path.join(profileDir, 'node_modules', '@bigfish');
  fs.mkdirSync(scopeDir, { recursive: true });
  const linkPath = path.join(scopeDir, 'dsh-client-ui-p5stage');
  const realTarget = fs.realpathSync(targetPluginDir);

  let existsOnDisk = false;
  let pointsToTarget = false;
  try {
    fs.lstatSync(linkPath);
    existsOnDisk = true;
    const realExisting = fs.realpathSync(linkPath);
    pointsToTarget = realExisting === realTarget;
  } catch {
    pointsToTarget = false;
  }

  if (!pointsToTarget) {
    if (existsOnDisk) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
    fs.symlinkSync(realTarget, linkPath, platform === 'win32' ? 'junction' : 'dir');
  }

  return {
    dshHome,
    profileDir,
    pluginLinkPath: linkPath,
    targetPluginDir: realTarget,
  };
}

function verifyPackagedAppDir(appDir) {
  if (!isExistingDirectory(appDir)) {
    throw new Error(`打包应用目录不存在或不是真实磁盘目录：${appDir}`);
  }
  const parentResources = path.dirname(appDir);
  const asarSibling = path.join(parentResources, 'app.asar');
  if (fs.existsSync(asarSibling)) {
    throw new Error(`检测到未禁用的 app.asar 归档（期望 asar: false 真实目录）：${asarSibling}`);
  }

  const requiredRelativePaths = [
    'package.json',
    'electron/main.cjs',
    'electron/preload.cjs',
    'electron/runtime.cjs',
    'packages/dsh-client-ui-p5stage/package.json',
    'packages/dsh-client-ui-p5stage/lib/index.js',
    'packages/dsh-client-ui-p5stage/lib/client.js',
    'public/characters/deepseek-v4-pro/character.json',
    'public/sfx/manifest.json',
  ];

  const missing = requiredRelativePaths.filter(
    (rel) => !fs.existsSync(path.join(appDir, rel))
  );
  if (missing.length > 0) {
    throw new Error(
      `打包应用目录缺少必要运行时文件 (${appDir})：\n- ${missing.join('\n- ')}`
    );
  }
  return true;
}

module.exports = {
  isInsideAsarArchive,
  compareVersionDesc,
  collectCandidateBinDirs,
  buildAugmentedPath,
  resolveExecutableInPath,
  resolveDshBinary,
  resolveNodeBinary,
  buildDshSpawnEnv,
  resolveRuntimePaths,
  ensureBigfishProfile,
  verifyPackagedAppDir,
};
