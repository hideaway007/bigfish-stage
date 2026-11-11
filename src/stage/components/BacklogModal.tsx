import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { StageEvent } from '../../shared/stage-events';
import { getCachedCharacterPack } from '../characterLoader';
import { computeDiffStats, type SkillCardItem } from '../stageReducer';
import '../backlog.css';

interface BacklogModalProps {
  open: boolean;
  events: StageEvent[];
  skillCards: SkillCardItem[];
  characterName: string;
  onClose: () => void;
  onInspectSkill: (toolUseId: string) => void;
}

type EntryType = '台词' | '用户' | '工具' | '审批' | '错误' | '原文' | '结算';
interface BacklogEntry {
  id: number;
  at: number;
  type: EntryType;
  style: string;
  badge: string;
  text: string;
  detail?: string;
  toolUseId?: string;
}

function createEntry(ev: StageEvent, id: number, characterName: string,
  skills: Map<string, SkillCardItem>): BacklogEntry | null {
  const base = { id, at: ev.at };
  switch (ev.type) {
    case 'user_message': return { ...base, type: '用户', style: 'user', badge: '玩家指令', text: ev.text };
    case 'steer_queued': return { ...base, type: '用户', style: 'steer', badge: '场外插话', text: ev.text };
    case 'character_line': {
      const speaker = (ev.characterId && getCachedCharacterPack(ev.characterId).name.split('（')[0]) || characterName;
      const tag = ev.source === 'touch' ? '互动' : ev.emotion.toUpperCase();
      return { ...base, type: '台词', style: 'char', badge: `${speaker} · [${tag}]`, text: ev.text };
    }
    case 'sub_navigator_line': {
      const navi = (ev.characterId && getCachedCharacterPack(ev.characterId).name.split('（')[0]) || '场外支援';
      return { ...base, type: '台词', style: 'char', badge: `NAVI // ${navi}`, text: ev.text };
    }
    case 'baton_pass': {
      const fromN = getCachedCharacterPack(ev.fromCharacterId).name.split('（')[0];
      const toN = getCachedCharacterPack(ev.toCharacterId).name.split('（')[0];
      return { ...base, type: '结算', style: 'done', badge: `BATON PASS // ${fromN} ➔ ${toN}`, text: ev.summary };
    }
    case 'context_compacted': {
      return { ...base, type: '结算', style: 'done', badge: 'MEMORY // 记忆凝炼', text: ev.summary || `压缩前 ${ev.turnsCompacted} 轮历史，释放 ${ev.freedTokens.toLocaleString()} Tokens` };
    }
    case 'worker_text': return { ...base, type: '原文', style: 'worker', badge: `WORKER RAW${ev.final ? ' // FINAL' : ''}`, text: ev.text };
    case 'tool_start': {
      const card = skills.get(ev.toolUseId);
      const stats = card?.diffStats;
      return { ...base, type: '工具', style: 'skill', badge: 'SKILL // 技能发动', toolUseId: ev.toolUseId,
        text: `${characterName} 发动 ${ev.tool.toUpperCase()} ▶ ${ev.file ?? ev.summary}`,
        detail: [stats && `+${stats.added} −${stats.removed}`, card && (card.status === 'success' ? '命中' : card.status === 'error' ? '失败' : '进行中'), card?.endSummary].filter(Boolean).join(' · ') };
    }
    case 'tool_end': return ev.ok ? null : { ...base, type: '错误', style: 'error', badge: '工具执行失败', text: ev.summary ?? '工具执行失败', detail: ev.output, toolUseId: ev.toolUseId };
    case 'permission_request': return { ...base, type: '审批', style: 'perm', badge: '权限请求', text: ev.summary, detail: ev.detail };
    case 'permission_resolved': return { ...base, type: '审批', style: 'perm', badge: 'DECISION // 权限决断', text: `Request ${ev.requestId}: ${ev.allowed ? 'ALLOWED (允许)' : 'REJECTED (拒绝)'}` };
    case 'error': return { ...base, type: '错误', style: 'error', badge: 'ERROR // 错误', text: ev.message };
    case 'turn_done': return { ...base, type: ev.ok ? '结算' : '错误', style: 'done', badge: 'TURN DONE // 回合结算', text: ev.summary || (ev.ok ? '任务完成' : '任务中断') };
    default: return null;
  }
}

const ENTRY_TYPES: EntryType[] = ['台词', '用户', '工具', '审批', '错误', '原文', '结算'];

export const BacklogModal: React.FC<BacklogModalProps> = ({ open, events, skillCards,
  characterName, onClose, onInspectSkill }) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EntryType | null>(null);
  const [activeMatch, setActiveMatch] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => {
    const skills = new Map<string, SkillCardItem>();
    for (const ev of events) {
      if (ev.type === 'tool_end') {
        skills.set(ev.toolUseId, {
          toolUseId: ev.toolUseId,
          tool: ev.diff ? 'edit' : 'other',
          rawName: '',
          summary: ev.summary ?? '',
          startedAt: ev.at,
          endedAt: ev.at,
          status: ev.ok ? 'success' : 'error',
          endSummary: ev.summary,
          diff: ev.diff,
          output: ev.output,
          diffStats: computeDiffStats(ev.diff),
          collapsedToLog: true,
        });
      }
    }
    for (const card of skillCards) {
      const fallback = skills.get(card.toolUseId);
      if (fallback && card.status === 'running') {
        skills.set(card.toolUseId, {
          ...card,
          endedAt: fallback.endedAt,
          status: fallback.status,
          endSummary: fallback.endSummary,
          diff: fallback.diff,
          output: fallback.output,
          diffStats: fallback.diffStats,
        });
      } else {
        skills.set(card.toolUseId, card);
      }
    }
    return events.map((ev, id) => createEntry(ev, id, characterName, skills))
      .filter((entry): entry is BacklogEntry => entry !== null);
  }, [events, skillCards, characterName]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = entries.filter(entry => (!filter || entry.type === filter) &&
    (!needle || `${entry.badge}\n${entry.text}\n${entry.detail ?? ''}`.toLocaleLowerCase().includes(needle)));
  const matchCount = needle ? visible.reduce((count, entry) => count +
    [entry.badge, entry.text, entry.detail ?? ''].reduce((sum, text) =>
      sum + text.toLocaleLowerCase().split(needle).length - 1, 0), 0) : 0;
  const selectedMatch = matchCount ? activeMatch % matchCount : 0;

  useEffect(() => { if (!open) { setQuery(''); setFilter(null); setActiveMatch(0); } }, [open]);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active-match="true"]');
    if (list && active) {
      const top = active.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTop += top - list.clientHeight / 2;
    }
  }, [selectedMatch, needle, filter, open]);

  if (!open) return null;
  let matchIndex = 0;
  const highlight = (text: string) => {
    if (!needle) return text;
    const parts: React.ReactNode[] = [];
    let start = 0;
    let found = text.toLocaleLowerCase().indexOf(needle);
    while (found !== -1) {
      parts.push(text.slice(start, found));
      const index = matchIndex++;
      parts.push(<mark key={found} data-active-match={index === selectedMatch}>{text.slice(found, found + needle.length)}</mark>);
      start = found + needle.length;
      found = text.toLocaleLowerCase().indexOf(needle, start);
    }
    parts.push(text.slice(start));
    return parts;
  };
  const jump = (direction: number) => {
    if (matchCount) setActiveMatch((selectedMatch + direction + matchCount) % matchCount);
  };

  return (
    <div className="p5-modal-backdrop" onClick={onClose} data-testid="backlog-modal"
      role="dialog" aria-modal="true" aria-label="Backlog 对话与行动回看">
      <div className="p5-backlog-modal p5-backlog-searchable" onClick={e => e.stopPropagation()}>
        <div className="p5-archive-header">
          <div className="p5-archive-title-group">
            <span className="p5-archive-kicker">STAGE BACKLOG // 演出回看记录</span>
            <h2 className="p5-archive-title">对话与行动 · 按时间顺序回看</h2>
          </div>
          <button type="button" className="p5-close-btn" onClick={onClose} data-testid="backlog-close-btn">[L / ESC] 关闭</button>
        </div>
        <div className="p5-backlog-toolbar">
          <div className="p5-backlog-search-row">
            <input type="search" autoFocus value={query} placeholder="搜索台词、指令或工具记录…"
              aria-label="搜索回看记录" data-testid="backlog-search" onChange={e => { setQuery(e.target.value); setActiveMatch(0); }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); jump(e.shiftKey ? -1 : 1); } }} />
            <span className="p5-backlog-count" data-testid="backlog-count" aria-live="polite">{visible.length} / {entries.length}</span>
            <button type="button" data-testid="backlog-prev-match" disabled={!matchCount} aria-label="上一个匹配" onClick={() => jump(-1)}>↑</button>
            <button type="button" data-testid="backlog-next-match" disabled={!matchCount} aria-label="下一个匹配" onClick={() => jump(1)}>↓</button>
          </div>
          <div className="p5-backlog-filters" aria-label="记录类型">
            {[null, ...ENTRY_TYPES.filter(type => entries.some(entry => entry.type === type))].map(type =>
              <button type="button" key={type ?? 'all'} data-testid={`backlog-filter-${type ?? 'all'}`} aria-pressed={filter === type}
                onClick={() => { setFilter(type); setActiveMatch(0); }}>{type ?? '全部'}</button>)}
          </div>
          <p className="p5-backlog-search-hint">Enter 下一处 · Shift+Enter 上一处
            {needle && <span data-testid="backlog-match-position"> · {matchCount ? selectedMatch + 1 : 0} / {matchCount} 处匹配</span>}</p>
        </div>
        <div className="p5-backlog-list" ref={listRef} data-testid="backlog-list">
          {visible.length === 0 && <p className="p5-backlog-empty" data-testid="backlog-empty">{entries.length ? '没有匹配的记录，试试其他关键词或类型。' : '还没有回看记录，发送一条指令后再来看看。'}</p>}
          {visible.map(entry => <div key={entry.id} className={`p5-backlog-item p5-backlog-item--${entry.style}`} data-testid="backlog-entry">
            <div className="p5-backlog-badge">{highlight(entry.badge)}</div>
            <div className="p5-backlog-content">
              <p className={entry.type === '原文' ? 'p5-backlog-mono' : 'p5-backlog-text'}>{highlight(entry.text)}</p>
              {entry.detail && <p className="p5-backlog-subtext">{highlight(entry.detail)}</p>}
              {entry.toolUseId && <button type="button" className="p5-backlog-open-archive" data-testid="backlog-open-archive"
                onClick={() => { onClose(); onInspectSkill(entry.toolUseId!); }}>展开档案 →</button>}
            </div>
            <time className="p5-backlog-time">{new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          </div>)}
        </div>
      </div>
    </div>
  );
};
