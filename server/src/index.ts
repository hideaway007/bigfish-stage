import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocket, WebSocketServer } from 'ws';
import { DEFAULT_SERVER_PORT, WS_PATH, type ServerMessage } from '../../src/shared/wire';
import { SettingsStore, defaultSettingsPath } from './settings-store';
import { CharacterCatalog } from './characters';
import { createRegistry, type AdapterRegistry } from './adapters/registry';
import { SessionController, parseCommand } from './session';

const runFile = promisify(execFile);

export async function pickNativeDirectory(): Promise<string | null> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runFile(
        'osascript',
        ['-e', 'tell application "System Events" to activate', '-e', 'POSIX path of (choose folder with prompt "请选择项目工作区文件夹")'],
        { timeout: 60000 }
      );
      const path = stdout.trim().replace(/\/+$/, '');
      return path || null;
    } catch {
      return null;
    }
  } else if (process.platform === 'win32') {
    try {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }`;
      const { stdout } = await runFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 60000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function validOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && origin === url.origin;
  } catch { return false; }
}
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
async function staticFile(root: string, path: string) {
  if (path.includes('\0') || path.includes('\\')) return null;
  try {
    const canonicalRoot = await realpath(root), target = await realpath(resolve(root, `.${path}`));
    const subpath = relative(canonicalRoot, target);
    if (subpath.startsWith('..') || isAbsolute(subpath)) return null;
    const info = await stat(target);
    return info.isFile() ? { target, size: info.size } : null;
  } catch { return null; }
}
export interface ServerOptions {
  port?: number;
  settingsPath?: string;
  charactersRoot?: string;
  distRoot?: string;
  registry?: AdapterRegistry;
}
export async function startServer(options: ServerOptions = {}) {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const settingsPath = options.settingsPath ?? process.env.BIGFISH_SETTINGS_PATH ?? defaultSettingsPath();
  const store = new SettingsStore(settingsPath); await store.load();
  const charactersRoot = options.charactersRoot ?? join(repository, 'public/characters');
  const distRoot = options.distRoot ?? join(repository, 'dist');
  const characters = new CharacterCatalog(charactersRoot); await characters.load();
  const registry = options.registry ?? createRegistry(join(dirname(settingsPath), 'codex'));
  const sockets = new Set<WebSocket>();
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 4 * 1024 * 1024) { socket.close(1013, 'Client too slow'); return; }
    socket.send(JSON.stringify(message));
  };
  const session = new SessionController(store, characters, registry, message => { for (const socket of sockets) send(socket, message); });
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD', 'POST'].includes(request.method ?? '')) { response.writeHead(405); response.end(); return; }
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (path === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}'); return; }
      if (path === '/api/default-directory') {
        const defaultDir = process.env.BIGFISH_PROJECT_DIR || repository;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, cwd: defaultDir }));
        return;
      }
      if (path === '/api/pick-directory') {
        if (request.method !== 'POST') {
          response.writeHead(405, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
          return;
        }
        if (!validOrigin(request.headers.origin)) {
          response.writeHead(403, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: 'Forbidden origin' }));
          return;
        }
        try {
          const selected = await pickNativeDirectory();
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(selected ? { ok: true, path: selected } : { ok: false, cancelled: true }));
        } catch (err) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: (err as Error).message }));
        }
        return;
      }
      if (path === '/api/tts') {
        if (request.method !== 'POST') {
          response.writeHead(405, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
          return;
        }
        if (!validOrigin(request.headers.origin)) {
          response.writeHead(403, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: 'Forbidden origin' }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          if (chunks.reduce((n, b) => n + b.length, 0) > 16_384) break;
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { characterId?: string; text?: string };
        const audio = await session.synthesizeDirect(String(payload.characterId || 'deepseek-v4-pro'), String(payload.text || ''));
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(audio ? { ok: true, ...audio } : { ok: false, error: 'Empty speech' }));
        return;
      }
      const character = path.startsWith('/characters/');
      let file = await staticFile(character ? charactersRoot : distRoot, character ? path.slice('/characters'.length) : path === '/' ? '/index.html' : path);
      if (!file && !character && !extname(path)) file = await staticFile(distRoot, '/index.html');
      if (!file) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('页面尚未构建或文件不存在。请先运行根目录 npm run build。'); return; }
      response.writeHead(200, { 'Content-Type': mime[extname(file.target)] ?? 'application/octet-stream', 'Content-Length': file.size, 'Cache-Control': 'no-cache' });
      if (request.method === 'HEAD') response.end(); else createReadStream(file.target).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(400); response.end(); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== WS_PATH || !validOrigin(request.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', (socket: WebSocket) => {
    let greeted = false;
    socket.on('error', () => { /* Connection errors are followed by close; do not log client data. */ });
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (data, binary) => {
      let command;
      try {
        if (binary) throw new Error('只接受 JSON 文本消息');
        command = parseCommand(JSON.parse(data.toString()));
        if (!greeted && command.type !== 'hello') throw new Error('请先发送 hello');
      } catch (error) { socket.close(1008, (error as Error).message.slice(0, 100)); return; }
      if (command.type === 'hello' && command.protocolVersion === 1) { greeted = true; sockets.add(socket); }
      void session.command(command, message => send(socket, message));
    });
  });
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 无效');
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); }); });
  return { server, session, store, port: (server.address() as { port: number }).port,
    async close() { await session.close(); for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolveClose => wss.close(() => resolveClose())); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(app => {
    console.log(`Big Fish Stage 已启动：http://127.0.0.1:${app.port}`);
    let closing = false;
    const close = () => { if (closing) return; closing = true; void app.close().catch(() => { process.exitCode = 1; }); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
  }).catch(() => { console.error('本地服务启动失败，请检查端口、设置文件与目录权限'); process.exitCode = 1; });
}
