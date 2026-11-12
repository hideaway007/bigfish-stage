const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

let mainWindow = null;
let dshProcess = null;
let dshOrigin = null;
let dshBootUrl = null;
let quitting = false;

function buildAugmentedPath() {
  const home = os.homedir();
  const extraDirs = [
    path.join(home, '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  // Also discover nvm / ~/.local/lib/node-* bin directories if present
  const localLib = path.join(home, '.local/lib');
  if (fs.existsSync(localLib)) {
    try {
      for (const entry of fs.readdirSync(localLib)) {
        if (entry.startsWith('node-')) {
          extraDirs.unshift(path.join(localLib, entry, 'bin'));
        }
      }
    } catch {
      // ignore
    }
  }
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return Array.from(new Set([...extraDirs, ...current])).join(path.delimiter);
}

function resolveDshBinary() {
  if (process.env.DSH_BIN && fs.existsSync(process.env.DSH_BIN)) {
    return process.env.DSH_BIN;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/dsh'),
    '/opt/homebrew/bin/dsh',
    '/usr/local/bin/dsh',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'dsh';
}

function ensureBigfishProfile(projectRoot) {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
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

  // Ensure symlink to this checkout's @bigfish/dsh-client-ui-p5stage plugin
  const scopeDir = path.join(profileDir, 'node_modules', '@bigfish');
  fs.mkdirSync(scopeDir, { recursive: true });
  const linkPath = path.join(scopeDir, 'dsh-client-ui-p5stage');
  const targetPluginDir = path.join(projectRoot, 'packages', 'dsh-client-ui-p5stage');
  try {
    const existing = fs.lstatSync(linkPath);
    if (existing.isSymbolicLink() || existing.isDirectory()) {
      const realExisting = fs.realpathSync(linkPath);
      const realTarget = fs.realpathSync(targetPluginDir);
      if (realExisting !== realTarget) {
        fs.rmSync(linkPath, { recursive: true, force: true });
        fs.symlinkSync(targetPluginDir, linkPath, 'dir');
      }
    }
  } catch {
    fs.symlinkSync(targetPluginDir, linkPath, 'dir');
  }
}

function startDshRuntime(projectRoot) {
  ensureBigfishProfile(projectRoot);
  const dshBin = resolveDshBinary();
  const env = {
    ...process.env,
    PATH: buildAugmentedPath(),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let outputLog = '';

    const proc = spawn(
      dshBin,
      ['--profile', 'bigfish', '--no-open', '--port', '0'],
      {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    dshProcess = proc;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`等待 DSH 启动超时（30s）。日志：\n${outputLog.slice(-800)}`));
    }, 30000);

    const onChunk = (chunk) => {
      const text = chunk.toString('utf8');
      outputLog += text;
      const match = outputLog.match(/dsh web:\s*(https?:\/\/127\.0\.0\.1:(\d+)\/\?token=[^\s]+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        const fullUrl = match[1];
        const port = match[2];
        dshOrigin = `http://127.0.0.1:${port}`;
        dshBootUrl = fullUrl;
        console.log(`[BigFish Desktop] DSH 原生内核已就绪 (port=${port})`);
        resolve({ url: fullUrl, origin: dshOrigin });
      }
    };

    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`无法启动 dsh (${dshBin}): ${err.message}`));
    });

    proc.on('exit', (code, signal) => {
      dshProcess = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            `DSH 进程异常退出 (code=${code}, signal=${signal})。\n${outputLog.slice(-800)}`
          )
        );
      } else if (!quitting) {
        console.error(`[BigFish Desktop] DSH 进程已退出 (code=${code}, signal=${signal})`);
      }
    });
  });
}

function stopDshRuntime() {
  if (!dshProcess) return;
  const proc = dshProcess;
  dshProcess = null;
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 2000).unref();
  } catch {
    // ignore
  }
}

function buildLoadingDataUrl() {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0; width: 100%; height: 100%; overflow: hidden;
      background: radial-gradient(circle at 28% 22%, #b80818 0%, #2a040a 42%, #090910 100%);
      color: #fff; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      display: grid; place-items: center; -webkit-app-region: drag;
    }
    .card {
      padding: 28px 42px; background: #0b0b12; border: 3px solid #e60012;
      box-shadow: 10px 10px 0 rgba(0, 0, 0, 0.72); transform: skewX(-6deg);
      text-align: center;
    }
    .kicker {
      display: inline-block; background: #e60012; color: #fff; font-weight: 900;
      font-size: 12px; letter-spacing: 0.14em; padding: 3px 10px; margin-bottom: 12px;
    }
    h1 { margin: 0 0 8px; font-size: 26px; font-weight: 900; letter-spacing: 0.06em; }
    p { margin: 0; font-size: 13px; color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">P5 AGENT STAGE × DSH</div>
    <h1>大肥鱼工作台启动中…</h1>
    <p>正在唤醒本机 DeepSeek Harness 原生运行时</p>
  </div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createMainWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    title: '大肥鱼工作台 // P5 AGENT STAGE',
    width: 1520,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#090910',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('dsh-window-fullscreen', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('dsh-window-fullscreen', false);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (dshOrigin && url.startsWith(dshOrigin)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(buildLoadingDataUrl());
  return mainWindow;
}

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: '大肥鱼工作台',
            submenu: [
              { role: 'about', label: '关于大肥鱼工作台' },
              { type: 'separator' },
              { role: 'services', label: '服务' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏窗口' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: '退出' },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新舞台' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏切换' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置所有窗口' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('native-pick-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择本地工作区项目文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

app.whenReady().then(async () => {
  setupMenu();
  const projectRoot = path.resolve(__dirname, '..');
  const win = createMainWindow();

  try {
    const { url } = await startDshRuntime(projectRoot);
    if (win && !win.isDestroyed()) {
      await win.loadURL(url);
      if (process.env.BIGFISH_VERIFY_SHOT) {
        setTimeout(async () => {
          try {
            if (!win.isDestroyed()) {
              const img = await win.webContents.capturePage();
              fs.writeFileSync(process.env.BIGFISH_VERIFY_SHOT, img.toPNG());
              console.log('[BigFish Desktop] Verified screenshot saved');
            }
          } catch (e) {
            console.error('[BigFish Desktop] Screenshot error:', e);
          }
        }, 3200);
      }
    }
  } catch (err) {
    console.error('[BigFish Desktop] 启动失败:', err);
    dialog.showErrorBox(
      '大肥鱼工作台启动失败',
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createMainWindow();
      if (dshOrigin) {
        void reopened.loadURL(dshOrigin);
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true;
    stopDshRuntime();
    app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
  stopDshRuntime();
});
