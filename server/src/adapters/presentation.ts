import { basename, isAbsolute, normalize, relative, resolve, sep } from 'node:path';

/** Decode shell quoting for display only; never execute or expand anything. */
function shellWords(input: string): string[] | undefined {
  const words: string[] = [];
  let word = '', quote = '', started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote === "'") {
      if (c === "'") quote = ''; else word += c;
    } else if (c === '\\' && quote !== "'") {
      if (i + 1 === input.length) return;
      const next = input[++i];
      if (!quote || '$`"\\\n'.includes(next)) { if (next !== '\n') word += next; }
      else word += '\\' + next;
      started = true;
    } else if (quote === '"') {
      if (c === '"') quote = ''; else word += c;
    } else if (c === "'" || c === '"') {
      quote = c; started = true;
    } else if (/\s/.test(c)) {
      if (started) { words.push(word); word = ''; started = false; }
    } else {
      if (';|&<>()'.includes(c)) return;
      word += c; started = true;
    }
  }
  if (quote) return;
  if (started) words.push(word);
  return words;
}

export function unwrapShellCommand(command: string): string {
  const words = shellWords(command);
  return words?.length === 3 && ['zsh', 'bash', 'sh'].includes(basename(words[0])) && ['-lc', '-c'].includes(words[1])
    ? words[2] : command;
}

/** macOS exposes the same temporary directory through /tmp and /private/tmp. */
function canonicalPath(path: string): string { return normalize(path).replace(/^\/private\/(tmp|var)(?=\/|$)/, '/$1'); }
export function fileKey(file: string, cwd: string): string {
  return canonicalPath(isAbsolute(file) || !cwd ? file : resolve(cwd, file));
}
export function displayPath(file: string, cwd: string, home = ''): string {
  if (!cwd) return file;
  const path = fileKey(file, cwd), root = canonicalPath(cwd), inside = relative(root, path);
  if (!inside) return '.';
  if (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) return inside;
  if (home) {
    const user = canonicalPath(home);
    if (path === user) return '~';
    if (path.startsWith(user + sep)) return '~' + path.slice(user.length);
  }
  return path;
}

function shortenPaths(text: string, cwd: string, home: string): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Replace only complete directory prefixes, keeping original command quoting intact.
  for (const [root, label] of [[cwd, '.'], [home, '~']]) {
    if (!root || root === '/') continue;
    const normalized = canonicalPath(root);
    const aliases = [root, normalized, ...(/^\/(tmp|var)(\/|$)/.test(normalized) ? ['/private' + normalized] : [])];
    for (const path of new Set(aliases)) {
      text = text.replace(new RegExp(`(^|[\\s"'=])${escape(path)}(/|(?=[\\s"';]|$))`, 'g'), (_match, prefix: string, slash: string) =>
        prefix + (label === '.' ? (slash ? '' : '.') : '~' + slash));
    }
  }
  return text;
}
export function displayCommand(command: string, cwd: string, home = ''): string {
  return shortenPaths(unwrapShellCommand(command), cwd, home);
}

export function approvalPresentation(params: { reason?: unknown; command?: unknown; cwd?: unknown }, cwd: string, home = '') {
  const command = typeof params.command === 'string' ? displayCommand(params.command, cwd, home) : '';
  const reason = typeof params.reason === 'string' ? shortenPaths(params.reason.trim(), cwd, home) : '';
  const directory = typeof params.cwd === 'string' && params.cwd ? params.cwd : cwd;
  return { summary: reason || command || '审批请求', detail: `${command || '文件修改审批'}\ncwd: ${displayPath(directory, cwd, home)}` };
}

function gitPath(path: string, prefixed = true): string {
  if (path.startsWith('"')) {
    try { path = JSON.parse(path.replace(/\\([0-7]{1,3})/g, (_m, octal: string) => `\\u${parseInt(octal, 8).toString(16).padStart(4, '0')}`)); }
    catch { return path; }
  }
  return prefixed ? path.replace(/^[ab]\//, '') : path;
}
function diffSections(diff: string) {
  return diff.split(/(?=^diff --git )/m).filter(section => section.startsWith('diff --git ')).map(text => {
    const paths = [...text.matchAll(/^(?:--- |\+\+\+ )(.+)$/gm)].map(m => m[1]).filter(path => path !== '/dev/null').map(path => gitPath(path));
    for (const match of text.matchAll(/^rename (?:from|to) (.+)$/gm)) paths.push(gitPath(match[1], false));
    if (!paths.length) {
      const header = text.match(/^diff --git (.+)/)?.[1] ?? '';
      const quoted = shellWords(header);
      if (quoted?.length === 2) paths.push(...quoted.map(path => gitPath(path)));
      else {
        const plain = header.match(/^a\/(.*?) b\/(.*)$/);
        if (plain) paths.push(plain[1], plain[2]);
      }
    }
    return { text, paths: [...new Set(paths)] };
  });
}

/** Keep only files changed this turn whose diffs were not already shown by Codex. */
export function uncoveredGitDiff(before: string, after: string, structuredFiles: ReadonlySet<string>, cwd: string): string {
  const covered = new Set([...structuredFiles].map(file => fileKey(file, cwd)));
  const previous = new Map(diffSections(before).map(section => [section.paths.join('\0'), section.text]));
  return diffSections(after).filter(section => section.text !== previous.get(section.paths.join('\0'))
    && !section.paths.some(file => covered.has(fileKey(file, cwd)))).map(section => section.text).join('');
}
