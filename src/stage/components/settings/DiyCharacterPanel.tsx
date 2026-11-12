import React, { useRef, useState } from 'react';
import type { CharacterPack } from '../../../shared/character-pack';
import type { Emotion } from '../../../shared/stage-events';
import {
  BUILTIN_PERSONA_DEFAULTS,
  isCustomCharacterId,
  MAX_DIY_IMAGE_BYTES,
  MAX_PERSONA_CHARS,
  PERSONA_MARKDOWN_TEMPLATE,
} from '../../../shared/diy-character';
import type { SettingsPatch } from '../../../shared/settings';
import { DEFAULT_CHARACTER_BRAINS } from '../../../shared/settings';
import {
  applyDiySnapshot,
  DEFAULT_CHARACTER_ID,
  getDiyPersonaOverride,
  getRawCharacterPack,
  resolveCharacterAssetUrl,
} from '../../characterLoader';
import {
  deleteDiyCustomCharacterClient,
  saveDiyCustomCharacterClient,
  saveDiyOverrideClient,
} from '../../diyClient';

const THEME_SWATCHES = [
  '#E60012',
  '#2563EB',
  '#A855F7',
  '#EA580C',
  '#10B981',
  '#EC4899',
  '#06B6D4',
  '#F59E0B',
];

const EXTRA_EMOTION_SLOTS: Array<{ key: Exclude<Emotion, 'idle'>; label: string }> = [
  { key: 'thinking', label: '思考 (thinking)' },
  { key: 'working', label: '干活 (working)' },
  { key: 'happy', label: '开心 (happy)' },
  { key: 'worried', label: '担忧 (worried)' },
  { key: 'shocked', label: '震惊 (shocked)' },
];

function readTextFile(file: File): Promise<string> {
  return new Promise((resolveText, rejectText) => {
    if (file.size > 512 * 1024) {
      rejectText(new Error(`文件「${file.name}」过大，请选择 512KB 以内的 .md / .txt 文本文件`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolveText(String(reader.result ?? ''));
    reader.onerror = () => rejectText(new Error(`读取文件「${file.name}」失败`));
    reader.readAsText(file, 'utf-8');
  });
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolveUrl, rejectUrl) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      rejectUrl(new Error(`不支持的图片格式（${file.name}），请选择 PNG / JPG / WebP / GIF`));
      return;
    }
    if (file.size > MAX_DIY_IMAGE_BYTES) {
      rejectUrl(new Error(`图片「${file.name}」超过 5MB 上限，请压缩后再上传`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolveUrl(String(reader.result ?? ''));
    reader.onerror = () => rejectUrl(new Error(`读取图片「${file.name}」失败`));
    reader.readAsDataURL(file);
  });
}

interface CharacterPersonaBarProps {
  characterId: string;
  pack: CharacterPack;
  activeCharacterId: string;
  onUpdateSettings: (patch: SettingsPatch) => void;
  onSwitchCharacter: (characterId: string) => void;
  onEditCustomCharacter: (characterId: string) => void;
}

export const CharacterPersonaCardBar: React.FC<CharacterPersonaBarProps> = ({
  characterId,
  pack,
  activeCharacterId,
  onUpdateSettings,
  onSwitchCharacter,
  onEditCustomCharacter,
}) => {
  const override = getDiyPersonaOverride(characterId);
  const isCustomChar = isCustomCharacterId(characterId);
  const builtinDefaults = BUILTIN_PERSONA_DEFAULTS[characterId];
  const defaultRolePrompt =
    DEFAULT_CHARACTER_BRAINS[characterId]?.rolePrompt ?? pack.persona.speechStyle ?? '';

  const [editorOpen, setEditorOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState('');
  const [selfTitleDraft, setSelfTitleDraft] = useState('');
  const [userTitleDraft, setUserTitleDraft] = useState('');
  const [taglineDraft, setTaglineDraft] = useState('');
  const [sourceNameDraft, setSourceNameDraft] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const openEditorWithCurrent = () => {
    const cur = getDiyPersonaOverride(characterId);
    setRoleDraft(cur?.rolePrompt ?? defaultRolePrompt);
    setSelfTitleDraft(cur?.selfTitle ?? builtinDefaults?.selfTitle ?? '我');
    setUserTitleDraft(
      cur?.userTitle ?? pack.uiCopy?.userTitle ?? builtinDefaults?.userTitle ?? '店长'
    );
    setTaglineDraft(cur?.tagline ?? pack.tagline ?? '');
    setSourceNameDraft(cur?.sourceFileName);
    setNotice(null);
    setEditorOpen(true);
  };

  const handleImportPersonaFile = async (file: File) => {
    setBusy(true);
    setNotice(null);
    try {
      const rawText = (await readTextFile(file)).trim();
      if (!rawText) {
        throw new Error('所选性格文件内容为空');
      }
      const clipped =
        rawText.length > MAX_PERSONA_CHARS
          ? rawText.slice(0, MAX_PERSONA_CHARS)
          : rawText;

      const cur = getDiyPersonaOverride(characterId);
      const snap = await saveDiyOverrideClient(characterId, {
        sourceFileName: file.name,
        rolePrompt: clipped,
        selfTitle: cur?.selfTitle ?? builtinDefaults?.selfTitle,
        userTitle: cur?.userTitle ?? pack.uiCopy?.userTitle ?? builtinDefaults?.userTitle,
        tagline: cur?.tagline,
      });
      applyDiySnapshot(snap);
      onUpdateSettings({
        characterBrains: {
          [characterId]: { rolePrompt: clipped },
        },
      });
      setRoleDraft(clipped);
      setSourceNameDraft(file.name);
      setNotice({
        ok: true,
        text:
          rawText.length > MAX_PERSONA_CHARS
            ? `已导入「${file.name}」（超出 ${MAX_PERSONA_CHARS} 字部分已截断）`
            : `已加载性格定位文件「${file.name}」`,
      });
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : '导入性格文件失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveInlineOverride = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const cleanRole = roleDraft.trim();
      if (!cleanRole) {
        throw new Error('性格与职责定位内容不能为空（若想还原内置设定请点「恢复默认」）');
      }
      const snap = await saveDiyOverrideClient(characterId, {
        sourceFileName: sourceNameDraft,
        rolePrompt: cleanRole,
        selfTitle: selfTitleDraft.trim() || undefined,
        userTitle: userTitleDraft.trim() || undefined,
        tagline: taglineDraft.trim() || undefined,
      });
      applyDiySnapshot(snap);
      onUpdateSettings({
        characterBrains: {
          [characterId]: { rolePrompt: cleanRole },
        },
      });
      setEditorOpen(false);
      setNotice({ ok: true, text: '角色性格与职责定位已保存生效' });
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : '保存失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResetDefault = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const snap = await saveDiyOverrideClient(characterId, null);
      applyDiySnapshot(snap);
      const fallbackPrompt = DEFAULT_CHARACTER_BRAINS[characterId]?.rolePrompt ?? '';
      onUpdateSettings({
        characterBrains: {
          [characterId]: { rolePrompt: fallbackPrompt },
        },
      });
      setEditorOpen(false);
      setSourceNameDraft(undefined);
      setNotice({ ok: true, text: '已恢复该角色的默认性格设定' });
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : '恢复默认失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCustom = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (activeCharacterId === characterId) {
        onSwitchCharacter(DEFAULT_CHARACTER_ID);
      }
      const snap = await deleteDiyCustomCharacterClient(characterId);
      applyDiySnapshot(snap);
    } catch (err) {
      setConfirmDelete(false);
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : '删除角色失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const hasCustomOverride = Boolean(override);

  return (
    <div
      className="p5-char-persona-bar"
      data-testid={`char-persona-bar-${characterId}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p5-char-persona-row">
        <div className="p5-char-persona-status">
          <span className="p5-field-tag">性格与定位档：</span>
          {hasCustomOverride ? (
            <span
              className="p5-persona-file-pill is-custom"
              data-testid={`char-persona-badge-${characterId}`}
            >
              📄 {override?.sourceFileName ? override.sourceFileName : '自定义性格设定'}
            </span>
          ) : (
            <span
              className="p5-persona-file-pill"
              data-testid={`char-persona-badge-${characterId}`}
            >
              内置默认设定
            </span>
          )}
        </div>

        <div className="p5-char-persona-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            data-testid={`char-persona-file-input-${characterId}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportPersonaFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="p5-mini-action-btn p5-mini-action-btn--accent"
            data-testid={`char-import-persona-btn-${characterId}`}
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            title="选择本地 .md 或 .txt 文件作为该角色的性格与职责定位设定"
          >
            📄 导入性格文件
          </button>

          <button
            type="button"
            className="p5-mini-action-btn"
            data-testid={`char-edit-persona-btn-${characterId}`}
            disabled={busy}
            onClick={() => {
              if (editorOpen) {
                setEditorOpen(false);
              } else {
                openEditorWithCurrent();
              }
            }}
          >
            {editorOpen ? '▴ 收起编辑' : '✎ 在线微调'}
          </button>

          {!isCustomChar && hasCustomOverride && (
            <button
              type="button"
              className="p5-mini-action-btn"
              data-testid={`char-reset-persona-btn-${characterId}`}
              disabled={busy}
              onClick={() => void handleResetDefault()}
            >
              ↺ 恢复默认
            </button>
          )}

          {isCustomChar && (
            <>
              <button
                type="button"
                className="p5-mini-action-btn"
                data-testid={`char-edit-custom-btn-${characterId}`}
                disabled={busy}
                onClick={() => onEditCustomCharacter(characterId)}
              >
                🎨 改立绘/形象
              </button>
              <button
                type="button"
                className={`p5-mini-action-btn ${confirmDelete ? 'p5-mini-action-btn--danger' : ''}`}
                data-testid={`char-delete-custom-btn-${characterId}`}
                disabled={busy}
                onMouseLeave={() => setConfirmDelete(false)}
                onClick={() => void handleDeleteCustom()}
              >
                {confirmDelete ? '⚠ 确认删除？' : '✕ 删除'}
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div
          className={`p5-diy-inline-notice ${notice.ok ? 'is-ok' : 'is-err'}`}
          data-testid={`char-persona-notice-${characterId}`}
        >
          {notice.text}
        </div>
      )}

      {editorOpen && (
        <div
          className="p5-persona-inline-editor"
          data-testid={`char-persona-editor-${characterId}`}
        >
          <div className="p5-diy-grid-3">
            <div className="p5-diy-field">
              <label className="p5-form-label">角色自称</label>
              <input
                type="text"
                className="p5-form-input"
                value={selfTitleDraft}
                onChange={(e) => setSelfTitleDraft(e.target.value)}
                placeholder="如：本鱼 / 本喵 / 我"
                maxLength={24}
              />
            </div>
            <div className="p5-diy-field">
              <label className="p5-form-label">对玩家的称呼</label>
              <input
                type="text"
                className="p5-form-input"
                value={userTitleDraft}
                onChange={(e) => setUserTitleDraft(e.target.value)}
                placeholder="如：店长 / 老师 / 指挥官"
                maxLength={24}
              />
            </div>
            <div className="p5-diy-field">
              <label className="p5-form-label">简介标语（选填）</label>
              <input
                type="text"
                className="p5-form-input"
                value={taglineDraft}
                onChange={(e) => setTaglineDraft(e.target.value)}
                placeholder="角色卡片展示的一句话简介"
                maxLength={80}
              />
            </div>
          </div>

          <div className="p5-diy-field">
            <div className="p5-form-label-row">
              <label className="p5-form-label">
                性格设定与职责定位正文（支持 Markdown · {roleDraft.length}/{MAX_PERSONA_CHARS}）
              </label>
              <button
                type="button"
                className="p5-mini-action-btn"
                onClick={() => setRoleDraft(PERSONA_MARKDOWN_TEMPLATE)}
              >
                填入参考模板
              </button>
            </div>
            <textarea
              className="p5-diy-textarea"
              rows={5}
              data-testid={`char-persona-textarea-${characterId}`}
              value={roleDraft}
              onChange={(e) => setRoleDraft(e.target.value.slice(0, MAX_PERSONA_CHARS))}
              placeholder="在这里编写或导入 .md 性格定位文件：例如角色的说话口癖、擅长领域、代码审查偏好…"
            />
          </div>

          <div className="p5-diy-editor-foot">
            <button
              type="button"
              className="p5-apply-btn"
              data-testid={`char-save-persona-btn-${characterId}`}
              disabled={busy}
              onClick={() => void handleSaveInlineOverride()}
            >
              {busy ? '保存中…' : '✓ 保存性格设定'}
            </button>
            <button
              type="button"
              className="p5-mini-action-btn"
              onClick={() => setEditorOpen(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface DiyCharacterCreatorDrawerProps {
  open: boolean;
  editingCharacterId: string | null;
  onClose: () => void;
  onCreatedOrUpdated: (characterId: string, rolePrompt: string) => void;
}

export const DiyCharacterCreatorDrawer: React.FC<DiyCharacterCreatorDrawerProps> = ({
  open,
  editingCharacterId,
  onClose,
  onCreatedOrUpdated,
}) => {
  const existingPack = editingCharacterId ? getRawCharacterPack(editingCharacterId) : undefined;
  const existingOverride = editingCharacterId
    ? getDiyPersonaOverride(editingCharacterId)
    : undefined;

  const [name, setName] = useState(existingPack?.name ?? '');
  const [codename, setCodename] = useState(existingPack?.codename ?? '');
  const [tagline, setTagline] = useState(existingOverride?.tagline ?? existingPack?.tagline ?? '');
  const [themeColor, setThemeColor] = useState(existingPack?.themeColor ?? '#E60012');
  const [selfTitle, setSelfTitle] = useState(existingOverride?.selfTitle ?? '我');
  const [userTitle, setUserTitle] = useState(
    existingOverride?.userTitle ?? existingPack?.uiCopy?.userTitle ?? '店长'
  );
  const [sourceFileName, setSourceFileName] = useState<string | undefined>(
    existingOverride?.sourceFileName
  );
  const [rolePrompt, setRolePrompt] = useState(
    existingOverride?.rolePrompt ?? existingPack?.persona.speechStyle ?? ''
  );
  const [catchphrasesText, setCatchphrasesText] = useState(
    (existingPack?.persona.catchphrases ?? []).join('\n')
  );

  const [idleDataUrl, setIdleDataUrl] = useState<string>('');
  const [portraitDataUrl, setPortraitDataUrl] = useState<string>('');
  const [extraEmotions, setExtraEmotions] = useState<
    Partial<Record<Exclude<Emotion, 'idle'>, string>>
  >({});
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mdFileRef = useRef<HTMLInputElement | null>(null);
  const idleFileRef = useRef<HTMLInputElement | null>(null);
  const portraitFileRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const raw = editingCharacterId ? getRawCharacterPack(editingCharacterId) : undefined;
    const ov = editingCharacterId ? getDiyPersonaOverride(editingCharacterId) : undefined;
    setName(raw?.name ?? '');
    setCodename(raw?.codename ?? '');
    setTagline(ov?.tagline ?? raw?.tagline ?? '');
    setThemeColor(raw?.themeColor ?? '#E60012');
    setSelfTitle(ov?.selfTitle ?? '我');
    setUserTitle(ov?.userTitle ?? raw?.uiCopy?.userTitle ?? '店长');
    setSourceFileName(ov?.sourceFileName);
    setRolePrompt(ov?.rolePrompt ?? raw?.persona.speechStyle ?? '');
    setCatchphrasesText((raw?.persona.catchphrases ?? []).join('\n'));
    setIdleDataUrl('');
    setPortraitDataUrl('');
    setExtraEmotions({});
    setError(null);
  }, [open, editingCharacterId]);

  if (!open) return null;

  const existingIdlePreview =
    existingPack && existingPack.art.renderer === 'sprites'
      ? resolveCharacterAssetUrl(existingPack.id, existingPack.art.emotions.idle)
      : null;
  const activeIdlePreview = idleDataUrl || existingIdlePreview;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('请填写角色名称（如：星野 / 零号机）');
      return;
    }
    if (!rolePrompt.trim()) {
      setError('请导入 .md/.txt 性格文件，或在下方填写角色的性格与职责定位');
      return;
    }
    if (!editingCharacterId && !idleDataUrl) {
      setError('新建角色请至少上传 1 张主立绘图片（支持 PNG / JPG / WebP / GIF）');
      return;
    }

    setSaving(true);
    try {
      const catchphrases = catchphrasesText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const res = await saveDiyCustomCharacterClient({
        ...(editingCharacterId ? { id: editingCharacterId } : {}),
        name: name.trim(),
        codename: codename.trim() || undefined,
        tagline: tagline.trim() || undefined,
        themeColor,
        selfTitle: selfTitle.trim() || '我',
        userTitle: userTitle.trim() || '店长',
        sourceFileName,
        rolePrompt: rolePrompt.trim(),
        catchphrases,
        ...(idleDataUrl ? { idleDataUrl } : {}),
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
        ...(Object.keys(extraEmotions).length > 0
          ? { emotionsDataUrls: extraEmotions }
          : {}),
      });

      applyDiySnapshot(res);
      onCreatedOrUpdated(res.savedPack.id, rolePrompt.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 DIY 角色失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="p5-diy-creator-card"
      data-testid="diy-character-creator"
      onSubmit={handleSubmit}
    >
      <div className="p5-diy-creator-head">
        <div>
          <span className="p5-diy-kicker">DIY CHARACTER WORKSHOP</span>
          <h4>{editingCharacterId ? '编辑 DIY 自定义角色' : '新建 DIY 专属角色'}</h4>
          <p>
            填写名字、上传 1 张主立绘并导入 <code>.md / .txt</code> 性格定位文件，即可召唤专属角色上台协作与换手接力。
          </p>
        </div>
        <button
          type="button"
          className="p5-mini-action-btn"
          onClick={onClose}
          data-testid="diy-creator-cancel-top"
        >
          ✕ 关闭
        </button>
      </div>

      <div className="p5-diy-main-layout">
        {/* Left: Standee Upload Preview */}
        <div className="p5-diy-standee-box">
          <input
            ref={idleFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            data-testid="diy-idle-file-input"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const url = await readImageFileAsDataUrl(file);
                setIdleDataUrl(url);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : '读取立绘失败');
              }
            }}
          />

          <div
            className="p5-diy-standee-preview"
            style={{ '--diy-theme': themeColor } as React.CSSProperties}
            onClick={() => idleFileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') idleFileRef.current?.click();
            }}
            title="点击上传角色主立绘（推荐透明背景 PNG / WebP）"
          >
            {activeIdlePreview ? (
              <img src={activeIdlePreview} alt="主立绘预览" />
            ) : (
              <div className="p5-diy-standee-placeholder">
                <span className="p5-diy-plus">＋</span>
                <strong>上传主立绘（必选）</strong>
                <span>透明 PNG / WebP / JPG · ≤5MB</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="p5-mini-action-btn p5-diy-upload-trigger"
            data-testid="diy-pick-idle-btn"
            onClick={() => idleFileRef.current?.click()}
          >
            🖼 {activeIdlePreview ? '更换主立绘图片' : '选择主立绘图片'}
          </button>
        </div>

        {/* Right: Core Metadata + Persona File */}
        <div className="p5-diy-fields-col">
          <div className="p5-diy-grid-2">
            <div className="p5-diy-field">
              <label className="p5-form-label" htmlFor="diy-char-name-input">
                角色名称（必填）
              </label>
              <input
                id="diy-char-name-input"
                data-testid="diy-char-name-input"
                type="text"
                className="p5-form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：星野（安全审计娘）"
                maxLength={48}
              />
            </div>

            <div className="p5-diy-field">
              <label className="p5-form-label">代表主题色</label>
              <div className="p5-diy-color-row">
                {THEME_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={`p5-diy-swatch ${
                      themeColor.toUpperCase() === hex ? 'is-selected' : ''
                    }`}
                    style={{ backgroundColor: hex }}
                    onClick={() => setThemeColor(hex)}
                    aria-label={`主题色 ${hex}`}
                  />
                ))}
                <input
                  type="color"
                  className="p5-diy-color-picker"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  title="自选任意主题色"
                />
              </div>
            </div>
          </div>

          <div className="p5-diy-grid-3">
            <div className="p5-diy-field">
              <label className="p5-form-label">角色自称</label>
              <input
                type="text"
                className="p5-form-input"
                data-testid="diy-self-title-input"
                value={selfTitle}
                onChange={(e) => setSelfTitle(e.target.value)}
                placeholder="我 / 本喵 / 在下"
                maxLength={24}
              />
            </div>
            <div className="p5-diy-field">
              <label className="p5-form-label">对玩家的称呼</label>
              <input
                type="text"
                className="p5-form-input"
                data-testid="diy-user-title-input"
                value={userTitle}
                onChange={(e) => setUserTitle(e.target.value)}
                placeholder="店长 / 老师 / 搭档"
                maxLength={24}
              />
            </div>
            <div className="p5-diy-field">
              <label className="p5-form-label">一句话简介标语</label>
              <input
                type="text"
                className="p5-form-input"
                data-testid="diy-tagline-input"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="如：零信任防线 · 安全代码守门人"
                maxLength={80}
              />
            </div>
          </div>

          <div className="p5-diy-field">
            <div className="p5-form-label-row">
              <label className="p5-form-label" htmlFor="diy-role-prompt-input">
                角色性格与职责定位文件（必填 · {rolePrompt.length}/{MAX_PERSONA_CHARS}）
                {sourceFileName && (
                  <span className="p5-diy-source-tag">已导入：{sourceFileName}</span>
                )}
              </label>
              <div className="p5-diy-inline-btns">
                <input
                  ref={mdFileRef}
                  type="file"
                  accept=".md,.markdown,.txt,text/markdown,text/plain"
                  hidden
                  data-testid="diy-creator-persona-file-input"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    try {
                      const content = (await readTextFile(file)).trim();
                      setRolePrompt(content.slice(0, MAX_PERSONA_CHARS));
                      setSourceFileName(file.name);
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : '读取性格文件失败');
                    }
                  }}
                />
                <button
                  type="button"
                  className="p5-mini-action-btn p5-mini-action-btn--accent"
                  data-testid="diy-creator-import-md-btn"
                  onClick={() => mdFileRef.current?.click()}
                >
                  📄 选择 .md / .txt 文件
                </button>
                <button
                  type="button"
                  className="p5-mini-action-btn"
                  data-testid="diy-creator-fill-template-btn"
                  onClick={() => setRolePrompt(PERSONA_MARKDOWN_TEMPLATE)}
                >
                  填入模板
                </button>
              </div>
            </div>
            <textarea
              id="diy-role-prompt-input"
              data-testid="diy-role-prompt-input"
              className="p5-diy-textarea"
              rows={5}
              value={rolePrompt}
              onChange={(e) => setRolePrompt(e.target.value.slice(0, MAX_PERSONA_CHARS))}
              placeholder="可点击右上方「选择 .md / .txt 文件」直接载入，或在此手写角色的性格口吻、专精技术方向与行动准则…"
            />
          </div>

          <div>
            <button
              type="button"
              className="p5-mini-action-btn"
              onClick={() => setShowMoreOptions((v) => !v)}
            >
              {showMoreOptions
                ? '▾ 收起进阶选项（代号、口头禅、独立头像与 5 种表情差分）'
                : '▸ 进阶选项：独立小头像、5 种情绪立绘差分与专属口头禅（选填）'}
            </button>
          </div>

          {showMoreOptions && (
            <div className="p5-diy-advanced-box">
              <div className="p5-diy-grid-2">
                <div className="p5-diy-field">
                  <label className="p5-form-label">舞台英文/代号标签</label>
                  <input
                    type="text"
                    className="p5-form-input"
                    value={codename}
                    onChange={(e) => setCodename(e.target.value)}
                    placeholder="如：SEC · HOSHINO"
                    maxLength={36}
                  />
                </div>
                <div className="p5-diy-field">
                  <label className="p5-form-label">独立小头像（不传默认复用主立绘）</label>
                  <div className="p5-input-inline-row">
                    <input
                      ref={portraitFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          setPortraitDataUrl(await readImageFileAsDataUrl(file));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : '读取头像失败');
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="p5-mini-action-btn"
                      onClick={() => portraitFileRef.current?.click()}
                    >
                      {portraitDataUrl ? '✓ 已选新头像（点击更换）' : '上传独立方形头像'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="p5-diy-field">
                <label className="p5-form-label">
                  可选情绪立绘差分（未上传的情绪会自动使用主立绘）
                </label>
                <div className="p5-diy-emotion-grid">
                  {EXTRA_EMOTION_SLOTS.map((slot) => {
                    const hasSelected = Boolean(extraEmotions[slot.key]);
                    return (
                      <label key={slot.key} className={`p5-diy-emo-slot ${hasSelected ? 'is-set' : ''}`}>
                        <span>{hasSelected ? `✓ ${slot.label}` : `+ ${slot.label}`}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          hidden
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            try {
                              const url = await readImageFileAsDataUrl(file);
                              setExtraEmotions((prev) => ({ ...prev, [slot.key]: url }));
                            } catch (err) {
                              setError(err instanceof Error ? err.message : '读取表情差分失败');
                            }
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="p5-diy-field">
                <label className="p5-form-label">专属登场台词 / 口头禅（每行一句，选填）</label>
                <textarea
                  className="p5-diy-textarea"
                  rows={2}
                  value={catchphrasesText}
                  onChange={(e) => setCatchphrasesText(e.target.value)}
                  placeholder="防线巡检就绪，今天要排查哪一块模块？"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="p5-pond-dir-error" data-testid="diy-creator-error" role="alert">
          {error}
        </p>
      )}

      <div className="p5-diy-creator-foot">
        <button
          type="submit"
          className="p5-apply-btn p5-diy-submit-btn"
          data-testid="diy-creator-submit-btn"
          disabled={saving}
        >
          {saving
            ? '正在保存角色与立绘…'
            : editingCharacterId
            ? '★ 保存 DIY 角色修改'
            : '★ 创建角色并召唤上台'}
        </button>
        <button
          type="button"
          className="p5-mini-action-btn"
          onClick={onClose}
          disabled={saving}
        >
          取消
        </button>
      </div>
    </form>
  );
};
