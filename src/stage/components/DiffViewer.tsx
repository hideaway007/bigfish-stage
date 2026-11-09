import React from 'react';

interface DiffViewerProps {
  diff?: string;
  output?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff, output }) => {
  if (diff) {
    const lines = diff.split('\n');
    return (
      <div className="p5-diff-viewer" data-testid="diff-viewer">
        {lines.map((line, idx) => {
          let lineClass = 'p5-diff-line';
          let prefix = ' ';
          if (line.startsWith('+++') || line.startsWith('---')) {
            lineClass += ' p5-diff-line--meta';
            prefix = 'File';
          } else if (line.startsWith('@@')) {
            lineClass += ' p5-diff-line--hunk';
            prefix = 'Hunk';
          } else if (line.startsWith('+')) {
            lineClass += ' p5-diff-line--add';
            prefix = '+';
          } else if (line.startsWith('-')) {
            lineClass += ' p5-diff-line--del';
            prefix = '−';
          }
          return (
            <div key={idx} className={lineClass}>
              <span className="p5-diff-gutter">{idx + 1}</span>
              <span className="p5-diff-sign">{prefix}</span>
              <span className="p5-diff-code">{line}</span>
            </div>
          );
        })}
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
