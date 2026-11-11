import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCachedCharacterPack,
  preloadCharacterPacks,
  resolveCharacterAssetUrl,
  subscribeCharacterPacks,
} from '../../../../src/stage/characterLoader';
import { playSfx } from '../../../../src/stage/sfx';
import {
  getActiveStageSessionId,
  getStoredCharacterId,
  notifyActiveStageSessionId,
  subscribeActiveStageSession,
  subscribeStoredCharacterId,
} from './DshStageSource';

interface P5PolyBoxProps {
  points: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  shadow?: string;
  accentSlashColor?: string;
  cornerCutWhite?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * Renders an authentic Persona-5 irregular quadrilateral frame using a
 * non-scaling SVG polygon so angled edges never clip or blur at any aspect ratio.
 */
const P5PolyBox: React.FC<P5PolyBoxProps> = ({
  points,
  fill,
  stroke = '#ffffff',
  strokeWidth = 2,
  shadow = '4px 4px 0 #000000',
  accentSlashColor,
  cornerCutWhite = false,
  className,
  style,
  children,
}) => {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        filter: shadow ? `drop-shadow(${shadow})` : undefined,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <polygon
          points={points}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
        />
        {accentSlashColor && (
          <polygon points="0,4 5.5,2 4,98 0,96" fill={accentSlashColor} />
        )}
        {cornerCutWhite && (
          <polygon points="88,93 98,74 96.8,93.5" fill="#ffffff" opacity="0.92" />
        )}
      </svg>
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  );
};

function formatRelativeTime(updatedAt?: number | string): string {
  if (!updatedAt) return '';
  const ts = typeof updatedAt === 'number' ? updatedAt : Date.parse(String(updatedAt));
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}天`;
  return `${Math.floor(diffDay / 30)}月`;
}

export function createP5SidebarComponents(ctx: any) {
  const P5HeaderLeadingToggle: React.FC<any> = () => {
    return (
      <button
        type="button"
        onClick={() => {
          playSfx('select');
          ctx.layout?.toggleSidebar?.();
        }}
        onMouseEnter={() => playSfx('hover')}
        title="展开潜入档案栏"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <P5PolyBox
          points="8,8 100,0 92,94 0,100"
          fill="#e60012"
          stroke="#ffffff"
          strokeWidth={2}
          shadow="3px 3px 0 #000000"
          style={{ padding: '4px 11px' }}
        >
          <span
            style={{
              color: '#ffffff',
              fontFamily: '"Noto Sans SC", Anton, sans-serif',
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: '0.06em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ▶ 档案
          </span>
        </P5PolyBox>
      </button>
    );
  };

  const P5PhantomSidebar: React.FC<any> = (props) => {
    const collapsed = Boolean(props?.collapsed);
    const renderSlot = props?.renderSlot;

    const [, setTick] = useState(0);
    const [charId, setCharId] = useState<string>(getStoredCharacterId);
    const [activeStageId, setActiveStageId] = useState<string | null>(getActiveStageSessionId);
    const [query, setQuery] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [expandedAllInGroup, setExpandedAllInGroup] = useState<Record<string, boolean>>({});
    const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
    const hiddenSettingsRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      void preloadCharacterPacks();
      const disposers: Array<() => void> = [];
      disposers.push(subscribeCharacterPacks(() => setTick((v) => v + 1)));
      disposers.push(subscribeStoredCharacterId((id) => setCharId(id)));
      disposers.push(subscribeActiveStageSession((id) => setActiveStageId(id)));
      if (ctx.sessions?.list?.subscribe) {
        disposers.push(ctx.sessions.list.subscribe(() => setTick((v) => v + 1)));
      }
      if (ctx.workspaces?.list?.subscribe) {
        disposers.push(ctx.workspaces.list.subscribe(() => setTick((v) => v + 1)));
      }
      if (ctx.layout?.panelInfo?.subscribe) {
        disposers.push(ctx.layout.panelInfo.subscribe(() => setTick((v) => v + 1)));
      }
      return () => {
        for (const d of disposers) d();
      };
    }, []);

    const activePack = getCachedCharacterPack(charId);
    const portraitUrl =
      resolveCharacterAssetUrl(activePack.id, activePack.art.portrait) ||
      '/characters/deepseek-v4-pro/art/portrait.png';

    const sessionsSnap = ctx.sessions?.list?.getSnapshot?.() ?? { ids: [], byId: {} };
    const workspacesSnap = ctx.workspaces?.list?.getSnapshot?.() ?? {
      items: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    };

    const archivedSet = useMemo(
      () => new Set<string>(workspacesSnap.archivedSessionIds ?? []),
      [workspacesSnap.archivedSessionIds]
    );
    const pinnedSet = useMemo(
      () => new Set<string>(workspacesSnap.pinnedSessionIds ?? []),
      [workspacesSnap.pinnedSessionIds]
    );

    // Resolve current selected session across Stage or Trajectory
    const selectedSessionId = useMemo(() => {
      if (activeStageId && sessionsSnap.byId?.[activeStageId]) {
        return activeStageId;
      }
      for (const id of sessionsSnap.ids ?? []) {
        const row = sessionsSnap.byId?.[id];
        if (row?.retainedBy && Object.keys(row.retainedBy).length > 0) {
          return id;
        }
      }
      return activeStageId;
    }, [activeStageId, sessionsSnap]);

    // Group sessions into Workspaces + Ungrouped
    const groups = useMemo(() => {
      const needle = query.trim().toLowerCase();
      const claimed = new Set<string>();
      const out: Array<{
        id: string;
        title: string;
        path?: string;
        workspaceId?: string;
        sessions: any[];
      }> = [];

      for (const ws of workspacesSnap.items ?? []) {
        const wsSessions: any[] = [];
        let blankAdded = false;
        for (const sid of ws.sessionIds ?? []) {
          claimed.add(sid);
          if (archivedSet.has(sid)) continue;
          const s = sessionsSnap.byId?.[sid];
          if (!s || s.origin === 'subagent') continue;
          if (s.blank) {
            // Only show the blank session if it is currently selected, and at most one
            if (sid !== selectedSessionId || blankAdded) continue;
            blankAdded = true;
          }
          const label = String(s.displayTitle || s.title || (s.blank ? '新潜入行动' : sid));
          if (needle && !label.toLowerCase().includes(needle) && !String(ws.title).toLowerCase().includes(needle)) {
            continue;
          }
          wsSessions.push({ ...s, _label: s.blank ? '新潜入行动 · 待命' : label });
        }
        out.push({
          id: ws.workspaceId,
          workspaceId: ws.workspaceId,
          title: ws.title === 'default-workspace' ? '默认工作区' : ws.title || '工作区',
          path: ws.path,
          sessions: wsSessions,
        });
      }

      const ungrouped: any[] = [];
      for (const sid of sessionsSnap.ids ?? []) {
        if (claimed.has(sid) || archivedSet.has(sid)) continue;
        const s = sessionsSnap.byId?.[sid];
        if (!s || s.origin === 'subagent') continue;
        if (s.blank && sid !== selectedSessionId) continue;
        const label = String(s.displayTitle || s.title || (s.blank ? '新潜入行动 · 待命' : sid));
        if (needle && !label.toLowerCase().includes(needle)) continue;
        ungrouped.push({ ...s, _label: label });
      }
      if (ungrouped.length > 0) {
        out.push({
          id: '__ungrouped__',
          title: '独立潜入记录',
          sessions: ungrouped,
        });
      }
      return out;
    }, [workspacesSnap, sessionsSnap, archivedSet, selectedSessionId, query]);

    const currentWorkspaceId = useMemo(() => {
      if (selectedSessionId) {
        const found = (workspacesSnap.items ?? []).find((ws: any) =>
          (ws.sessionIds ?? []).includes(selectedSessionId)
        );
        if (found) return found.workspaceId;
      }
      return workspacesSnap.items?.[0]?.workspaceId;
    }, [workspacesSnap, selectedSessionId]);

    const handleNewSession = (wsId?: string) => {
      playSfx('send');
      ctx.layout?.selectPanel?.(null);
      if (ctx.uiWorkspace?.startSession) {
        ctx.uiWorkspace.startSession(wsId ?? currentWorkspaceId);
      }
    };

    const handleSelectSession = (sid: string) => {
      playSfx('select');
      ctx.layout?.selectPanel?.(null);
      notifyActiveStageSessionId(sid);
      ctx.uiWorkspace?.openSession?.(sid);
    };

    const handlePickWorkspaceFolder = async () => {
      playSfx('select');
      try {
        const picked = await ctx.uiWorkspace?.pickDirectory?.();
        if (!picked) return;
        const ws = await ctx.workspaces?.create?.({ path: picked });
        if (ws?.workspaceId) {
          await ctx.uiWorkspace?.openWorkspace?.(ws.workspaceId);
        }
      } catch {
        // ignore cancelled picker
      }
    };

    const handleArchiveSession = (e: React.MouseEvent, sid: string) => {
      e.stopPropagation();
      playSfx('deny');
      void ctx.uiWorkspace?.archiveSession?.(sid, { stopActivity: true });
    };

    const handleOpenDshEngineSettings = () => {
      playSfx('select');
      window.dispatchEvent(
        new CustomEvent('bigfish:open-system-menu', {
          detail: { tab: 'presets' },
        })
      );
    };

    if (collapsed) {
      return (
        <aside
          className="p5-phantom-sidebar is-collapsed"
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            backgroundColor: '#07080e',
            borderRight: '2px solid #e60012',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 6px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => {
                playSfx('select');
                ctx.layout?.toggleSidebar?.();
              }}
              title="展开潜入档案栏"
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <P5PolyBox
                points="10,0 100,10 90,100 0,90"
                fill="#e60012"
                stroke="#ffffff"
                strokeWidth={2}
                shadow="3px 3px 0 #000000"
                style={{ width: 36, height: 36, display: 'grid', placeItems: 'center' }}
              >
                <span style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>▶</span>
              </P5PolyBox>
            </button>

            <button
              type="button"
              onClick={() => handleNewSession()}
              title="新建潜入行动"
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <P5PolyBox
                points="0,10 92,0 100,90 8,100"
                fill="#141724"
                stroke="#ffffff"
                strokeWidth={1.8}
                shadow="3px 3px 0 #000000"
                style={{ width: 36, height: 36, display: 'grid', placeItems: 'center' }}
              >
                <span style={{ color: '#e60012', fontSize: 18, fontWeight: 900 }}>＋</span>
              </P5PolyBox>
            </button>
          </div>



          <button
            type="button"
            onClick={handleOpenDshEngineSettings}
            title="打开工作台设置"
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <P5PolyBox
              points="10,0 100,10 90,100 0,90"
              fill="#141724"
              stroke="rgba(255,255,255,0.65)"
              strokeWidth={1.5}
              shadow="2px 2px 0 #000000"
              style={{ width: 34, height: 34, display: 'grid', placeItems: 'center' }}
            >
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>⚙</span>
            </P5PolyBox>
          </button>
        </aside>
      );
    }

    let globalCardIdx = 0;

    return (
      <aside
        className="p5-phantom-sidebar"
        data-testid="p5-phantom-sidebar"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#07080e',
          color: '#ffffff',
          overflow: 'hidden',
          userSelect: 'none',
          fontFamily: '"Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        {/* P5 Diagonal Geometric Wedges & Halftone Backdrop */}
        <svg
          viewBox="0 0 280 900"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          <defs>
            <pattern id="p5-sb-dots" width="10" height="10" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.15" fill="rgba(230, 0, 18, 0.28)" />
            </pattern>
            <pattern
              id="p5-sb-stripes"
              width="14"
              height="14"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-42)"
            >
              <rect width="3" height="14" fill="rgba(255, 255, 255, 0.018)" />
            </pattern>
          </defs>
          <rect width="280" height="900" fill="url(#p5-sb-stripes)" />
          <polygon points="0,0 280,0 280,96 0,148" fill="rgba(230, 0, 18, 0.16)" />
          <polygon points="0,0 190,0 95,128 0,128" fill="url(#p5-sb-dots)" />
          <polygon points="90,900 280,795 280,900" fill="rgba(230, 0, 18, 0.14)" />
          <polygon points="140,900 280,820 280,900" fill="url(#p5-sb-dots)" />
          {/* Jagged right comic border */}
          <line x1="278.5" y1="0" x2="278.5" y2="900" stroke="#e60012" strokeWidth="3" />
          <line x1="275" y1="0" x2="275" y2="900" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
        </svg>

        {/* Vertical P5 Watermark */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 6,
            top: 190,
            writingMode: 'vertical-rl',
            fontFamily: 'Anton, Impact, sans-serif',
            fontSize: 42,
            letterSpacing: '0.12em',
            color: 'rgba(230, 0, 18, 0.08)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          PHANTOM LOG
        </div>



        {/* ── 1. TOP HEADER PLAQUE (Irregular Quadrilateral) ── */}
        <div
          className="p5-sb-header-zone"
          style={{
            position: 'relative',
            zIndex: 2,
            padding: '10px 12px 8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            {/* Irregular Quadrilateral Character Emblem */}
            <P5PolyBox
              points="8,0 100,10 92,100 0,90"
              fill={activePack.themeColor || '#e60012'}
              stroke="#ffffff"
              strokeWidth={2}
              shadow="3px 3px 0 #000000"
              style={{ width: 34, height: 34, flexShrink: 0, padding: 2 }}
            >
              <img
                src={portraitUrl}
                alt={activePack.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  clipPath: 'polygon(8% 0%, 100% 10%, 92% 100%, 0% 90%)',
                  display: 'block',
                }}
              />
            </P5PolyBox>

            {/* Two-tone Irregular Title Banner */}
            <P5PolyBox
              points="0,10 98,0 100,88 3,100"
              fill="#090910"
              stroke="#ffffff"
              strokeWidth={2}
              shadow="4px 4px 0 #e60012"
              style={{ padding: '4px 10px 4px 9px', flex: 1, minWidth: 0 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    background: '#e60012',
                    color: '#ffffff',
                    fontFamily: 'Anton, sans-serif',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    padding: '1px 5px',
                    clipPath: 'polygon(6% 0%, 100% 0%, 94% 100%, 0% 100%)',
                    flexShrink: 0,
                  }}
                >
                  LOG
                </span>
                <span
                  style={{
                    fontFamily: '"Noto Sans SC", Anton, sans-serif',
                    fontSize: 13.5,
                    fontWeight: 900,
                    letterSpacing: '0.06em',
                    color: '#ffffff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  潜入行动档案
                </span>
              </div>
            </P5PolyBox>
          </div>

          {/* Irregular Quad Collapse Sidebar Button */}
          <button
            type="button"
            onClick={() => {
              playSfx('select');
              ctx.layout?.toggleSidebar?.();
            }}
            onMouseEnter={() => playSfx('hover')}
            title="收起潜入档案栏"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              flexShrink: 0,
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            <P5PolyBox
              points="12,0 100,10 88,100 0,90"
              fill="#141724"
              stroke="#ffffff"
              strokeWidth={1.8}
              shadow="3px 3px 0 #000000"
              style={{ width: 30, height: 30, display: 'grid', placeItems: 'center' }}
            >
              <span style={{ color: '#ffffff', fontSize: 11, fontWeight: 900 }}>◀</span>
            </P5PolyBox>
          </button>
        </div>

        {/* ── 2. PRIMARY CTA: "+ 新建潜入行动" IRREGULAR QUADRILATERAL ── */}
        <div style={{ position: 'relative', zIndex: 2, padding: '4px 14px 10px 12px' }}>
          <button
            type="button"
            onClick={() => handleNewSession()}
            onMouseEnter={() => playSfx('hover')}
            className="p5-sb-new-btn"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <P5PolyBox
              points="2.5,9 100,0 97,89 0,100"
              fill="#e60012"
              stroke="#ffffff"
              strokeWidth={2.3}
              shadow="5px 5px 0 #000000"
              cornerCutWhite={true}
              style={{ padding: '9px 14px' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 900,
                    letterSpacing: '0.06em',
                    textShadow: '1.5px 1.5px 0 #000000',
                  }}
                >
                  <span
                    style={{
                      background: '#090910',
                      color: '#ffffff',
                      fontFamily: 'Anton, sans-serif',
                      fontSize: 11,
                      padding: '1px 6px',
                      clipPath: 'polygon(10% 0%, 100% 6%, 90% 100%, 0% 94%)',
                    }}
                  >
                    NEW
                  </span>
                  ＋ 新建潜入行动
                </span>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11,
                    fontWeight: 800,
                    color: 'rgba(255,255,255,0.88)',
                  }}
                >
                  ▶
                </span>
              </div>
            </P5PolyBox>
          </button>
        </div>

        {/* ── 3. IRREGULAR QUAD SEARCH BOX + PICK FOLDER BUTTON ── */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            padding: '0 14px 10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <P5PolyBox
            points="0,6 99,0 100,93 1.5,100"
            fill="#0e101a"
            stroke="rgba(255, 255, 255, 0.58)"
            strokeWidth={1.6}
            shadow="3px 3px 0 #000000"
            style={{ flex: 1, minWidth: 0, padding: '5px 10px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#e60012', fontWeight: 900 }}>⌕</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="检索潜入记录…"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </P5PolyBox>

          <button
            type="button"
            onClick={() => void handlePickWorkspaceFolder()}
            onMouseEnter={() => playSfx('hover')}
            title="接入新工作区文件夹"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <P5PolyBox
              points="8,0 100,9 92,100 0,91"
              fill="#151826"
              stroke="#ffffff"
              strokeWidth={1.6}
              shadow="3px 3px 0 #000000"
              style={{ padding: '5px 8px' }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  color: '#ffffff',
                  letterSpacing: '0.03em',
                }}
              >
                📁＋
              </span>
            </P5PolyBox>
          </button>
        </div>

        {/* ── 4. WORKSPACE STICKERS & IRREGULAR QUAD SESSION CARDS ── */}
        <div
          className="p5-sb-scroll"
          style={{
            position: 'relative',
            zIndex: 2,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px 13px 14px 11px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {groups.map((group) => {
            const isGroupCollapsed = Boolean(collapsedGroups[group.id]);
            const showAll = Boolean(expandedAllInGroup[group.id]) || Boolean(query.trim());
            const visibleSessions = showAll ? group.sessions : group.sessions.slice(0, 6);
            const hiddenCount = Math.max(0, group.sessions.length - visibleSessions.length);

            return (
              <div key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Irregular Comic Sticker Workspace Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      playSfx('select');
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.id]: !prev[group.id],
                      }));
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <P5PolyBox
                      points="0,14 97,0 100,86 2.5,100"
                      fill="#131624"
                      stroke="rgba(255, 255, 255, 0.72)"
                      strokeWidth={1.6}
                      shadow="3px 3px 0 #000000"
                      accentSlashColor="#e60012"
                      style={{ padding: '4px 10px 4px 12px' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 12,
                            fontWeight: 900,
                            color: '#f8fafc',
                            letterSpacing: '0.04em',
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ color: '#e60012', fontSize: 10 }}>
                            {isGroupCollapsed ? '▶' : '▼'}
                          </span>
                          <span>{group.title}</span>
                        </span>
                        <span
                          style={{
                            background: '#090910',
                            color: '#f87171',
                            border: '1px solid rgba(230,0,18,0.55)',
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '0 5px',
                            clipPath: 'polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)',
                            flexShrink: 0,
                          }}
                        >
                          {group.sessions.length}
                        </span>
                      </div>
                    </P5PolyBox>
                  </button>

                  {group.workspaceId && (
                    <button
                      type="button"
                      onClick={() => handleNewSession(group.workspaceId)}
                      onMouseEnter={() => playSfx('hover')}
                      title={`在 ${group.title} 新建潜入`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <P5PolyBox
                        points="12,0 100,12 88,100 0,88"
                        fill="#1a0b10"
                        stroke="rgba(230, 0, 18, 0.85)"
                        strokeWidth={1.5}
                        shadow="2px 2px 0 #000000"
                        style={{ width: 24, height: 24, display: 'grid', placeItems: 'center' }}
                      >
                        <span style={{ color: '#ffffff', fontSize: 12, fontWeight: 900 }}>＋</span>
                      </P5PolyBox>
                    </button>
                  )}
                </div>

                {/* Irregular Quadrilateral Session Cards */}
                {!isGroupCollapsed &&
                  visibleSessions.map((s: any) => {
                    const idx = globalCardIdx++;
                    const isSelected = s.id === selectedSessionId;
                    const isHovered = s.id === hoveredSessionId;
                    const isPinned = pinnedSet.has(s.id);
                    // Alternating hand-cut Persona-5 irregular quadrilateral vertices
                    const polyPoints =
                      idx % 2 === 0
                        ? '1.6,7 100,0 98,92 0,100'
                        : '0,0 98.4,8 100,100 1.8,92';

                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectSession(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectSession(s.id);
                          }
                        }}
                        onMouseEnter={() => {
                          setHoveredSessionId(s.id);
                          playSfx('hover');
                        }}
                        onMouseLeave={() => {
                          setHoveredSessionId((prev) => (prev === s.id ? null : prev));
                        }}
                        className="p5-sb-session-card"
                        style={{
                          cursor: 'pointer',
                          paddingLeft: 4,
                          transform: isSelected
                            ? 'translateX(2px)'
                            : isHovered
                            ? 'translateX(3px) translateY(-1px)'
                            : 'none',
                          transition: 'transform 0.12s ease',
                        }}
                      >
                        <P5PolyBox
                          points={polyPoints}
                          fill={
                            isSelected
                              ? '#e60012'
                              : isHovered
                              ? '#220912'
                              : '#0f121d'
                          }
                          stroke={
                            isSelected
                              ? '#ffffff'
                              : isHovered
                              ? '#ffffff'
                              : 'rgba(255, 255, 255, 0.34)'
                          }
                          strokeWidth={isSelected ? 2.2 : isHovered ? 1.8 : 1.3}
                          shadow={isSelected ? '4px 4px 0 #000000' : '3px 3px 0 #000000'}
                          accentSlashColor={
                            isSelected ? '#090910' : isHovered ? '#e60012' : 'rgba(230,0,18,0.65)'
                          }
                          cornerCutWhite={isSelected}
                          style={{ padding: '7px 10px 7px 12px' }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              {(isSelected || s.running) && (
                                <span
                                  style={{
                                    background: '#090910',
                                    color: s.running ? '#fde047' : '#ffffff',
                                    fontFamily: 'Anton, sans-serif',
                                    fontSize: 9.5,
                                    letterSpacing: '0.08em',
                                    padding: '1px 5px',
                                    clipPath: 'polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)',
                                    flexShrink: 0,
                                  }}
                                >
                                  {s.running ? 'ACT' : 'NOW'}
                                </span>
                              )}
                              {isPinned && !isSelected && (
                                <span style={{ color: '#fbbf24', fontSize: 10, flexShrink: 0 }}>
                                  ★
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: isSelected ? 900 : 700,
                                  color: isSelected || isHovered ? '#ffffff' : '#dbe2ef',
                                  textShadow: isSelected ? '1px 1px 0 rgba(0,0,0,0.75)' : undefined,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {s._label}
                              </span>
                            </div>

                            {isHovered && !s.blank ? (
                              <button
                                type="button"
                                onClick={(e) => handleArchiveSession(e, s.id)}
                                title="归档此记录"
                                style={{
                                  background: '#090910',
                                  color: '#ffffff',
                                  border: '1px solid #ffffff',
                                  clipPath: 'polygon(12% 0%, 100% 8%, 88% 100%, 0% 92%)',
                                  fontSize: 10,
                                  fontWeight: 900,
                                  padding: '1px 5px',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                }}
                              >
                                ✕
                              </button>
                            ) : (
                              <span
                                style={{
                                  fontFamily: '"JetBrains Mono", monospace',
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  color: isSelected ? '#ffe4e6' : '#64748b',
                                  flexShrink: 0,
                                }}
                              >
                                {formatRelativeTime(s.updatedAt)}
                              </span>
                            )}
                          </div>
                        </P5PolyBox>
                      </div>
                    );
                  })}

                {!isGroupCollapsed && hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedAllInGroup((prev) => ({ ...prev, [group.id]: true }))
                    }
                    style={{
                      alignSelf: 'flex-start',
                      marginLeft: 8,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <P5PolyBox
                      points="4,0 100,8 96,100 0,92"
                      fill="#121522"
                      stroke="rgba(230, 0, 18, 0.7)"
                      strokeWidth={1.3}
                      shadow="2px 2px 0 #000000"
                      style={{ padding: '3px 10px' }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: '#fca5a5',
                          letterSpacing: '0.04em',
                        }}
                      >
                        ＋ 展开其余 {hiddenCount} 条档案
                      </span>
                    </P5PolyBox>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── 5. STANDALONE BOTTOM ENGINE BAR (ZERO OFFICIAL LOGIN!) ── */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            padding: '8px 14px 10px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <P5PolyBox
            points="0,10 98,0 100,90 2,100"
            fill="#0c0e17"
            stroke="rgba(255, 255, 255, 0.42)"
            strokeWidth={1.5}
            shadow="3px 3px 0 #000000"
            accentSlashColor="#22c55e"
            style={{ padding: '5px 10px 5px 12px', flex: 1, minWidth: 0 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: 'Anton, "JetBrains Mono", sans-serif',
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  color: '#e2e8f0',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                BIG FISH × DSH CORE
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  color: '#4ade80',
                  fontFamily: '"JetBrains Mono", monospace',
                  flexShrink: 0,
                }}
              >
                ● LOCAL
              </span>
            </div>
          </P5PolyBox>

          <button
            type="button"
            onClick={handleOpenDshEngineSettings}
            onMouseEnter={() => playSfx('hover')}
            title="打开工作台设置与 Agent 预设模式"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <P5PolyBox
              points="10,0 100,10 90,100 0,90"
              fill="#171a28"
              stroke="#ffffff"
              strokeWidth={1.6}
              shadow="3px 3px 0 #000000"
              style={{ padding: '5px 9px' }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  color: '#ffffff',
                  letterSpacing: '0.04em',
                }}
              >
                ⚙ 设置
              </span>
            </P5PolyBox>
          </button>
        </div>
      </aside>
    );
  };

  return { P5PhantomSidebar, P5HeaderLeadingToggle };
}
