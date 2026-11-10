import React, { useEffect, useState } from 'react';
import type { CharacterSummary } from '../../shared/character-pack';
import type {
  PublicSettings,
  SettingsPatch,
  WorkerAdapterInfo,
} from '../../shared/settings';
import { getCachedCharacterPack } from '../characterLoader';
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

const TABS: Array<{ id: SystemMenuTab; zh: string }> = [
  { id: 'characters', zh: '切换角色' },
  { id: 'worker', zh: 'AI 模型' },
  { id: 'voice', zh: '角色台词' },
  { id: 'pond', zh: '工作文件夹' },
  { id: 'performance', zh: '显示速度' },
];

export const SystemMenuModal: React.FC<SystemMenuModalProps> = ({
  open,
  activeTab,
  settings,
  settingsSyncedAt = null,
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
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);

  useEffect(() => {
    setWorkerModelDraft(settings.worker.model);
    setWorkerBaseUrlDraft(settings.worker.endpoint.baseUrl);
    setVoiceBaseUrlDraft(settings.voice.endpoint.baseUrl);
    setVoiceModelDraft(settings.voice.endpoint.model);
    setProjectDirDraft(settings.projectDir ?? '');
    setTypingSpeedDraft(settings.performance.typingCharsPerSec);
  }, [settings, settingsSyncedAt]);

  useEffect(() => {
    if (!open) return;
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
            {/* ── TAB 1: 切换角色 (CHARACTERS) ── */}
            {activeTab === 'characters' && (
              <div
                className="p5-sys-panel"
                data-testid="system-panel-characters"
              >
                <div className="p5-sys-panel-head">
                  <h3>选择陪伴你的角色</h3>
                </div>

                <div className="p5-char-grid">
                  {characters.map((ch) => {
                    const pack = getCachedCharacterPack(ch.id);
                    const isCurrent = settings.activeCharacterId === ch.id;
                    const shortName = ch.name.split('（')[0];
                    const recModels =
                      pack.recommendedModels && pack.recommendedModels.length > 0
                        ? pack.recommendedModels
                        : [
                            'remote-magpie/antigravity/gemini-3.8-flash',
                            'remote-magpie/auto/deepseek-v4.1-flash',
                            'deepseek-v4-pro',
                          ];

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
                          onUpdateSettings({ activeCharacterId: ch.id });
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
                            <h4 className="p5-char-card-name">{shortName}</h4>
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

                        {/* 第 2 层：直接内嵌模型选择选项 */}
                        <div
                          className="p5-char-card-model-bar"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="p5-field-tag">选择模型：</span>
                          <div className="p5-model-pills">
                            {recModels.map((m) => {
                              const isSelectedModel =
                                settings.worker.model === m;
                              return (
                                <button
                                  key={m}
                                  type="button"
                                  className={`p5-model-chip-btn ${
                                    isSelectedModel ? 'is-selected' : ''
                                  }`}
                                  onClick={() => {
                                    onSwitchCharacter(ch.id);
                                    onUpdateSettings({
                                      activeCharacterId: ch.id,
                                      worker: { model: m },
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

            {/* ── TAB 2: AI 模型 (WORKER) ── */}
            {activeTab === 'worker' && (
              <div className="p5-sys-panel" data-testid="system-panel-worker">
                <div className="p5-sys-panel-head">
                  <h3>AI 模型设置</h3>
                </div>

                <div className="p5-sys-form">
                  {/* Model Picker first — most important for users */}
                  <ModelPicker
                    target="worker"
                    label="当前模型"
                    currentModel={settings.worker.model}
                    draft={workerModelDraft}
                    onDraftChange={setWorkerModelDraft}
                    modelList={safeWorkerModels}
                    placeholder="搜索或输入模型名称"
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
                      {workerAdapters.length > 0 && (
                        <div className="p5-form-group">
                          <label
                            className="p5-form-label"
                            htmlFor="worker-adapter-select"
                          >
                            执行方式
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
                                {ad.name}
                                {!ad.available ? '（未安装）' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

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
                                placeholder="http://127.0.0.1:3425/v1"
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
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── TAB 3: 角色台词 (VOICE) ── */}
            {activeTab === 'voice' && (
              <div className="p5-sys-panel" data-testid="system-panel-voice">
                <div className="p5-sys-panel-head">
                  <h3>角色台词设置</h3>
                </div>

                <div className="p5-sys-form">
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
                                placeholder="http://127.0.0.1:3425/v1"
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
                        onChange={(e) => setProjectDirDraft(e.target.value)}
                        placeholder="/Users/你的名字/项目文件夹"
                      />
                      <button
                        type="button"
                        className="p5-apply-btn p5-apply-btn--test"
                        onClick={async () => {
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
                            if (res.ok) {
                              const data = await res.json();
                              if (data.ok && data.path) {
                                setProjectDirDraft(data.path);
                                onUpdateSettings({ projectDir: data.path });
                              }
                            }
                          } catch {
                            // ignore
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
                            onUpdateSettings({ projectDir: trimmed });
                          }
                        }}
                      >
                        保存
                      </button>
                    </div>
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
