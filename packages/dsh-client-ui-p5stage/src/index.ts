import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.moc3': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8',
};

const pkgDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoPublicDir =
  [resolve(pkgDir, 'public'), resolve(pkgDir, '../../public')].find((dir) =>
    existsSync(join(dir, 'characters'))
  ) ?? resolve(pkgDir, 'public');

function createStaticPrefixResource(mountPrefix: string, rootDir: string) {
  const normalizedRoot = resolve(rootDir);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const rel = pathname.startsWith(mountPrefix)
      ? pathname.slice(mountPrefix.length).replace(/^\/+/, '')
      : '';
    if (!rel) {
      return new Response('Not Found', { status: 404 });
    }
    const targetPath = resolve(join(normalizedRoot, rel));
    if (
      targetPath !== normalizedRoot &&
      !targetPath.startsWith(normalizedRoot + sep)
    ) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const info = await stat(targetPath);
      if (!info.isFile()) {
        return new Response('Not Found', { status: 404 });
      }
      const ext = extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'content-type': contentType,
            'content-length': String(info.size),
            'cache-control': 'no-cache',
          },
        });
      }
      const bytes = await readFile(targetPath);
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': contentType,
          'content-length': String(bytes.byteLength),
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  };
}

/**
 * 兼容两代 DSH webServer 路由契约：
 * - 新版（host-webserver ≥0.2.2，dsh CLI）：`resource(request: Request) => Response`
 * - 旧版（0.2.1，DSH 桌面版内置）：`handler(req: IncomingMessage, res: ServerResponse)`
 * 旧版只调 handler；缺了它会抛错并被转成 400，导致立绘/音效全部加载失败。
 */
function dualRoute(path: string, resource: (request: Request) => Promise<Response>) {
  const handler = async (req: any, res: any) => {
    const request = new Request(new URL(req.url ?? '/', 'http://127.0.0.1'), { method: req.method ?? 'GET' });
    const response = await resource(request);
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    if (request.method === 'HEAD' || !response.body) { res.end(); return; }
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return { kind: 'prefix' as const, path, resource, handler };
}

export const name = 'ui-p5stage-host';
export const inject = ['webServer'];

const HEAD_FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
  '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=JetBrains+Mono:wght@500;700;800&family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet" />',
].join('');

export function apply(ctx: any): void {
  if (!ctx.webServer) return;

  const charactersDir = join(repoPublicDir, 'characters');
  const sfxDir = join(repoPublicDir, 'sfx');

  ctx.effect(() =>
    ctx.webServer.register(dualRoute('/characters', createStaticPrefixResource('/characters', charactersDir)) as any)
  );

  ctx.effect(() =>
    ctx.webServer.register(dualRoute('/sfx', createStaticPrefixResource('/sfx', sfxDir)) as any)
  );

  ctx.on('webserver/index-inject', (table: Array<Record<string, unknown>>) => {
    table.push({
      kind: 'html',
      placement: 'head',
      html: HEAD_FONT_LINKS,
    });
  });
}
