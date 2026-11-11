import { execFile } from 'node:child_process';
import { realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { GitChangedFile } from '../../src/shared/wire';

const runFile = promisify(execFile);

async function resolveSafeTarget(cwd: string, relPath: string): Promise<{ root: string; safeRel: string; fullPath: string }> {
  const cleanRel = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel || cleanRel === '.git' || cleanRel.startsWith('.git/') || cleanRel.split('/').includes('..')) {
    throw new Error('文件路径不安全或不允许操作 .git 目录');
  }
  const root = await realpath(cwd);
  const candidate = resolve(root, cleanRel);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('文件路径越出当前工作区边界');
  }
  return { root, safeRel: rel.replace(/\\/g, '/'), fullPath: candidate };
}

export async function getGitStatus(cwd: string): Promise<{
  isRepo: boolean;
  branch?: string;
  files: GitChangedFile[];
  diff: string;
  error?: string;
}> {
  try {
    const root = await realpath(cwd);
    const inside = await runFile('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { timeout: 5000 }).catch(() => null);
    if (!inside || inside.stdout.trim() !== 'true') {
      return { isRepo: false, files: [], diff: '', error: '当前文件夹不是 Git 仓库' };
    }

    const branchRes = await runFile('git', ['-C', root, 'branch', '--show-current'], { timeout: 4000 }).catch(() => ({ stdout: '' }));
    const branch = branchRes.stdout.trim() || 'HEAD';

    const statusRes = await runFile('git', ['-C', root, 'status', '--porcelain', '-uall'], { timeout: 6000 });
    const numstatMap = new Map<string, { added: number; removed: number }>();

    const numstatRes = await runFile('git', ['-C', root, 'diff', '--numstat', 'HEAD'], { timeout: 6000 })
      .catch(() => runFile('git', ['-C', root, 'diff', '--numstat'], { timeout: 6000 }))
      .catch(() => ({ stdout: '' }));

    for (const line of numstatRes.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [addStr, delStr, ...rest] = line.split('\t');
      const filePath = rest.join('\t').trim();
      if (!filePath) continue;
      numstatMap.set(filePath, {
        added: Number.isFinite(Number(addStr)) ? Number(addStr) : 0,
        removed: Number.isFinite(Number(delStr)) ? Number(delStr) : 0,
      });
    }

    const files: GitChangedFile[] = [];
    for (const rawLine of statusRes.stdout.split(/\r?\n/)) {
      if (rawLine.length < 4) continue;
      const xy = rawLine.slice(0, 2);
      let filePath = rawLine.slice(3).trim();
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ').pop()!.trim();
      }
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }
      let status: GitChangedFile['status'] = 'M';
      if (xy === '??') status = '?';
      else if (xy.includes('A')) status = 'A';
      else if (xy.includes('D')) status = 'D';
      else if (xy.includes('R')) status = 'R';

      const stats = numstatMap.get(filePath) ?? { added: 0, removed: 0 };
      files.push({
        path: filePath,
        status,
        added: stats.added,
        removed: stats.removed,
      });
    }

    const diffRes = await runFile('git', ['-C', root, 'diff', 'HEAD'], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 })
      .catch(() => runFile('git', ['-C', root, 'diff'], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }))
      .catch(() => ({ stdout: '' }));

    return {
      isRepo: true,
      branch,
      files,
      diff: diffRes.stdout.slice(0, 60_000),
    };
  } catch (error) {
    return {
      isRepo: false,
      files: [],
      diff: '',
      error: (error as Error).message,
    };
  }
}

export async function revertGitFile(cwd: string, relPath: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { root, safeRel, fullPath } = await resolveSafeTarget(cwd, relPath);
    const tracked = await runFile('git', ['-C', root, 'ls-files', '--error-unmatch', '--', safeRel], { timeout: 4000 })
      .then(() => true)
      .catch(() => false);

    if (tracked) {
      await runFile('git', ['-C', root, 'checkout', 'HEAD', '--', safeRel], { timeout: 6000 })
        .catch(() => runFile('git', ['-C', root, 'checkout', '--', safeRel], { timeout: 6000 }));
      return { ok: true, message: `已撤回文件改动：${safeRel}` };
    }

    const st = await stat(fullPath).catch(() => null);
    if (st && st.isFile()) {
      const realFile = await realpath(fullPath);
      const checkRel = relative(root, realFile);
      if (checkRel.startsWith('..') || isAbsolute(checkRel)) {
        throw new Error('拒绝删除工作区外部软链目标');
      }
      await rm(realFile, { force: true });
      return { ok: true, message: `已清理未跟踪新建文件：${safeRel}` };
    }

    return { ok: false, message: `未找到需要撤回的文件：${safeRel}` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export async function commitGitAll(cwd: string, message: string): Promise<{ ok: boolean; message: string }> {
  const cleanMsg = message.trim();
  if (!cleanMsg || cleanMsg.length > 500) {
    return { ok: false, message: '请填写 1~500 字的提交说明' };
  }
  try {
    const root = await realpath(cwd);
    await runFile('git', ['-C', root, 'add', '-A'], { timeout: 8000 });
    const status = await runFile('git', ['-C', root, 'status', '--porcelain'], { timeout: 5000 });
    if (!status.stdout.trim()) {
      return { ok: false, message: '当前工作区没有可提交的改动' };
    }
    const commitRes = await runFile('git', ['-C', root, 'commit', '-m', cleanMsg], { timeout: 10_000 });
    const firstLine = commitRes.stdout.trim().split(/\r?\n/)[0] || cleanMsg;
    return { ok: true, message: `提交成功：${firstLine}` };
  } catch (error) {
    return { ok: false, message: `Git 提交失败：${(error as Error).message}` };
  }
}
