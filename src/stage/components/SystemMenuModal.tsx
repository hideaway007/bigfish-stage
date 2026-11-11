import React, { useEffect, useState } from 'react';
import type { CharacterSummary } from '../../shared/character-pack';
import {
  DEFAULT_CHARACTER_VOICES,
  type PublicSettings,
  type SettingsPatch,
  type WorkerAdapterInfo,
} from '../../shared/settings';
import { getCachedCharacterPack } from '../characterLoader';
import { CHARACTER_ROLE_META } from '../touchReactions';
import { setTtsMuted } from '../ttsPlayer';
import { ModelPicker } from './settings/ModelPicker';
import { ConnectionTestResult } from './settings/ConnectionTestResult';
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
  ttsConnTest?: ConnectionTestState;
  onSelectTab: (tab: SystemMenuTab) => void;
  onClose: () => void;
  onSwitchCharacter: (characterId: string) => void;
  onUpdateSettings: (patch: SettingsPatch) => void;
  onListModels: (target: 'worker' | 'voice') => void;
  onTestConnection: (target: 'worker' | 'voice' | 'tts') => void;
  onSynthesizeTts?: (characterId: string, text: string) => void;
  onStartNewSessionWithDir?: (projectDir: string) => void;
}

const DEFAULT_MODEL_LIST: ModelListState = {
  models: [],
  loading: false,
};

const DEFAULT_CONN_TEST: ConnectionTestState = {
  testing: false,
};

const TABS: Array<{ id: SystemMenuTab; zh: string }> = [
  { id: 'characters', zh: '角色与模型' },
  { id: 'worker', zh: 'AI 引擎' },
  { id: 'voice', zh: '台词与语音' },
  { id: 'pond', zh: '工作文件夹' },
  { id: 'performance', zh: '显示速度' },
];

const CHIRP3_HD_FEMALE_VOICES: Array<{ value: string; label: string }> = [
  { value: 'cmn-CN-Chirp3-HD-Leda', label: 'Leda · 元气清亮' },
  { value: 'cmn-CN-Chirp3-HD-Aoede', label: 'Aoede · 甜酷灵动' },
  { value: 'cmn-CN-Chirp3-HD-Achernar', label: 'Achernar · 温柔知性' },
  { value: 'cmn-CN-Chirp3-HD-Zephyr', label: 'Zephyr · 轻柔困倦' },
  { value: 'cmn-CN-Chirp3-HD-Kore', label: 'Kore · 明快干练' },
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
  ttsConnTest = DEFAULT_CONN_TEST,
  onSelectTab,
  onClose,
  onSwitchCharacter,
  onUpdateSettings,
  onListModels,
  onTestConnection,
  onSynthesizeTts,
  onStartNewSessionWithDir,
}) => {
  const safeWorkerModels = workerModels ?? DEFAULT_MODEL_LIST;
  const safeVoiceModels = voiceModels ?? DEFAULT_MODEL_LIST;
  const safeWorkerConn = workerConnTest ?? DEFAULT_CONN_TEST;
  const safeVoiceConn = voiceConnTest ?? DEFAULT_CONN_TEST;
  const safeTtsConn = ttsConnTest ?? DEFAULT_CONN_TEST;

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
  const [ttsRateDraft, setTtsRateDraft] = useState(
    settings.tts?.speakingRate ?? 1.04
  );
  const [ttsBaseUrlDraft, setTtsBaseUrlDraft] = useState(
    settings.tts?.endpoint?.baseUrl ?? 'https://texttospeech.googleapis.com'
  );
  const [ttsApiKeyDraft, setTtsApiKeyDraft] = useState('');
  const [ttsGcpProjectDraft, setTtsGcpProjectDraft] = useState(
    settings.tts?.gcpProject ?? ''
  );
  const [projectDirDraft, setProjectDirDraft] = useState(
    settings.projectDir ?? ''
  );
  const [typingSpeedDraft, setTypingSpeedDraft] = useState(
    settings.performance.typingCharsPerSec
  );
  const [showWorkerAdvanced, setShowWorkerAdvanced] = useState(false);
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);
  const [showTtsAdvanced, setShowTtsAdvanced] = useState(false);
  const [dirPickError, setDirPickError] = useState<string | null>(null);

  useEffect(() => {
    setWorkerModelDraft(settings.worker.model);
    setWorkerBaseUrlDraft(settings.worker.endpoint.baseUrl);
    setVoiceBaseUrlDraft(settings.voice.endpoint.baseUrl);
    setVoiceModelDraft(settings.voice.endpoint.model);
    setTtsRateDraft(settings.tts?.speakingRate ?? 1.04);
    setTtsBaseUrlDraft(
      settings.tts?.endpoint?.baseUrl ?? 'https://texttospeech.googleapis.com'
    );
    setTtsGcpProjectDraft(settings.tts?.gcpProject ?? '');
    setProjectDirDraft(settings.projectDir ?? '');
    setTypingSpeedDraft(settings.performance.typingCharsPerSec);
  }, [settings, settingsSyncedAt]);

  useEffect(() => {
    if (!open) {
      setDirPickError(null);
      return;
    }
    if (activeTab === 'worker') {
      onListModels('worker');
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
                <div className="p5-sys-panel-head">
                  <h3>角色与独立大脑</h3>
                  <p>
                    每位角色拥有「独立大脑与专属房间」：单独记住各自的模型与对话历史，切换角色不串记忆。
                  </p>
                </div>

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
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── TAB 2: AI 引擎底座 (WORKER) ── */}
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
                </div>
              </div>
            )}

            {/* ── TAB 3: 台词与语音 (VOICE & GOOGLE CLOUD TTS) ── */}
            {activeTab === 'voice' && (
              <div className="p5-sys-panel" data-testid="system-panel-voice">
                <div className="p5-sys-panel-head">
                  <h3>台词与语音设置</h3>
                  <p>配置角色实时开口说话（Google TTS）与自由互动台词生成。</p>
                </div>

                <div className="p5-sys-form">
                  {/* ── 角色语音 (Google TTS) ── */}
                  <div
                    className="p5-tts-settings-card"
                    data-testid="tts-settings-section"
                  >
                    <div className="p5-tts-card-head">
                      <div>
                        <h4 className="p5-tts-card-title">
                          角色语音 (Google TTS)
                        </h4>
                        <p className="p5-tts-card-sub">
                          角色说出台词时实时播报中文女声，并驱动舞台口型与声波跳动。
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="tts-enabled-toggle"
                        className={`p5-toggle-btn ${
                          settings.tts?.enabled ? 'is-on' : 'is-off'
                        }`}
                        onClick={() => {
                          const nextEnabled = !settings.tts?.enabled;
                          setTtsMuted(!nextEnabled, true);
                          onUpdateSettings({
                            tts: { enabled: nextEnabled },
                          });
                        }}
                      >
                        {settings.tts?.enabled ? '● 已开启' : '○ 已关闭'}
                      </button>
                    </div>

                    {settings.tts?.enabled && (
                      <div className="p5-tts-card-body">
                        <div className="p5-sys-grid-2">
                          <div className="p5-form-group">
                            <label
                              className="p5-form-label"
                              htmlFor="tts-provider-select"
                            >
                              语音引擎
                            </label>
                            <select
                              id="tts-provider-select"
                              data-testid="tts-provider-select"
                              className="p5-form-select"
                              value={settings.tts.provider}
                              onChange={(e) =>
                                onUpdateSettings({
                                  tts: {
                                    provider: e.target.value as
                                      | 'google-cloud'
                                      | 'openai-tts',
                                  },
                                })
                              }
                            >
                              <option value="google-cloud">
                                Google Cloud Chirp3-HD（本机中文女声 · 推荐）
                              </option>
                              <option value="openai-tts">
                                OpenAI 兼容语音合成 (TTS)
                              </option>
                            </select>
                          </div>

                          <div className="p5-form-group">
                            <label
                              className="p5-form-label"
                              htmlFor="tts-rate-slider"
                            >
                              播报语速：
                              <strong>{ttsRateDraft.toFixed(2)}x</strong>
                            </label>
                            <input
                              id="tts-rate-slider"
                              data-testid="tts-rate-slider"
                              type="range"
                              min={0.7}
                              max={1.4}
                              step={0.02}
                              className="p5-form-range"
                              value={ttsRateDraft}
                              onChange={(e) => {
                                const nextRate = Number(e.target.value);
                                setTtsRateDraft(nextRate);
                                onUpdateSettings({
                                  tts: { speakingRate: nextRate },
                                });
                              }}
                            />
                          </div>
                        </div>

                        {/* 4 Character Chirp3-HD Voice Dropdowns */}
                        <div className="p5-form-group">
                          <span className="p5-form-label">
                            各角色专属声线（Chirp3-HD 中文女声）
                          </span>
                          <div className="p5-tts-voice-grid">
                            {characters.map((ch) => {
                              const shortName = ch.name.split('（')[0];
                              const currentVoice =
                                settings.tts.characterVoices?.[ch.id] ??
                                DEFAULT_CHARACTER_VOICES[ch.id] ??
                                'cmn-CN-Chirp3-HD-Leda';
                              const hasPreset = CHIRP3_HD_FEMALE_VOICES.some(
                                (v) => v.value === currentVoice
                              );
                              return (
                                <div
                                  key={ch.id}
                                  className="p5-tts-voice-item"
                                >
                                  <label
                                    htmlFor={`tts-voice-${ch.id}`}
                                    className="p5-tts-voice-char"
                                  >
                                    {shortName}
                                  </label>
                                  <select
                                    id={`tts-voice-${ch.id}`}
                                    data-testid={`tts-voice-select-${ch.id}`}
                                    className="p5-form-select"
                                    value={currentVoice}
                                    onChange={(e) =>
                                      onUpdateSettings({
                                        tts: {
                                          characterVoices: {
                                            ...settings.tts.characterVoices,
                                            [ch.id]: e.target.value,
                                          },
                                        },
                                      })
                                    }
                                  >
                                    {!hasPreset && (
                                      <option value={currentVoice}>
                                        {currentVoice}
                                      </option>
                                    )}
                                    {CHIRP3_HD_FEMALE_VOICES.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Test TTS Connection + Audition Button */}
                        <div className="p5-form-group p5-conn-test-row">
                          <div className="p5-conn-test-bar">
                            <button
                              type="button"
                              className="p5-apply-btn p5-apply-btn--test"
                              data-testid="tts-test-conn-btn"
                              onClick={() => onTestConnection('tts')}
                              disabled={safeTtsConn.testing}
                            >
                              {safeTtsConn.testing
                                ? '正在检测…'
                                : '测试语音连通'}
                            </button>

                            <button
                              type="button"
                              className="p5-apply-btn p5-tts-audition-btn"
                              data-testid="tts-audition-btn"
                              onClick={() => {
                                setTtsMuted(false, true);
                                const activeId = settings.activeCharacterId;
                                const sample =
                                  CHARACTER_ROLE_META[activeId]?.auditionLine ??
                                  getCachedCharacterPack(activeId).persona
                                    .catchphrases[0] ??
                                  '你好呀，今天想一起完成什么任务？';
                                onSynthesizeTts?.(activeId, sample);
                              }}
                            >
                              ▶ 试听当前角色语音
                            </button>
                          </div>

                          <ConnectionTestResult
                            target="tts"
                            state={safeTtsConn}
                          />
                        </div>

                        <div>
                          <button
                            type="button"
                            className="p5-mini-action-btn"
                            onClick={() => setShowTtsAdvanced((v) => !v)}
                          >
                            {showTtsAdvanced
                              ? '▾ 收起高级语音凭据设置'
                              : '▸ 高级语音凭据设置（本机已配置 gcloud 时无需填写）'}
                          </button>
                        </div>

                        {showTtsAdvanced && (
                          <div className="p5-tts-adv-box">
                            <div className="p5-form-group">
                              <label
                                className="p5-form-label"
                                htmlFor="tts-baseurl-input"
                              >
                                语音服务地址
                              </label>
                              <div className="p5-input-inline-row">
                                <input
                                  id="tts-baseurl-input"
                                  type="text"
                                  className="p5-form-input"
                                  value={ttsBaseUrlDraft}
                                  onChange={(e) =>
                                    setTtsBaseUrlDraft(e.target.value)
                                  }
                                  placeholder="https://texttospeech.googleapis.com"
                                />
                                <button
                                  type="button"
                                  className="p5-apply-btn"
                                  onClick={() => {
                                    const trimmed = ttsBaseUrlDraft.trim();
                                    if (trimmed) {
                                      onUpdateSettings({
                                        tts: { endpoint: { baseUrl: trimmed } },
                                      });
                                    }
                                  }}
                                >
                                  保存
                                </button>
                              </div>
                            </div>

                            <div className="p5-form-group">
                              <label
                                className="p5-form-label"
                                htmlFor="tts-gcp-project-input"
                              >
                                配额项目 ID（可选，仅保存在本机）
                              </label>
                              <div className="p5-input-inline-row">
                                <input
                                  id="tts-gcp-project-input"
                                  type="text"
                                  className="p5-form-input"
                                  value={ttsGcpProjectDraft}
                                  onChange={(e) =>
                                    setTtsGcpProjectDraft(e.target.value)
                                  }
                                  placeholder="留空则自动使用本机 gcloud 默认项目"
                                />
                                <button
                                  type="button"
                                  className="p5-apply-btn"
                                  onClick={() =>
                                    onUpdateSettings({
                                      tts: {
                                        gcpProject: ttsGcpProjectDraft.trim(),
                                      },
                                    })
                                  }
                                >
                                  保存
                                </button>
                              </div>
                            </div>

                            <div className="p5-form-group">
                              <div className="p5-form-label-row">
                                <label
                                  className="p5-form-label"
                                  htmlFor="tts-apikey-input"
                                >
                                  语音接口密钥（可选 API Key）
                                </label>
                                <span
                                  className={`p5-apikey-status ${
                                    settings.tts.endpoint.apiKeySet
                                      ? 'is-set'
                                      : 'is-unset'
                                  }`}
                                >
                                  {settings.tts.endpoint.apiKeySet
                                    ? '已设置'
                                    : '自动使用本机登录态'}
                                </span>
                              </div>
                              <div className="p5-input-inline-row">
                                <input
                                  id="tts-apikey-input"
                                  type="password"
                                  className="p5-form-input"
                                  value={ttsApiKeyDraft}
                                  onChange={(e) =>
                                    setTtsApiKeyDraft(e.target.value)
                                  }
                                  placeholder="无需密钥时留空即可"
                                  autoComplete="off"
                                />
                                <button
                                  type="button"
                                  className="p5-apply-btn"
                                  onClick={() => {
                                    if (!ttsApiKeyDraft.trim()) return;
                                    onUpdateSettings({
                                      tts: {
                                        endpoint: {
                                          apiKey: ttsApiKeyDraft.trim(),
                                        },
                                      },
                                    });
                                    setTtsApiKeyDraft('');
                                  }}
                                >
                                  保存
                                </button>
                                {settings.tts.endpoint.apiKeySet && (
                                  <button
                                    type="button"
                                    className="p5-apply-btn p5-apply-btn--danger"
                                    onClick={() => {
                                      setTtsApiKeyDraft('');
                                      onUpdateSettings({
                                        tts: { endpoint: { apiKey: '' } },
                                      });
                                    }}
                                  >
                                    清除密钥
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

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
