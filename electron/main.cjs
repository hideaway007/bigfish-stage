const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let sessionController = null;
let staticServer = null;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function startInternalStaticServer(projectRoot) {
  const distDir = path.join(projectRoot, 'dist');
  const charactersDir = path.join(projectRoot, 'public/characters');

  staticServer = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      let targetFile = null;

      if (urlPath.startsWith('/characters/')) {
        targetFile = path.join(charactersDir, urlPath.slice('/characters/'.length));
      } else if (urlPath === '/' || !path.extname(urlPath)) {
        targetFile = path.join(distDir, 'index.html');
      } else {
        targetFile = path.join(distDir, urlPath);
      }

      if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
        const ext = path.extname(targetFile);
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        fs.createReadStream(targetFile).pipe(res);
      } else {
        // Fallback to index.html for SPA
        const fallback = path.join(distDir, 'index.html');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(fallback).pipe(res);
      }
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  return new Promise((resolve) => {
    staticServer.listen(0, '127.0.0.1', () => {
      const port = staticServer.address().port;
      console.log(`[Native App] 内部静态资源就绪: http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

async function initNativeEngine(projectRoot) {
  console.log('[Native App] 正在装载 DSH 核心运行时...');
  const { SessionController } = await import('./engine/session.js');
  const { CharacterCatalog } = await import('./engine/characters.js');
  const { SettingsStore } = await import('./engine/settings-store.js');
  const { createRegistry } = await import('./engine/adapters/registry.js');

  const store = new SettingsStore();
  await store.load();
  const characters = new CharacterCatalog(path.join(projectRoot, 'public/characters'));
  await characters.load();
  const registry = createRegistry(path.join(path.dirname(store.path), 'codex'));

  sessionController = new SessionController(store, characters, registry, (message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stage-message', message);
    }
  });

  console.log('[Native App] DSH 核心运行时就绪！');
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    title: '大肥鱼工作台 // BIG FISH AGENT STAGE',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#090910',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    if (sessionController) {
      const welcome = await sessionController.welcome();
      mainWindow.webContents.send('stage-message', welcome);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

// 注册纯原生 IPC 消息接收
ipcMain.on('stage-command', async (_event, command) => {
  if (!sessionController) return;
  try {
    await sessionController.command(command, (reply) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stage-message', reply);
      }
    });
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stage-message', {
        type: 'command_error',
        commandType: command?.type,
        message: err.message,
      });
    }
  }
});

// 注册原生目录选择 IPC
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
  const port = await startInternalStaticServer(projectRoot);
  await initNativeEngine(projectRoot);
  createMainWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (staticServer) {
    staticServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (staticServer) {
    staticServer.close();
  }
});
