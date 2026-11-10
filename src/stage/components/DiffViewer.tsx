import React, { useMemo, useState } from 'react';
import { foldDiffContext, parseUnifiedDiff, type DiffFile, type DiffRow } from '../diffParse';
import '../diffViewer.css';

function DiffLine({ row }: { row: DiffRow }) {
  return (
    <div className={`p5-diff-line p5-diff-line--${row.kind}`} data-testid="diff-line">
      <span className="p5-diff-gutter" data-testid="diff-old-line" aria-label="旧行号">{row.oldLine ?? ''}</span>
      <span className="p5-diff-gutter" data-testid="diff-new-line" aria-label="新行号">{row.newLine ?? ''}</span>
      <span className="p5-diff-sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>
      <span className="p5-diff-code">{row.text || ' '}</span>
    </div>
  );
}

function DiffFileSection({ file, index }: { file: DiffFile; index: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const rows = useMemo(() => foldDiffContext(file.rows), [file.rows]);
  const path = (file.newPath === '/dev/null' ? file.oldPath : file.newPath) ?? file.oldPath ?? `差异片段 ${index + 1}`;
  return (
    <section className="p5-diff-file" data-testid="diff-file">
      <button type="button" className="p5-diff-file-toggle" data-testid="diff-file-toggle"
        aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        <strong className="p5-diff-file-path">{path}</strong>
        {file.oldPath === '/dev/null' && <span>新增</span>}
        {file.newPath === '/dev/null' && <span>删除</span>}
        <span className="p5-diff-file-stats"><span>+{file.added}</span> <span>−{file.removed}</span></span>
      </button>
      {!collapsed && <div className="p5-diff-file-body">
        <div className="p5-diff-column-labels">旧行号 / 新行号</div>
        {rows.map(item => item.kind === 'line'
          ? <DiffLine key={item.index} row={item.row} />
          : expanded.has(item.index)
            ? item.rows.map((row, offset) => <DiffLine key={item.index + offset} row={row} />)
            : <button type="button" key={item.index} className="p5-diff-fold" data-testid="diff-expand-context"
                onClick={() => setExpanded(value => new Set(value).add(item.index))}>展开 {item.rows.length} 行</button>)}
      </div>}
    </section>
  );
}

interface DiffViewerProps {
  diff?: string;
  output?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff, output }) => {
  const files = useMemo(() => parseUnifiedDiff(diff ?? ''), [diff]);
  if (diff) {
    return (
      <div className="p5-diff-viewer p5-diff-viewer--numbered" data-testid="diff-viewer">
        {files.map((file, index) => <DiffFileSection key={`${diff}:${index}`} file={file} index={index} />)}
      </div>
    );
  }

  if (output) {
    const lines = output.split('\n');
    return (
      <div className="p5-terminal-viewer" data-testid="terminal-viewer">
        {lines.map((line, idx) => {
          let cls = 'p5-term-line';
          if (
            line.includes('FAIL') ||
            line.includes('AssertionError') ||
            line.includes('× ') ||
            line.includes('1 failed')
          ) {
            cls += ' p5-term-line--err';
          } else if (
            line.includes('PASS') ||
            line.includes('✓ ') ||
            line.includes('passed')
          ) {
            cls += ' p5-term-line--ok';
          } else if (line.startsWith('$ ')) {
            cls += ' p5-term-line--cmd';
          }
          return (
            <div key={idx} className={cls}>
              {line || ' '}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="p5-terminal-viewer p5-terminal-viewer--empty">
      [工具执行中，暂无输出内容 // EXECUTING...]
    </div>
  );
};
