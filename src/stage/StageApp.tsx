import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  preloadCharacterPacks,
  subscribeCharacterPacks,
} from './characterLoader';
import {
  computeDiffStats,
  createInitialStageState,
  stageReducer,
  type SkillCardItem,
  type SystemMenuTab,
} from './stageReducer';
import { DEFAULT_FIRST_USER_PROMPT } from '../demo/script';
import { LiveSource } from './sources/LiveSource';
import { ScriptSource } from './sources/ScriptSource';
import { NativeAppSource } from './sources/NativeAppSource';
import type {
  ConnectionStatus,
  DataSourceMode,
  StageDataSource,
  StageDataSourceCallbacks,
  StageImageAttachment,
} from './sources/types';
import { CharacterRenderer } from './components/CharacterRenderer';
import { ArchiveModal } from './components/ArchiveModal';
import { PermissionModal } from './components/PermissionModal';
import { BacklogModal } from './components/BacklogModal';
import { SessionListControl } from './components/SessionListModal';
import { EngineeringView } from './components/EngineeringView';
import { ShortcutHelp, isTypingTarget } from './components/ShortcutHelp';
import { SystemMenuModal } from './components/SystemMenuModal';
import { defaultCharacterLine, resolveEmotionLabel, resolveUiCopy } from './uiCopy';
import { SwitchTransition, SfxMuteButton } from './components/SwitchTransition';
import {
  AllOutFinishOverlay,
  BatonPassCutin,
  BatonPassModal,
  NavigatorCutin,
  type AllOutFinishData,
  type BatonPassCutinData,
  type NavigatorCutinData,
} from './components/P5Cutins';
import { playSfx } from './sfx';
import { pickCharacterTouchReaction } from './touchReactions';
import { OnboardingCard } from './components/OnboardingCard';
import type {
  CharacterTouchZone,
  StageEvent,
  ToolKind,
} from '../shared/stage-events';
import type { SettingsPatch } from '../shared/settings';
import type { ServerMessage } from '../shared/wire';

const HUD_STATUS_TEXT = {
  idle: { zh: '待机', en: 'STANDBY', gauge: 38 },
  thinking: { zh: '思考中', en: 'THINKING', gauge: 72 },
  acting: { zh: '行动中', en: 'IN ACTION', gauge: 100 },
} as const;

const TOOL_DISPLAY_LABELS: Record<ToolKind, string> = {
  read: 'READ',
  edit: 'EDIT',
  write: 'WRITE',
  bash: 'BASH',
  search: 'SEARCH',
  web: 'WEB',
  task: 'TASK',
  other: 'TOOL',
};

function detectSourceMode(): DataSourceMode {
  const params = new URLSearchParams(window.location.search);
  const demoVal = params.get('demo');
  if (demoVal === '1' || demoVal === 'true') {
    return 'demo';
  }
  if (typeof window !== 'undefined' && window.electronAPI?.isNativeApp) {
    return 'native';
  }
  return 'live';
}

function extractInlineDiffLines(diff?: string): { kind: 'add' | 'del'; text: string }[] {
  if (!diff) return [];
  const rows: { kind: 'add' | 'del'; text: string }[] = [];
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) {
      continue;
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', text: raw });
    } else if (raw.startsWith('-')) {
      rows.push({ kind: 'del', text: raw });
    }
    if (rows.length >= 4) break;
  }
  return rows;
}

export function tokenizeSpeakerName(rawName: string): string[] {
  const base = rawName.split('（')[0].trim();
  const matches = base.match(/[A-Za-z0-9._-]+|[^\sA-Za-z0-9._-]/g);
  return matches && matches.length > 0 ? matches : [base];
}

export function formatWorkspaceLabel(cwd: string): string {
  if (!cwd) return '尚未选择项目文件夹';
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join('/')}`;
}

function stripTypingMarkdown(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#{1,4}\s+/gm, '');
}

function renderInlineMarkdown(line: string, keyPrefix: string): React.ReactNode {
  const segments = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  const parts: React.ReactNode[] = [];

  segments.forEach((seg, idx) => {
    if (!seg) return;
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      parts.push(
        <code key={`${keyPrefix}-code-${idx}`} className="p5-md-code">
          {seg.slice(1, -1)}
        </code>
      );
    } else if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      parts.push(
        <strong key={`${keyPrefix}-bold-${idx}`} className="p5-md-bold">
          {seg.slice(2, -2)}
        </strong>
      );
    } else {
      parts.push(seg);
    }
  });

  return parts.length === 1 ? parts[0] : parts;
}

export function renderFormattedText(text: string): React.ReactNode {
  if (!text) return null;
  if (
    !text.includes('```') &&
    !text.includes('`') &&
    !text.includes('**') &&
    !text.includes('\n')
  ) {
    return text;
  }

  const blocks: React.ReactNode[] = [];
  let blockIdx = 0;

  const pushProseSegment = (segment: string, segKey: string) => {
    const rawLines = segment.replace(/\r\n/g, '\n').split('\n');
    let listBuffer: { key: string; content: React.ReactNode }[] = [];
    let paraBuffer: React.ReactNode[] = [];

    const flushList = () => {
      if (listBuffer.length === 0) return;
      blocks.push(
        <ul key={`${segKey}-ul-${blockIdx++}`} className="p5-md-list">
          {listBuffer.map((item) => (
            <li key={item.key}>{item.content}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    };

    const flushPara = () => {
      if (paraBuffer.length === 0) return;
      blocks.push(
        <span key={`${segKey}-p-${blockIdx++}`} className="p5-md-para">
          {paraBuffer}
        </span>
      );
      paraBuffer = [];
    };

    rawLines.forEach((rawLine, lineIdx) => {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        flushList();
        flushPara();
        return;
      }

      const bulletMatch =
        trimmed.match(/^[-*•]\s+(.*)$/) || trimmed.match(/^\d+\.\s+(.*)$/);
      if (bulletMatch) {
        flushPara();
        listBuffer.push({
          key: `${segKey}-li-${lineIdx}`,
          content: renderInlineMarkdown(
            bulletMatch[1],
            `${segKey}-li-${lineIdx}`
          ),
        });
        return;
      }

      flushList();
      const headingMatch = trimmed.match(/^#{1,4}\s+(.*)$/);
      const inlineNode = headingMatch ? (
        <strong key={`${segKey}-h-${lineIdx}`} className="p5-md-heading">
          {renderInlineMarkdown(headingMatch[1], `${segKey}-h-${lineIdx}`)}
        </strong>
      ) : (
        renderInlineMarkdown(rawLine, `${segKey}-ln-${lineIdx}`)
      );

      if (paraBuffer.length > 0) {
        paraBuffer.push(<br key={`${segKey}-br-${lineIdx}`} />);
      }
      paraBuffer.push(inlineNode);
    });

    flushList();
    flushPara();
  };

  const fenceParts = text.split(/(```[a-zA-Z0-9_-]*\n?[\s\S]*?```)/g);
  fenceParts.forEach((part, idx) => {
    if (!part) return;
    if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
      const inner = part.slice(3, -3);
      const newlineIdx = inner.indexOf('\n');
      const firstLine = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : '';
      const isLangToken = /^[a-zA-Z0-9_-]{1,20}$/.test(firstLine);
      const codeBody = (
        newlineIdx >= 0 && isLangToken ? inner.slice(newlineIdx + 1) : inner
      ).replace(/\n$/, '');
      blocks.push(
        <pre
          key={`pre-${blockIdx++}`}
          className="p5-md-pre"
          data-lang={isLangToken ? firstLine : undefined}
        >
          <code>{codeBody}</code>
        </pre>
      );
    } else {
      pushProseSegment(part, `seg-${idx}`);
    }
  });

  return blocks.length === 1 ? blocks[0] : blocks;
}

function formatStageModelBanner(modelName: string | undefined, fallbackCodename: string): string {
  const raw = (modelName || '').trim();
  if (!raw || raw === 'dsh/default' || raw === 'dsh/auto') {
    return fallbackCodename;
  }
  const parts = raw.split('/').filter(Boolean);
  const short = parts[parts.length - 1] || raw;
  return short.replace(/_/g, '-').toUpperCase();
}

export interface StageAppProps {
  externalSource?: StageDataSource;
  embeddedInDsh?: boolean;
  sessionKey?: string;
}

export const StageApp: React.FC<StageAppProps> = ({
  externalSource,
  embeddedInDsh = false,
  sessionKey,
}) => {
  const [sourceMode] = useState<DataSourceMode>(() =>
    externalSource ? externalSource.mode : detectSourceMode()
  );

  const [state, dispatch] = useReducer(
    stageReducer,
    DEFAULT_CHARACTER_ID,
    createInitialStageState
  );

  // Force re-render when character pack JSONs finish loading
  const [, setPackVersion] = useState(0);
  useEffect(() => {
    void preloadCharacterPacks();
    return subscribeCharacterPacks(() => {
      setPackVersion((v) => v + 1);
    });
  }, []);

  const [connStatus, setConnStatus] = useState<ConnectionStatus>({
    state: externalSource || sourceMode === 'demo' ? 'connected' : 'connecting',
    attempt: 0,
    hasEverConnected: Boolean(externalSource) || sourceMode === 'demo',
  });

  const [inputValue, setInputValue] = useState<string>(
    sourceMode === 'demo' ? DEFAULT_FIRST_USER_PROMPT : ''
  );
  const [pendingImages, setPendingImages] = useState<StageImageAttachment[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const addImageFiles = (files: Iterable<File>) => {
    const accepted = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    for (const file of Array.from(files)) {
      if (!accepted.includes(file.type)) {
        setImageError(`不支持的图片格式：${file.type || file.name}（支持 PNG / JPEG / WebP / GIF）`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setImageError(`图片太大：${file.name}（上限 10MB）`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result ?? '');
        const comma = url.indexOf(',');
        if (comma < 0) return;
        setImageError(null);
        setPendingImages((prev) =>
          prev.length >= 8
            ? prev
            : [
                ...prev,
                {
                  mediaType: file.type as StageImageAttachment['mediaType'],
                  data: url.slice(comma + 1),
                  name: file.name || undefined,
                  previewUrl: url,
                },
              ]
        );
      };
      reader.readAsDataURL(file);
    }
  };
  const [typedLength, setTypedLength] = useState<number>(0);
  const [fadeReplaceKey, setFadeReplaceKey] = useState<number>(0);
  const dialogueBoxRef = useRef<HTMLDivElement | null>(null);
  const dialogueTextRef = useRef<HTMLDivElement | null>(null);
  const scrollDragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);
  const [dlgSize, setDlgSize] = useState<{ w: number; h: number }>({ w: 820, h: 190 });
  const [dlgScroll, setDlgScroll] = useState<{
    canScroll: boolean;
    ratio: number;
    thumbFrac: number;
  }>({ canScroll: false, ratio: 0, thumbFrac: 1 });
  const [inlinePreviewId, setInlinePreviewId] = useState<string | null>(null);
  const [stageModelPickerOpen, setStageModelPickerOpen] = useState(false);
  const [stageModelQuery, setStageModelQuery] = useState('');
  const stageModelPopoverRef = useRef<HTMLDivElement | null>(null);
  const [, setReasoningTick] = useState(0);
  useEffect(() => {
    const bridge = (window as any).__BIGFISH_REASONING__;
    return bridge?.subscribe ? bridge.subscribe(() => setReasoningTick((v: number) => v + 1)) : undefined;
  }, []);
  const reasoningBridge = typeof window !== 'undefined' ? (window as any).__BIGFISH_REASONING__ : undefined;
  const activeModelForEffort = state.serverSettings.worker.model || state.modelName || '';
  const effortOptions: Array<{ id: string; name: string }> = reasoningBridge?.efforts?.(activeModelForEffort) ?? [];
  const currentEffort: string | null = reasoningBridge?.current?.() ?? null;
  const modalityBridge = typeof window !== 'undefined' ? (window as any).__BIGFISH_MODALITY__ : undefined;
  const imagesAllowed: boolean =
    sourceMode === 'demo' || modalityBridge?.supportsImages?.(activeModelForEffort) === true;
  const IMAGE_BLOCKED_MSG = '当前模型不支持图片：请到 设置 → AI 引擎 勾选「图片（看图）」，或切换支持图片的模型';
  const EFFORT_LABELS: Record<string, string> = { off: '关', none: '关', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: 'MAX' };
  const [contextTokens, setContextTokens] = useState<{
    used: number;
    max: number;
  }>({ used: 0, max: 1000000 });
  const [compactionState, setCompactionState] = useState<{
    activeCutin: boolean;
    turnsCompacted: number;
    freedTokens: number;
    summaryText: string;
    compactedAt: number | null;
  }>({
    activeCutin: false,
    turnsCompacted: 10,
    freedTokens: 80000,
    summaryText: '已将前 10 轮历史压缩为摘要卡，释放 80,000 Tokens！',
    compactedAt: null,
  });
  const [isCompacting, setIsCompacting] = useState<boolean>(false);
  const [batonModalOpen, setBatonModalOpen] = useState<boolean>(false);
  const [allOutFinishData, setAllOutFinishData] =
    useState<AllOutFinishData | null>(null);
  const [batonCutinData, setBatonCutinData] =
    useState<BatonPassCutinData | null>(null);
  const [naviCutinData, setNaviCutinData] =
    useState<NavigatorCutinData | null>(null);

  const sourceRef = useRef<StageDataSource | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const collapseTimersRef = useRef<Map<string, number>>(new Map());
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastBatonCutinAtRef = useRef<number>(0);
  const pendingTouchFallbackRef = useRef<{
    characterId: string;
    zone: CharacterTouchZone;
  } | null>(null);

  const prevLineTrackRef = useRef<{
    lineKey: string;
    replaceVersion: number;
    wasTyping: boolean;
  }>({
    lineKey: '',
    replaceVersion: 0,
    wasTyping: false,
  });

  const character = getCachedCharacterPack(state.characterId);
  const shortNickname = character.name.split('（')[0];
  const uiCopy = resolveUiCopy(character);
  const dialogueCharacter = getCachedCharacterPack(
    state.currentLine?.characterId ?? state.characterId
  );

  const dismissAllOutFinish = useCallback(() => {
    setAllOutFinishData(null);
  }, []);
  const dismissBatonCutin = useCallback(() => {
    setBatonCutinData(null);
  }, []);
  const dismissNaviCutin = useCallback(() => {
    setNaviCutinData(null);
  }, []);

  const syncDialogueScroll = useCallback(() => {
    const el = dialogueTextRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const canScroll = maxScroll > 3;
    const ratio = canScroll ? Math.min(1, Math.max(0, el.scrollTop / maxScroll)) : 0;
    const thumbFrac = canScroll
      ? Math.min(0.86, Math.max(0.14, el.clientHeight / Math.max(1, el.scrollHeight)))
      : 1;
    setDlgScroll((prev) => {
      if (
        prev.canScroll === canScroll &&
        Math.abs(prev.ratio - ratio) < 0.002 &&
        Math.abs(prev.thumbFrac - thumbFrac) < 0.002
      ) {
        return prev;
      }
      return { canScroll, ratio, thumbFrac };
    });
  }, []);

  useEffect(() => {
    const boxEl = dialogueBoxRef.current;
    if (!boxEl || typeof ResizeObserver === 'undefined') return;
    const updateSize = () => {
      const rect = boxEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        setDlgSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
      syncDialogueScroll();
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(boxEl);
    if (dialogueTextRef.current) {
      ro.observe(dialogueTextRef.current);
    }
    return () => ro.disconnect();
  }, [syncDialogueScroll, state.engineeringView, fadeReplaceKey]);

  useEffect(() => {
    syncDialogueScroll();
  }, [typedLength, state.currentLine?.text, syncDialogueScroll]);

  // Connect data source on mount
  useEffect(() => {
    const callbacks: StageDataSourceCallbacks = {
      onServerMessage: (message: ServerMessage) => {
        if (
          message.type === 'command_error' &&
          message.commandType === 'interact_character' &&
          pendingTouchFallbackRef.current
        ) {
          const fallback = pendingTouchFallbackRef.current;
          pendingTouchFallbackRef.current = null;
          const pack = getCachedCharacterPack(fallback.characterId);
          const picked = pickCharacterTouchReaction(pack, fallback.zone);
          dispatch({
            type: 'STAGE_EVENT',
            event: {
              type: 'character_line',
              lineId: `line_local_touch_${Date.now()}`,
              source: 'touch',
              touchZone: fallback.zone,
              characterId: fallback.characterId,
              emotion: picked.emotion,
              text: picked.text,
              at: Date.now(),
            },
          });
          return;
        }

        if (
          message.type === 'command_error' &&
          message.commandType === 'compact_session'
        ) {
          setIsCompacting(false);
        }

        if (message.type === 'event') {
          const ev = message.event;
          const snap = stateRef.current;

          if (ev.type === 'error') {
            setIsCompacting(false);
          } else if (ev.type === 'context_compacted') {
            setIsCompacting(false);
            playSfx('compaction');
            const msg =
              ev.summary ||
              `已成功将前 ${ev.turnsCompacted} 轮历史压缩为摘要卡，释放 ${ev.freedTokens.toLocaleString()} Tokens！`;
            setCompactionState({
              activeCutin: true,
              turnsCompacted: ev.turnsCompacted,
              freedTokens: ev.freedTokens,
              summaryText: msg,
              compactedAt: Date.now(),
            });
          } else if (ev.type === 'sub_navigator_line') {
            playSfx('hover');
            setNaviCutinData({
              key: Date.now(),
              characterId: ev.characterId,
              emotion: ev.emotion,
              text: ev.text,
            });
          } else if (ev.type === 'baton_pass') {
            const now = Date.now();
            if (now - lastBatonCutinAtRef.current > 2000) {
              lastBatonCutinAtRef.current = now;
              playSfx('switch');
              setBatonCutinData({
                key: now,
                fromCharacterId: ev.fromCharacterId,
                toCharacterId: ev.toCharacterId,
                summary: ev.summary,
              });
            }
          } else if (ev.type === 'turn_done' && ev.ok) {
            playSfx('complete');
            if (snap.skillCards.length >= 1) {
              const activePack = getCachedCharacterPack(snap.characterId);
              const elapsedMs =
                ev.durationMs ??
                (snap.turnStartedAt
                  ? Math.max(200, Date.now() - snap.turnStartedAt)
                  : snap.turnDurationMs);
              const filesSet = new Set(
                snap.skillCards
                  .map(
                    (c) =>
                      c.file ||
                      (c.tool === 'edit' || c.tool === 'write'
                        ? c.summary
                        : undefined)
                  )
                  .filter((f): f is string => Boolean(f))
              );
              const diffTotals = snap.skillCards.reduce(
                (acc, c) => {
                  if (c.diffStats) {
                    acc.added += c.diffStats.added;
                    acc.removed += c.diffStats.removed;
                  }
                  return acc;
                },
                { added: 0, removed: 0 }
              );
              setAllOutFinishData({
                key: Date.now(),
                characterId: activePack.id,
                characterName: activePack.name,
                codename: activePack.codename,
                themeColor: activePack.themeColor,
                durationSec: (elapsedMs / 1000).toFixed(1),
                filesCount: filesSet.size,
                added: diffTotals.added,
                removed: diffTotals.removed,
                toolCount: snap.skillCards.length,
                summaryText: ev.summary ?? null,
              });
            }
          }
        }

        dispatch({ type: 'SERVER_MESSAGE', message });
      },
      onConnectionChange: (status: ConnectionStatus) => {
        setConnStatus(status);
      },
    };

    const source: StageDataSource =
      externalSource
        ? externalSource
        : sourceMode === 'demo'
        ? new ScriptSource(callbacks)
        : sourceMode === 'native'
        ? new NativeAppSource(callbacks)
        : new LiveSource(callbacks);

    if (externalSource && 'bindCallbacks' in externalSource) {
      (
        externalSource as StageDataSource & {
          bindCallbacks?: (cb: StageDataSourceCallbacks) => void;
        }
      ).bindCallbacks?.(callbacks);
    }

    sourceRef.current = source;
    source.connect();

    return () => {
      source.dispose();
      sourceRef.current = null;
      for (const timer of collapseTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      collapseTimersRef.current.clear();
    };
  }, [sourceMode, externalSource, sessionKey]);

  // Listen for sidebar settings button, Creator preset prefill, and Cmd+, / Ctrl+,
  useEffect(() => {
    const onOpenMenu = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: SystemMenuTab }>).detail;
      dispatch({
        type: 'TOGGLE_SYSTEM_MENU',
        open: true,
        ...(detail?.tab ? { tab: detail.tab } : {}),
      });
    };
    const onPrefill = (ev: Event) => {
      const detail = (ev as CustomEvent<{ prompt?: string }>).detail;
      if (detail?.prompt) {
        setInputValue(detail.prompt);
        window.setTimeout(() => inputRef.current?.focus(), 60);
      }
    };
    const onCommaShortcut = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === ',') {
        ev.preventDefault();
        ev.stopPropagation();
        dispatch({ type: 'TOGGLE_SYSTEM_MENU' });
      }
    };
    window.addEventListener('bigfish:open-system-menu', onOpenMenu);
    window.addEventListener('bigfish:prefill-prompt', onPrefill);
    window.addEventListener('keydown', onCommaShortcut, true);
    return () => {
      window.removeEventListener('bigfish:open-system-menu', onOpenMenu);
      window.removeEventListener('bigfish:prefill-prompt', onPrefill);
      window.removeEventListener('keydown', onCommaShortcut, true);
    };
  }, []);

  // Close stage inline model picker on outside click or Escape
  useEffect(() => {
    if (!stageModelPickerOpen) return;
    const onPointerDown = (ev: MouseEvent) => {
      if (
        stageModelPopoverRef.current &&
        !stageModelPopoverRef.current.contains(ev.target as Node)
      ) {
        setStageModelPickerOpen(false);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setStageModelPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [stageModelPickerOpen]);

  // Sync fastForward with data source
  useEffect(() => {
    sourceRef.current?.setFastForward?.(state.fastForward);
  }, [state.fastForward]);

  // Auto-select latest card with diff for inline preview & sync DSH context/compaction events
  useEffect(() => {
    const latestDiffCard = [...state.skillCards]
      .reverse()
      .find((c) => Boolean(c.diff));
    if (latestDiffCard) {
      setInlinePreviewId(latestDiffCard.toolUseId);
    } else if (state.skillCards.length === 0) {
      setInlinePreviewId(null);
    }
  }, [state.skillCards]);

  useEffect(() => {
    if (state.events.length === 0) {
      setContextTokens({ used: 0, max: 1000000 });
      return;
    }
    const lastEv = state.events[state.events.length - 1];
    if (lastEv.type === 'session_started') {
      setContextTokens({ used: 0, max: 1000000 });
      setCompactionState((prev) => ({
        ...prev,
        activeCutin: false,
        compactedAt: null,
      }));
      return;
    }

    // Scan from newest to oldest within the current session (stopping at the most recent session_started)
    let latestUsage: Extract<StageEvent, { type: 'context_usage' }> | null =
      null;
    let latestCompactedAfterUsage: Extract<
      StageEvent,
      { type: 'context_compacted' }
    > | null = null;
    let sessionStartIdx = 0;

    for (let i = state.events.length - 1; i >= 0; i -= 1) {
      const ev = state.events[i];
      if (ev.type === 'session_started') {
        sessionStartIdx = i;
        break;
      }
      if (
        !latestUsage &&
        ev.type === 'context_compacted' &&
        !latestCompactedAfterUsage
      ) {
        latestCompactedAfterUsage = ev;
      }
      if (ev.type === 'context_usage') {
        latestUsage = ev;
        break;
      }
    }

    if (latestUsage) {
      const maxTokens = latestUsage.maxTokens;
      let usedTokens = latestUsage.usedTokens;
      if (latestCompactedAfterUsage) {
        usedTokens =
          latestCompactedAfterUsage.afterTokens ??
          Math.max(0, usedTokens - latestCompactedAfterUsage.freedTokens);
      } else if (
        compactionState.compactedAt &&
        compactionState.compactedAt > latestUsage.at
      ) {
        usedTokens = Math.max(0, usedTokens - compactionState.freedTokens);
      }
      setContextTokens({
        used: Math.max(0, maxTokens > 0 ? Math.min(maxTokens, usedTokens) : usedTokens),
        max: maxTokens,
      });
      return;
    }

    if (sourceMode !== 'demo') { setContextTokens(prev => ({ ...prev, used: 0 })); return; }
    const sessionEvents = state.events.slice(sessionStartIdx);
    const userAndWorkerCount = sessionEvents.filter(
      (e) => e.type === 'user_message' || e.type === 'worker_text'
    ).length;
    if (userAndWorkerCount === 0 && state.skillCards.length === 0) {
      setContextTokens((prev) => ({ used: 0, max: prev.max }));
      return;
    }
    const dynamicTokens =
      userAndWorkerCount * 3000 +
      state.skillCards.length * 8000 -
      (compactionState.compactedAt ? compactionState.freedTokens : 0);
    setContextTokens((prev) => ({
      used: Math.max(0, Math.min(prev.max, dynamicTokens)),
      max: prev.max,
    }));
  }, [state.events, state.skillCards.length]);

  useEffect(() => {
    if (!compactionState.activeCutin) return;
    const tId = window.setTimeout(() => {
      setCompactionState((prev) => ({ ...prev, activeCutin: false }));
    }, 2800);
    return () => window.clearTimeout(tId);
  }, [compactionState.activeCutin]);

  useEffect(() => {
    if (!isCompacting) return;
    const safetyTimer = window.setTimeout(() => {
      setIsCompacting(false);
    }, 12000);
    return () => window.clearTimeout(safetyTimer);
  }, [isCompacting]);

  const handleTriggerCompaction = () => {
    if (isCompacting) return;
    if (state.turnActive) return;
    if (sourceMode === 'live' && connStatus.state !== 'connected') {
      dispatch({ type: 'SERVER_MESSAGE', message: { type: 'command_error', commandType: 'compact_session', message: '尚未连接执行引擎，无法整理记忆' } });
      return;
    }
    setIsCompacting(true);
    sourceRef.current?.compactSession?.();
  };

  // Schedule auto-collapse of finished skill cards after ~2.6s
  useEffect(() => {
    for (const card of state.skillCards) {
      if (
        card.status !== 'running' &&
        !card.collapsedToLog &&
        !collapseTimersRef.current.has(card.toolUseId)
      ) {
        const delay = state.fastForward ? 650 : 2600;
        const tId = window.setTimeout(() => {
          collapseTimersRef.current.delete(card.toolUseId);
          dispatch({ type: 'COLLAPSE_SKILL_CARD', toolUseId: card.toolUseId });
        }, delay);
        collapseTimersRef.current.set(card.toolUseId, tId);
      }
    }
  }, [state.skillCards, state.fastForward]);

  // Live HUD stopwatch & 15s idle wait check while turn is active
  useEffect(() => {
    if (!state.turnActive) return;
    const interval = window.setInterval(() => {
      dispatch({ type: 'TICK_TIMER', now: Date.now() });
    }, 100);
    return () => window.clearInterval(interval);
  }, [state.turnActive]);

  // Handle typewriter & in-place replacesLineId transitions
  const fullLineText = state.currentLine?.text ?? '';
  const currentLineKey = state.currentLine?.lineKey ?? '';
  const currentReplaceVersion = state.currentLine?.replaceVersion ?? 0;

  useEffect(() => {
    const prev = prevLineTrackRef.current;
    const isInPlaceReplace =
      currentReplaceVersion > 0 && currentReplaceVersion !== prev.replaceVersion;

    if (isInPlaceReplace) {
      if (prev.wasTyping) {
        setTypedLength(0);
      } else {
        setTypedLength(fullLineText.length);
        setFadeReplaceKey((k) => k + 1);
      }
    } else if (currentLineKey !== prev.lineKey) {
      setTypedLength(0);
    }

    prevLineTrackRef.current = {
      lineKey: currentLineKey,
      replaceVersion: currentReplaceVersion,
      wasTyping: true,
    };
  }, [currentLineKey, currentReplaceVersion, fullLineText]);

  const isTypingLine = typedLength < fullLineText.length;
  useEffect(() => {
    prevLineTrackRef.current.wasTyping = isTypingLine;
  }, [isTypingLine]);

  const typingCharsPerSec =
    state.serverSettings?.performance?.typingCharsPerSec || 40;

  useEffect(() => {
    if (!fullLineText || typedLength >= fullLineText.length) return;
    const baseStepMs = Math.max(8, Math.round(1000 / typingCharsPerSec));
    const stepMs = state.fastForward ? 8 : baseStepMs;
    const stepChars = state.fastForward ? 4 : 1;
    const tId = window.setTimeout(() => {
      setTypedLength((prev) => {
        const next = Math.min(fullLineText.length, prev + stepChars);
        if (next % 3 === 0) {
          playSfx('type');
        }
        return next;
      });
    }, stepMs);
    return () => window.clearTimeout(tId);
  }, [fullLineText, typedLength, state.fastForward, typingCharsPerSec]);

  const skipTypewriter = () => {
    if (fullLineText && typedLength < fullLineText.length) {
      setTypedLength(fullLineText.length);
    }
  };

  const handleConfirmPermission = (allowed: boolean) => {
    if (!state.pendingPermission) return;
    playSfx(allowed ? 'allow' : 'deny');
    sourceRef.current?.decidePermission(
      state.pendingPermission.requestId,
      allowed
    );
  };

  const handleSwitchCharacter = (nextCharId: string) => {
    if (!nextCharId || state.turnActive) return;
    sourceRef.current?.switchCharacter(nextCharId);
  };

  const handleUpdateSettings = (patch: SettingsPatch) => {
    sourceRef.current?.updateSettings(patch);
  };

  const handleListModels = (target: 'worker' | 'voice') => {
    dispatch({ type: 'MARK_MODELS_LOADING', target });
    sourceRef.current?.listModels(target);
  };

  const handleTestConnection = (target: 'worker' | 'voice') => {
    dispatch({ type: 'MARK_CONN_TESTING', target });
    sourceRef.current?.testConnection(target);
  };

  const handleTouchCharacterZone = (zone: CharacterTouchZone) => {
    if (
      sourceMode === 'demo' ||
      (connStatus.state === 'connected' && sourceRef.current?.interactCharacter)
    ) {
      pendingTouchFallbackRef.current = {
        characterId: character.id,
        zone,
      };
      sourceRef.current?.interactCharacter?.(character.id, zone);
      return;
    }

    // Offline local instant reaction
    const picked = pickCharacterTouchReaction(character, zone);
    dispatch({
      type: 'STAGE_EVENT',
      event: {
        type: 'character_line',
        lineId: `line_offline_touch_${Date.now()}`,
        source: 'touch',
        touchZone: zone,
        characterId: character.id,
        emotion: picked.emotion,
        text: picked.text,
        at: Date.now(),
      },
    });
  };

  const handleConfirmBatonPass = (
    toCharacterId: string,
    instruction: string
  ) => {
    if (state.turnActive) return;
    setBatonModalOpen(false);
    sourceRef.current?.batonPass?.(toCharacterId, instruction);
  };

  const handleRequestGitStatus = () => {
    dispatch({ type: 'MARK_GIT_LOADING' });
    sourceRef.current?.requestGitStatus?.();
  };

  const handleRevertGitFile = (path: string) => {
    playSfx('deny');
    sourceRef.current?.revertGitFile?.(path);
  };

  const handleCommitGit = (message: string) => {
    playSfx('allow');
    sourceRef.current?.commitGit?.(message);
  };

  const handleStartNewSessionWithDir = (projectDir: string) => {
    const source = sourceRef.current;
    if (source?.newSessionInDirectory) source.newSessionInDirectory(projectDir);
    else { source?.updateSettings({ projectDir }); source?.newSession(); }
    dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: false });
  };

  const selectedCard: SkillCardItem | null = (() => {
    if (!state.selectedToolUseId) return null;
    const activeHit = state.skillCards.find(
      (c) => c.toolUseId === state.selectedToolUseId
    );
    if (activeHit) return activeHit;

    let startEv: Extract<StageEvent, { type: 'tool_start' }> | null = null;
    let endEv: Extract<StageEvent, { type: 'tool_end' }> | null = null;
    for (const ev of state.events) {
      if (
        ev.type === 'tool_start' &&
        ev.toolUseId === state.selectedToolUseId
      ) {
        startEv = ev;
      } else if (
        ev.type === 'tool_end' &&
        ev.toolUseId === state.selectedToolUseId
      ) {
        endEv = ev;
      }
    }
    if (!startEv && !endEv) return null;
    const diff = endEv?.diff;
    return {
      toolUseId: state.selectedToolUseId,
      tool: startEv?.tool ?? (diff ? 'edit' : 'other'),
      rawName: startEv?.rawName ?? 'tool',
      summary: startEv?.summary ?? endEv?.summary ?? '历史工具调用档案',
      file: startEv?.file,
      startedAt: startEv?.at ?? endEv?.at ?? Date.now(),
      endedAt: endEv?.at,
      status: endEv ? (endEv.ok ? 'success' : 'error') : 'running',
      endSummary: endEv?.summary,
      diff,
      output: endEv?.output,
      diffStats: computeDiffStats(diff),
      collapsedToLog: true,
    };
  })();

  // Global keyboard shortcuts (stable window listeners via keyHandlerRef to avoid re-binding at 40Hz)
  const keyHandlerRef = useRef<{
    onKeyDown: (e: KeyboardEvent) => void;
    onKeyUp: (e: KeyboardEvent) => void;
    onBlur: () => void;
  }>({
    onKeyDown: () => {},
    onKeyUp: () => {},
    onBlur: () => {},
  });

  keyHandlerRef.current = {
    onKeyDown: (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.metaKey ||
        e.altKey ||
        (e.ctrlKey && e.key !== 'Control') ||
        e.repeat
      )
        return;
      if (isTypingTarget(e.target) && e.key !== 'Escape') return;
      if (e.key === 'Control') {
        dispatch({ type: 'SET_FAST_FORWARD', fast: true });
      }

      if (e.key === '`' || e.code === 'Backquote') {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_ENGINEERING_VIEW' });
          return;
        }
      }

      if (e.key === 'Escape') {
        if (allOutFinishData) {
          e.preventDefault();
          setAllOutFinishData(null);
          return;
        }
        if (batonCutinData) {
          e.preventDefault();
          setBatonCutinData(null);
          return;
        }
        if (batonModalOpen) {
          e.preventDefault();
          setBatonModalOpen(false);
          return;
        }
        if (state.selectedToolUseId !== null || state.gitDrawerOpen) {
          e.preventDefault();
          dispatch({ type: 'SELECT_SKILL_CARD', toolUseId: null });
          dispatch({ type: 'TOGGLE_GIT_DRAWER', open: false });
          return;
        }
        if (state.backlogOpen) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_BACKLOG', open: false });
          return;
        }
        if (state.systemMenuOpen) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: false });
          return;
        }
        if (!state.pendingPermission && !state.engineeringView) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: true });
          return;
        }
      }

      if (
        state.pendingPermission &&
        !state.systemMenuOpen &&
        !state.backlogOpen &&
        !batonModalOpen &&
        state.selectedToolUseId === null &&
        !state.gitDrawerOpen
      ) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          dispatch({ type: 'SET_PERMISSION_CHOICE', choice: 'allow' });
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          dispatch({ type: 'SET_PERMISSION_CHOICE', choice: 'reject' });
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          handleConfirmPermission(state.permissionChoice === 'allow');
          return;
        }
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTypingInInput =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        activeTag === 'select';

      if (
        !isTypingInInput &&
        !state.systemMenuOpen &&
        !batonModalOpen &&
        !state.gitDrawerOpen &&
        !state.engineeringView
      ) {
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_BACKLOG' });
          return;
        }
        if (e.key === 'o' || e.key === 'O') {
          if (state.skillCards.length > 0 && !selectedCard) {
            e.preventDefault();
            dispatch({
              type: 'SELECT_SKILL_CARD',
              toolUseId: state.skillCards[state.skillCards.length - 1].toolUseId,
            });
            return;
          }
        }
        if (e.key === ' ') {
          e.preventDefault();
          skipTypewriter();
          return;
        }
      }
    },
    onKeyUp: (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        dispatch({ type: 'SET_FAST_FORWARD', fast: false });
      }
    },
    onBlur: () => {
      dispatch({ type: 'SET_FAST_FORWARD', fast: false });
    },
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keyHandlerRef.current.onKeyDown(e);
    const onKeyUp = (e: KeyboardEvent) => keyHandlerRef.current.onKeyUp(e);
    const onBlur = () => keyHandlerRef.current.onBlur();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const handleSubmitInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (needsOnboarding) return;
    const trimmed = inputValue.trim();

    const images = pendingImages;
    if (images.length > 0 && !imagesAllowed) {
      setImageError(IMAGE_BLOCKED_MSG);
      return;
    }
    if (sourceMode !== 'demo' && !trimmed && images.length === 0) {
      inputRef.current?.focus();
      return;
    }

    if (state.turnActive) {
      const steerText =
        trimmed || '顺便确认按钮带上 data-variant="theme-primary" 属性！';
      sourceRef.current?.steer(steerText, images);
      setInputValue('');
      setPendingImages([]);
      return;
    }

    for (const timer of collapseTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    collapseTimersRef.current.clear();

    const promptToSend = trimmed || DEFAULT_FIRST_USER_PROMPT;
    sourceRef.current?.send(images.length && !trimmed ? '' : promptToSend, images);
    setInputValue('');
    setPendingImages([]);
    inputRef.current?.blur();
  };

  const handleReplayOrNewSession = () => {
    for (const timer of collapseTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    collapseTimersRef.current.clear();

    if (sourceMode === 'demo') {
      sourceRef.current?.replayDemo?.();
    } else {
      sourceRef.current?.newSession();
    }
    setInputValue('');
  };

  const turnDurationSec = (state.turnDurationMs / 1000).toFixed(1);
  const idleWaitSec = (state.idleWaitMs / 1000).toFixed(1);
  const isLongWaiting = state.turnActive && state.idleWaitMs >= 15000;
  const hudStatusMeta = HUD_STATUS_TEXT[state.hudStatus];
  const emotionMeta = resolveEmotionLabel(character, state.currentEmotion);

  const latestUserMsg = [...state.events]
    .reverse()
    .find((ev) => ev.type === 'user_message');

  const latestWorkerFinal = [...state.events]
    .reverse()
    .find((ev) => ev.type === 'worker_text');

  const contextUsageKnown = sourceMode === 'demo' || state.events.some(event => event.type === 'context_usage');
  const usedK = Math.round(contextTokens.used / 1000);
  const maxK = Math.round(contextTokens.max / 1000);
  const contextCapacityKnown = contextUsageKnown && contextTokens.max > 0;
  const contextPercent = contextCapacityKnown ? Math.min(
    100,
    Math.max(0, Math.round((contextTokens.used / contextTokens.max) * 100))
  ) : 0;

  const touchedFiles = Array.from(
    new Set(
      state.skillCards
        .map(
          (c) =>
            c.file ||
            (c.tool === 'edit' || c.tool === 'write' ? c.summary : undefined)
        )
        .filter((f): f is string => Boolean(f))
    )
  );
  const totalDiffStats = state.skillCards.reduce(
    (acc, c) => {
      if (c.diffStats) {
        acc.added += c.diffStats.added;
        acc.removed += c.diffStats.removed;
      }
      return acc;
    },
    { added: 0, removed: 0 }
  );

  const handleReplayAllOutFinish = () => {
    playSfx('complete');
    setAllOutFinishData({
      key: Date.now(),
      characterId: character.id,
      characterName: character.name,
      codename: character.codename,
      themeColor: character.themeColor,
      durationSec: turnDurationSec === '0.0' ? '4.8' : turnDurationSec,
      filesCount: touchedFiles.length,
      added: totalDiffStats.added,
      removed: totalDiffStats.removed,
      toolCount: state.skillCards.length,
      summaryText: state.lastTurnSummary,
    });
  };

  const canBatonPass =
    sourceMode === 'demo' ||
    state.skillCards.length > 0 ||
    state.events.some(
      (e) =>
        e.type === 'user_message' ||
        e.type === 'worker_text' ||
        e.type === 'tool_end'
    );

  if (state.engineeringView) {
    return (
      <EngineeringView
        events={state.events}
        modelName={state.modelName}
        hudStatusLabel={hudStatusMeta.zh}
        turnDurationSec={turnDurationSec}
        pendingPermission={state.pendingPermission}
        steers={state.steers}
        inputValue={inputValue}
        turnActive={state.turnActive}
        onInputChange={setInputValue}
        onSubmitInput={handleSubmitInput}
        onResolvePermission={handleConfirmPermission}
        onExitEngineeringView={() =>
          dispatch({ type: 'TOGGLE_ENGINEERING_VIEW', open: false })
        }
        onReplayScript={handleReplayOrNewSession}
      />
    );
  }

  const displayedText =
    fullLineText.slice(0, typedLength) || defaultCharacterLine(character);
  const isLongDialogue =
    fullLineText.length > 140 ||
    fullLineText.includes('\n') ||
    fullLineText.includes('```');

  const conclusionCandidate =
    latestWorkerFinal && latestWorkerFinal.type === 'worker_text'
      ? latestWorkerFinal.text
      : !state.turnActive && state.lastTurnSummary
      ? state.lastTurnSummary
      : null;
  const isConclusionDuplicateOfDialogue =
    Boolean(conclusionCandidate) &&
    Boolean(state.currentLine?.text) &&
    state.currentLine!.text.trim() === conclusionCandidate!.trim();
  const shouldShowConclusionCard =
    Boolean(conclusionCandidate?.trim()) && !isConclusionDuplicateOfDialogue;

  const isDisconnected =
    !embeddedInDsh && sourceMode === 'live' && connStatus.state !== 'connected';
  const needsOnboarding =
    !embeddedInDsh &&
    (sourceMode === 'live' || sourceMode === 'native') && !state.serverSettings.projectDir;
  const isNativeApp =
    sourceMode === 'native' ||
    (typeof window !== 'undefined' &&
      Boolean(window.electronAPI?.isNativeApp));

  const backlogCount = state.events.filter(
    (e) =>
      [
        'user_message',
        'steer_queued',
        'character_line',
        'sub_navigator_line',
        'baton_pass',
        'context_compacted',
        'worker_text',
        'tool_start',
        'permission_request',
        'permission_resolved',
        'error',
        'turn_done',
      ].includes(e.type) ||
      (e.type === 'tool_end' && !e.ok)
  ).length;

  const viewportStyle = {
    '--char-theme-color': character.themeColor,
    '--char-accent-color': character.accentColor ?? character.themeColor,
  } as React.CSSProperties;

  return (
    <div
      className={`p5-stage-viewport${isNativeApp ? ' is-native-app' : ''}${embeddedInDsh ? ' is-dsh-embedded' : ''}`}
      data-testid="p5-stage-viewport"
      data-active-character={character.id}
      style={viewportStyle}
    >
      {/* ── P5X GEOMETRIC STAGE BACKDROP LAYERS ── */}
      <div className="p5-bg-crimson-wedge" aria-hidden="true" />
      <div className="p5-bg-halftone" aria-hidden="true" />
      <div className="p5-bg-right-red-corner" aria-hidden="true" />
      <div className="p5-bg-right-halftone" aria-hidden="true" />
      <div className="p5-bg-vertical-watermark" aria-hidden="true">
        CHARACTER
      </div>

      {/* ── DISCONNECT / RECONNECT BANNER (LiveSource) ── */}
      {isDisconnected && (
        <div
          className="p5-disconnect-banner"
          data-testid="disconnect-banner"
          role="status"
        >
          <div className="p5-disconnect-left">
            <span className="p5-disconnect-badge">OFFLINE // 信号中断</span>
            <strong className="p5-disconnect-title">鱼塘断线，重连中…</strong>
            <span className="p5-disconnect-detail">
              {connStatus.hasEverConnected
                ? `正在第 ${connStatus.attempt} 次重连 — 若服务已停止请运行：`
                : `尚未连上本地服务（第 ${Math.max(1, connStatus.attempt)} 次尝试）— 请启动服务：`}
            </span>
            <code className="p5-disconnect-cmd">npm run dev:server</code>
          </div>

          <div className="p5-disconnect-actions">
            <button
              type="button"
              className="p5-disconnect-btn"
              data-testid="reconnect-now-btn"
              onClick={() => sourceRef.current?.retryNow()}
            >
              ↻ 立即重连
            </button>
            <a
              href="?demo=1"
              className="p5-disconnect-demo-link"
              data-testid="switch-to-demo-link"
            >
              进入 ?demo=1 剧本模式
            </a>
          </div>
        </div>
      )}

      {/* ── MAIN 2-ZONE P5X STAGE (LEFT CHARACTER STAGE / RIGHT WORKSPACE) ── */}
      <div className="p5-main-grid">
        {/* ══ LEFT ZONE: P5X BREAK-THE-FRAME CHARACTER STAGE + INTEGRATED HUD ══ */}
        <aside className="p5-left-column" data-testid="hud-layer">
          {/* Top Brand & Live Connection Pill */}
          <div className="p5-brand-strip">
            <div className="p5-brand-tag">BIGFISH STAGE</div>
            <div
              className={`p5-live-pill mode-${sourceMode}`}
              data-testid="data-source-badge"
            >
              <span
                className={`p5-live-dot status-${state.hudStatus}`}
              />
              <span>
                {sourceMode === 'demo'
                  ? 'DEMO · 剧本演示'
                  : connStatus.state === 'connected'
                  ? '实时连接 · 已就绪'
                  : '连接中…'}
              </span>
            </div>
          </div>

          {/* Break-the-Frame Character Showcase */}
          <div
            key={`stage_frame_${state.characterSwitchKey}`}
            className="p5-portrait-stage p5-portrait-stage--theme"
          >
            <div
              className="p5-char-tilted-card"
              data-watermark={character.codename}
              aria-hidden="true"
            />
            <div
              className="p5-portrait-emotion-tag"
              data-testid="emotion-badge"
              title={`${emotionMeta.en} · ${emotionMeta.zh}`}
            >
              <span className="emotion-zh">{emotionMeta.zh}</span>
            </div>

            <CharacterRenderer
              characterId={character.id}
              characterName={character.name}
              codename={character.codename}
              art={character.art}
              emotion={state.currentEmotion}
              emotionSwitchKey={state.emotionSwitchKey}
              characterSwitchKey={state.characterSwitchKey}
              talking={isTypingLine && dialogueCharacter.id === character.id}
              breathing={
                state.turnActive &&
                (state.currentEmotion === 'thinking' ||
                  state.currentEmotion === 'working' ||
                  isLongWaiting)
              }
              onTouchZone={handleTouchCharacterZone}
            />
          </div>

          {/* P5X Overlapping Nameplate + Bottom Row (Party Medals + P5 Context Radar) */}
          <div className="p5-char-info-cluster" data-testid="hud-status-card">
            <div
              className="p5-char-codename-giant"
              data-testid="character-nickname"
            >
              {shortNickname}
            </div>

            <div
              className="p5-char-name-pill p5-char-name-pill--interactive"
              ref={stageModelPopoverRef}
            >
              <button
                type="button"
                className={`p5-stage-model-trigger ${
                  stageModelPickerOpen ? 'is-open' : ''
                }`}
                data-testid="character-codename"
                aria-haspopup="listbox"
                aria-expanded={stageModelPickerOpen}
                title={`当前驱动模型：${
                  state.serverSettings.worker.model || state.modelName || character.codename
                }（点击切换模型）`}
                onClick={() => {
                  playSfx('select');
                  const next = !stageModelPickerOpen;
                  setStageModelPickerOpen(next);
                  if (next) {
                    setStageModelQuery('');
                    handleListModels('worker');
                  }
                }}
              >
                <span className="p5-char-name-main">
                  {formatStageModelBanner(
                    state.serverSettings.worker.model || state.modelName,
                    character.codename
                  )}
                </span>
                <span className="p5-stage-model-caret" aria-hidden="true">
                  {stageModelPickerOpen ? '▴' : '▾'}
                </span>
              </button>

              {effortOptions.length > 0 && (
                <button
                  type="button"
                  className="p5-effort-chip"
                  data-testid="reasoning-effort-chip"
                  title="思考强度（点击切换下一档）"
                  onClick={() => {
                    playSfx('select');
                    const ids = effortOptions.map((e) => e.id);
                    const idx = currentEffort ? ids.indexOf(currentEffort) : -1;
                    const next = ids[(idx + 1) % ids.length];
                    handleUpdateSettings({ worker: { reasoningEffort: next } });
                  }}
                >
                  ⚡ {EFFORT_LABELS[currentEffort ?? ''] ?? currentEffort ?? '默认'}
                </button>
              )}

              <span
                className="p5-speaker-codename-sr"
                data-testid="hud-model-name"
              >
                {state.modelName}
              </span>

              <span
                className={`p5-char-status-inline status-${state.hudStatus}`}
                data-testid="hud-status-text"
              >
                <span>★ {hudStatusMeta.zh}</span>
                <span>·</span>
                <strong data-testid="hud-elapsed-time">
                  {turnDurationSec}s
                </strong>
              </span>

              {stageModelPickerOpen && (() => {
                const activeModel =
                  state.serverSettings.worker.model || state.modelName || '';
                const recList =
                  character.recommendedModels && character.recommendedModels.length > 0
                    ? character.recommendedModels
                    : [];
                const catalogList = state.workerModels.models || [];
                const mergedModels = Array.from(
                  new Set([
                    ...(activeModel && activeModel !== 'dsh/default' ? [activeModel] : []),
                    ...catalogList,
                    ...(embeddedInDsh ? [] : recList),
                  ])
                );
                const q = stageModelQuery.trim().toLowerCase();
                const filtered = q
                  ? mergedModels.filter((m) => m.toLowerCase().includes(q))
                  : mergedModels;

                const applyModelChoice = (targetModel: string) => {
                  const clean = targetModel.trim();
                  if (!clean) return;
                  playSfx('select');
                  handleUpdateSettings({ worker: { model: clean } });
                  setStageModelPickerOpen(false);
                };

                return (
                  <div
                    className="p5-stage-model-popover"
                    data-testid="stage-model-popover"
                    role="dialog"
                    aria-label="切换驱动模型"
                  >
                    <div className="p5-stage-model-pop-head">
                      <div className="p5-stage-model-pop-title">
                        <span className="p5-stage-model-pop-tag">MODEL</span>
                        <span>选择当前驱动模型</span>
                      </div>
                      <button
                        type="button"
                        className="p5-stage-model-pop-close"
                        onClick={() => setStageModelPickerOpen(false)}
                        aria-label="关闭模型选择"
                      >
                        ✕
                      </button>
                    </div>

                    <form
                      className="p5-stage-model-search-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (filtered.length > 0 && stageModelQuery.trim()) {
                          applyModelChoice(filtered[0]);
                        } else if (stageModelQuery.trim()) {
                          applyModelChoice(stageModelQuery);
                        }
                      }}
                    >
                      <span className="p5-stage-model-search-icon">⌕</span>
                      <input
                        type="text"
                        autoFocus
                        value={stageModelQuery}
                        onChange={(e) => setStageModelQuery(e.target.value)}
                        placeholder="搜索或输入模型 ID 回车切换…"
                        className="p5-stage-model-search-input"
                        data-testid="stage-model-search-input"
                      />
                    </form>

                    {effortOptions.length > 0 && (
                      <div className="p5-effort-row" data-testid="reasoning-effort-row">
                        <span className="p5-effort-row-label">思考强度</span>
                        {effortOptions.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            className={`p5-effort-opt ${currentEffort === e.id ? 'is-active' : ''}`}
                            title={e.name}
                            onClick={() => {
                              playSfx('select');
                              handleUpdateSettings({ worker: { reasoningEffort: e.id } });
                            }}
                          >
                            {EFFORT_LABELS[e.id] ?? e.name}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="p5-stage-model-list" role="listbox">
                      {state.workerModels.loading && mergedModels.length === 0 && (
                        <div className="p5-stage-model-empty">正在读取可用模型列表…</div>
                      )}
                      {!state.workerModels.loading && filtered.length === 0 && (
                        <div className="p5-stage-model-empty">
                          {stageModelQuery.trim() ? (
                            <button
                              type="button"
                              className="p5-stage-model-item is-custom-apply"
                              onClick={() => applyModelChoice(stageModelQuery)}
                            >
                              <span>直接使用自定义模型：</span>
                              <strong>{stageModelQuery.trim()}</strong>
                            </button>
                          ) : (
                            '暂无模型列表，点击下方进入模型设置配置接口'
                          )}
                        </div>
                      )}
                      {filtered.map((m) => {
                        const isCurrent = m === activeModel;
                        const slashIdx = m.lastIndexOf('/');
                        const shortId = slashIdx >= 0 ? m.slice(slashIdx + 1) : m;
                        const prefix = slashIdx > 0 ? m.slice(0, slashIdx) : '';
                        const isRec = recList.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            role="option"
                            aria-selected={isCurrent}
                            className={`p5-stage-model-item ${
                              isCurrent ? 'is-active' : ''
                            }`}
                            onClick={() => applyModelChoice(m)}
                          >
                            <div className="p5-stage-model-item-main">
                              <span className="p5-stage-model-item-name">
                                {isCurrent ? `✓ ${shortId}` : shortId}
                              </span>
                              {isRec && (
                                <span className="p5-stage-model-rec-pill">推荐</span>
                              )}
                            </div>
                            {prefix && (
                              <span className="p5-stage-model-item-prefix">
                                {prefix}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="p5-stage-model-pop-foot">
                      <button
                        type="button"
                        className="p5-stage-model-foot-btn"
                        onClick={() => handleListModels('worker')}
                      >
                        ↻ 刷新列表
                      </button>
                      <button
                        type="button"
                        className="p5-stage-model-foot-btn is-accent"
                        onClick={() => {
                          setStageModelPickerOpen(false);
                          dispatch({
                            type: 'TOGGLE_SYSTEM_MENU',
                            open: true,
                            tab: 'worker',
                          });
                        }}
                      >
                        ⚙ 模型接口设置 →
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {isLongWaiting && (
              <div
                className="p5-hud-wait-alert"
                data-testid="hud-idle-wait-timer"
              >
                <span className="p5-wait-pulse" />
                <span>
                  深度思考中 · 已等待 <strong>{idleWaitSec}s</strong>
                </span>
              </div>
            )}

            {/* Bottom Row: Dynamic P5 Context Radar Dial (Left) + 4 Character Avatars (Right) */}
            <div className="p5-bottom-left-dock">
              {/* Dynamic P5 Tactical Radar Dial for Context Usage */}
              <div
                className={`p5-context-radar ${
                  contextPercent >= 75
                    ? 'is-high'
                    : contextPercent >= 40
                    ? 'is-mid'
                    : 'is-low'
                }`}
                data-testid="context-meter"
              >
                <div className="p5-radar-dial-wrap">
                  <svg
                    className="p5-radar-svg"
                    viewBox="0 0 64 64"
                    aria-hidden="true"
                  >
                    <polygon
                      className="p5-radar-outer-star"
                      points="32,2 39,21 60,18 44,33 54,53 32,43 10,53 20,33 4,18 25,21"
                    />
                    <circle
                      className="p5-radar-track"
                      cx="32"
                      cy="32"
                      r="22"
                    />
                    <circle
                      className="p5-radar-fill"
                      cx="32"
                      cy="32"
                      r="22"
                      strokeDasharray={138.2}
                      strokeDashoffset={
                        138.2 -
                        (138.2 * (contextCapacityKnown ? Math.max(8, Math.min(100, contextPercent)) : 0)) /
                          100
                      }
                    />
                  </svg>
                  <span className="p5-radar-pct">{contextCapacityKnown ? `${contextPercent}%` : '—'}</span>
                </div>

                <div className="p5-radar-info">
                  <span className="p5-radar-kicker">CONTEXT GAUGE</span>
                  <span
                    className="p5-radar-tokens"
                    data-testid="context-meter-value"
                  >
                    {contextUsageKnown ? <><strong>{usedK}k</strong> / {contextCapacityKnown ? `${maxK}k` : '上限未提供'}</> : '等待引擎统计'}
                  </span>
                  <button
                    type="button"
                    className={`p5-compaction-trigger-btn ${
                      isCompacting ? 'is-compacting' : ''
                    }`}
                    data-testid="trigger-compaction-btn"
                    onClick={handleTriggerCompaction}
                    disabled={isCompacting || state.turnActive}
                    title="触发历史上下文记忆蒸馏压缩"
                  >
                    {isCompacting ? '✦ 凝炼中…' : '✦ 记忆凝炼'}
                  </button>
                </div>
              </div>

              <div className="p5-party-medals" data-testid="party-bar">
                {state.characters.map((ch) => {
                  const isActive = ch.id === character.id;
                  const shortLabel = ch.name.split('（')[0];
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      data-testid={`party-member-${ch.id}`}
                      disabled={state.turnActive}
                      className={`p5-medal-item ${isActive ? 'is-active' : ''}`}
                      style={
                        {
                          '--member-color': ch.themeColor,
                        } as React.CSSProperties
                      }
                      onClick={() => handleSwitchCharacter(ch.id)}
                      title={`${ch.name} (${ch.codename})`}
                    >
                      <div className="p5-medal-ring">
                        {ch.portraitUrl ? (
                          <img
                            src={ch.portraitUrl}
                            alt={shortLabel}
                            className="p5-party-avatar"
                          />
                        ) : (
                          <span className="p5-party-avatar-text">
                            {shortLabel.slice(0, 2)}
                          </span>
                        )}
                      </div>
                      <span className="p5-medal-name">{shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        {/* ══ RIGHT ZONE: AI CODING WORKSPACE (TOPBAR + COMIC BUBBLE + ACTION STREAM + INPUT) ══ */}
        <main className="p5-center-stage">
          {/* ── 1. MINIMAL WORKSPACE HEADER ── */}
          <header className="p5-workspace-header">
            <div className="p5-workspace-header-left">
              <div className="p5-session-switcher-wrap">
                <span className="p5-session-badge">SESSION</span>
                <SessionListControl
                  sourceRef={sourceRef}
                  turnActive={state.turnActive}
                />
              </div>

              {sourceMode === 'demo' && (
                <button
                  type="button"
                  className="p5-pill-btn p5-pill-btn--replay"
                  onClick={handleReplayOrNewSession}
                  data-testid="replay-script-btn"
                >
                  ↻ 重播剧本
                </button>
              )}
            </div>

            <div className="p5-workspace-header-right">
              <SfxMuteButton />

              <button
                type="button"
                className="p5-pill-btn p5-pill-btn--trophy"
                onClick={() => dispatch({ type: 'TOGGLE_GIT_DRAWER', open: true })}
                data-testid="git-trophy-btn"
                title="查看工作区全量 Git 变更、单文件撤回与一键提交"
              >
                🗂 代码变更
                {state.gitStatus.loaded && state.gitStatus.files.length > 0 && (
                  <span className="p5-trophy-count">
                    {state.gitStatus.files.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                className="p5-pill-btn"
                onClick={() => dispatch({ type: 'TOGGLE_BACKLOG' })}
                data-testid="backlog-open-btn"
              >
                <kbd>L</kbd> 对话回看 ({backlogCount})
              </button>

              <button
                type="button"
                className="p5-pill-btn is-accent"
                onClick={() =>
                  dispatch({
                    type: 'TOGGLE_SYSTEM_MENU',
                    open: !state.systemMenuOpen,
                  })
                }
                data-testid="system-menu-btn"
              >
                <kbd>ESC</kbd> 设置
              </button>

              <button
                type="button"
                className="p5-skip-sr-btn"
                onClick={() =>
                  dispatch({
                    type: 'SET_FAST_FORWARD',
                    fast: !state.fastForward,
                  })
                }
                data-testid="fast-forward-btn"
                tabIndex={-1}
              >
                快进
              </button>

              <button
                type="button"
                className="p5-skip-sr-btn"
                onClick={() => dispatch({ type: 'TOGGLE_ENGINEERING_VIEW' })}
                data-testid="engineering-view-btn"
                tabIndex={-1}
              >
                工程视图
              </button>
            </div>
          </header>

          {/* ── 2. AUTHENTIC P5 JAGGED TRAPEZOID DIALOGUE BOX (复刻 P5 原作锯齿闪电尾 + 反色字名牌 + 右下大白三角游标) ── */}
          <section className="p5-dialogue-section" data-testid="dialogue-layer">
            <div className="p5-dialogue-top-row">
              <div className="p5-user-mission-bar">
                <strong>当前指令 //</strong>
                <span className="p5-mission-text">
                  {latestUserMsg && latestUserMsg.type === 'user_message'
                    ? latestUserMsg.text
                    : `等待${uiCopy.userTitle}下达第一条任务指令……`}
                </span>
                {state.lastTurnOk !== null && !state.turnActive && (
                  <>
                    <span
                      className="p5-mission-done-stamp"
                      data-testid="turn-done-badge"
                    >
                      {state.lastTurnOk ? '✓ 已完成' : '■ 已中止'}
                    </span>
                    {state.lastTurnOk && (
                      <button
                        type="button"
                        className="p5-replay-allout-btn"
                        data-testid="replay-allout-btn"
                        onClick={handleReplayAllOutFinish}
                        title="重播本轮总攻击任务结算演出"
                      >
                        ✦ 战果演出
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="p5-comic-bubble-wrap">
              {/* P5 tilted white nameplate with smart word/CJK tokenizer & inverted 2nd token */}
              <div className="p5-speaker-sticker">
                <span
                  className="p5-speaker-chars"
                  data-testid="dialogue-speaker-name"
                >
                  {tokenizeSpeakerName(dialogueCharacter.name).map(
                    (token, idx) =>
                      idx === 1 ? (
                        <span key={idx} className="p5-speaker-char-invert">
                          {token}
                        </span>
                      ) : (
                        <span key={idx} className="p5-speaker-char-normal">
                          {token}
                        </span>
                      )
                  )}
                </span>
                <span
                  className="p5-speaker-codename-sr"
                  data-testid="dialogue-speaker-codename"
                >
                  {dialogueCharacter.codename}
                </span>
                {state.currentLine?.source && (
                  <span
                    className="p5-speaker-source-sr"
                    data-testid="dialogue-line-source"
                  >
                    {state.currentLine.source}
                  </span>
                )}
              </div>

              {(() => {
                const boxW = Math.max(260, dlgSize.w);
                const boxH = Math.max(130, dlgSize.h);
                // Constant pixel slant so top/bottom borders NEVER cut through text when box grows tall
                const polyPts = `8,22 ${boxW - 8},8 ${boxW - 28},${boxH - 12} 16,${boxH - 8}`;

                // Right slanted scrollbar geometry — strictly parallel to right border (boxW-8,8) -> (boxW-28,boxH-12)
                const trackX1 = boxW - 20;
                const trackY1 = 24;
                const trackX2 = boxW - 37;
                const trackY2 = Math.max(trackY1 + 36, boxH - 26);
                const lerpX = (t: number) => trackX1 + (trackX2 - trackX1) * t;
                const lerpY = (t: number) => trackY1 + (trackY2 - trackY1) * t;

                const t0 = dlgScroll.ratio * (1 - dlgScroll.thumbFrac);
                const t1 = Math.min(1, t0 + dlgScroll.thumbFrac);
                const trackPts = `${trackX1 - 3.5},${trackY1 + 0.5} ${trackX1 + 3.5},${trackY1 - 0.5} ${trackX2 + 3.5},${trackY2 - 0.5} ${trackX2 - 3.5},${trackY2 + 0.5}`;
                const thumbPts = `${lerpX(t0) - 4.5},${lerpY(t0) + 0.6} ${lerpX(t0) + 4.5},${lerpY(t0) - 0.6} ${lerpX(t1) + 4.5},${lerpY(t1) - 0.6} ${lerpX(t1) - 4.5},${lerpY(t1) + 0.6}`;

                return (
                  <div
                    ref={dialogueBoxRef}
                    className={`p5-dialogue-box${dlgScroll.canScroll ? ' is-scrollable' : ''}`}
                    onClick={skipTypewriter}
                    data-testid="dialogue-box"
                    role="region"
                    aria-label="角色当前台词"
                    title="点击对话框或按 Space 立即显示整句"
                  >
                    {/* Main slanted quadrilateral box (1:1 pixel coordinates, constant top/bottom bevel) */}
                    <svg
                      className="p5-dialogue-svg-bg"
                      viewBox={`0 0 ${boxW} ${boxH}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polygon
                        points={polyPts}
                        fill="#07070c"
                        stroke="#07070c"
                        strokeWidth="14"
                        strokeLinejoin="miter"
                      />
                      <polygon
                        points={polyPts}
                        fill="#09090f"
                        stroke="#ffffff"
                        strokeWidth="5.5"
                        strokeLinejoin="miter"
                      />
                    </svg>

                    {/* Fixed-aspect cross-column P5 single-Z lightning tail piercing into left character frame */}
                    <svg
                      className="p5-dialogue-tail-svg"
                      viewBox="0 0 180 84"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polygon
                        points="180,12 82,34 106,18 4,52 108,42 84,60 180,66"
                        fill="#09090f"
                      />
                      <polyline
                        points="170,13 82,34 106,18 4,52 108,42 84,60 170,65"
                        fill="none"
                        stroke="#07070c"
                        strokeWidth="13"
                        strokeLinejoin="miter"
                        strokeMiterlimit="10"
                        vectorEffect="non-scaling-stroke"
                      />
                      <polyline
                        points="172,13 82,34 106,18 4,52 108,42 84,60 172,65"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="5.5"
                        strokeLinejoin="miter"
                        strokeMiterlimit="10"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>

                    <div
                      key={fadeReplaceKey}
                      ref={dialogueTextRef}
                      onScroll={syncDialogueScroll}
                      className={`p5-dialogue-text ${
                        isLongDialogue ? 'is-long-text' : ''
                      } ${
                        fadeReplaceKey > 0 ? 'p5-dialogue-text--fade-replace' : ''
                      }`}
                      data-testid="dialogue-line-text"
                    >
                      <span className="p5-dialogue-right-slope-spacer" aria-hidden="true" />
                      {isTypingLine
                        ? stripTypingMarkdown(displayedText)
                        : renderFormattedText(displayedText)}
                    </div>

                    {/* Slanted P5 Scrollbar running strictly along the rightmost diagonal edge */}
                    {dlgScroll.canScroll && (
                      <svg
                        className="p5-dialogue-slant-scrollbar"
                        viewBox={`0 0 ${boxW} ${boxH}`}
                        preserveAspectRatio="none"
                        data-testid="dialogue-slant-scrollbar"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Clickable wider hit area + visible slanted track */}
                        <polygon
                          points={`${trackX1 - 10},${trackY1} ${trackX1 + 10},${trackY1} ${trackX2 + 10},${trackY2} ${trackX2 - 10},${trackY2}`}
                          fill="transparent"
                          style={{ cursor: 'pointer', pointerEvents: 'all' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const el = dialogueTextRef.current;
                            const box = dialogueBoxRef.current;
                            if (!el || !box) return;
                            const rect = box.getBoundingClientRect();
                            const clickY = e.clientY - rect.top;
                            const frac = Math.min(
                              1,
                              Math.max(0, (clickY - trackY1) / Math.max(1, trackY2 - trackY1))
                            );
                            el.scrollTop = frac * (el.scrollHeight - el.clientHeight);
                            syncDialogueScroll();
                          }}
                        />
                        <polygon
                          points={trackPts}
                          fill="rgba(255, 255, 255, 0.12)"
                          stroke="rgba(255, 255, 255, 0.28)"
                          strokeWidth="1"
                          style={{ pointerEvents: 'none' }}
                        />
                        {/* Draggable crimson-white slanted P5 thumb */}
                        <polygon
                          points={thumbPts}
                          fill="#e60012"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          className="p5-dialogue-slant-thumb"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const el = dialogueTextRef.current;
                            if (!el) return;
                            e.currentTarget.setPointerCapture(e.pointerId);
                            scrollDragRef.current = {
                              startY: e.clientY,
                              startScrollTop: el.scrollTop,
                            };
                          }}
                          onPointerMove={(e) => {
                            const drag = scrollDragRef.current;
                            const el = dialogueTextRef.current;
                            if (!drag || !el) return;
                            const usableTrack = Math.max(
                              1,
                              (trackY2 - trackY1) * (1 - dlgScroll.thumbFrac)
                            );
                            const dy = e.clientY - drag.startY;
                            const maxScroll = el.scrollHeight - el.clientHeight;
                            el.scrollTop = Math.min(
                              maxScroll,
                              Math.max(0, drag.startScrollTop + (dy / usableTrack) * maxScroll)
                            );
                            syncDialogueScroll();
                          }}
                          onPointerUp={(e) => {
                            if (scrollDragRef.current) {
                              scrollDragRef.current = null;
                              try {
                                e.currentTarget.releasePointerCapture(e.pointerId);
                              } catch {
                                // ignore
                              }
                            }
                          }}
                        />
                      </svg>
                    )}

                    {/* Authentic P5 giant tilted white wedge cursor on bottom-right */}
                    <span
                      className={`p5-dialogue-cursor p5-cursor-wedge ${
                        isTypingLine ? 'is-typing' : 'is-ready'
                      } ${dlgScroll.canScroll ? 'is-compact-corner' : ''}`}
                      aria-hidden="true"
                    />

                    <button
                      type="button"
                      className="p5-skip-sr-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        skipTypewriter();
                      }}
                      data-testid="skip-line-btn"
                      tabIndex={-1}
                    >
                      跳过打字
                    </button>
                  </div>
                );
              })()}
            </div>
          </section>

          {/* ── 3. DSH TRAJECTORY ROUTE MAP (仅在有工具调用、报错或引导时显示，待机时不显示冗余占位框) ── */}
          <section className="p5-action-section" data-testid="action-layer">
            {state.skillCards.length > 0 && (
              <div className="p5-deck-header">
                <div className="p5-deck-title-group">
                  <span
                    className="p5-deck-slash-badge"
                    data-testid="summary-splash-count"
                  >
                    ACTION LOG // 本轮行动 ({state.skillCards.length})
                  </span>
                  {touchedFiles.length > 0 && (
                    <span
                      className="p5-deck-summary-text"
                      data-testid="summary-files-touched"
                    >
                      涉及{' '}
                      <strong>
                        {touchedFiles.map((f) => f.split('/').pop()).join(', ')}
                      </strong>
                      {(totalDiffStats.added > 0 ||
                        totalDiffStats.removed > 0) && (
                        <>
                          {' · '}
                          <span className="diff-add">
                            +{totalDiffStats.added}
                          </span>{' '}
                          /{' '}
                          <span className="diff-del">
                            −{totalDiffStats.removed}
                          </span>
                        </>
                      )}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="p5-mini-chip p5-mini-chip--btn"
                  onClick={() => {
                    const last =
                      state.skillCards[state.skillCards.length - 1];
                    if (last) {
                      dispatch({
                        type: 'SELECT_SKILL_CARD',
                        toolUseId: last.toolUseId,
                      });
                    }
                  }}
                >
                  展开完整档案 ▶
                </button>
              </div>
            )}

            <div
              className="p5-active-skills-zone"
              data-testid="action-log-strip"
            >
              {/* Friendly Error Notice Banner */}
              {state.lastError && !needsOnboarding && (
                <div
                  className="p5-error-notice-card"
                  data-testid="stage-error-banner"
                >
                  <div className="p5-error-notice-left">
                    <span className="p5-error-notice-tag">
                      NOTICE // 运行提示
                    </span>
                    <span className="p5-error-notice-msg">
                      {state.lastError.message}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="p5-error-dismiss-btn"
                    onClick={() => dispatch({ type: 'DISMISS_ERROR' })}
                  >
                    知道了
                  </button>
                </div>
              )}

              {/* DSH Memory Compaction Summary Card in Trajectory */}
              {compactionState.compactedAt && (
                <div
                  className="p5-compaction-summary-node"
                  data-testid="compaction-summary-card"
                >
                  <span className="p5-compaction-node-badge">
                    ✦ MEMORY DISTILLED // 记忆摘要卡
                  </span>
                  <span className="p5-compaction-node-text">
                    {compactionState.summaryText}
                  </span>
                  <span className="p5-compaction-node-freed">
                    {compactionState.freedTokens > 0 ? `−${Math.round(compactionState.freedTokens / 1000)}k Tokens` : '引擎未提供节省数量'}
                  </span>
                </div>
              )}

              {needsOnboarding ? (
                <OnboardingCard
                  character={character}
                  settings={state.serverSettings}
                  workerAdapters={state.workerAdapters}
                  lastError={state.lastError}
                  onStartWithDir={handleStartNewSessionWithDir}
                  onOpenSystemMenu={(tab) =>
                    dispatch({
                      type: 'TOGGLE_SYSTEM_MENU',
                      open: true,
                      tab: tab ?? 'pond',
                    })
                  }
                  onDismissError={() => dispatch({ type: 'DISMISS_ERROR' })}
                />
              ) : state.skillCards.length > 0 ? (
                <div
                  className="p5-action-list p5-trajectory-route"
                  data-testid="turn-summary-card"
                >
                  {state.skillCards.map((card, index) => {
                    const isPreviewOpen = inlinePreviewId === card.toolUseId;
                    const inlineDiffRows = isPreviewOpen
                      ? extractInlineDiffLines(card.diff)
                      : [];
                    const stepDurationMs =
                      card.endedAt && card.startedAt
                        ? Math.max(120, card.endedAt - card.startedAt)
                        : null;
                    return (
                      <React.Fragment key={card.toolUseId}>
                        <div
                          className={`p5-action-row status-${card.status} tool-${card.tool} ${
                            isPreviewOpen ||
                            state.selectedToolUseId === card.toolUseId
                              ? 'is-expanded'
                              : ''
                          }`}
                          onClick={() =>
                            dispatch({
                              type: 'SELECT_SKILL_CARD',
                              toolUseId: card.toolUseId,
                            })
                          }
                          data-testid={`action-log-item-${index}`}
                        >
                          <div className="p5-step-badge-group">
                            <span className="p5-step-num">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span
                              className={`p5-tool-tag tool-${card.tool}`}
                              data-testid={`active-skill-card-${card.toolUseId}`}
                            >
                              {TOOL_DISPLAY_LABELS[card.tool] ??
                                card.tool.toUpperCase()}
                            </span>
                          </div>

                          <div className="p5-action-target">
                            <strong>{card.file ?? card.summary}</strong>
                            <span>
                              {card.endSummary ??
                                `${card.rawName} · ${card.summary}`}
                            </span>
                          </div>

                          <span className="p5-action-stat">
                            {card.diffStats ? (
                              <>
                                <span className="add">
                                  +{card.diffStats.added}
                                </span>{' '}
                                <span className="del">
                                  −{card.diffStats.removed}
                                </span>
                              </>
                            ) : (
                              card.rawName
                            )}
                            {stepDurationMs && (
                              <em className="p5-step-ms">
                                {' '}
                                · {stepDurationMs}ms
                              </em>
                            )}
                          </span>

                          <span
                            className={`p5-action-status status-${card.status}`}
                          >
                            {card.status === 'running'
                              ? '▶ 执行中'
                              : card.status === 'success'
                              ? card.diff
                                ? '▼ Diff 预览'
                                : '✓ 完成'
                              : '✖ 失败'}
                          </span>
                        </div>

                        {inlineDiffRows.length > 0 && (
                          <div
                            className="p5-inline-diff-box"
                            onClick={() =>
                              dispatch({
                                type: 'SELECT_SKILL_CARD',
                                toolUseId: card.toolUseId,
                              })
                            }
                            title="点击打开完整代码对比档案"
                          >
                            {inlineDiffRows.map((row, rIdx) => (
                              <div
                                key={rIdx}
                                className={
                                  row.kind === 'add'
                                    ? 'p5-diff-line-add'
                                    : 'p5-diff-line-del'
                                }
                              >
                                {row.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Worker Answer Body Card in Trajectory (only when distinct from current dialogue bubble) */}
                  {shouldShowConclusionCard && conclusionCandidate && (
                    <div
                      className="p5-worker-answer-card"
                      data-testid="trajectory-answer-card"
                    >
                      <div className="p5-worker-answer-head">
                        <span className="p5-worker-answer-badge">
                          ★ CONCLUSION // {shortNickname}的行动结论正文
                        </span>
                        <span className="p5-worker-answer-meta">
                          耗时 {turnDurationSec}s · 模型 {state.modelName}
                        </span>
                      </div>
                      <div className="p5-worker-answer-body">
                        {renderFormattedText(conclusionCandidate)}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Steer (插话) Live Status Pills */}
              {state.steers.length > 0 && (
                <div className="p5-steer-strip" data-testid="steer-strip">
                  {state.steers.map((st) => (
                    <div
                      key={st.id}
                      className={`p5-steer-pill steer-${st.status}`}
                      data-testid={`steer-item-${st.status}`}
                    >
                      <span
                        className="p5-steer-status-badge"
                        data-testid="steer-status-badge"
                      >
                        {st.status === 'queued' ? '已传达，待接收' : '已接收'}
                      </span>
                      <span className="p5-steer-text">
                        场外插话：「{st.text}」
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── 4. SLEEK SLANTED COMMAND INPUT BAR (工作区移至右下角投喂按钮上方) ── */}
          <section className="p5-command-dock" data-testid="player-input-zone">
            <div className="p5-dock-quick-chips">
              <div className="p5-chip-group">
                {needsOnboarding ? (
                  <span
                    className="p5-input-onboarding-hint"
                    data-testid="stage-input-disabled-hint"
                  >
                    ▲ 请先在上方引导卡选定项目文件夹后再投喂任务
                  </span>
                ) : state.turnActive ? (
                  <>
                    {sourceMode === 'demo' && (
                      <button
                        type="button"
                        className="p5-mini-chip p5-mini-chip--btn is-steer"
                        data-testid="quick-steer-btn"
                        onClick={() => {
                          sourceRef.current?.steer(
                            '顺便检查一下深色模式下的按钮边框对比度！'
                          );
                        }}
                      >
                        ⚡ 一键插话 (Steer)
                      </button>
                    )}
                    <button
                      type="button"
                      className="p5-mini-chip p5-mini-chip--btn is-stop"
                      data-testid="stop-turn-btn"
                      onClick={() => sourceRef.current?.stop()}
                    >
                      ■ 喊停 (STOP)
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="p5-mini-chip p5-mini-chip--btn is-baton"
                    data-testid="baton-pass-btn"
                    disabled={!canBatonPass}
                    onClick={() => setBatonModalOpen(true)}
                    title={
                      canBatonPass
                        ? '将当前会话摘要与代码改动交接给另一位角色接力推进'
                        : '先完成至少一轮对话或修改后即可发起角色换手接力'
                    }
                  >
                    ⚡ 换手接力
                  </button>
                )}
              </div>
            </div>
            {!needsOnboarding && !state.turnActive && (
              <button
                type="button"
                className="p5-skip-sr-btn"
                data-testid="example-instruction-btn"
                onClick={() => setInputValue(DEFAULT_FIRST_USER_PROMPT)}
                tabIndex={-1}
              >
                填入示例任务指令
              </button>
            )}

            {(pendingImages.length > 0 || imageError) && (
              <div className="p5-image-tray" data-testid="stage-image-tray">
                {pendingImages.map((img, i) => (
                  <div className="p5-image-thumb" key={`${i}-${img.name ?? ''}`}>
                    <img src={img.previewUrl} alt={img.name ?? `图片 ${i + 1}`} />
                    <button
                      type="button"
                      className="p5-image-thumb-x"
                      title="移除"
                      onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {imageError && <span className="p5-image-error">{imageError}</span>}
              </div>
            )}
            <form
              className="p5-input-bar-slash"
              onSubmit={handleSubmitInput}
              onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
              }}
              onDrop={(e) => {
                if (e.dataTransfer.files.length === 0) return;
                e.preventDefault();
                if (!imagesAllowed) {
                  setImageError(IMAGE_BLOCKED_MSG);
                  return;
                }
                addImageFiles(e.dataTransfer.files);
              }}
            >
              <div className="p5-input-field-box">
                <button
                  type="button"
                  className="p5-attach-btn"
                  data-testid="stage-attach-btn"
                  title={imagesAllowed ? '附加图片（也可以直接粘贴或拖入）' : IMAGE_BLOCKED_MSG}
                  disabled={needsOnboarding || !imagesAllowed}
                  onClick={() => imagePickerRef.current?.click()}
                >
                  📎
                </button>
                <input
                  ref={imagePickerRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) addImageFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={inputRef}
                  type="text"
                  className="p5-command-input"
                  data-testid="stage-input"
                  disabled={needsOnboarding}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
                    if (files.length === 0) return;
                    e.preventDefault();
                    if (!imagesAllowed) {
                      setImageError(IMAGE_BLOCKED_MSG);
                      return;
                    }
                    addImageFiles(files);
                  }}
                  placeholder={
                    needsOnboarding
                      ? '请先在上方「首次启动引导」卡片中选定项目文件夹并点击「开始」...'
                      : state.turnActive
                      ? '任务进行中：输入消息并回车立即插话补充要求…'
                      : `向${shortNickname}下达新任务，或在执行中直接插话补充要求…`
                  }
                />
              </div>
              <button
                type="submit"
                className="p5-send-slash-btn"
                data-testid="stage-send-btn"
                disabled={
                  needsOnboarding ||
                  (sourceMode !== 'demo' && !inputValue.trim() && pendingImages.length === 0)
                }
              >
                {state.turnActive ? '插话 ▶' : '投喂 ▶'}
              </button>
            </form>
          </section>
        </main>
      </div>

      <SwitchTransition
        characterId={character.id}
        characterSwitchKey={state.characterSwitchKey}
        name={character.name}
        codename={character.codename}
        tagline={character.tagline}
        themeColor={character.themeColor}
        accentColor={character.accentColor}
        portraitUrl={
          state.characters.find((c) => c.id === character.id)?.portraitUrl
        }
      />

      {/* ── P5 SUB-NAVIGATOR DIAMOND RADAR CAMEO (右上角菱形雷达支援窗，绝不遮挡弹窗) ── */}
      <NavigatorCutin data={naviCutinData} onDismiss={dismissNaviCutin} />

      {/* ── P5 BATON PASS LIGHTNING RELAY CUT-IN (1.4s 击掌换手接力大演出) ── */}
      <BatonPassCutin data={batonCutinData} onDismiss={dismissBatonCutin} />

      {/* ── P5 ALL-OUT FINISH OVERLAY (2.4s 总攻击华丽收工结算大演出) ── */}
      <AllOutFinishOverlay
        data={allOutFinishData}
        onDismiss={dismissAllOutFinish}
      />

      {/* ── DSH MEMORY COMPACTION CUT-IN EFFECT (记忆凝炼专属技能演出) ── */}
      {compactionState.activeCutin && (
        <div
          className="p5-compaction-cutin"
          data-testid="compaction-cutin-banner"
          onClick={() =>
            setCompactionState((prev) => ({ ...prev, activeCutin: false }))
          }
        >
          <div className="p5-compaction-blade">
            <div className="p5-compaction-kicker">
              ✦ MEMORY DISTILLATION // 记忆凝炼技能发动！
            </div>
            <div className="p5-compaction-headline">
              {compactionState.summaryText}
            </div>
            <div className="p5-compaction-sub">
              {compactionState.freedTokens > 0 ? `上下文整理完成 · 释放约 ${Math.round(compactionState.freedTokens / 1000)}k Tokens` : '上下文整理完成 · 未提供精确用量，历史回看已保留'}
            </div>
          </div>
        </div>
      )}

      {/* ── OVERLAYS: 权限选择肢 / 档案层 / BACKLOG / SYSTEM 菜单 / 快捷键帮助 ── */}
      <PermissionModal
        permission={state.pendingPermission}
        selectedChoice={state.permissionChoice}
        characterId={character.id}
        characterName={shortNickname}
        portraitUrl={
          state.characters.find((c) => c.id === character.id)?.portraitUrl
        }
        onSelectChoice={(choice) =>
          dispatch({ type: 'SET_PERMISSION_CHOICE', choice })
        }
        onConfirm={handleConfirmPermission}
      />

      <BatonPassModal
        open={batonModalOpen}
        activeCharacterId={character.id}
        characters={state.characters}
        settings={state.serverSettings}
        onClose={() => setBatonModalOpen(false)}
        onConfirm={handleConfirmBatonPass}
      />

      <ArchiveModal
        card={selectedCard}
        gitDrawerOpen={state.gitDrawerOpen}
        gitStatus={state.gitStatus}
        gitOpNotice={state.gitOpNotice}
        characterName={shortNickname}
        onClose={() => {
          dispatch({ type: 'SELECT_SKILL_CARD', toolUseId: null });
          dispatch({ type: 'TOGGLE_GIT_DRAWER', open: false });
        }}
        onRequestGitStatus={handleRequestGitStatus}
        onRevertGitFile={handleRevertGitFile}
        onCommitGit={handleCommitGit}
      />

      <BacklogModal
        open={state.backlogOpen}
        events={state.events}
        skillCards={state.skillCards}
        characterName={shortNickname}
        onClose={() => dispatch({ type: 'TOGGLE_BACKLOG', open: false })}
        onInspectSkill={(toolUseId) =>
          dispatch({ type: 'SELECT_SKILL_CARD', toolUseId })
        }
      />

      <SystemMenuModal
        embeddedInDsh={embeddedInDsh}
        onPickDirectory={embeddedInDsh ? () => sourceRef.current?.pickDirectory?.() ?? Promise.reject(new Error('请直接填写文件夹路径')) : undefined}
        open={state.systemMenuOpen}
        activeTab={state.systemMenuTab}
        settings={state.serverSettings}
        settingsSyncedAt={state.settingsSyncedAt}
        currentSessionId={state.sessionInfo?.sessionId ?? state.sessionId}
        characters={state.characters}
        workerAdapters={state.workerAdapters}
        workerModels={state.workerModels}
        voiceModels={state.voiceModels}
        workerConnTest={state.workerConnTest}
        voiceConnTest={state.voiceConnTest}
        onSelectTab={(tab: SystemMenuTab) =>
          dispatch({ type: 'SET_SYSTEM_TAB', tab })
        }
        onClose={() => dispatch({ type: 'TOGGLE_SYSTEM_MENU', open: false })}
        onSwitchCharacter={handleSwitchCharacter}
        onUpdateSettings={handleUpdateSettings}
        onListModels={handleListModels}
        onTestConnection={handleTestConnection}
        onStartNewSessionWithDir={handleStartNewSessionWithDir}
      />

      <ShortcutHelp
        archiveAvailable={state.skillCards.length > 0}
        onOpenArchive={() => {
          const last = state.skillCards[state.skillCards.length - 1];
          if (last) {
            dispatch({
              type: 'SELECT_SKILL_CARD',
              toolUseId: last.toolUseId,
            });
          }
        }}
      />
    </div>
  );
};
