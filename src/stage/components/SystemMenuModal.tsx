import React, { useEffect, useState } from 'react';
import type { CharacterSummary } from '../../shared/character-pack';
import {
  BUILTIN_AGENT_PRESETS,
  type AgentPresetInfo,
  type PublicSettings,
  type SettingsPatch,
  type WorkerAdapterInfo,
} from '../../shared/settings';
import { getCachedCharacterPack } from '../characterLoader';
import { isCustomCharacterId } from '../../shared/diy-character';
import { CHARACTER_ROLE_META } from '../touchReactions';
import { ModelPicker } from './settings/ModelPicker';
import { ConnectionTestResult } from './settings/ConnectionTestResult';
import {
  CharacterPersonaCardBar,
  DiyCharacterCreatorDrawer,
} from './settings/DiyCharacterPanel';
import './settings/settings.css';
import type {
  ConnectionTestState,
  ModelListState,
  SystemMenuTab,
} from '../stageReducer';

interface SystemMenuModalProps {
  open: boolean;
  activeTab: SystemMenuTab;
  settings: PublicSettings;
  settingsSyncedAt?: number | null;
  currentSessionId?: string;
  characters: CharacterSummary[];
  workerAdapters: WorkerAdapterInfo[];
  workerModels?: ModelListState;
  voiceModels?: ModelListState;
  workerConnTest?: ConnectionTestState;
  voiceConnTest?: ConnectionTestState;
  onSelectTab: (tab: SystemMenuTab) => void;
  onClose: () => void;
  onSwitchCharacter: (characterId: string) => void;
  onUpdateSettings: (patch: SettingsPatch) => void;
  onListModels: (target: 'worker' | 'voice') => void;
  onTestConnection: (target: 'worker' | 'voice') => void;
  onStartNewSessionWithDir?: (projectDir: string) => void;
}

const DEFAULT_MODEL_LIST: ModelListState = {
  models: [],
  loading: false,
};

const DEFAULT_CONN_TEST: ConnectionTestState = {
  testing: false,
};

interface BigfishPresetsBridge {
  listPresets?: () => Promise<
    Array<{ id: string; name?: string; description?: string }>
  >;
  readPresetSource?: (
    id: string
  ) => Promise<{ title: string; content: string } | null>;
  startCreatorMode?: () => void;
}

interface BigfishProviderRow {
  route: string;
  displayName: string;
  api?: string;
  baseURL?: string;
  apiKeyEnv: string;
  keyConfigured: boolean;
  models: Array<{ id: string; name?: string; input?: string[] }>;
  isBuiltin: boolean;
}

interface BigfishProvidersBridge {
  listProviders?: () => Promise<BigfishProviderRow[]>;
  saveProvider?: (input: {
    route: string;
    displayName?: string;
    api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
    baseURL?: string;
    apiKey?: string;
    models?: Array<{ id: string; name?: string; input?: string[] }>;
  }) => Promise<void>;
  removeProvider?: (route: string) => Promise<void>;
  discoverModels?: (probe: {
    provider?: string;
    baseURL?: string;
    api?: string;
    apiKey?: string;
  }) => Promise<Array<{ id: string; name?: string; input?: string[] }>>;
}

declare global {
  interface Window {
    __BIGFISH_PRESETS__?: BigfishPresetsBridge;
    __BIGFISH_PROVIDERS__?: BigfishProvidersBridge;
  }
}

const TABS: Array<{ id: SystemMenuTab; zh: string }> = [
  { id: 'characters', zh: '角色与模型' },
  { id: 'presets', zh: 'Agent 预设' },
  { id: 'worker', zh: 'AI 引擎' },
  { id: 'voice', zh: '互动台词' },
  { id: 'pond', zh: '工作文件夹' },
  { id: 'performance', zh: '显示速度' },
];

function formatAdapterDisplayName(ad: WorkerAdapterInfo): string {
  if (ad.id === 'dsh') {
    return 'DeepSeek Harness · 全自动代码读写与终端执行（核心推荐）';
  }
  if (ad.id === 'direct-chat') {
    return 'DeepSeek 直连模式 · 轻量极速问答';
  }
  return ad.name;
}

export const SystemMenuModal: React.FC<SystemMenuModalProps> = ({
  open,
  activeTab,
  settings,
  settingsSyncedAt = null,
  currentSessionId,
  characters,
  workerAdapters,
  workerModels = DEFAULT_MODEL_LIST,
  voiceModels = DEFAULT_MODEL_LIST,
  workerConnTest = DEFAULT_CONN_TEST,
  voiceConnTest = DEFAULT_CONN_TEST,
  onSelectTab,
  onClose,
  onSwitchCharacter,
  onUpdateSettings,
  onListModels,
  onTestConnection,
  onStartNewSessionWithDir,
}) => {
  const safeWorkerModels = workerModels ?? DEFAULT_MODEL_LIST;
  const safeVoiceModels = voiceModels ?? DEFAULT_MODEL_LIST;
  const safeWorkerConn = workerConnTest ?? DEFAULT_CONN_TEST;
  const safeVoiceConn = voiceConnTest ?? DEFAULT_CONN_TEST;

  const [workerModelDraft, setWorkerModelDraft] = useState(
    settings.worker.model
  );
  const [workerBaseUrlDraft, setWorkerBaseUrlDraft] = useState(
    settings.worker.endpoint.baseUrl
  );
  const [workerApiKeyDraft, setWorkerApiKeyDraft] = useState('');
  const [voiceBaseUrlDraft, setVoiceBaseUrlDraft] = useState(
    settings.voice.endpoint.baseUrl
  );
  const [voiceModelDraft, setVoiceModelDraft] = useState(
    settings.voice.endpoint.model
  );
  const [voiceApiKeyDraft, setVoiceApiKeyDraft] = useState('');
  const [projectDirDraft, setProjectDirDraft] = useState(
    settings.projectDir ?? ''
  );
  const [typingSpeedDraft, setTypingSpeedDraft] = useState(
    settings.performance.typingCharsPerSec
  );
  const [showWorkerAdvanced, setShowWorkerAdvanced] = useState(false);
  const [, setReasoningTick] = useState(0);
  useEffect(() => {
    const bridge = (window as any).__BIGFISH_REASONING__;
    return bridge?.subscribe ? bridge.subscribe(() => setReasoningTick((v: number) => v + 1)) : undefined;
  }, []);
  const reasoningBridge = typeof window !== 'undefined' ? (window as any).__BIGFISH_REASONING__ : undefined;
  const effortOptions: Array<{ id: string; name: string; description?: string }> =
    reasoningBridge?.efforts?.(settings.worker.model || '') ?? [];
  const currentEffort: string = reasoningBridge?.current?.() ?? settings.worker.reasoningEffort ?? '';
  const modalityBridge = typeof window !== 'undefined' ? (window as any).__BIGFISH_MODALITY__ : undefined;
  const imageEditable: boolean = !!modalityBridge?.editable?.(settings.worker.model || '');
  const imageSupported: boolean = modalityBridge?.supportsImages?.(settings.worker.model || '') === true;
  const [imageSaving, setImageSaving] = useState(false);
  const [imageSaveError, setImageSaveError] = useState<string | null>(null);
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);
  const [dirPickError, setDirPickError] = useState<string | null>(null);
  const [diyCreatorOpen, setDiyCreatorOpen] = useState(false);
  const [editingCustomCharId, setEditingCustomCharId] = useState<string | null>(null);
  const [customPresets, setCustomPresets] = useState<AgentPresetInfo[]>([]);
  const [presetGuideOpen, setPresetGuideOpen] = useState<
    Record<string, 'details' | 'usage' | 'source' | null>
  >({});
  const [presetSourceCache, setPresetSourceCache] = useState<
    Record<string, string>
  >({});

  // DSH Native Multi-Provider Setup (GPT / Claude / Custom Gateway)
  const providersBridge =
    typeof window !== 'undefined' ? window.__BIGFISH_PROVIDERS__ : undefined;
  const [extProviders, setExtProviders] = useState<BigfishProviderRow[]>([]);
  const [provMode, setProvMode] = useState<'openai' | 'anthropic' | 'custom'>('openai');
  const [provRoute, setProvRoute] = useState('openai');
  const [provDisplayName, setProvDisplayName] = useState('OpenAI (GPT)');
  const [provApi, setProvApi] = useState<
    'openai-completions' | 'openai-responses' | 'anthropic-messages'
  >('openai-completions');
  const [provBaseUrl, setProvBaseUrl] = useState('');
  const [provApiKey, setProvApiKey] = useState('');
  const [provModelsText, setProvModelsText] = useState('');
  const [provBusy, setProvBusy] = useState(false);
  const [provProbing, setProvProbing] = useState(false);
  const [provNotice, setProvNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const reloadExtProviders = () => {
    if (!providersBridge?.listProviders) return;
    void providersBridge
      .listProviders()
      .then((rows) => setExtProviders(rows))
      .catch(() => {});
  };

  const applyProviderPresetTemplate = (
    mode: 'openai' | 'anthropic' | 'custom'
  ) => {
    setProvMode(mode);
    setProvNotice(null);
    setProvApiKey('');
    const existing = extProviders.find((r) => r.route === mode);
    if (mode === 'openai') {
      setProvRoute('openai');
      setProvDisplayName('OpenAI (GPT)');
      setProvApi('openai-responses');
      setProvBaseUrl(existing?.baseURL ?? '');
      setProvModelsText(
        existing?.models?.length
          ? existing.models.map((m) => m.id).join(', ')
          : ''
      );
    } else if (mode === 'anthropic') {
      setProvRoute('anthropic');
      setProvDisplayName('Anthropic (Claude)');
      setProvApi('anthropic-messages');
      setProvBaseUrl(existing?.baseURL ?? '');
      setProvModelsText(
        existing?.models?.length
          ? existing.models.map((m) => m.id).join(', ')
          : ''
      );
    } else {
      setProvRoute('custom-gateway');
      setProvDisplayName('自定义模型网关');
      setProvApi('openai-completions');
      setProvBaseUrl('');
      setProvModelsText('');
    }
  };

  useEffect(() => {
    setWorkerModelDraft(settings.worker.model);
    setWorkerBaseUrlDraft(settings.worker.endpoint.baseUrl);
    setVoiceBaseUrlDraft(settings.voice.endpoint.baseUrl);
    setVoiceModelDraft(settings.voice.endpoint.model);
    setProjectDirDraft(settings.projectDir ?? '');
    setTypingSpeedDraft(settings.performance.typingCharsPerSec);
  }, [settings, settingsSyncedAt]);

  useEffect(() => {
    if (!open) {
      setDirPickError(null);
      return;
    }
    if (activeTab === 'presets') {
      const bridge = window.__BIGFISH_PRESETS__;
      if (bridge?.listPresets) {
        void bridge
          .listPresets()
          .then((rows) => {
            const builtinIds = new Set(BUILTIN_AGENT_PRESETS.map((b) => b.id));
            const extras: AgentPresetInfo[] = rows
              .filter((r) => r.id && !builtinIds.has(r.id))
              .map((r) => ({
                id: r.id,
                name: r.name || r.id,
                badge: '自定义',
                builtIn: false,
                description:
                  r.description || '自定义组合的工具集与角色指令预设模式。',
                modeDetails:
                  '由用户或创造模式定义的专属预设组合，新建舞台会话时自动挂载对应工具与提示词。',
                howToUse: '点选设为默认后，新建舞台会话即按该自定义模式运行。',
              }));
            setCustomPresets(extras);
          })
          .catch(() => {});
      }
    } else if (activeTab === 'worker') {
      onListModels('worker');
      reloadExtProviders();
    } else if (
      activeTab === 'voice' &&
      safeVoiceModels.models.length === 0 &&
      !safeVoiceModels.loading
    ) {
      onListModels('voice');
    }
  }, [
    open,
    activeTab,
    settings.worker.connection,
    settings.worker.endpoint.baseUrl,
    settings.worker.endpoint.apiKeySet,
    settings.worker.adapter,
  ]);

  if (!open) return null;

  return (
    <div
      className="p5-system-backdrop"
      data-testid="system-menu-modal"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      onClick={onClose}
    >
      <div className="p5-system-shell" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <header className="p5-system-header">
          <div className="p5-system-title-group">
            <h2 className="p5-system-title">设置</h2>
          </div>

          <div className="p5-system-header-right">
            {settingsSyncedAt && (
              <span
                className="p5-system-sync-pill"
                data-testid="settings-synced-indicator"
              >
                ✓ 已保存
              </span>
            )}
            <button
              type="button"
              className="p5-close-btn"
              onClick={onClose}
              data-testid="system-close-btn"
            >
              返回
            </button>
          </div>
        </header>

        <div className="p5-system-body">
          {/* Left Tab Navigation — Clean 1-line labels */}
          <nav className="p5-system-nav" aria-label="设置分类">
            {TABS.map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`system-tab-${t.id}`}
                  className={`p5-system-tab-btn ${isActive ? 'is-active' : ''}`}
                  onClick={() => onSelectTab(t.id)}
                >
                  <span className="p5-system-tab-zh">{t.zh}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Tab Content */}
          <div className="p5-system-content" data-testid="system-content-pane">
            {/* ── TAB 1: 角色与模型 (CHARACTERS & INDEPENDENT BRAINS) ── */}
            {activeTab === 'characters' && (
              <div
                className="p5-sys-panel"
                data-testid="system-panel-characters"
              >
                <div className="p5-sys-panel-head p5-sys-panel-head--split">
                  <div>
                    <h3>角色与独立大脑</h3>
                    <p>
                      每位角色拥有「独立大脑与专属房间」，并支持导入 <code>.md / .txt</code> 性格定位文件或 DIY 自建新角色。
                    </p>
                  </div>
                  <button
                    type="button"
                    className="p5-diy-open-creator-btn"
                    data-testid="open-diy-creator-btn"
                    onClick={() => {
                      setEditingCustomCharId(null);
                      setDiyCreatorOpen((prev) => !prev);
                    }}
                  >
                    {diyCreatorOpen && !editingCustomCharId
                      ? '▴ 收起捏人工作台'
                      : '＋ DIY 新建角色'}
                  </button>
                </div>

                <DiyCharacterCreatorDrawer
                  open={diyCreatorOpen}
                  editingCharacterId={editingCustomCharId}
                  onClose={() => {
                    setDiyCreatorOpen(false);
                    setEditingCustomCharId(null);
                  }}
                  onCreatedOrUpdated={(charId, rolePromptText) => {
                    onUpdateSettings({
                      characterBrains: {
                        [charId]: { rolePrompt: rolePromptText },
                      },
                    });
                    onSwitchCharacter(charId);
                  }}
                />

                <div className="p5-char-grid">
                  {characters.map((ch) => {
                    const pack = getCachedCharacterPack(ch.id);
                    const isCurrent = settings.activeCharacterId === ch.id;
                    const shortName = ch.name.split('（')[0];
                    const charBrain = settings.characterBrains?.[ch.id];
                    const brainModel = charBrain?.model || settings.worker.model;
                    const hasActiveRoom =
                      Boolean(charBrain?.activeSessionId) ||
                      (isCurrent && Boolean(currentSessionId));
                    const roleMeta = CHARACTER_ROLE_META[ch.id];
                    const isCustomChar = isCustomCharacterId(ch.id);

                    const pillCandidates = Array.from(
                      new Set([
                        'deepseek-chat',
                        'deepseek-reasoner',
                        ...(pack.recommendedModels ?? []),
                      ])
                    ).slice(0, 4);
                    if (brainModel && !pillCandidates.includes(brainModel)) {
                      pillCandidates.unshift(brainModel);
                    }

                    return (
                      <div
                        key={ch.id}
                        data-testid={`char-card-${ch.id}`}
                        className={`p5-char-card ${
                          isCurrent ? 'is-active' : ''
                        }`}
                        style={
                          {
                            '--card-theme': ch.themeColor,
                          } as React.CSSProperties
                        }
                        onClick={() => {
                          onSwitchCharacter(ch.id);
                        }}
                      >
                        {/* 第 1 层：大头像 + 大名字 & 小字简介 + 切换角色按钮 */}
                        <div className="p5-char-card-top">
                          <div className="p5-char-card-avatar-wrap">
                            {ch.portraitUrl ? (
                              <img
                                src={ch.portraitUrl}
                                alt={shortName}
                                className="p5-char-card-avatar"
                              />
                            ) : (
                              <div className="p5-char-card-avatar-fallback">
                                {shortName.slice(0, 2)}
                              </div>
                            )}
                          </div>
                          <div className="p5-char-card-titles">
                            <div className="p5-char-card-name-row">
                              <h4 className="p5-char-card-name">{shortName}</h4>
                              {isCustomChar && (
                                <span className="p5-char-diy-pill">
                                  ★ DIY 自建
                                </span>
                              )}
                              {roleMeta && (
                                <span className="p5-char-specialty-pill">
                                  {roleMeta.specialtyTag}
                                </span>
                              )}
                              {hasActiveRoom && (
                                <span
                                  className="p5-char-room-active-badge"
                                  data-testid={`char-room-active-${ch.id}`}
                                >
                                  ● 房间记忆中
                                </span>
                              )}
                            </div>
                            <span className="p5-char-card-tagline">
                              {pack.tagline}
                            </span>
                          </div>
                          <span
                            className={`p5-char-card-status ${
                              isCurrent ? 'is-current' : ''
                            }`}
                          >
                            {isCurrent ? '★ 当前使用' : '切换角色'}
                          </span>
                        </div>

                        {/* 第 2 层：独立大脑与专属房间模型选择 */}
                        <div
                          className="p5-char-card-model-bar"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span
                            className="p5-field-tag p5-brain-room-label"
                            data-testid={`char-brain-label-${ch.id}`}
                          >
                            独立大脑与专属房间：
                          </span>
                          <div className="p5-model-pills">
                            {pillCandidates.map((m) => {
                              const isSelectedModel = brainModel === m;
                              return (
                                <button
                                  key={m}
                                  type="button"
                                  data-testid={`char-brain-pill-${ch.id}-${m}`}
                                  className={`p5-model-chip-btn ${
                                    isSelectedModel ? 'is-selected' : ''
                                  }`}
                                  onClick={() => {
                                    onUpdateSettings({
                                      characterBrains: {
                                        [ch.id]: { model: m },
                                      },
                                    });
                                  }}
                                >
                                  {isSelectedModel ? `✓ ${m}` : m}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* 第 3 层：DIY 角色性格与定位文件配置 */}
                        <CharacterPersonaCardBar
                          characterId={ch.id}
                          pack={pack}
                          activeCharacterId={settings.activeCharacterId}
                          onUpdateSettings={onUpdateSettings}
                          onSwitchCharacter={onSwitchCharacter}
                          onEditCustomCharacter={(targetId) => {
                            setEditingCustomCharId(targetId);
                            setDiyCreatorOpen(true);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── TAB 2: AGENT 预设模式 (PRESETS) ── */}
            {activeTab === 'presets' && (
              <div
                className="p5-sys-panel"
                data-testid="system-panel-presets"
              >
                <div className="p5-sys-panel-head">
                  <h3>Agent 工作预设模式</h3>
                  <p className="p5-preset-lead">
                    选择角色调用工具与推进任务的方式。日常开发推荐「标准模式」，批量数据处理选「PTC 模式」，扩展新工具与自定义模式选「创造模式」。
                  </p>
                </div>

                <div className="p5-preset-section-label">内置预设模式</div>
                <div className="p5-preset-grid">
                  {BUILTIN_AGENT_PRESETS.map((preset, idx) => {
                    const currentPreset =
                      settings.worker.agentPreset || 'standard';
                    const isActive = currentPreset === preset.id;
                    const openDrawer = presetGuideOpen[preset.id] ?? null;

                    return (
                      <div
                        key={preset.id}
                        data-testid={`preset-card-${preset.id}`}
                        className={`p5-preset-card ${
                          idx % 2 === 1 ? 'is-alt-tilt' : ''
                        } ${isActive ? 'is-active' : ''}`}
                        onClick={() =>
                          onUpdateSettings({
                            worker: { agentPreset: preset.id },
                          })
                        }
                      >
                        <div className="p5-preset-card-head">
                          <div className="p5-preset-title-group">
                            <span className="p5-preset-name">{preset.name}</span>
                            {isActive ? (
                              <span className="p5-preset-badge is-default">
                                ★ 新任务默认
                              </span>
                            ) : (
                              <span className="p5-preset-badge">
                                {preset.badge}
                              </span>
                            )}
                          </div>
                          <code className="p5-preset-code">{preset.id}</code>
                        </div>

                        <p className="p5-preset-desc">{preset.description}</p>

                        {openDrawer && (
                          <div
                            className="p5-preset-drawer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {openDrawer === 'details' && (
                              <p>{preset.modeDetails}</p>
                            )}
                            {openDrawer === 'usage' && <p>{preset.howToUse}</p>}
                            {openDrawer === 'source' && (
                              <pre className="p5-preset-source-pre">
                                {presetSourceCache[preset.id] ||
                                  `# preset: ${preset.id}\n${preset.modeDetails}`}
                              </pre>
                            )}
                          </div>
                        )}

                        <div
                          className="p5-preset-footer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="p5-preset-links">
                            <button
                              type="button"
                              className={`p5-preset-link-btn ${
                                openDrawer === 'details' ? 'is-open' : ''
                              }`}
                              onClick={() =>
                                setPresetGuideOpen((prev) => ({
                                  ...prev,
                                  [preset.id]:
                                    prev[preset.id] === 'details'
                                      ? null
                                      : 'details',
                                }))
                              }
                            >
                              模式说明
                            </button>
                            <button
                              type="button"
                              className={`p5-preset-link-btn ${
                                openDrawer === 'usage' ? 'is-open' : ''
                              }`}
                              onClick={() =>
                                setPresetGuideOpen((prev) => ({
                                  ...prev,
                                  [preset.id]:
                                    prev[preset.id] === 'usage' ? null : 'usage',
                                }))
                              }
                            >
                              如何使用
                            </button>
                          </div>

                          <div className="p5-preset-actions">
                            <button
                              type="button"
                              className={`p5-preset-icon-btn ${
                                openDrawer === 'source' ? 'is-open' : ''
                              }`}
                              title="查看预设声明配置"
                              onClick={() => {
                                const nextOpen =
                                  openDrawer === 'source' ? null : 'source';
                                setPresetGuideOpen((prev) => ({
                                  ...prev,
                                  [preset.id]: nextOpen,
                                }));
                                if (
                                  nextOpen === 'source' &&
                                  !presetSourceCache[preset.id] &&
                                  window.__BIGFISH_PRESETS__?.readPresetSource
                                ) {
                                  void window.__BIGFISH_PRESETS__
                                    .readPresetSource(preset.id)
                                    .then((res) => {
                                      if (res?.content) {
                                        setPresetSourceCache((c) => ({
                                          ...c,
                                          [preset.id]: res.content,
                                        }));
                                      }
                                    })
                                    .catch(() => {});
                                }
                              }}
                            >
                              ≡
                            </button>
                            <button
                              type="button"
                              className={`p5-preset-select-btn ${
                                isActive ? 'is-selected' : ''
                              }`}
                              onClick={() =>
                                onUpdateSettings({
                                  worker: { agentPreset: preset.id },
                                })
                              }
                            >
                              {isActive ? '✓ 已启用' : '设为默认'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p5-preset-section-label">自定义预设</div>
                {customPresets.length > 0 && (
                  <div className="p5-preset-grid p5-preset-grid--custom">
                    {customPresets.map((preset) => {
                      const currentPreset =
                        settings.worker.agentPreset || 'standard';
                      const isActive = currentPreset === preset.id;
                      return (
                        <div
                          key={preset.id}
                          className={`p5-preset-card ${
                            isActive ? 'is-active' : ''
                          }`}
                          onClick={() =>
                            onUpdateSettings({
                              worker: { agentPreset: preset.id },
                            })
                          }
                        >
                          <div className="p5-preset-card-head">
                            <div className="p5-preset-title-group">
                              <span className="p5-preset-name">
                                {preset.name}
                              </span>
                              <span
                                className={`p5-preset-badge ${
                                  isActive ? 'is-default' : ''
                                }`}
                              >
                                {isActive ? '★ 新任务默认' : '自定义'}
                              </span>
                            </div>
                            <code className="p5-preset-code">{preset.id}</code>
                          </div>
                          <p className="p5-preset-desc">{preset.description}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  className="p5-preset-creator-cta"
                  data-testid="preset-creator-cta"
                  onClick={() => {
                    onUpdateSettings({ worker: { agentPreset: 'cordis' } });
                    window.__BIGFISH_PRESETS__?.startCreatorMode?.();
                    window.dispatchEvent(
                      new CustomEvent('bigfish:prefill-prompt', {
                        detail: {
                          prompt:
                            '基于标准模式帮我创建一个自定义预设模式：',
                        },
                      })
                    );
                    onClose();
                  }}
                >
                  <span className="p5-preset-creator-tag">CREATOR</span>
                  <span>＋ 让当前角色帮我创建专属预设模式</span>
                </button>
              </div>
            )}

            {/* ── TAB 3: AI 引擎底座 (WORKER) ── */}
            {activeTab === 'worker' && (
              <div className="p5-sys-panel" data-testid="system-panel-worker">
                <div className="p5-sys-panel-head">
                  <h3>AI 引擎底座设置</h3>
                  <p>
                    统一配置执行引擎（DeepSeek Harness / 直连模式）与全局默认模型。
                  </p>
                </div>

                <div className="p5-sys-form">
                  {workerAdapters.length > 0 && (
                    <div className="p5-form-group">
                      <label
                        className="p5-form-label"
                        htmlFor="worker-adapter-select"
                      >
                        核心执行引擎
                      </label>
                      <select
                        id="worker-adapter-select"
                        data-testid="worker-adapter-select"
                        className="p5-form-select"
                        value={settings.worker.adapter}
                        onChange={(e) =>
                          onUpdateSettings({
                            worker: { adapter: e.target.value },
                          })
                        }
                      >
                        {workerAdapters.map((ad) => (
                          <option
                            key={ad.id}
                            value={ad.id}
                            disabled={!ad.available}
                          >
                            {formatAdapterDisplayName(ad)}
                            {!ad.available ? '（未就绪）' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Model Picker first — most important for users */}
                  <ModelPicker
                    target="worker"
                    label="默认兜底模型"
                    currentModel={settings.worker.model}
                    draft={workerModelDraft}
                    onDraftChange={setWorkerModelDraft}
                    modelList={safeWorkerModels}
                    placeholder="搜索或输入模型名称（如 deepseek-chat / deepseek-reasoner）"
                    onRefresh={() => onListModels('worker')}
                    onApplyModel={(model) =>
                      onUpdateSettings({ worker: { model } })
                    }
                  />

                  <div className="p5-form-group" data-testid="worker-effort-group">
                    <label className="p5-form-label" htmlFor="worker-effort-select">
                      思考强度
                    </label>
                    {effortOptions.length > 0 ? (
                      <select
                        id="worker-effort-select"
                        className="p5-form-select"
                        value={currentEffort}
                        onChange={(e) =>
                          onUpdateSettings({ worker: { reasoningEffort: e.target.value } })
                        }
                      >
                        {!currentEffort && <option value="">模型默认</option>}
                        {effortOptions.map((eff) => (
                          <option key={eff.id} value={eff.id}>
                            {eff.name}
                            {eff.description ? ` — ${eff.description}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="p5-model-error-hint">当前模型不支持调节思考强度。</p>
                    )}
                  </div>

                  <div className="p5-form-group" data-testid="worker-image-group">
                    <span className="p5-form-label">输入类型</span>
                    {imageEditable ? (
                      <div className="p5-modality-row">
                        <label className="p5-modality-chip is-locked" title="文本输入始终开启">
                          <input type="checkbox" checked disabled /> 文本
                        </label>
                        <label className={`p5-modality-chip${imageSupported ? ' is-on' : ''}`}>
                          <input
                            type="checkbox"
                            data-testid="worker-image-toggle"
                            checked={imageSupported}
                            disabled={imageSaving}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setImageSaving(true);
                              setImageSaveError(null);
                              modalityBridge
                                .setSupportsImages(settings.worker.model, on)
                                .catch((err: unknown) =>
                                  setImageSaveError(err instanceof Error ? err.message : '保存失败')
                                )
                                .finally(() => setImageSaving(false));
                            }}
                          />{' '}
                          图片（看图）
                        </label>
                        {imageSaving && <span className="p5-model-error-hint">保存中…</span>}
                      </div>
                    ) : (
                      <p className="p5-model-error-hint">
                        该模型不在可编辑的模型配置中，按仅文本处理，舞台不允许上传图片。
                      </p>
                    )}
                    {imageSaveError && <p className="p5-pond-dir-error">{imageSaveError}</p>}
                  </div>

                  {/* ── DSH 原生：接入 GPT / Claude / 第三方模型服务商 ── */}
                  {providersBridge ? (
                    <div
                      className="p5-provider-hub-card"
                      data-testid="dsh-provider-hub"
                    >
                      <div className="p5-provider-hub-head">
                        <div>
                          <h4 className="p5-tts-card-title">
                            接入外部大模型（OpenAI GPT / Anthropic Claude / 兼容网关）
                          </h4>
                          <p className="p5-tts-card-sub">
                            配置后模型会自动出现在舞台左下角模型选择器与上方默认模型列表中；密钥独立加密保存在本机凭证库。
                          </p>
                        </div>
                      </div>

                      {extProviders.length > 0 && (
                        <div className="p5-provider-saved-list">
                          {extProviders.map((row) => (
                            <div
                              key={row.route}
                              className="p5-provider-saved-item"
                              data-testid={`saved-provider-${row.route}`}
                            >
                              <div className="p5-provider-saved-main">
                                <span className="p5-provider-saved-name">
                                  {row.displayName}
                                </span>
                                <code className="p5-preset-code">
                                  {row.route}
                                </code>
                                <span
                                  className={`p5-provider-key-pill ${
                                    row.keyConfigured ? 'is-ok' : 'is-warn'
                                  }`}
                                >
                                  {row.keyConfigured ? '● 密钥已就绪' : '○ 待填密钥'}
                                </span>
                                <span className="p5-provider-model-count">
                                  {row.models.length > 0
                                    ? `${row.models.length} 个指定模型`
                                    : '官方内置全系模型'}
                                </span>
                              </div>
                              <div className="p5-provider-saved-actions">
                                <button
                                  type="button"
                                  className="p5-mini-action-btn"
                                  onClick={() => {
                                    setProvNotice(null);
                                    if (row.route === 'openai') {
                                      setProvMode('openai');
                                    } else if (row.route === 'anthropic') {
                                      setProvMode('anthropic');
                                    } else {
                                      setProvMode('custom');
                                    }
                                    setProvRoute(row.route);
                                    setProvDisplayName(row.displayName);
                                    if (
                                      row.api === 'openai-completions' ||
                                      row.api === 'openai-responses' ||
                                      row.api === 'anthropic-messages'
                                    ) {
                                      setProvApi(row.api);
                                    }
                                    setProvBaseUrl(row.baseURL ?? '');
                                    setProvApiKey('');
                                    setProvModelsText(
                                      row.models.map((m) => m.id).join(', ')
                                    );
                                  }}
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  className="p5-mini-action-btn p5-mini-action-btn--accent"
                                  disabled={provBusy}
                                  onClick={() => {
                                    if (!providersBridge.removeProvider) return;
                                    setProvBusy(true);
                                    setProvNotice(null);
                                    providersBridge
                                      .removeProvider(row.route)
                                      .then(() => {
                                        reloadExtProviders();
                                        onListModels('worker');
                                        setProvNotice({
                                          ok: true,
                                          text: `已移除服务商「${row.displayName}」`,
                                        });
                                      })
                                      .catch((err: unknown) =>
                                        setProvNotice({
                                          ok: false,
                                          text:
                                            err instanceof Error
                                              ? err.message
                                              : '移除失败',
                                        })
                                      )
                                      .finally(() => setProvBusy(false));
                                  }}
                                >
                                  移除
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 3 Preset Quick Templates */}
                      <div className="p5-provider-template-bar">
                        <button
                          type="button"
                          className={`p5-provider-tpl-btn ${
                            provMode === 'openai' ? 'is-active' : ''
                          }`}
                          onClick={() => applyProviderPresetTemplate('openai')}
                        >
                          ＋ OpenAI (GPT 系列)
                        </button>
                        <button
                          type="button"
                          className={`p5-provider-tpl-btn ${
                            provMode === 'anthropic' ? 'is-active' : ''
                          }`}
                          onClick={() =>
                            applyProviderPresetTemplate('anthropic')
                          }
                        >
                          ＋ Anthropic (Claude 系列)
                        </button>
                        <button
                          type="button"
                          className={`p5-provider-tpl-btn ${
                            provMode === 'custom' ? 'is-active' : ''
                          }`}
                          onClick={() => applyProviderPresetTemplate('custom')}
                        >
                          ＋ 自定义中转 / 兼容网关
                        </button>
                      </div>

                      <div className="p5-provider-form-grid">
                        {provMode === 'custom' && (
                          <>
                            <div className="p5-provider-field">
                              <label className="p5-form-label">
                                服务商代号（英文标识）
                              </label>
                              <input
                                type="text"
                                className="p5-form-input"
                                value={provRoute}
                                onChange={(e) => setProvRoute(e.target.value)}
                                placeholder="如 openrouter / company-gateway"
                              />
                            </div>
                            <div className="p5-provider-field">
                              <label className="p5-form-label">显示名称</label>
                              <input
                                type="text"
                                className="p5-form-input"
                                value={provDisplayName}
                                onChange={(e) =>
                                  setProvDisplayName(e.target.value)
                                }
                                placeholder="如 OpenRouter / 企业网关"
                              />
                            </div>
                            <div className="p5-provider-field p5-provider-field--full">
                              <label className="p5-form-label">接口协议</label>
                              <select
                                className="p5-form-select"
                                value={provApi}
                                onChange={(e) =>
                                  setProvApi(
                                    e.target.value as
                                      | 'openai-completions'
                                      | 'openai-responses'
                                      | 'anthropic-messages'
                                  )
                                }
                              >
                                <option value="openai-completions">
                                  OpenAI Chat Completions 兼容（/v1/chat/completions · 最通用）
                                </option>
                                <option value="openai-responses">
                                  OpenAI Responses 协议（/v1/responses · GPT 新协议）
                                </option>
                                <option value="anthropic-messages">
                                  Anthropic Messages 协议（/v1/messages · Claude 原生协议）
                                </option>
                              </select>
                            </div>
                          </>
                        )}

                        <div className="p5-provider-field p5-provider-field--full">
                          <label className="p5-form-label">
                            接口地址 (Base URL)
                            {provMode !== 'custom' && (
                              <span className="p5-provider-opt-hint">
                                （选填：留空直连官方接口，走代理可填代理地址）
                              </span>
                            )}
                          </label>
                          <input
                            type="text"
                            className="p5-form-input"
                            value={provBaseUrl}
                            onChange={(e) => setProvBaseUrl(e.target.value)}
                            placeholder={
                              provMode === 'openai'
                                ? 'https://api.openai.com/v1（留空默认官方）'
                                : provMode === 'anthropic'
                                ? 'https://api.anthropic.com（留空默认官方）'
                                : 'https://openrouter.ai/api/v1'
                            }
                          />
                        </div>

                        <div className="p5-provider-field p5-provider-field--full">
                          <label className="p5-form-label">
                            接口密钥 (API Key)
                            {extProviders.find((r) => r.route === provRoute)
                              ?.keyConfigured && (
                              <span className="p5-provider-opt-hint is-green">
                                （已保存密钥，不修改可留空）
                              </span>
                            )}
                          </label>
                          <input
                            type="password"
                            className="p5-form-input"
                            value={provApiKey}
                            onChange={(e) => setProvApiKey(e.target.value)}
                            placeholder={
                              provMode === 'anthropic'
                                ? 'sk-ant-...'
                                : 'sk-...'
                            }
                            autoComplete="off"
                          />
                        </div>

                        <div className="p5-provider-field p5-provider-field--full">
                          <div className="p5-form-label-row">
                            <label className="p5-form-label">
                              模型 ID 列表（逗号或换行分隔）
                              {provMode !== 'custom' && (
                                <span className="p5-provider-opt-hint">
                                  （留空即自动载入官方全系 GPT/Claude 模型与推理强度档位）
                                </span>
                              )}
                            </label>
                            <button
                              type="button"
                              className="p5-mini-action-btn"
                              disabled={provProbing || provBusy}
                              onClick={() => {
                                if (!providersBridge.discoverModels) return;
                                setProvProbing(true);
                                setProvNotice(null);
                                providersBridge
                                  .discoverModels({
                                    provider:
                                      provMode !== 'custom'
                                        ? provRoute
                                        : undefined,
                                    baseURL: provBaseUrl.trim() || undefined,
                                    api:
                                      provMode === 'custom'
                                        ? provApi
                                        : undefined,
                                    apiKey: provApiKey.trim() || undefined,
                                  })
                                  .then((found) => {
                                    if (found.length === 0) {
                                      setProvNotice({
                                        ok: false,
                                        text: '接口未返回模型列表，请手动填写模型 ID',
                                      });
                                      return;
                                    }
                                    setProvModelsText(
                                      found.map((m) => m.id).join(', ')
                                    );
                                    setProvNotice({
                                      ok: true,
                                      text: `成功探测到 ${found.length} 个可用模型！点击下方保存即可载入。`,
                                    });
                                  })
                                  .catch((err: unknown) =>
                                    setProvNotice({
                                      ok: false,
                                      text:
                                        err instanceof Error
                                          ? err.message
                                          : '自动探测失败，可手动输入模型 ID',
                                    })
                                  )
                                  .finally(() => setProvProbing(false));
                              }}
                            >
                              {provProbing ? '探测中…' : '↻ 从接口自动探测模型'}
                            </button>
                          </div>
                          <input
                            type="text"
                            className="p5-form-input"
                            value={provModelsText}
                            onChange={(e) => setProvModelsText(e.target.value)}
                            placeholder={
                              provMode === 'openai'
                                ? '留空自动使用官方全系模型；或手填如 gpt-5, o3, gpt-4o'
                                : provMode === 'anthropic'
                                ? '留空自动使用官方全系模型；或手填如 claude-opus-4-6, claude-sonnet-4-6'
                                : '必填，如 openai/gpt-4o, anthropic/claude-sonnet-4-5'
                            }
                          />
                        </div>
                      </div>

                      {provNotice && (
                        <div
                          className={`p5-provider-notice ${
                            provNotice.ok ? 'is-ok' : 'is-err'
                          }`}
                        >
                          {provNotice.text}
                        </div>
                      )}

                      <div className="p5-provider-submit-row">
                        <button
                          type="button"
                          className="p5-apply-btn"
                          data-testid="save-dsh-provider-btn"
                          disabled={provBusy}
                          onClick={() => {
                            if (!providersBridge.saveProvider) return;
                            setProvBusy(true);
                            setProvNotice(null);
                            const parsedModels = provModelsText
                              .split(/[,\n]+/)
                              .map((s) => s.trim())
                              .filter(Boolean)
                              .map((id) => ({
                                id,
                                input: ['text', 'image'],
                              }));
                            providersBridge
                              .saveProvider({
                                route:
                                  provMode === 'openai'
                                    ? 'openai'
                                    : provMode === 'anthropic'
                                    ? 'anthropic'
                                    : provRoute,
                                displayName: provDisplayName,
                                api: provApi,
                                baseURL: provBaseUrl,
                                apiKey: provApiKey,
                                models: parsedModels,
                              })
                              .then(() => {
                                setProvApiKey('');
                                reloadExtProviders();
                                onListModels('worker');
                                setProvNotice({
                                  ok: true,
                                  text: '✓ 已保存并载入模型目录！现在可在上方默认模型或舞台左下角直接选择。',
                                });
                              })
                              .catch((err: unknown) =>
                                setProvNotice({
                                  ok: false,
                                  text:
                                    err instanceof Error
                                      ? err.message
                                      : '保存失败',
                                })
                              )
                              .finally(() => setProvBusy(false));
                          }}
                        >
                          {provBusy ? '正在保存…' : '✦ 保存并载入外部模型'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Test Connection */}
                      <div className="p5-form-group p5-conn-test-row">
                        <button
                          type="button"
                          className="p5-apply-btn p5-apply-btn--test"
                          data-testid="worker-test-conn-btn"
                          onClick={() => onTestConnection('worker')}
                          disabled={safeWorkerConn.testing}
                        >
                          {safeWorkerConn.testing ? '正在检测…' : '检测连接状态'}
                        </button>

                        <ConnectionTestResult
                          target="worker"
                          state={safeWorkerConn}
                        />
                      </div>

                      {/* Collapsible Advanced Settings */}
                      <div>
                        <button
                          type="button"
                          className="p5-mini-action-btn"
                          onClick={() => setShowWorkerAdvanced((v) => !v)}
                        >
                          {showWorkerAdvanced
                            ? '▾ 收起高级接口设置'
                            : '▸ 高级接口设置（一般无需修改）'}
                        </button>
                      </div>

                      {showWorkerAdvanced && (
                        <>
                          <div className="p5-form-group">
                            <label
                              className="p5-form-label"
                              htmlFor="worker-connection-select"
                            >
                              账号与接口来源
                            </label>
                            <select
                              id="worker-connection-select"
                              data-testid="worker-connection-select"
                              className="p5-form-select"
                              value={settings.worker.connection}
                              onChange={(e) => {
                                setWorkerApiKeyDraft('');
                                onUpdateSettings({
                                  worker: {
                                    connection: e.target.value as
                                      | 'endpoint'
                                      | 'agent-default',
                                  },
                                });
                              }}
                            >
                              <option value="agent-default">
                                直接使用本机已登录账号（推荐）
                              </option>
                              <option value="endpoint">自定义接口地址</option>
                            </select>
                          </div>

                          {settings.worker.connection === 'endpoint' && (
                            <>
                              <div className="p5-form-group">
                                <label
                                  className="p5-form-label"
                                  htmlFor="worker-baseurl-input"
                                >
                                  接口地址
                                </label>
                                <div className="p5-input-inline-row">
                                  <input
                                    id="worker-baseurl-input"
                                    data-testid="worker-baseurl-input"
                                    type="text"
                                    className="p5-form-input"
                                    value={workerBaseUrlDraft}
                                    onChange={(e) =>
                                      setWorkerBaseUrlDraft(e.target.value)
                                    }
                                    placeholder="https://api.deepseek.com/v1"
                                  />
                                  <button
                                    type="button"
                                    className="p5-apply-btn"
                                    data-testid="worker-baseurl-save-btn"
                                    onClick={() => {
                                      const baseUrl = workerBaseUrlDraft.trim();
                                      if (baseUrl)
                                        onUpdateSettings({
                                          worker: { endpoint: { baseUrl } },
                                        });
                                    }}
                                  >
                                    保存
                                  </button>
                                </div>
                              </div>

                              <div className="p5-form-group">
                                <div className="p5-form-label-row">
                                  <label
                                    className="p5-form-label"
                                    htmlFor="worker-apikey-input"
                                  >
                                    接口密钥 (API Key)
                                  </label>
                                  <span
                                    className={`p5-apikey-status ${
                                      settings.worker.endpoint.apiKeySet
                                        ? 'is-set'
                                        : 'is-unset'
                                    }`}
                                    data-testid="worker-apikey-status"
                                  >
                                    {settings.worker.endpoint.apiKeySet
                                      ? '已设置'
                                      : '未设置'}
                                  </span>
                                </div>
                                <div className="p5-input-inline-row">
                                  <input
                                    id="worker-apikey-input"
                                    data-testid="worker-apikey-input"
                                    type="password"
                                    className="p5-form-input"
                                    value={workerApiKeyDraft}
                                    onChange={(e) =>
                                      setWorkerApiKeyDraft(e.target.value)
                                    }
                                    placeholder="无需密钥时可留空"
                                    autoComplete="off"
                                  />
                                  <button
                                    type="button"
                                    className="p5-apply-btn"
                                    data-testid="worker-apikey-save-btn"
                                    onClick={() => {
                                      const apiKey = workerApiKeyDraft.trim();
                                      if (!apiKey) return;
                                      onUpdateSettings({
                                        worker: { endpoint: { apiKey } },
                                      });
                                      setWorkerApiKeyDraft('');
                                    }}
                                  >
                                    保存
                                  </button>
                                  {settings.worker.endpoint.apiKeySet && (
                                    <button
                                      type="button"
                                      className="p5-apply-btn p5-apply-btn--danger"
                                      data-testid="worker-apikey-clear-btn"
                                      onClick={() => {
                                        setWorkerApiKeyDraft('');
                                        onUpdateSettings({
                                          worker: { endpoint: { apiKey: '' } },
                                        });
                                      }}
                                    >
                                      清除密钥
                                    </button>
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── TAB 3: 互动台词 (VOICE) ── */}
            {activeTab === 'voice' && (
              <div className="p5-sys-panel" data-testid="system-panel-voice">
                <div className="p5-sys-panel-head">
                  <h3>互动台词设置</h3>
                  <p>配置角色在舞台事件与点击互动时的自由台词生成。</p>
                </div>

                <div className="p5-sys-form">
                  {/* ── AI 自由互动台词 ── */}
                  <div className="p5-form-group p5-form-group--inline">
                    <label className="p5-form-label">AI 自由互动台词</label>
                    <button
                      type="button"
                      data-testid="voice-enabled-toggle"
                      className={`p5-toggle-btn ${
                        settings.voice.enabled ? 'is-on' : 'is-off'
                      }`}
                      onClick={() =>
                        onUpdateSettings({
                          voice: { enabled: !settings.voice.enabled },
                        })
                      }
                    >
                      {settings.voice.enabled ? '● 已开启' : '○ 已关闭'}
                    </button>
                  </div>

                  {settings.voice.enabled && (
                    <>
                      <ModelPicker
                        target="voice"
                        label="台词模型"
                        currentModel={settings.voice.endpoint.model}
                        draft={voiceModelDraft}
                        onDraftChange={setVoiceModelDraft}
                        modelList={safeVoiceModels}
                        placeholder="选择用于生成角色台词的模型"
                        refreshLabel="↻ 刷新列表"
                        onRefresh={() => onListModels('voice')}
                        onApplyModel={(model) =>
                          onUpdateSettings({ voice: { endpoint: { model } } })
                        }
                      />

                      <div className="p5-form-group p5-conn-test-row">
                        <button
                          type="button"
                          className="p5-apply-btn p5-apply-btn--test"
                          data-testid="voice-test-conn-btn"
                          onClick={() => onTestConnection('voice')}
                          disabled={safeVoiceConn.testing}
                        >
                          {safeVoiceConn.testing ? '正在检测…' : '检测连接状态'}
                        </button>

                        <ConnectionTestResult
                          target="voice"
                          state={safeVoiceConn}
                        />
                      </div>

                      <div>
                        <button
                          type="button"
                          className="p5-mini-action-btn"
                          onClick={() => setShowVoiceAdvanced((v) => !v)}
                        >
                          {showVoiceAdvanced
                            ? '▾ 收起高级接口设置'
                            : '▸ 高级接口设置（一般无需修改）'}
                        </button>
                      </div>

                      {showVoiceAdvanced && (
                        <>
                          <div className="p5-form-group">
                            <label
                              className="p5-form-label"
                              htmlFor="voice-baseurl-input"
                            >
                              接口地址
                            </label>
                            <div className="p5-input-inline-row">
                              <input
                                id="voice-baseurl-input"
                                data-testid="voice-baseurl-input"
                                type="text"
                                className="p5-form-input"
                                value={voiceBaseUrlDraft}
                                onChange={(e) =>
                                  setVoiceBaseUrlDraft(e.target.value)
                                }
                                placeholder="https://api.deepseek.com/v1"
                              />
                              <button
                                type="button"
                                className="p5-apply-btn"
                                data-testid="voice-baseurl-save-btn"
                                onClick={() => {
                                  const trimmed = voiceBaseUrlDraft.trim();
                                  if (trimmed) {
                                    onUpdateSettings({
                                      voice: { endpoint: { baseUrl: trimmed } },
                                    });
                                  }
                                }}
                              >
                                保存
                              </button>
                            </div>
                          </div>

                          <div className="p5-form-group">
                            <div className="p5-form-label-row">
                              <label
                                className="p5-form-label"
                                htmlFor="voice-apikey-input"
                              >
                                接口密钥 (API Key)
                              </label>
                              <span
                                className={`p5-apikey-status ${
                                  settings.voice.endpoint.apiKeySet
                                    ? 'is-set'
                                    : 'is-unset'
                                }`}
                                data-testid="voice-apikey-status"
                              >
                                {settings.voice.endpoint.apiKeySet
                                  ? '已设置'
                                  : '未设置'}
                              </span>
                            </div>

                            <div className="p5-input-inline-row">
                              <input
                                id="voice-apikey-input"
                                data-testid="voice-apikey-input"
                                type="password"
                                className="p5-form-input"
                                value={voiceApiKeyDraft}
                                onChange={(e) =>
                                  setVoiceApiKeyDraft(e.target.value)
                                }
                                placeholder="无需密钥时可留空"
                                autoComplete="off"
                              />
                              <button
                                type="button"
                                className="p5-apply-btn"
                                data-testid="voice-apikey-save-btn"
                                onClick={() => {
                                  if (!voiceApiKeyDraft.trim()) return;
                                  onUpdateSettings({
                                    voice: {
                                      endpoint: {
                                        apiKey: voiceApiKeyDraft.trim(),
                                      },
                                    },
                                  });
                                  setVoiceApiKeyDraft('');
                                }}
                              >
                                保存
                              </button>
                              {settings.voice.endpoint.apiKeySet && (
                                <button
                                  type="button"
                                  className="p5-apply-btn p5-apply-btn--danger"
                                  data-testid="voice-apikey-clear-btn"
                                  onClick={() => {
                                    setVoiceApiKeyDraft('');
                                    onUpdateSettings({
                                      voice: { endpoint: { apiKey: '' } },
                                    });
                                  }}
                                >
                                  清除密钥
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── TAB 4: 工作文件夹 (POND) ── */}
            {activeTab === 'pond' && (
              <div className="p5-sys-panel" data-testid="system-panel-pond">
                <div className="p5-sys-panel-head">
                  <h3>工作文件夹</h3>
                </div>

                <div className="p5-sys-form">
                  <div className="p5-form-group">
                    <label
                      className="p5-form-label"
                      htmlFor="pond-project-dir-input"
                    >
                      当前文件夹路径
                    </label>
                    <div className="p5-input-inline-row">
                      <input
                        id="pond-project-dir-input"
                        data-testid="pond-project-dir-input"
                        type="text"
                        className="p5-form-input"
                        value={projectDirDraft}
                        onChange={(e) => {
                          setProjectDirDraft(e.target.value);
                          if (dirPickError) setDirPickError(null);
                        }}
                        placeholder="/Users/你的名字/项目文件夹"
                      />
                      <button
                        type="button"
                        className="p5-apply-btn p5-apply-btn--test"
                        onClick={async () => {
                          setDirPickError(null);
                          try {
                            const electronAPI = (
                              window as unknown as {
                                electronAPI?: {
                                  pickDirectory: () => Promise<string | null>;
                                };
                              }
                            ).electronAPI;
                            if (electronAPI?.pickDirectory) {
                              const picked = await electronAPI.pickDirectory();
                              if (picked) {
                                setProjectDirDraft(picked);
                                onUpdateSettings({ projectDir: picked });
                              }
                              return;
                            }
                            const res = await fetch('/api/pick-directory', {
                              method: 'POST',
                            });
                            const data = await res
                              .json()
                              .catch(() => ({} as Record<string, unknown>));
                            if (!res.ok) {
                              setDirPickError(
                                (typeof data.error === 'string' && data.error) ||
                                  (typeof data.message === 'string' && data.message) ||
                                  `无法唤起系统文件夹选择器（HTTP ${res.status}），请在上方输入框直接粘贴路径。`
                              );
                              return;
                            }
                            if (data.cancelled) {
                              return;
                            }
                            if (data.ok && typeof data.path === 'string' && data.path) {
                              setProjectDirDraft(data.path);
                              onUpdateSettings({ projectDir: data.path });
                            } else if (data.ok === false) {
                              setDirPickError(
                                (typeof data.error === 'string' && data.error) ||
                                  (typeof data.message === 'string' && data.message) ||
                                  '无法打开系统文件夹选择器，请在上方输入框直接填写文件夹路径。'
                              );
                            }
                          } catch {
                            setDirPickError(
                              '无法连接本地服务以打开文件夹选择器，请在上方输入框直接填写文件夹路径。'
                            );
                          }
                        }}
                      >
                        📁 选择文件夹
                      </button>
                      <button
                        type="button"
                        className="p5-apply-btn"
                        data-testid="pond-save-dir-btn"
                        onClick={() => {
                          const trimmed = projectDirDraft.trim();
                          if (trimmed) {
                            setDirPickError(null);
                            onUpdateSettings({ projectDir: trimmed });
                          }
                        }}
                      >
                        保存
                      </button>
                    </div>
                    {dirPickError && (
                      <p
                        className="p5-pond-dir-error"
                        data-testid="pond-pick-dir-error"
                        role="alert"
                      >
                        {dirPickError}
                      </p>
                    )}
                  </div>

                  {onStartNewSessionWithDir && (
                    <div className="p5-form-group">
                      <button
                        type="button"
                        className="p5-new-session-cta"
                        data-testid="pond-new-session-btn"
                        onClick={() => {
                          const targetDir =
                            projectDirDraft.trim() || settings.projectDir || '';
                          if (targetDir) {
                            onStartNewSessionWithDir(targetDir);
                          }
                        }}
                      >
                        ★ 进入该文件夹并开始新对话
                      </button>
                    </div>
                  )}

                  {settings.recentProjects.length > 0 && (
                    <div className="p5-form-group">
                      <span className="p5-form-label">最近打开的文件夹</span>
                      <div
                        className="p5-recent-projects-list"
                        data-testid="pond-recent-list"
                      >
                        {settings.recentProjects.map((dir) => (
                          <div key={dir} className="p5-recent-project-item">
                            <code className="p5-recent-path">{dir}</code>
                            <div className="p5-recent-actions">
                              <button
                                type="button"
                                className="p5-mini-action-btn p5-mini-action-btn--accent"
                                onClick={() => {
                                  setProjectDirDraft(dir);
                                  if (onStartNewSessionWithDir) {
                                    onStartNewSessionWithDir(dir);
                                  } else {
                                    onUpdateSettings({ projectDir: dir });
                                  }
                                }}
                              >
                                切换到此文件夹 ▶
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── TAB 5: 显示速度 (PERFORMANCE) ── */}
            {activeTab === 'performance' && (
              <div
                className="p5-sys-panel"
                data-testid="system-panel-performance"
              >
                <div className="p5-sys-panel-head">
                  <h3>对话显示速度</h3>
                </div>

                <div className="p5-sys-form">
                  <div className="p5-form-group">
                    <label
                      className="p5-form-label"
                      htmlFor="perf-typing-speed-input"
                    >
                      台词逐字显示速度：
                      <strong data-testid="perf-current-speed-val">
                        {settings.performance.typingCharsPerSec} 字/秒
                      </strong>
                    </label>
                    <div className="p5-input-inline-row">
                      <input
                        id="perf-typing-speed-input"
                        data-testid="perf-typing-speed-input"
                        type="range"
                        min={10}
                        max={120}
                        step={5}
                        className="p5-form-range"
                        value={typingSpeedDraft}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setTypingSpeedDraft(v);
                          onUpdateSettings({
                            performance: { typingCharsPerSec: v },
                          });
                        }}
                      />
                      <span className="p5-range-val">{typingSpeedDraft} 字/秒</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
