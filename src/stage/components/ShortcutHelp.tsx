import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../shortcutHelp.css';

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

const SHORTCUTS = [
  ['? / Shift+/', '快捷键速查', '未输入文字时'],
  ['H', '历史会话列表', '舞台界面，无其他弹窗时'],
  ['L', '对话与行动回看', '舞台界面'],
  ['O / A', '打开最近工具档案', '舞台界面，无其他弹窗时'],
  ['`', '切换朴素工程视图', '未输入文字时'],
  ['Esc', '关闭弹窗 / 打开设置', '舞台界面'],
  ['Space', '跳过打字机立即显示整句', '舞台界面'],
  ['按住 Ctrl', '加速台词播放', '未输入文字时'],
  ['← / ↑ · → / ↓', '选择允许 / 拒绝', '审批弹窗中'],
  ['Enter', '确认当前审批选项', '审批弹窗中，未输入文字时'],
  ['Enter / Shift+Enter', '跳到下一处 / 上一处搜索匹配', '回看搜索框中'],
  ['Enter', '发送指令或插话', '舞台 / 工程视图输入框中'],
];

export function ShortcutHelp({
  onOpenArchive,
  archiveAvailable = false,
  showTrigger = false,
}: {
  onOpenArchive?: () => void;
  archiveAvailable?: boolean;
  showTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (open) {
        if (event.key === 'Escape' || event.key === '?') {
          setOpen(false);
          event.preventDefault();
        }
        if (event.key === 'Tab') {
          closeRef.current?.focus();
          event.preventDefault();
        }
        event.stopImmediatePropagation();
        return;
      }
      if (event.defaultPrevented || event.repeat || isTypingTarget(event.target)) return;
      if (event.key === '?') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(true);
      } else if ((event.key.toLowerCase() === 'a' || event.key.toLowerCase() === 'o') && archiveAvailable) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onOpenArchive?.();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onOpenArchive, archiveAvailable]);

  return createPortal(<>
    <button type="button" className={`p5-shortcut-trigger${showTrigger ? '' : ' is-sr-only'}`} data-testid="shortcut-help-btn" aria-label="快捷键帮助"
      onClick={() => setOpen(true)}>? 快捷键</button>
    {open && <div className="p5-modal-backdrop p5-shortcut-backdrop" data-testid="shortcut-help" role="dialog"
      aria-modal="true" aria-label="快捷键帮助" onClick={() => setOpen(false)}>
      <section className="p5-shortcut-panel" onClick={event => event.stopPropagation()}>
        <header><div><span>KEYBOARD // 操作速查</span><h2>鱼塘快捷键</h2></div>
          <button type="button" className="p5-close-btn" ref={closeRef} data-testid="shortcut-help-close" onClick={() => setOpen(false)}>Esc 关闭</button></header>
        <p>输入文字时不触发舞台快捷键。搜索框与指令框保留各自的 Enter 操作。</p>
        <dl>{SHORTCUTS.map(([key, action, scope]) => <div key={`${key}-${scope}`}><dt><kbd>{key}</kbd></dt><dd>{action}<small>{scope}</small></dd></div>)}</dl>
      </section>
    </div>}
  </>, document.body);
}
