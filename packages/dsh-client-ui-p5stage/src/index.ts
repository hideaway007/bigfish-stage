import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiyStore, handleDiyApiAction } from '../../../server/src/diy-store';

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

function createStaticPrefixResource(
  mountPrefix: string,
  rootDir: string,
  fallbackStore?: DiyStore
) {
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
      if (info.isFile()) {
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
      }
    } catch {
      // Fall through to DIY store if configured
    }

    if (fallbackStore) {
      const customAsset = await fallbackStore.resolveCustomAssetFile(rel);
      if (customAsset) {
        const contentType = MIME_TYPES[customAsset.ext] ?? 'application/octet-stream';
        if (request.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: {
              'content-type': contentType,
              'content-length': String(customAsset.size),
              'cache-control': 'no-cache',
            },
          });
        }
        const bytes = await readFile(customAsset.target);
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': contentType,
            'content-length': String(bytes.byteLength),
            'cache-control': 'no-cache',
          },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  };
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
  const diyStore = new DiyStore();
  const diyLoaded = diyStore.load().catch(() => {});

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/api/diy',
      resource: async (request: Request): Promise<Response> => {
        await diyLoaded;
        const url = new URL(request.url, 'http://127.0.0.1');
        const method = request.method || 'GET';
        let rawBody: string | undefined;
        if (method !== 'GET' && method !== 'HEAD') {
          rawBody = await request.text();
          if (rawBody.length > 32 * 1024 * 1024) {
            return new Response(
              JSON.stringify({ ok: false, error: '上传内容过大（总计上限 32MB）' }),
              { status: 413, headers: { 'content-type': 'application/json; charset=utf-8' } }
            );
          }
        }
        const res = await handleDiyApiAction(
          diyStore,
          method,
          decodeURIComponent(url.pathname),
          url.searchParams,
          rawBody
        );
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-cache',
          },
        });
      },
    })
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/characters',
      resource: createStaticPrefixResource('/characters', charactersDir, diyStore),
    })
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/sfx',
      resource: createStaticPrefixResource('/sfx', sfxDir),
    })
  );

  ctx.on('webserver/index-inject', (table: Array<Record<string, unknown>>) => {
    table.push({
      kind: 'html',
      placement: 'head',
      html: HEAD_FONT_LINKS,
    });
  });
}
