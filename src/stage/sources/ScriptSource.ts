import {
  PROTOCOL_VERSION,
  type SessionInfo,
  type SessionSummary,
} from '../../shared/wire';
import {
  DEFAULT_SETTINGS,
  type PublicSettings,
  type SettingsPatch,
  type WorkerAdapterInfo,
} from '../../shared/settings';
import type { CharacterSummary } from '../../shared/character-pack';
import type { StageEvent } from '../../shared/stage-events';
import { SessionListFeed } from './SessionListFeed';
import { ScriptPlayer } from '../../demo/player';
import { DEFAULT_FIRST_USER_PROMPT } from '../../demo/script';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  KNOWN_CHARACTER_IDS,
  pickReactionForEvent,
  preloadCharacterPacks,
  toCharacterSummary,
} from '../characterLoader';
import type {
  StageDataSource,
  StageDataSourceCallbacks,
} from './types';

function buildInitialPublicSettings(): PublicSettings {
  return {
    version: 1,
    activeCharacterId: DEFAULT_SETTINGS.activeCharacterId,
    projectDir: '/workspace/bigfish-login-app',
    recentProjects: [
      '/workspace/bigfish-login-app',
      '/workspace/bigfish-pond-core',
    ],
    worker: {
      ...DEFAULT_SETTINGS.worker,
      endpoint: { baseUrl: DEFAULT_SETTINGS.worker.endpoint.baseUrl, apiKeySet: false },
    },
    voice: {
      enabled: DEFAULT_SETTINGS.voice.enabled,
      endpoint: {
        baseUrl: DEFAULT_SETTINGS.voice.endpoint.baseUrl,
        model: DEFAULT_SETTINGS.voice.endpoint.model,
        apiKeySet: false,
      },
      maxLinesPerMinute: DEFAULT_SETTINGS.voice.maxLinesPerMinute,
    },
    performance: { ...DEFAULT_SETTINGS.performance },
  };
}

const DEMO_ADAPTERS: WorkerAdapterInfo[] = [
  {
    id: 'codex',
    name: 'OpenAI Codex (codex app-server)',
    available: true,
  },
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    available: false,
    unavailableReason: 'Phase 1 仅开放 Codex 适配器（接口已预留）',
  },
];

const DEMO_MODELS = [
  'codex/gpt-6.1-sol',
  'codex/codex-mini-latest',
  'gemini-3.8-flash',
  'gemini-4-argon',
  'gpt-6.1-sol',
  'gpt-6-luna',
  'deepseek-v4-pro',
  'claude-opus-5-5',
];

export class ScriptSource implements StageDataSource {
  public readonly mode = 'demo' as const;
  private callbacks: StageDataSourceCallbacks;
  private player: ScriptPlayer;
  private settings: PublicSettings;
  private characters: CharacterSummary[] = [];
  private history: StageEvent[] = [];
  private session: SessionInfo;
  private disposed = false;
  private sessionList = new SessionListFeed();
  public subscribeSessions = this.sessionList.subscribe;
  private sessions: SessionSummary[] = [
    { sessionId: 'ses_dafeiyu_v4_01', title: '登录页面与主题按钮', model: 'gpt-6.1-sol', cwd: '/workspace/bigfish-login-app', updatedAt: Date.now(), turnCount: 1 },
    { sessionId: 'ses_demo_pond', title: '鱼塘核心 · 整理工具记录', model: 'deepseek-v4-pro', cwd: '/workspace/bigfish-pond-core', updatedAt: Date.now() - 3600000, turnCount: 4 },
    { sessionId: 'ses_demo_theme', title: '深色模式的边框对比度', model: 'gpt-6.1-sol', cwd: '/workspace/bigfish-login-app', updatedAt: Date.now() - 86400000, turnCount: 2 },
  ];

  constructor(callbacks: StageDataSourceCallbacks) {
    this.callbacks = callbacks;
    this.settings = buildInitialPublicSettings();
    this.session = {
      sessionId: 'ses_dafeiyu_v4_01',
      adapter: this.settings.worker.adapter,
      model: this.settings.worker.model,
      cwd: this.settings.projectDir ?? '/workspace/bigfish-login-app',
      turnActive: false,
    };
    this.player = new ScriptPlayer((event) => {
      if (this.disposed) return;
      if (event.type === 'session_started') {
        event = { ...event, sessionId: this.session.sessionId, model: this.session.model, cwd: this.session.cwd };
      }
      this.history.push(event);
      if (event.type === 'user_message') {
        this.session = { ...this.session, turnActive: true };
      } else if (event.type === 'turn_done' || event.type === 'error') {
        this.session = { ...this.session, turnActive: false };
      }
      this.callbacks.onServerMessage({ type: 'event', event });
    }, this.settings.activeCharacterId);
  }

  public connect(): void {
    this.disposed = false;
    this.callbacks.onConnectionChange({
      state: 'connected',
      attempt: 0,
      hasEverConnected: true,
    });

    void (async () => {
      const packs = await preloadCharacterPacks(KNOWN_CHARACTER_IDS);
      if (this.disposed) return;
      this.characters = KNOWN_CHARACTER_IDS.map((id) =>
        toCharacterSummary(packs[id] ?? getCachedCharacterPack(id))
      );
      this.history = [];
      this.callbacks.onServerMessage({
        type: 'welcome',
        protocolVersion: PROTOCOL_VERSION,
        settings: this.settings,
        characters: this.characters,
        workerAdapters: DEMO_ADAPTERS,
        session: this.session,
        history: [],
      });
      this.player.boot();
    })();
  }

  public retryNow(): void {
    this.connect();
  }

  public dispose(): void {
    this.disposed = true;
    this.player.dispose();
    this.sessionList.dispose();
  }

  public send(text: string): void {
    const prompt = text.trim() || DEFAULT_FIRST_USER_PROMPT;
    this.sessions = this.sessions.map((session) => session.sessionId === this.session.sessionId
      ? { ...session, title: session.turnCount ? session.title : prompt.slice(0, 48), turnCount: (session.turnCount ?? 0) + 1, updatedAt: Date.now() }
      : session);
    this.player.startTurn(prompt);
    this.listSessions();
  }

  public steer(text: string): void {
    const steerText =
      text.trim() || '顺便确认按钮带上 data-variant="theme-primary" 属性！';
    this.player.sendSteer(steerText);
  }

  public stop(): void {
    this.player.stop();
  }

  public decidePermission(_requestId: string, allowed: boolean): void {
    this.player.resolvePermission(allowed);
  }

  public listSessions(): void {
    this.sessionList.receive({ type: 'sessions', sessions: this.sessions.map((session) => ({ ...session, current: session.sessionId === this.session.sessionId })) });
  }

  public newSession(): void {
    const newId = `ses_demo_${Date.now().toString(36)}`;
    this.session = {
      sessionId: newId,
      adapter: this.settings.worker.adapter,
      model: this.settings.worker.model,
      cwd: this.settings.projectDir ?? '/workspace/bigfish-login-app',
      turnActive: false,
    };
    this.player.dispose();
    this.sessions.unshift({ ...this.session, title: '新会话', createdAt: Date.now(), updatedAt: Date.now(), turnCount: 0 });
    this.history = [];
    this.callbacks.onServerMessage({
      type: 'session',
      session: this.session,
    });
    this.resetDemoSession();
    this.listSessions();
  }

  public resumeSession(sessionId: string): void {
    const target = this.sessions.find((session) => session.sessionId === sessionId);
    if (!target) return;
    this.player.dispose();
    this.session = { ...this.session, sessionId, model: target.model ?? this.session.model, cwd: target.cwd ?? this.session.cwd, turnActive: false };
    this.callbacks.onServerMessage({ type: 'session', session: this.session });
    this.resetDemoSession();
    this.listSessions();
  }

  private resetDemoSession(): void {
    this.history = [];
    this.player.boot();
    this.callbacks.onServerMessage({ type: 'welcome', protocolVersion: PROTOCOL_VERSION, settings: this.settings, characters: this.characters, workerAdapters: DEMO_ADAPTERS, session: this.session, history: this.history });
  }

  public switchCharacter(characterId: string): void {
    this.settings = {
      ...this.settings,
      activeCharacterId: characterId || DEFAULT_CHARACTER_ID,
    };
    this.player.setCharacterId(this.settings.activeCharacterId);
    this.callbacks.onServerMessage({
      type: 'settings',
      settings: this.settings,
    });

    // Emit a greeting/switch line if idle so the new character speaks right away
    if (!this.player.isRunning()) {
      const pack = getCachedCharacterPack(this.settings.activeCharacterId);
      const reaction = pickReactionForEvent(pack, {
        type: 'session_started',
        sessionId: this.session.sessionId,
        at: Date.now(),
      });
      if (reaction) {
        const ev: StageEvent = {
          type: 'character_line',
          lineId: `line_switch_${Date.now()}`,
          source: 'preset',
          characterId: this.settings.activeCharacterId,
          emotion: reaction.emotion,
          text: reaction.text,
          at: Date.now(),
        };
        this.history.push(ev);
        this.callbacks.onServerMessage({ type: 'event', event: ev });
      }
    }
  }

  public updateSettings(patch: SettingsPatch): void {
    const next: PublicSettings = {
      ...this.settings,
      ...(patch.activeCharacterId !== undefined
        ? { activeCharacterId: patch.activeCharacterId }
        : {}),
      ...(patch.projectDir !== undefined
        ? { projectDir: patch.projectDir }
        : {}),
      ...(patch.recentProjects !== undefined
        ? { recentProjects: patch.recentProjects }
        : {}),
      worker: {
        ...this.settings.worker,
        ...(patch.worker ?? {}),
        endpoint: {
          ...this.settings.worker.endpoint,
          ...(patch.worker?.endpoint?.baseUrl !== undefined
            ? { baseUrl: patch.worker.endpoint.baseUrl } : {}),
          ...(patch.worker?.endpoint?.apiKey !== undefined
            ? { apiKeySet: patch.worker.endpoint.apiKey.length > 0 } : {}),
        },
      },
      voice: {
        ...this.settings.voice,
        ...(patch.voice
          ? {
              ...(patch.voice.enabled !== undefined
                ? { enabled: patch.voice.enabled }
                : {}),
              ...(patch.voice.maxLinesPerMinute !== undefined
                ? { maxLinesPerMinute: patch.voice.maxLinesPerMinute }
                : {}),
              endpoint: {
                ...this.settings.voice.endpoint,
                ...(patch.voice.endpoint?.baseUrl !== undefined
                  ? { baseUrl: patch.voice.endpoint.baseUrl }
                  : {}),
                ...(patch.voice.endpoint?.model !== undefined
                  ? { model: patch.voice.endpoint.model }
                  : {}),
                ...(patch.voice.endpoint?.apiKey !== undefined
                  ? { apiKeySet: patch.voice.endpoint.apiKey.length > 0 }
                  : {}),
              },
            }
          : {}),
      },
      performance: {
        ...this.settings.performance,
        ...(patch.performance ?? {}),
      },
    };

    if (
      patch.projectDir &&
      !next.recentProjects.includes(patch.projectDir)
    ) {
      next.recentProjects = [patch.projectDir, ...next.recentProjects].slice(
        0,
        8
      );
    }

    this.settings = next;
    this.player.setCharacterId(this.settings.activeCharacterId);
    this.callbacks.onServerMessage({
      type: 'settings',
      settings: this.settings,
    });
  }

  public listModels(target: 'worker' | 'voice'): void {
    window.setTimeout(() => {
      if (this.disposed) return;
      this.callbacks.onServerMessage({
        type: 'models',
        target,
        models: DEMO_MODELS,
      });
    }, 80);
  }

  public testConnection(target: 'worker' | 'voice'): void {
    window.setTimeout(() => {
      if (this.disposed) return;
      this.callbacks.onServerMessage({
        type: 'connection_test',
        target,
        ok: true,
        message:
          target === 'worker'
            ? `演示模式：执行适配器 ${this.settings.worker.adapter} (${this.settings.worker.model}) 就绪`
            : `演示模式：台词网关 ${this.settings.voice.endpoint.baseUrl} (${this.settings.voice.endpoint.model}) 连通正常`,
        latencyMs: 18,
      });
    }, 110);
  }

  public setFastForward(fast: boolean): void {
    this.player.setFastForward(fast);
  }

  public replayDemo(): void {
    this.player.startTurn(DEFAULT_FIRST_USER_PROMPT);
  }
}
