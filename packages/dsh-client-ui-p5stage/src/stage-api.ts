import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { commitGitAll, getGitStatus, revertGitFile } from '../../../server/src/git-ops';

export interface StageRoom { model?: string; sessionId?: string }
export type StageRooms = Record<string, StageRoom>;
const characterIds = new Set(['deepseek-v4-pro', 'gemini-4-argon', 'claude-opus-5-5', 'codex-dragon']);

/** Registered only through DSH's authenticated, owner-only Fetch carrier. */
export function createStageApi(directory = join(homedir(), '.config/bigfish-stage/dsh-rooms')) {
  const queues = new Map<string, Promise<unknown>>();
  return async (request: Request): Promise<Response> => {
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
    try {
      if (request.method !== 'POST') return json({ error: '仅支持 POST' }, 405);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '需要 JSON 请求' }, 415);
      const text = await request.text();
      if (text.length > 32_768) return json({ error: '请求过大' }, 413);
      const input = JSON.parse(text);
      if (!input || typeof input.cwd !== 'string' || !isAbsolute(input.cwd)) throw new Error('请选择有效的本地项目目录');
      const cwd = await realpath(input.cwd);
      const file = join(directory, `${createHash('sha256').update(cwd).digest('hex')}.json`);
      const load = async (): Promise<StageRooms> => {
        try { return JSON.parse(await readFile(file, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
      };
      if (input.op === 'rooms_get') { await queues.get(file); return json(await load()); }
      if (input.op === 'rooms_patch') {
        if (!characterIds.has(input.characterId)) throw new Error('角色不存在');
        const patch: StageRoom = {};
        for (const key of ['model', 'sessionId'] as const) {
          if (input[key] !== undefined) {
            if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 256) throw new Error('角色配置无效');
            patch[key] = input[key].trim();
          }
        }
        const save = async () => {
          const rooms = await load();
          rooms[input.characterId] = { ...rooms[input.characterId], ...patch };
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const temp = `${file}.${randomUUID()}.tmp`;
          await writeFile(temp, JSON.stringify(rooms), { mode: 0o600 });
          await rename(temp, file);
          return rooms;
        };
        const next = (queues.get(file) ?? Promise.resolve()).then(save, save);
        queues.set(file, next.catch(() => {}));
        return json(await next);
      }
      if (input.op === 'git_status') return json(await getGitStatus(cwd));
      if (input.op === 'git_revert') {
        if (typeof input.path !== 'string' || input.path.length > 1000) throw new Error('文件路径无效');
        return json(await revertGitFile(cwd, input.path));
      }
      if (input.op === 'git_commit') {
        if (typeof input.message !== 'string') throw new Error('提交说明无效');
        return json(await commitGitAll(cwd, input.message));
      }
      return json({ error: '不支持的操作' }, 400);
    } catch (error) { return json({ error: error instanceof Error ? error.message : '操作失败' }, 400); }
  };
}
