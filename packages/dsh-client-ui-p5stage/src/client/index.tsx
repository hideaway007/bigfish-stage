import React, { useEffect, useMemo, type ComponentType } from 'react';
import { StageApp } from '../../../../src/stage/StageApp';
import { preloadCharacterPacks } from '../../../../src/stage/characterLoader';
import { DshStageSource, getActiveStageSource, setStoredAgentPreset, reasoningBridge, modalityBridge, providersBridge } from './DshStageSource';
import { createP5SidebarComponents } from './P5PhantomSidebar';

export const inject = [
  'slots',
  'sessions',
  'workspaces',
  'uiConversation',
  'uiSession',
  'uiWorkspace',
  'layout',
  'connection',
  'remote',
  'remote.session',
  'remote.settings',
  'remote.credentials',
  'remote.llm',
  'remote.agentPresets',
  'configForms',
  'theme',
  'locale',
] as const;

declare const __P5_STAGE_CSS__: string;
declare const __P5_PACKAGE_ID__: string | undefined;

const PLUGIN_OWNER_ID =
  typeof __P5_PACKAGE_ID__ === 'string' && __P5_PACKAGE_ID__
    ? __P5_PACKAGE_ID__
    : '@bigfish/dsh-client-ui-p5stage';

const STANDALONE_PRODUCT_TITLE = 'BigFish Stage · 大肥鱼工作台';

const SIDEBAR_SLOT_CHILDREN = {
  'sidebar.brand.mark': { kind: 'single', scope: 'root' },
  'sidebar.brand.name': { kind: 'single', scope: 'root' },
  'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
  'sidebar.panellist': { kind: 'list', scope: 'root' },
  'sidebar.panellist.actions': { kind: 'list', scope: 'root' },
  'sidebar.workspaces': { kind: 'single', scope: 'root' },
  'sidebar.settings': { kind: 'single', scope: 'root' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
} as const;

const P5_THEME_OVERRIDES: Record<string, { light: string; dark: string }> = {
  '--dsw-alias-bg-base': { light: '#090910', dark: '#090910' },
  '--dsw-alias-bg-layer-1': { light: '#10121d', dark: '#10121d' },
  '--dsw-alias-bg-layer-2': { light: '#171a28', dark: '#171a28' },
  '--dsw-alias-bg-overlay': { light: '#121420', dark: '#121420' },
  '--dsw-specific-sidebar-fill': { light: '#07080e', dark: '#07080e' },
  '--dsw-alias-brand-primary': { light: '#e60012', dark: '#e60012' },
  '--dsw-alias-state-business-primary': { light: '#e60012', dark: '#e60012' },
  '--dsw-alias-border-l1': {
    light: 'rgba(255, 255, 255, 0.08)',
    dark: 'rgba(255, 255, 255, 0.08)',
  },
  '--dsw-alias-border-l2': {
    light: 'rgba(230, 0, 18, 0.38)',
    dark: 'rgba(230, 0, 18, 0.38)',
  },
  '--dsw-alias-border-l3': {
    light: 'rgba(255, 255, 255, 0.18)',
    dark: 'rgba(255, 255, 255, 0.18)',
  },
};

function ensureStageStylesMounted(): void {
  if (typeof document === 'undefined') return;
  if (
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    /Mac/i.test(navigator.platform || navigator.userAgent)
  ) {
    document.documentElement.setAttribute('data-bigfish-mac-app', '1');
  }
  const id = 'p5-agent-stage-dsh-styles';
  let styleEl = document.getElementById(id) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = id;
    document.head.appendChild(styleEl);
  }
  if (typeof __P5_STAGE_CSS__ === 'string' && styleEl.textContent !== __P5_STAGE_CSS__) {
    styleEl.textContent = __P5_STAGE_CSS__;
  }
}

const EMPTY_STAGE_SNAPSHOT = Object.freeze({ ready: true });

function createDshStageView(ctx: any): React.FC<any> {
  return function DshP5StageView(props: any) {
    const sessionId: string = String(
      props?.sessionId ?? props?.session?.sessionId ?? 'dsh_session'
    );
    useEffect(() => {
      ensureStageStylesMounted();
    }, []);

    const source = useMemo(() => new DshStageSource(ctx, sessionId), [sessionId]);

    return (
      <div className="p5-dsh-host" data-testid="p5-dsh-host">
        <StageApp
          key={sessionId}
          sessionKey={sessionId}
          externalSource={source}
          embeddedInDsh={true}
        />
      </div>
    );
  };
}

function createBlankSessionStageView(StageView: React.FC<any>): React.FC<any> {
  return function BlankSessionStageView(props: any) {
    const sessionSnap =
      typeof props?.useSession === 'function'
        ? props.useSession((s: any) => s)
        : props?.session;
    const isBlank = Boolean(sessionSnap?.blank);
    if (!isBlank) return null;
    const sessionId = String(
      props?.sessionId ?? sessionSnap?.sessionId ?? 'dsh_blank_session'
    );
    return (
      <div className="p5-dsh-blank-stage" data-testid="p5-dsh-blank-stage">
        <StageView sessionId={sessionId} />
      </div>
    );
  };
}

export function apply(ctx: any): () => void {
  ensureStageStylesMounted();
  void preloadCharacterPacks();

  const disposers: Array<() => void> = [];
  disposers.push(() => {
    if (typeof document !== 'undefined') {
      document.getElementById('p5-agent-stage-dsh-styles')?.remove();
      document.documentElement.removeAttribute('data-bigfish-mac-app');
      document.documentElement.removeAttribute('data-bigfish-fullscreen');
    }
  });

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const syncFullscreenAttr = () => {
      // When inside Official DSH Desktop (data-platform present), DSH preload natively sets [data-fullscreen]
      if (document.documentElement.hasAttribute('data-platform')) {
        document.documentElement.removeAttribute('data-bigfish-fullscreen');
        return;
      }
      const isDocFs = Boolean(document.fullscreenElement);
      const isScreenFs =
        window.screen &&
        window.screen.width > 900 &&
        window.innerWidth >= window.screen.width - 2 &&
        window.innerHeight >= window.screen.height - 2;
      if (isDocFs || isScreenFs) {
        document.documentElement.setAttribute('data-bigfish-fullscreen', '1');
      } else {
        document.documentElement.removeAttribute('data-bigfish-fullscreen');
      }
    };
    syncFullscreenAttr();
    window.addEventListener('resize', syncFullscreenAttr);
    document.addEventListener('fullscreenchange', syncFullscreenAttr);
    const offElectronFs = (window as any).electronAPI?.onFullscreenChange?.((fs: boolean) => {
      if (fs) {
        document.documentElement.setAttribute('data-bigfish-fullscreen', '1');
      } else {
        document.documentElement.removeAttribute('data-bigfish-fullscreen');
      }
    });
    disposers.push(() => {
      window.removeEventListener('resize', syncFullscreenAttr);
      document.removeEventListener('fullscreenchange', syncFullscreenAttr);
      if (typeof offElectronFs === 'function') offElectronFs();
    });
  }

  // Keep standalone window title ("大肥鱼工作台 // P5 AGENT STAGE", never "DeepSeek Harness")
  if (typeof document !== 'undefined') {
    const originalTitle = document.title;
    const syncTitle = () => {
      if (document.title.includes('DeepSeek Harness')) {
        const next = document.title.replace(/\s*—?\s*DeepSeek Harness/g, '').trim();
        document.title = next
          ? `${next} — ${STANDALONE_PRODUCT_TITLE}`
          : STANDALONE_PRODUCT_TITLE;
      } else if (!document.title) {
        document.title = STANDALONE_PRODUCT_TITLE;
      }
    };
    syncTitle();
    const titleEl = document.querySelector('title');
    if (titleEl && typeof MutationObserver !== 'undefined') {
      const obs = new MutationObserver(syncTitle);
      obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
      disposers.push(() => {
        obs.disconnect();
        if (originalTitle) document.title = originalTitle;
      });
    }
  }

  // Activate dark palette + Persona-5 crimson/ink token layer across all DSH surfaces
  if (ctx.theme) {
    const prevPreference = ctx.theme.getTheme?.()?.preference;
    try {
      ctx.theme.setTheme?.('dark');
      if (prevPreference && prevPreference !== 'dark') {
        disposers.push(() => {
          try {
            ctx.theme.setTheme?.(prevPreference);
          } catch {
            // ignore
          }
        });
      }
    } catch {
      // ignore
    }
    if (typeof ctx.theme.overrideTokens === 'function') {
      disposers.push(
        ctx.theme.overrideTokens(PLUGIN_OWNER_ID, P5_THEME_OVERRIDES)
      );
    }
  }

  // Register custom Persona-5 irregular quadrilateral Sidebar & Collapsed Leading Expand Toggle
  const { P5PhantomSidebar, P5HeaderLeadingToggle } = createP5SidebarComponents(ctx);

  if (typeof window !== 'undefined') {
    (window as any).__BIGFISH_REASONING__ = reasoningBridge;
    disposers.push(() => { delete (window as any).__BIGFISH_REASONING__; });
    (window as any).__BIGFISH_MODALITY__ = modalityBridge;
    disposers.push(() => { delete (window as any).__BIGFISH_MODALITY__; });
    (window as any).__BIGFISH_PROVIDERS__ = providersBridge;
    disposers.push(() => { delete (window as any).__BIGFISH_PROVIDERS__; });
  }

  // Expose real DSH Agent Presets bridge to P5 SystemMenuModal
  if (typeof window !== 'undefined') {
    const presetForm = ctx.configForms?.get?.('agent-preset-registry');
    const syncInitialPreset = () => {
      const val = presetForm?.getSnapshot?.()?.value;
      const saved = val?.selectedDefault ?? val?.default;
      if (typeof saved === 'string' && saved.trim()) {
        setStoredAgentPreset(saved.trim());
      }
    };
    syncInitialPreset();
    if (presetForm?.subscribe) {
      disposers.push(presetForm.subscribe(syncInitialPreset));
    }

    (window as any).__BIGFISH_PRESETS__ = {
      listPresets: async () => {
        const res = await ctx.remote?.agentPresets?.list?.();
        if (res?.ok && Array.isArray(res.value?.presets)) {
          return res.value.presets
            .filter((p: any) => !p?.broken && p?.id)
            .map((p: any) => ({
              id: String(p.id),
              name: typeof p.name === 'string' ? p.name : undefined,
              description: typeof p.description === 'string' ? p.description : undefined,
            }));
        }
        return [];
      },
      readPresetSource: async (id: string) => {
        const res = await ctx.remote?.agentPresets?.read?.(id);
        if (res?.ok && res.value) {
          return {
            title: String(res.value.name ?? id),
            content: String(res.value.content ?? ''),
          };
        }
        return null;
      },
      startCreatorMode: () => {
        setStoredAgentPreset('cordis');
        void ctx.remote?.settings
          ?.update?.('agent-preset-registry', { selectedDefault: 'cordis' })
          ?.catch?.(() => {});
        ctx.uiWorkspace?.startSession?.(undefined, {
          clearPreviousDraft: false,
          agentPreset: 'cordis',
        });
      },
    };
    disposers.push(() => {
      delete (window as any).__BIGFISH_PRESETS__;
    });
  }

  const trackInject = (res: unknown) => {
    if (typeof res === 'function') {
      disposers.push(res as () => void);
    }
  };

  trackInject(
    ctx.slots.inject('sidebar', () => {
      const undeclaredChildren: Record<string, { kind: string; scope: string }> = {};
      for (const [k, v] of Object.entries(SIDEBAR_SLOT_CHILDREN)) {
        if (!ctx.slots.spec?.(k)) {
          undeclaredChildren[k] = v;
        }
      }
      return ctx.slots.register(
        {
          name: 'sidebar',
          priority: -100,
          ...(Object.keys(undeclaredChildren).length > 0
            ? { children: undeclaredChildren }
            : {}),
        },
        P5PhantomSidebar as unknown as ComponentType<any>
      );
    })
  );

  trackInject(
    ctx.slots.inject('shell.leading', () =>
      ctx.slots.register(
        {
          name: 'shell.leading',
          priority: -100,
        },
        P5HeaderLeadingToggle as unknown as ComponentType<any>
      )
    )
  );

  disposers.push(
    ctx.uiConversation.views.register({
      target: 'chat',
      create: () => ({
        empty: EMPTY_STAGE_SNAPSHOT,
        replace: () => EMPTY_STAGE_SNAPSHOT,
        apply: () => EMPTY_STAGE_SNAPSHOT,
      }),
    })
  );

  const BoundStageView = createDshStageView(ctx);
  const BlankStageView = createBlankSessionStageView(BoundStageView);

  trackInject(
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: 'chat',
          order: 0,
          priority: -100,
          label: () => 'STAGE',
        },
        BoundStageView as unknown as ComponentType<any>
      )
    )
  );

  trackInject(
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'p5stage-blank-hero',
          order: 0,
          priority: -100,
        },
        BlankStageView as unknown as ComponentType<any>
      )
    )
  );

  trackInject(
    ctx.slots.inject('conversation.hero.brand.mark', () =>
      ctx.slots.register(
        { name: 'conversation.hero.brand.mark', priority: -100 },
        ({ size = 34 }: any) =>
          React.createElement('img', {
            src: '/characters/deepseek-v4-pro/art/portrait.png',
            alt: '大肥鱼',
            style: {
              width: size,
              height: size,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '2px solid #e60012',
            },
          })
      )
    )
  );

  if (ctx.remote?.$on) {
    const unsubApproval = ctx.remote.$on(
      'approval/request',
      async function (this: any, request: any, next: () => Promise<any>) {
        const scopedId = ctx.sessions?.scopeOf?.(this) ?? request?.sessionId;
        const stageSource = scopedId ? getActiveStageSource(String(scopedId)) : undefined;
        if (stageSource) {
          return stageSource.handleApprovalRequest(request);
        }
        return next();
      }
    );
    if (typeof unsubApproval === 'function') {
      disposers.push(unsubApproval);
    }
  }

  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}
