import {
  PROTOCOL_VERSION,
  type SessionInfo,
  type SessionSummary,
} from '../../shared/wire';
import {
  DEFAULT_CHARACTER_BRAINS,
  DEFAULT_SETTINGS,
  type PublicSettings,
  type PublicizeCharacterBrain,
  type SettingsPatch,
  type WorkerAdapterInfo,
} from '../../shared/settings';
import type { CharacterSummary } from '../../shared/character-pack';
import type { CharacterTouchZone, StageEvent } from '../../shared/stage-events';
import { SessionListFeed } from './SessionListFeed';
import { ScriptPlayer } from '../../demo/player';
import {
  DEFAULT_FIRST_USER_PROMPT,
  DEMO_INITIAL_GIT_ENTRIES,
  type DemoGitEntry,
} from '../../demo/script';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  KNOWN_CHARACTER_IDS,
  pickReactionForEvent,
  preloadCharacterPacks,
  toCharacterSummary,
} from '../characterLoader';
import { pickCharacterTouchReaction } from '../touchReactions';
import type {
  StageDataSource,
  StageDataSourceCallbacks,
} from './types';

function buildInitialPublicSettings(): PublicSettings {
  const characterBrains: Record<string, PublicizeCharacterBrain> = {};
  for (const [id, brain] of Object.entries(DEFAULT_CHARACTER_BRAINS)) {
    characterBrains[id] = {
      model: brain.model,
      useCustomEndpoint: Boolean(brain.useCustomEndpoint),
      endpoint: brain.endpoint
        ? { baseUrl: brain.endpoint.baseUrl, apiKeySet: Boolean(brain.endpoint.apiKey) }
        : undefined,
      activeSessionId:
        id === DEFAULT_SETTINGS.activeCharacterId ? 'ses_dafeiyu_v4_01' : null,
      rolePrompt: brain.rolePrompt,
    };
  }

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
    characterBrains,
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
    id: 'dsh',
    name: 'DeepSeek Harness（全自动读写与终端执行）',
    available: true,
  },
  {
    id: 'direct-chat',
    name: 'DeepSeek 直连模式（轻量极速对话）',
    available: true,
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (codex app-server)',
    available: true,
  },
];

const DEMO_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v4-pro',
  'gemini-4-argon',
  'gpt-6.1-sol',
  'claude-opus-5-5',
];

const BATON_PASS_REVIEWS: Record<string, string[]> = {
  'deepseek-v4-pro': [
    '接棒成功捏！大肥鱼刚把交接摘要啃完，按钮主题色和单元测试我都盯紧啦，随时可以继续挥舞 Harness！',
  ],
  'gemini-4-argon': [
    '接力棒稳稳接住！刚扫了一眼 Login.tsx 的边框阴影焊缝，比例很利落，要不要我再补一道悬停辉光动效？',
  ],
  'claude-opus-5-5': [
    '交接目录已阅。Login.tsx 的样式令牌与 data-variant 属性契约一致，没有破坏既有表单结构，请委托人放心。',
  ],
  'codex-dragon': [
    '接手了。清醒度七成。看完了那两处 diff：themeColor 回退值安全，没有空指针边界漏点。',
  ],
};

export class ScriptSource implements StageDataSource {
  public readonly mode = 'demo' as const;
  private callbacks: StageDataSourceCallbacks;
  private player: ScriptPlayer;
  private settings: PublicSettings;
  private characters: CharacterSummary[] = [];
  private history: StageEvent[] = [];
  private session: SessionInfo;
  private roomHistories: Record<string, StageEvent[]> = {};
  private roomSessions: Record<string, SessionInfo> = {};
  private demoGitEntries: DemoGitEntry[] = DEMO_INITIAL_GIT_ENTRIES.map((e) => ({
    file: { ...e.file },
    diff: e.diff,
  }));
  private timers = new Set<number>();
  private disposed = false;
  private sessionList = new SessionListFeed();
  public subscribeSessions = this.sessionList.subscribe;
  private sessions: SessionSummary[] = [
    { sessionId: 'ses_dafeiyu_v4_01', title: '登录页面与主题按钮', model: 'deepseek-chat', characterId: 'deepseek-v4-pro', cwd: '/workspace/bigfish-login-app', updatedAt: Date.now(), turnCount: 1 },
    { sessionId: 'ses_demo_pond', title: '鱼塘核心 · 整理工具记录', model: 'deepseek-v4-pro', cwd: '/workspace/bigfish-pond-core', updatedAt: Date.now() - 3600000, turnCount: 4 },
    { sessionId: 'ses_demo_theme', title: '深色模式的边框对比度', model: 'deepseek-reasoner', cwd: '/workspace/bigfish-login-app', updatedAt: Date.now() - 86400000, turnCount: 2 },
  ];

  constructor(callbacks: StageDataSourceCallbacks) {
    this.callbacks = callbacks;
    this.settings = buildInitialPublicSettings();
    this.session = {
      sessionId: 'ses_dafeiyu_v4_01',
      adapter: this.settings.worker.adapter,
      model: this.settings.worker.model,
      cwd: this.settings.projectDir ?? '/workspace/bigfish-login-app',
      characterId: this.settings.activeCharacterId,
      turnActive: false,
    };
    this.player = new ScriptPlayer((event) => {
      if (this.disposed) return;
      if (event.type === 'session_started') {
        event = {
          ...event,
          sessionId: this.session.sessionId,
          model: this.session.model,
          cwd: this.session.cwd,
          characterId: this.settings.activeCharacterId,
        };
      }
      this.history.push(event);
      this.roomHistories[this.settings.activeCharacterId] = [...this.history];
      if (event.type === 'user_message') {
        this.session = { ...this.session, turnActive: true };
      } else if (event.type === 'tool_end' && event.diff) {
        if (this.demoGitEntries.length === 0) {
          this.demoGitEntries = DEMO_INITIAL_GIT_ENTRIES.map((e) => ({
            file: { ...e.file },
            diff: e.diff,
          }));
        }
      } else if (event.type === 'turn_done' || event.type === 'error') {
        this.session = { ...this.session, turnActive: false };
      }
      this.roomSessions[this.settings.activeCharacterId] = { ...this.session };
      this.callbacks.onServerMessage({ type: 'event', event });
    }, this.settings.activeCharacterId);
  }

  private scheduleDemoTimer(fn: () => void, delayMs: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, delayMs);
    this.timers.add(id);
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
    for (const id of this.timers) {
      window.clearTimeout(id);
    }
    this.timers.clear();
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
    const activeId = this.settings.activeCharacterId;
    const brainModel =
      this.settings.characterBrains[activeId]?.model ||
      this.settings.worker.model;
    this.session = {
      sessionId: newId,
      adapter: this.settings.worker.adapter,
      model: brainModel,
      cwd: this.settings.projectDir ?? '/workspace/bigfish-login-app',
      characterId: activeId,
      turnActive: false,
    };
    this.settings = {
      ...this.settings,
      characterBrains: {
        ...this.settings.characterBrains,
        [activeId]: {
          ...this.settings.characterBrains[activeId],
          activeSessionId: newId,
        },
      },
    };
    this.player.dispose();
    this.sessions.unshift({
      ...this.session,
      title: '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turnCount: 0,
    });
    this.history = [];
    this.roomHistories[activeId] = [];
    this.roomSessions[activeId] = { ...this.session };
    this.callbacks.onServerMessage({
      type: 'settings',
      settings: this.settings,
    });
    this.callbacks.onServerMessage({
      type: 'session',
      session: this.session,
      history: [],
    });
    this.resetDemoSession();
    this.listSessions();
  }

  public resumeSession(sessionId: string): void {
    const target = this.sessions.find((session) => session.sessionId === sessionId);
    if (!target) return;
    this.player.dispose();
    this.session = {
      ...this.session,
      sessionId,
      model: target.model ?? this.session.model,
      cwd: target.cwd ?? this.session.cwd,
      turnActive: false,
    };
    this.callbacks.onServerMessage({
      type: 'session',
      session: this.session,
      history: this.history,
    });
    this.resetDemoSession();
    this.listSessions();
  }

  private resetDemoSession(): void {
    this.history = [];
    this.player.boot();
    this.callbacks.onServerMessage({ type: 'welcome', protocolVersion: PROTOCOL_VERSION, settings: this.settings, characters: this.characters, workerAdapters: DEMO_ADAPTERS, session: this.session, history: this.history });
  }

  public switchCharacter(characterId: string): void {
    const prevCharId = this.settings.activeCharacterId;
    const nextCharId = characterId || DEFAULT_CHARACTER_ID;
    if (!this.player.isRunning()) {
      this.roomHistories[prevCharId] = [...this.history];
      this.roomSessions[prevCharId] = { ...this.session };
    }

    const brainModel =
      this.settings.characterBrains[nextCharId]?.model ||
      this.settings.worker.model;
    let nextRoomSession = this.roomSessions[nextCharId];
    if (!nextRoomSession) {
      const roomSesId = `ses_room_${nextCharId.slice(0, 6)}_${Date.now()
        .toString(36)
        .slice(-4)}`;
      nextRoomSession = {
        sessionId: roomSesId,
        adapter: this.settings.worker.adapter,
        model: brainModel,
        cwd: this.settings.projectDir ?? '/workspace/bigfish-login-app',
        characterId: nextCharId,
        turnActive: this.player.isRunning(),
      };
      this.roomSessions[nextCharId] = nextRoomSession;
      this.sessions.unshift({
        sessionId: roomSesId,
        title: `${getCachedCharacterPack(nextCharId).name.split('（')[0]}的专属房间`,
        model: brainModel,
        characterId: nextCharId,
        cwd: nextRoomSession.cwd,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        turnCount: 0,
      });
    } else {
      nextRoomSession = {
        ...nextRoomSession,
        model: brainModel,
        turnActive: this.player.isRunning(),
      };
      this.roomSessions[nextCharId] = nextRoomSession;
    }

    this.settings = {
      ...this.settings,
      activeCharacterId: nextCharId,
      characterBrains: {
        ...this.settings.characterBrains,
        [nextCharId]: {
          ...this.settings.characterBrains[nextCharId],
          activeSessionId: nextRoomSession.sessionId,
        },
      },
    };
    this.player.setCharacterId(this.settings.activeCharacterId);
    this.callbacks.onServerMessage({
      type: 'settings',
      settings: this.settings,
    });

    if (!this.player.isRunning()) {
      this.session = nextRoomSession;
      const savedHistory = this.roomHistories[nextCharId];
      if (savedHistory && savedHistory.length > 0) {
        this.history = [...savedHistory];
        this.callbacks.onServerMessage({
          type: 'session',
          session: this.session,
          history: this.history,
        });
      } else {
        const pack = getCachedCharacterPack(nextCharId);
        const reaction = pickReactionForEvent(pack, {
          type: 'session_started',
          sessionId: this.session.sessionId,
          at: Date.now(),
        });
        const now = Date.now();
        const bootEvents: StageEvent[] = [
          {
            type: 'session_started',
            sessionId: this.session.sessionId,
            model: brainModel,
            cwd: this.session.cwd,
            characterId: nextCharId,
            at: now,
          },
        ];
        if (reaction) {
          bootEvents.push({
            type: 'character_line',
            lineId: `line_switch_${now}`,
            source: 'preset',
            characterId: nextCharId,
            emotion: reaction.emotion,
            text: reaction.text,
            at: now + 1,
          });
        }
        this.history = bootEvents;
        this.roomHistories[nextCharId] = [...bootEvents];
        this.callbacks.onServerMessage({
          type: 'session',
          session: this.session,
          history: this.history,
        });
      }
    }
  }

  public updateSettings(patch: SettingsPatch): void {
    const nextBrains: Record<string, PublicizeCharacterBrain> = {
      ...this.settings.characterBrains,
    };
    if (patch.characterBrains) {
      for (const [charId, brainPatch] of Object.entries(patch.characterBrains)) {
        const prevBrain = nextBrains[charId] ?? {};
        nextBrains[charId] = {
          ...prevBrain,
          ...(brainPatch.model !== undefined ? { model: brainPatch.model } : {}),
          ...(brainPatch.useCustomEndpoint !== undefined
            ? { useCustomEndpoint: brainPatch.useCustomEndpoint }
            : {}),
          ...(brainPatch.activeSessionId !== undefined
            ? { activeSessionId: brainPatch.activeSessionId }
            : {}),
          ...(brainPatch.rolePrompt !== undefined
            ? { rolePrompt: brainPatch.rolePrompt }
            : {}),
          endpoint: brainPatch.endpoint
            ? {
                baseUrl:
                  brainPatch.endpoint.baseUrl ??
                  prevBrain.endpoint?.baseUrl ??
                  this.settings.worker.endpoint.baseUrl,
                apiKeySet:
                  brainPatch.endpoint.apiKey !== undefined
                    ? brainPatch.endpoint.apiKey.length > 0
                    : Boolean(prevBrain.endpoint?.apiKeySet),
              }
            : prevBrain.endpoint,
        };
      }
    }

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
      characterBrains: nextBrains,
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
    const activeBrainModel =
      this.settings.characterBrains[this.settings.activeCharacterId]?.model ||
      this.settings.worker.model;
    this.session = {
      ...this.session,
      model: activeBrainModel,
    };
    this.player.setCharacterId(this.settings.activeCharacterId);
    this.callbacks.onServerMessage({
      type: 'settings',
      settings: this.settings,
    });
  }

  public listModels(target: 'worker' | 'voice'): void {
    this.scheduleDemoTimer(() => {
      this.callbacks.onServerMessage({
        type: 'models',
        target,
        models: DEMO_MODELS,
      });
    }, 80);
  }

  public testConnection(target: 'worker' | 'voice'): void {
    this.scheduleDemoTimer(() => {
      const message =
        target === 'worker'
          ? `演示模式：执行引擎 ${this.settings.worker.adapter} (${this.settings.worker.model}) 就绪`
          : `演示模式：台词服务 (${this.settings.voice.endpoint.model}) 连通正常`;
      this.callbacks.onServerMessage({
        type: 'connection_test',
        target,
        ok: true,
        message,
        latencyMs: 18,
      });
    }, 110);
  }

  public compactSession(): void {
    this.scheduleDemoTimer(() => {
      const now = Date.now();
      const compactEv: StageEvent = {
        type: 'context_compacted',
        turnsCompacted: 8,
        freedTokens: 64000,
        afterTokens: 18000,
        summary:
          '已将前 8 轮探索与文件读取浓缩为战术记忆摘要卡，释放 64,000 Tokens！',
        at: now,
      };
      const usageEv: StageEvent = {
        type: 'context_usage',
        usedTokens: 18000,
        maxTokens: 1000000,
        at: now + 1,
      };
      this.history.push(compactEv, usageEv);
      this.roomHistories[this.settings.activeCharacterId] = [...this.history];
      this.callbacks.onServerMessage({ type: 'event', event: compactEv });
      this.callbacks.onServerMessage({ type: 'event', event: usageEv });
    }, 320);
  }

  public batonPass(toCharacterId: string, instruction?: string): void {
    const fromId = this.settings.activeCharacterId;
    const targetId = toCharacterId || DEFAULT_CHARACTER_ID;
    const cleanInstruction =
      instruction?.trim() || '交接本轮 Login.tsx 改动与单元测试结果，请继续把关';

    this.switchCharacter(targetId);

    const now = Date.now();
    const fromName = getCachedCharacterPack(fromId).name.split('（')[0];
    const batonEv: StageEvent = {
      type: 'baton_pass',
      fromCharacterId: fromId,
      toCharacterId: targetId,
      summary: `${fromName} ➔ 交接指令：${cleanInstruction}`,
      at: now,
    };
    const greetingEv: StageEvent = {
      type: 'character_line',
      lineId: `line_baton_in_${now}`,
      source: 'model',
      characterId: targetId,
      emotion: 'working',
      text: `收到${fromName}的接力棒！「${cleanInstruction}」——交给我接着上！`,
      at: now + 2,
    };
    this.history.push(batonEv, greetingEv);
    this.roomHistories[targetId] = [...this.history];
    this.callbacks.onServerMessage({ type: 'event', event: batonEv });
    this.callbacks.onServerMessage({ type: 'event', event: greetingEv });

    this.scheduleDemoTimer(() => {
      const reviews =
        BATON_PASS_REVIEWS[targetId] ?? BATON_PASS_REVIEWS['deepseek-v4-pro'];
      const reviewText = reviews[0];
      const reviewEv: StageEvent = {
        type: 'character_line',
        lineId: `line_baton_review_${Date.now()}`,
        source: 'model',
        characterId: targetId,
        emotion: 'happy',
        text: reviewText,
        at: Date.now(),
      };
      this.history.push(reviewEv);
      this.roomHistories[targetId] = [...this.history];
      this.callbacks.onServerMessage({ type: 'event', event: reviewEv });
    }, 780);
  }

  public interactCharacter(
    characterId: string,
    zone: CharacterTouchZone
  ): void {
    const targetId = characterId || this.settings.activeCharacterId;
    const pack = getCachedCharacterPack(targetId);
    const picked = pickCharacterTouchReaction(pack, zone);
    const lineId = `line_touch_${zone}_${Date.now()}`;
    const ev: StageEvent = {
      type: 'character_line',
      lineId,
      source: 'touch',
      touchZone: zone,
      characterId: targetId,
      emotion: picked.emotion,
      text: picked.text,
      at: Date.now(),
    };
    this.history.push(ev);
    this.roomHistories[this.settings.activeCharacterId] = [...this.history];
    this.callbacks.onServerMessage({ type: 'event', event: ev });
  }

  private emitDemoGitStatus(): void {
    this.callbacks.onServerMessage({
      type: 'git_status_result',
      isRepo: true,
      branch: 'feat/theme-login-btn',
      files: this.demoGitEntries.map((e) => ({ ...e.file })),
      diff: this.demoGitEntries.map((e) => e.diff).join('\n'),
    });
  }

  public requestGitStatus(): void {
    this.scheduleDemoTimer(() => {
      this.emitDemoGitStatus();
    }, 60);
  }

  public revertGitFile(path: string): void {
    this.scheduleDemoTimer(() => {
      const beforeLen = this.demoGitEntries.length;
      this.demoGitEntries = this.demoGitEntries.filter(
        (e) => e.file.path !== path
      );
      const reverted = this.demoGitEntries.length < beforeLen;
      this.callbacks.onServerMessage({
        type: 'git_op_result',
        op: 'revert',
        ok: reverted,
        message: reverted
          ? `已撤回文件改动：${path}`
          : `未找到待撤回文件：${path}`,
      });
      this.emitDemoGitStatus();
    }, 100);
  }

  public commitGit(message: string): void {
    const trimmed = message.trim();
    this.scheduleDemoTimer(() => {
      if (!trimmed) {
        this.callbacks.onServerMessage({
          type: 'git_op_result',
          op: 'commit',
          ok: false,
          message: '请输入非空的提交信息',
        });
        return;
      }
      if (this.demoGitEntries.length === 0) {
        this.callbacks.onServerMessage({
          type: 'git_op_result',
          op: 'commit',
          ok: false,
          message: '当前工作区没有待提交的改动',
        });
        return;
      }
      const count = this.demoGitEntries.length;
      this.demoGitEntries = [];
      this.callbacks.onServerMessage({
        type: 'git_op_result',
        op: 'commit',
        ok: true,
        message: `已提交 ${count} 个文件的改动：「${trimmed}」`,
      });
      this.emitDemoGitStatus();
    }, 140);
  }

  public setFastForward(fast: boolean): void {
    this.player.setFastForward(fast);
  }

  public replayDemo(): void {
    this.player.startTurn(DEFAULT_FIRST_USER_PROMPT);
  }
}
