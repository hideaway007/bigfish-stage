import React, { useEffect, useState } from 'react';
import type { CharacterSummary } from '../../shared/character-pack';
import type {
  PublicSettings,
  SettingsPatch,
  WorkerAdapterInfo,
} from '../../shared/settings';
import { getCachedCharacterPack } from '../characterLoader';
import type {
  ConnectionTestState,
  ModelListState,
  SystemMenuTab,
} from '../stageReducer';

interface SystemMenuModalProps {
  open: boolean;
  activeTab: SystemMenuTab;
  settings: PublicSettings;
  settingsSyncedAt: number | null;
  characters: CharacterSummary[];
  workerAdapters: WorkerAdapterInfo[];
  workerModels: ModelListState;
  voiceModels: ModelListState;
  workerConnTest: ConnectionTestState;
  voiceConnTest: ConnectionTestState;
  onSelectTab: (tab: SystemMenuTab) => void;
  onClose: () => void;
  onSwitchCharacter: (characterId: string) => void;
  onUpdateSettings: (patch: SettingsPatch) => void;
  onListModels: (target: 'worker' | 'voice') => void;
  onTestConnection: (target: 'worker' | 'voice') => void;
  onStartNewSessionWithDir: (projectDir: string) => void;
}

const TABS: Array<{ id: SystemMenuTab; en: string; zh: string; desc: string }> = [
  {
    id: 'characters',
    en: 'CHARACTERS',
    zh: '角色',
    desc: '前台看板娘人设与队伍编成',
  },
  {
    id: 'worker',
    en: 'WORKER AGENT',
    zh: '执行 Agent',
    desc: '后台执行适配器、模型与沙箱',
  },
  {
    id: 'voice',
    en: 'VOICE MODEL',
    zh: '台词模型',
    desc: '即兴台词生成接口与频率控制',
  },
  {
    id: 'pond',
    en: 'POND PROJECT',
    zh: '鱼塘（项目）',
    desc: '工作目录选择与开启新会话',
  },
  {
    id: 'performance',
    en: 'PERFORMANCE',
    zh: '演出',
    desc: '打字机速度与舞台演出参数',
  },
];

export const SystemMenuModal: React.FC<SystemMenuModalProps> = ({
  open,
  activeTab,
  settings,
  settingsSyncedAt,
  characters,
  workerAdapters,
  workerModels,
  voiceModels,
  workerConnTest,
  voiceConnTest,
  onSelectTab,
  onClose,
  onSwitchCharacter,
  onUpdateSettings,
  onListModels,
  onTestConnection,
  onStartNewSessionWithDir,
}) => {
  // Local input states synced from server `settings`
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
  const [voiceRateDraft, setVoiceRateDraft] = useState(
    String(settings.voice.maxLinesPerMinute)
  );
  const [projectDirDraft, setProjectDirDraft] = useState(
    settings.projectDir ?? ''
  );
  const [typingSpeedDraft, setTypingSpeedDraft] = useState(
    settings.performance.typingCharsPerSec
  );

  // Sync local drafts whenever server returns updated `settings`
  useEffect(() => {
    setWorkerModelDraft(settings.worker.model);
    setWorkerBaseUrlDraft(settings.worker.endpoint.baseUrl);
    setVoiceBaseUrlDraft(settings.voice.endpoint.baseUrl);
    setVoiceModelDraft(settings.voice.endpoint.model);
    setVoiceRateDraft(String(settings.voice.maxLinesPerMinute));
    setProjectDirDraft(settings.projectDir ?? '');
    setTypingSpeedDraft(settings.performance.typingCharsPerSec);
  }, [settings, settingsSyncedAt]);

  // Auto-fetch model lists when switching to worker or voice tab
  useEffect(() => {
    if (!open) return;
    if (activeTab === 'worker') {
      onListModels('worker');
    } else if (
      activeTab === 'voice' &&
      voiceModels.models.length === 0 &&
      !voiceModels.loading
    ) {
      onListModels('voice');
    }
  }, [open, activeTab, settings.worker.connection, settings.worker.endpoint.baseUrl, settings.worker.endpoint.apiKeySet, settings.worker.adapter]);

  if (!open) return null;

  const syncedTimeText = settingsSyncedAt
    ? new Date(settingsSyncedAt).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div
      className="p5-system-backdrop"
      data-testid="system-menu-modal"
      role="dialog"
      aria-modal="true"
      aria-label="SYSTEM 系统设置菜单"
      onClick={onClose}
    >
      <div
        className="p5-system-shell"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <header className="p5-system-header">
          <div className="p5-system-title-group">
            <span className="p5-system-badge">SYSTEM CONFIG // 深海控制台</span>
            <h2 className="p5-system-title">鱼塘工作台 · 全局设置</h2>
          </div>

          <div className="p5-system-header-right">
            {syncedTimeText && (
              <span
                className="p5-system-sync-pill"
                data-testid="settings-synced-indicator"
              >
                ✓ 已同步服务端设置 ({syncedTimeText})
              </span>
            )}
            <button
              type="button"
              className="p5-close-btn"
              onClick={onClose}
              data-testid="system-close-btn"
            >
              [ESC] 返回舞台
            </button>
          </div>
        </header>

        <div className="p5-system-body">
          {/* Left Tab Navigation */}
          <nav className="p5-system-nav" aria-label="设置分页">
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
                  <div className="p5-system-tab-top">
                    <span className="p5-system-tab-en">{t.en}</span>
                    <span className="p5-system-tab-zh">{t.zh}</span>
                  </div>
                  <div className="p5-system-tab-desc">{t.desc}</div>
                </button>
              );
            })}
          </nav>

          {/* Right Tab Content */}
          <div className="p5-system-content" data-testid="system-content-pane">
            {/* ── TAB 1: 角色 (CHARACTERS) ── */}
            {activeTab === 'characters' && (
              <div
                className="p5-sys-panel"
                data-testid="system-panel-characters"
              >
                <div className="p5-sys-panel-head">
                  <h3>角色选择 // CHARACTER ROSTER</h3>
                  <p>
                    角色包位于 <code>public/characters/&lt;id&gt;/character.json</code>
                    ，角色与执行 Agent / 模型互不绑定，切换立即生效且不中断当前任务。
                  </p>
                </div>

                <div className="p5-char-grid">
                  {characters.map((ch) => {
                    const pack = getCachedCharacterPack(ch.id);
                    const isCurrent = settings.activeCharacterId === ch.id;
                    const recModels = pack.recommendedModels ?? [];

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
                        <div className="p5-char-card-top">
                          <div className="p5-char-card-avatar-wrap">
                            {ch.portraitUrl ? (
                              <img
                                src={ch.portraitUrl}
                                alt={ch.name}
                                className="p5-char-card-avatar"
                              />
                            ) : (
                              <div className="p5-char-card-avatar-fallback">
                                {ch.name.slice(0, 2)}
                              </div>
                            )}
                          </div>
                          <div className="p5-char-card-titles">
                            <span className="p5-char-card-codename">
                              {ch.codename}
                            </span>
                            <h4 className="p5-char-card-name">{ch.name}</h4>
                            <span className="p5-char-card-tagline">
                              {pack.tagline}
                            </span>
                          </div>
                          <span
                            className={`p5-char-card-status ${
                              isCurrent ? 'is-current' : ''
                            }`}
                          >
                            {isCurrent ? '★ 当前登场' : '点选切换'}
                          </span>
                        </div>

                        <div className="p5-char-card-style">
                          <span className="p5-field-tag">说话风格</span>
                          <p>{pack.persona.speechStyle}</p>
                        </div>

                        {recModels.length > 0 && (
                          <div className="p5-char-card-models">
                            <span className="p5-field-tag">
                              推荐搭配模型（仅提示）
                            </span>
                            <div className="p5-model-pills">
                              {recModels.map((m) => (
                                <span key={m} className="p5-model-pill">
                                  {m}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── TAB 2: 执行 Agent (WORKER) ── */}
            {activeTab === 'worker' && (
              <div className="p5-sys-panel" data-testid="system-panel-worker">
                <div className="p5-sys-panel-head">
                  <h3>执行 Agent（手） // WORKER AGENT</h3>
                  <p className="p5-sys-notice-banner" data-testid="worker-next-session-hint">
                    ★ 提示：新设置在下次开新会话时生效（不会打断当前正在运行的会话）
                  </p>
                </div>

                <div className="p5-sys-form">
                  {/* Adapter Select */}
                  <div className="p5-form-group">
                    <label className="p5-form-label" htmlFor="worker-adapter-select">
                      执行 Agent 适配器 (ADAPTER)
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
                          {ad.name} ({ad.id})
                          {!ad.available
                            ? ` — 不可用：${ad.unavailableReason ?? '未安装'}`
                            : ' — 可用'}
                        </option>
                      ))}
                    </select>

                    {/* Adapter availability list */}
                    <div className="p5-adapter-status-list">
                      {workerAdapters.map((ad) => (
                        <div
                          key={ad.id}
                          className={`p5-adapter-chip ${
                            ad.available ? 'is-available' : 'is-disabled'
                          }`}
                        >
                          <strong>{ad.name}</strong> ({ad.id})：
                          {ad.available ? (
                            <span className="ok-text">● 本机可用</span>
                          ) : (
                            <span className="err-text">
                              ○ 不可用（{ad.unavailableReason ?? '未检测到命令'}）
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p5-form-group">
                    <label className="p5-form-label" htmlFor="worker-connection-select">
                      模型连接方式
                    </label>
                    <select
                      id="worker-connection-select"
                      data-testid="worker-connection-select"
                      className="p5-form-select"
                      value={settings.worker.connection}
                      onChange={(e) => {
                        setWorkerApiKeyDraft('');
                        onUpdateSettings({ worker: { connection: e.target.value as 'endpoint' | 'agent-default' } });
                      }}
                    >
                      <option value="endpoint">自定义接口</option>
                      <option value="agent-default">使用 Agent 自带登录</option>
                    </select>
                  </div>

                  {settings.worker.connection === 'endpoint' ? (
                    <>
                      <div className="p5-form-group">
                        <label className="p5-form-label" htmlFor="worker-baseurl-input">
                          OpenAI 兼容接口地址 (BASE URL)
                        </label>
                        <div className="p5-input-inline-row">
                          <input
                            id="worker-baseurl-input"
                            data-testid="worker-baseurl-input"
                            type="text"
                            className="p5-form-input"
                            value={workerBaseUrlDraft}
                            onChange={(e) => setWorkerBaseUrlDraft(e.target.value)}
                            placeholder="http://127.0.0.1:3425/v1"
                          />
                          <button
                            type="button"
                            className="p5-apply-btn"
                            data-testid="worker-baseurl-save-btn"
                            onClick={() => {
                              const baseUrl = workerBaseUrlDraft.trim();
                              if (baseUrl) onUpdateSettings({ worker: { endpoint: { baseUrl } } });
                            }}
                          >
                            保存地址
                          </button>
                        </div>
                      </div>
                      <div className="p5-form-group">
                        <div className="p5-form-label-row">
                          <label className="p5-form-label" htmlFor="worker-apikey-input">
                            API Key（只写不读）
                          </label>
                          <span
                            className={`p5-apikey-status ${settings.worker.endpoint.apiKeySet ? 'is-set' : 'is-unset'}`}
                            data-testid="worker-apikey-status"
                          >
                            状态：{settings.worker.endpoint.apiKeySet ? '已设置' : '未设置'}
                          </span>
                        </div>
                        <div className="p5-input-inline-row">
                          <input
                            id="worker-apikey-input"
                            data-testid="worker-apikey-input"
                            type="password"
                            className="p5-form-input"
                            value={workerApiKeyDraft}
                            onChange={(e) => setWorkerApiKeyDraft(e.target.value)}
                            placeholder="接口免 Key 时可留空"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="p5-apply-btn"
                            data-testid="worker-apikey-save-btn"
                            onClick={() => {
                              const apiKey = workerApiKeyDraft.trim();
                              if (!apiKey) return;
                              onUpdateSettings({ worker: { endpoint: { apiKey } } });
                              setWorkerApiKeyDraft('');
                            }}
                          >
                            更新 Key
                          </button>
                          <button
                            type="button"
                            className="p5-apply-btn p5-apply-btn--danger"
                            data-testid="worker-apikey-clear-btn"
                            onClick={() => {
                              setWorkerApiKeyDraft('');
                              onUpdateSettings({ worker: { endpoint: { apiKey: '' } } });
                            }}
                          >
                            清除 Key
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="p5-empty-hint" data-testid="worker-agent-default-hint">
                      使用本机 Agent 已有的登录状态和模型配置，工作台仍强制启用所选沙箱及按需审批。
                    </p>
                  )}

                  {/* Worker Model Input + List */}
                  <div className="p5-form-group">
                    <div className="p5-form-label-row">
                      <label className="p5-form-label" htmlFor="worker-model-input">
                        执行模型 (WORKER MODEL) — 当前服务端值：
                        <code data-testid="worker-current-model-val">
                          {settings.worker.model}
                        </code>
                      </label>
                      <button
                        type="button"
                        className="p5-mini-action-btn"
                        data-testid="worker-refresh-models-btn"
                        onClick={() => onListModels('worker')}
                      >
                        {workerModels.loading ? '拉取中…' : '↻ 刷新可选模型'}
                      </button>
                    </div>

                    <div className="p5-input-inline-row">
                      <input
                        id="worker-model-input"
                        data-testid="worker-model-input"
                        type="text"
                        className="p5-form-input"
                        value={workerModelDraft}
                        onChange={(e) => setWorkerModelDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const trimmed = workerModelDraft.trim();
                            if (trimmed) {
                              onUpdateSettings({ worker: { model: trimmed } });
                            }
                          }
                        }}
                        placeholder="输入模型名（如 gpt-6.1-sol）或从下方列表点选"
                      />
                      <button
                        type="button"
                        className="p5-apply-btn"
                        data-testid="worker-model-save-btn"
                        onClick={() => {
                          const trimmed = workerModelDraft.trim();
                          if (trimmed) {
                            onUpdateSettings({ worker: { model: trimmed } });
                          }
                        }}
                      >
                        应用模型
                      </button>
                    </div>

                    {workerModels.error && (
                      <div className="p5-form-hint-err">
                        模型列表获取提示：{workerModels.error}
                      </div>
                    )}

                    {workerModels.models.length > 0 && (
                      <div
                        className="p5-model-select-chips"
                        data-testid="worker-model-list"
                      >
                        {workerModels.models.map((m) => (
                          <button
                            key={m}
                            type="button"
                            data-testid={`worker-model-option-${m}`}
                            className={`p5-model-chip-btn ${
                              settings.worker.model === m ? 'is-selected' : ''
                            }`}
                            onClick={() => {
                              setWorkerModelDraft(m);
                              onUpdateSettings({ worker: { model: m } });
                            }}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sandbox Policy */}
                  <div className="p5-form-group">
                    <label className="p5-form-label" htmlFor="worker-sandbox-select">
                      沙箱权限策略 (SANDBOX)
                    </label>
                    <select
                      id="worker-sandbox-select"
                      data-testid="worker-sandbox-select"
                      className="p5-form-select"
                      value={settings.worker.sandbox}
                      onChange={(e) =>
                        onUpdateSettings({
                          worker: {
                            sandbox: e.target.value as
                              | 'read-only'
                              | 'workspace-write',
                          },
                        })
                      }
                    >
                      <option value="workspace-write">
                        workspace-write（允许修改项目目录内文件，终端命令需审批）
                      </option>
                      <option value="read-only">
                        read-only（只读沙箱，禁止写入文件）
                      </option>
                    </select>
                  </div>

                  {/* Test Connection */}
                  <div className="p5-form-group p5-conn-test-row">
                    <button
                      type="button"
                      className="p5-apply-btn p5-apply-btn--test"
                      data-testid="worker-test-conn-btn"
                      onClick={() => onTestConnection('worker')}
                      disabled={workerConnTest.testing}
                    >
                      {workerConnTest.testing
                        ? '正在测试连接…'
                        : '⚡ 测试执行 Agent 连接'}
                    </button>

                    {workerConnTest.message && (
                      <div
                        className={`p5-conn-result ${
                          workerConnTest.ok ? 'is-ok' : 'is-fail'
                        }`}
                        data-testid="worker-conn-result"
                      >
                        <strong>
                          {workerConnTest.ok ? '✓ 连接成功' : '✗ 连接失败'}
                        </strong>
                        <span>{workerConnTest.message}</span>
                        {workerConnTest.latencyMs !== undefined && (
                          <span className="p5-conn-latency">
                            {workerConnTest.latencyMs} ms
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 3: 台词模型 (VOICE) ── */}
            {activeTab === 'voice' && (
              <div className="p5-sys-panel" data-testid="system-panel-voice">
                <div className="p5-sys-panel-head">
                  <h3>台词模型（嘴） // VOICE MODEL</h3>
                  <p>
                    事件到达后先即时显示角色包预置台词（preset），开启台词模型后会在后台生成角色口吻台词并原地替换（model）。
                  </p>
                </div>

                <div className="p5-sys-form">
                  {/* Enable Toggle */}
                  <div className="p5-form-group p5-form-group--inline">
                    <label className="p5-form-label">
                      启用台词模型即兴生成 (VOICE ENABLED)
                    </label>
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
                      {settings.voice.enabled
                        ? '● 已开启（预置台词 + 模型替换）'
                        : '○ 已关闭（仅使用角色包预置台词）'}
                    </button>
                  </div>

                  {/* Base URL */}
                  <div className="p5-form-group">
                    <label className="p5-form-label" htmlFor="voice-baseurl-input">
                      OpenAI 兼容接口地址 (BASE URL)
                    </label>
                    <div className="p5-input-inline-row">
                      <input
                        id="voice-baseurl-input"
                        data-testid="voice-baseurl-input"
                        type="text"
                        className="p5-form-input"
                        value={voiceBaseUrlDraft}
                        onChange={(e) => setVoiceBaseUrlDraft(e.target.value)}
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
                        保存地址
                      </button>
                    </div>
                  </div>

                  {/* Voice Model */}
                  <div className="p5-form-group">
                    <div className="p5-form-label-row">
                      <label className="p5-form-label" htmlFor="voice-model-input">
                        台词生成模型 (VOICE MODEL) — 当前：
                        <code data-testid="voice-current-model-val">
                          {settings.voice.endpoint.model}
                        </code>
                      </label>
                      <button
                        type="button"
                        className="p5-mini-action-btn"
                        data-testid="voice-refresh-models-btn"
                        onClick={() => onListModels('voice')}
                      >
                        {voiceModels.loading ? '拉取中…' : '↻ 刷新模型列表'}
                      </button>
                    </div>

                    <div className="p5-input-inline-row">
                      <input
                        id="voice-model-input"
                        data-testid="voice-model-input"
                        type="text"
                        className="p5-form-input"
                        value={voiceModelDraft}
                        onChange={(e) => setVoiceModelDraft(e.target.value)}
                        placeholder="remote-magpie/antigravity/gemini-3.8-flash"
                      />
                      <button
                        type="button"
                        className="p5-apply-btn"
                        data-testid="voice-model-save-btn"
                        onClick={() => {
                          const trimmed = voiceModelDraft.trim();
                          if (trimmed) {
                            onUpdateSettings({
                              voice: { endpoint: { model: trimmed } },
                            });
                          }
                        }}
                      >
                        应用模型
                      </button>
                    </div>

                    {voiceModels.models.length > 0 && (
                      <div
                        className="p5-model-select-chips"
                        data-testid="voice-model-list"
                      >
                        {voiceModels.models.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`p5-model-chip-btn ${
                              settings.voice.endpoint.model === m
                                ? 'is-selected'
                                : ''
                            }`}
                            onClick={() => {
                              setVoiceModelDraft(m);
                              onUpdateSettings({
                                voice: { endpoint: { model: m } },
                              });
                            }}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* API Key (Write-only, never read back) */}
                  <div className="p5-form-group">
                    <div className="p5-form-label-row">
                      <label className="p5-form-label" htmlFor="voice-apikey-input">
                        API Key（只写不读，服务端脱敏保存）
                      </label>
                      <span
                        className={`p5-apikey-status ${
                          settings.voice.endpoint.apiKeySet ? 'is-set' : 'is-unset'
                        }`}
                        data-testid="voice-apikey-status"
                      >
                        状态：{settings.voice.endpoint.apiKeySet ? '已设置' : '未设置'}
                      </span>
                    </div>

                    <div className="p5-input-inline-row">
                      <input
                        id="voice-apikey-input"
                        data-testid="voice-apikey-input"
                        type="password"
                        className="p5-form-input"
                        value={voiceApiKeyDraft}
                        onChange={(e) => setVoiceApiKeyDraft(e.target.value)}
                        placeholder="本机 magpie 网关免 Key；如需填写外部 Key 请在此输入"
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
                              endpoint: { apiKey: voiceApiKeyDraft.trim() },
                            },
                          });
                          setVoiceApiKeyDraft('');
                        }}
                      >
                        更新 Key
                      </button>
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
                        清除 Key
                      </button>
                    </div>
                  </div>

                  {/* Max lines per minute */}
                  <div className="p5-form-group">
                    <label className="p5-form-label" htmlFor="voice-rate-input">
                      每分钟最多生成句数 (MAX LINES / MIN)：
                      <strong>{settings.voice.maxLinesPerMinute} 句/分钟</strong>
                    </label>
                    <div className="p5-input-inline-row">
                      <input
                        id="voice-rate-input"
                        data-testid="voice-rate-input"
                        type="number"
                        min={1}
                        max={60}
                        className="p5-form-input p5-form-input--short"
                        value={voiceRateDraft}
                        onChange={(e) => setVoiceRateDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="p5-apply-btn"
                        data-testid="voice-rate-save-btn"
                        onClick={() => {
                          const n = Math.max(
                            1,
                            Math.min(60, Number(voiceRateDraft) || 6)
                          );
                          onUpdateSettings({
                            voice: { maxLinesPerMinute: n },
                          });
                        }}
                      >
                        保存限流
                      </button>
                    </div>
                  </div>

                  {/* Test Voice Connection */}
                  <div className="p5-form-group p5-conn-test-row">
                    <button
                      type="button"
                      className="p5-apply-btn p5-apply-btn--test"
                      data-testid="voice-test-conn-btn"
                      onClick={() => onTestConnection('voice')}
                      disabled={voiceConnTest.testing}
                    >
                      {voiceConnTest.testing
                        ? '正在测试连接…'
                        : '⚡ 测试台词模型连接'}
                    </button>

                    {voiceConnTest.message && (
                      <div
                        className={`p5-conn-result ${
                          voiceConnTest.ok ? 'is-ok' : 'is-fail'
                        }`}
                        data-testid="voice-conn-result"
                      >
                        <strong>
                          {voiceConnTest.ok ? '✓ 连接成功' : '✗ 连接失败'}
                        </strong>
                        <span>{voiceConnTest.message}</span>
                        {voiceConnTest.latencyMs !== undefined && (
                          <span className="p5-conn-latency">
                            {voiceConnTest.latencyMs} ms
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 4: 鱼塘（项目） (POND) ── */}
            {activeTab === 'pond' && (
              <div className="p5-sys-panel" data-testid="system-panel-pond">
                <div className="p5-sys-panel-head">
                  <h3>鱼塘（项目目录） // PROJECT WORKSPACE</h3>
                  <p>
                    指定执行 Agent 潜入干活的本地项目文件夹路径。当前生效目录：
                    <code data-testid="pond-current-dir">
                      {settings.projectDir ?? '尚未选择'}
                    </code>
                  </p>
                </div>

                <div className="p5-sys-form">
                  <div className="p5-form-group">
                    <label
                      className="p5-form-label"
                      htmlFor="pond-project-dir-input"
                    >
                      项目文件夹路径 (PROJECT DIRECTORY)
                    </label>
                    <div className="p5-input-inline-row">
                      <input
                        id="pond-project-dir-input"
                        data-testid="pond-project-dir-input"
                        type="text"
                        className="p5-form-input"
                        value={projectDirDraft}
                        onChange={(e) => setProjectDirDraft(e.target.value)}
                        placeholder="/tmp/my-project 或本地仓库路径"
                      />
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
                        仅保存路径
                      </button>
                    </div>
                  </div>

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
                      ★ 用这个文件夹开新会话（发送 update_settings + new_session）
                    </button>
                  </div>

                  <div className="p5-form-group">
                    <span className="p5-form-label">
                      最近潜入的鱼塘 (RECENT PROJECTS)
                    </span>
                    {settings.recentProjects.length === 0 ? (
                      <div className="p5-empty-hint">暂无最近项目记录</div>
                    ) : (
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
                                className="p5-mini-action-btn"
                                onClick={() => {
                                  setProjectDirDraft(dir);
                                  onUpdateSettings({ projectDir: dir });
                                }}
                              >
                                填入并设为当前
                              </button>
                              <button
                                type="button"
                                className="p5-mini-action-btn p5-mini-action-btn--accent"
                                onClick={() => {
                                  setProjectDirDraft(dir);
                                  onStartNewSessionWithDir(dir);
                                }}
                              >
                                直接开新会话 ▶
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 5: 演出 (PERFORMANCE) ── */}
            {activeTab === 'performance' && (
              <div
                className="p5-sys-panel"
                data-testid="system-panel-performance"
              >
                <div className="p5-sys-panel-head">
                  <h3>舞台演出参数 // STAGE PERFORMANCE</h3>
                  <p>调节角色台词框的打字机逐字显示速度。</p>
                </div>

                <div className="p5-sys-form">
                  <div className="p5-form-group">
                    <label
                      className="p5-form-label"
                      htmlFor="perf-typing-speed-input"
                    >
                      打字机速度 (TYPING SPEED)：
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
