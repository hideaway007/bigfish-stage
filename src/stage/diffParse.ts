export type DiffRowKind = 'context' | 'add' | 'del' | 'hunk' | 'meta';

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffFile {
  oldPath?: string;
  newPath?: string;
  added: number;
  removed: number;
  rows: DiffRow[];
}

function filePath(value: string): string {
  return value.split('\t')[0].trim().replace(/^[ab]\//, '');
}

/** Preserve unknown or truncated input as metadata, without inventing line numbers. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLine: number | undefined;
  let newLine: number | undefined;
  let oldRemaining = 0;
  let newRemaining = 0;
  const beginFile = () => {
    file = { added: 0, removed: 0, rows: [] };
    files.push(file);
    oldLine = newLine = undefined;
    oldRemaining = newRemaining = 0;
    return file;
  };
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('diff --git ')) {
      const target = beginFile();
      target.rows.push({ kind: 'meta', text: line });
      // ---/+++ headers take precedence; these names also cover binary diffs.
      const paths = line.match(/^diff --git (".*?"|\S+) (".*?"|\S+)$/);
      if (paths) {
        target.oldPath = filePath(paths[1].replace(/^"|"$/g, ''));
        target.newPath = filePath(paths[2].replace(/^"|"$/g, ''));
      }
      continue;
    }
    const current = file ?? beginFile();
    if (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ') &&
        (oldLine === undefined || (oldRemaining <= 0 && newRemaining <= 0))) {
      const target = current.oldPath !== undefined && current.rows.some(row => row.kind === 'hunk')
        ? beginFile() : current;
      target.oldPath = filePath(line.slice(4));
      target.newPath = filePath(lines[++index].slice(4));
      oldLine = newLine = undefined;
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      current.rows.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('@@')) {
      oldLine = newLine = undefined;
      current.rows.push({ kind: 'meta', text: line });
    } else if (line.startsWith('\\ No newline at end of file')) {
      current.rows.push({ kind: 'meta', text: line });
    } else if (oldLine !== undefined && newLine !== undefined && /^[ +\-]/.test(line)) {
      const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'context';
      current.rows.push({ kind, text: line.slice(1),
        oldLine: kind !== 'add' ? oldLine++ : undefined,
        newLine: kind !== 'del' ? newLine++ : undefined });
      if (kind !== 'add') oldRemaining--;
      if (kind !== 'del') newRemaining--;
      if (kind === 'add') current.added++;
      if (kind === 'del') current.removed++;
    } else {
      current.rows.push({ kind: 'meta', text: line });
    }
  }
  return files;
}

export type DiffDisplayRow = { kind: 'line'; row: DiffRow; index: number } |
  { kind: 'fold'; rows: DiffRow[]; index: number };

export function foldDiffContext(rows: DiffRow[]): DiffDisplayRow[] {
  const result: DiffDisplayRow[] = [];
  for (let index = 0; index < rows.length;) {
    let end = index;
    while (end < rows.length && rows[end].kind === 'context') end++;
    if (end - index > 8) {
      for (let i = index; i < index + 3; i++) result.push({ kind: 'line', row: rows[i], index: i });
      result.push({ kind: 'fold', rows: rows.slice(index + 3, end - 3), index: index + 3 });
      for (let i = end - 3; i < end; i++) result.push({ kind: 'line', row: rows[i], index: i });
      index = end;
    } else {
      result.push({ kind: 'line', row: rows[index], index });
      index++;
    }
  }
  return result;
}
