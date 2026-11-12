import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  composeStagePersonaPreamble,
  mergeCharacterWithOverride,
} from '../../src/shared/diy-character';
import { CharacterCatalog, validateCharacter } from '../src/characters';
import { DiyStore } from '../src/diy-store';
import { startServer } from '../src/index';

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

const fixturesRoot = new URL('./fixtures/characters/', import.meta.url).pathname;

async function createTempDir() {
  await mkdir('/tmp/bigfish-c-sandbox/diy-unit', { recursive: true });
  return mkdtemp('/tmp/bigfish-c-sandbox/diy-unit/case-');
}

test('人设合成：自定义性格文件覆盖角色标语、称呼并拼装 <stage-persona>', async () => {
  const catalog = new CharacterCatalog(fixturesRoot);
  await catalog.load();
  const basePack = catalog.get('deepseek-v4-pro')!;

  const merged = mergeCharacterWithOverride(basePack, {
    sourceFileName: '毒舌架构师.md',
    rolePrompt: '你是一位冷峻犀利的系统架构师，说话一针见血，绝不废话。',
    selfTitle: '在下',
    userTitle: '主公',
    tagline: '冷峻毒舌 · 零容忍架构守门人',
    updatedAt: 1700000000000,
  });

  assert.equal(merged.tagline, '冷峻毒舌 · 零容忍架构守门人');
  assert.equal(merged.uiCopy?.userTitle, '主公');
  assert.match(merged.persona.systemPrompt, /冷峻犀利的系统架构师/);

  const preamble = composeStagePersonaPreamble(
    merged,
    {
      sourceFileName: '毒舌架构师.md',
      rolePrompt: '你是一位冷峻犀利的系统架构师，说话一针见血，绝不废话。',
      selfTitle: '在下',
      userTitle: '主公',
      updatedAt: 1700000000000,
    },
    '默认职责提示'
  );

  assert.match(preamble, /<stage-persona>[\s\S]*<\/stage-persona>/);
  assert.match(preamble, /自称「在下」/);
  assert.match(preamble, /称呼用户为「主公」/);
  assert.match(preamble, /冷峻犀利的系统架构师/);
  assert.match(preamble, /技术内容必须准确完整/);
});

test('DiyStore：保存与清除内置角色的 .md 性格定位覆盖', async () => {
  const dir = await createTempDir();
  const store = new DiyStore(dir);
  await store.load();

  await store.saveOverride('deepseek-v4-pro', {
    sourceFileName: 'persona.md',
    rolePrompt: '# 角色定位\n专注 Rust 与高并发调优的深海机械师。',
    selfTitle: '本机械师',
    userTitle: '舰长',
    tagline: '深海涡轮 · 高并发调优专家',
    updatedAt: Date.now(),
  });

  const snap1 = await store.snapshot();
  assert.equal(snap1.overrides['deepseek-v4-pro']?.sourceFileName, 'persona.md');
  assert.equal(snap1.overrides['deepseek-v4-pro']?.userTitle, '舰长');

  // 重新实例化验证持久化落盘
  const reloaded = new DiyStore(dir);
  await reloaded.load();
  const snap2 = await reloaded.snapshot();
  assert.match(snap2.overrides['deepseek-v4-pro']?.rolePrompt ?? '', /高并发调优/);

  // 清除覆盖恢复默认
  await reloaded.saveOverride('deepseek-v4-pro', null);
  const snap3 = await reloaded.snapshot();
  assert.equal(snap3.overrides['deepseek-v4-pro'], undefined);
});

test('DiyStore：创建、更新与删除带立绘的 DIY 自建角色，并通过 validateCharacter 校验', async () => {
  const dir = await createTempDir();
  const store = new DiyStore(dir);
  await store.load();

  const created = await store.saveCustomCharacter({
    name: '星野（安全审计娘）',
    codename: 'SEC · HOSHINO',
    tagline: '零信任防线 · 专抓越权与注入漏洞',
    themeColor: '#10B981',
    selfTitle: '我',
    userTitle: '指挥官',
    sourceFileName: 'hoshino-sec.md',
    rolePrompt: '你是安全审计专员星野，审查代码时优先排查命令注入、XSS 与路径穿越。',
    catchphrases: ['防线巡检开始，指挥官请稍候。'],
    idleDataUrl: TINY_PNG_DATA_URL,
  });

  assert.match(created.id, /^custom-/);
  assert.equal(created.name, '星野（安全审计娘）');
  assert.equal(created.art.renderer, 'sprites');
  assert.doesNotThrow(() => validateCharacter(created, created.id));

  const idleFile = join(store.charactersDir, created.id, created.art.renderer === 'sprites' ? created.art.emotions.idle : '');
  const info = await stat(idleFile);
  assert.ok(info.isFile() && info.size > 0);

  // 二次编辑（不重传图片时保留原主立绘，仅更新标语与增加 happy 差分）
  const updated = await store.saveCustomCharacter({
    id: created.id,
    name: '星野（首席安全官）',
    codename: 'SEC · HOSHINO',
    tagline: '红蓝对抗 · 首席安全守门人',
    themeColor: '#059669',
    selfTitle: '星野',
    userTitle: '长官',
    rolePrompt: '你是首席安全官星野。',
    emotionsDataUrls: {
      happy: TINY_PNG_DATA_URL,
    },
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.name, '星野（首席安全官）');
  assert.ok(updated.art.renderer === 'sprites' && updated.art.emotions.happy);

  // CharacterCatalog 能同时加载内置目录 + DIY 目录 + overrides
  const catalog = new CharacterCatalog(fixturesRoot, store.charactersDir);
  await catalog.load();
  assert.ok(catalog.get('deepseek-v4-pro'));
  assert.ok(catalog.get(created.id));

  // 拒绝删除内置角色与非法 ID
  await assert.rejects(() => store.deleteCustomCharacter('deepseek-v4-pro'), /仅允许删除自建角色/);
  await assert.rejects(() => store.deleteCustomCharacter('custom-../escape'), /仅允许删除自建角色|无效/);

  // 正常删除自建角色
  await store.deleteCustomCharacter(created.id);
  const afterDel = await store.snapshot();
  assert.equal(afterDel.customPacks.length, 0);
});

test('DiyStore：拦截超大性格文本与非图片 DataURL', async () => {
  const dir = await createTempDir();
  const store = new DiyStore(dir);
  await store.load();

  await assert.rejects(
    () =>
      store.saveOverride('deepseek-v4-pro', {
        rolePrompt: 'A'.repeat(9000),
        updatedAt: Date.now(),
      }),
    /性格定位内容过长/
  );

  await assert.rejects(
    () =>
      store.saveCustomCharacter({
        name: '非法测试',
        rolePrompt: '测试',
        idleDataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      }),
    /图片格式不受支持/
  );
});

test('HTTP 端到端：/api/diy 创建角色、/characters/<custom-id> 静态立绘读取与 Origin 校验', async () => {
  const dir = await createTempDir();
  const app = await startServer({
    port: 0,
    settingsPath: join(dir, 'settings.json'),
    charactersRoot: fixturesRoot,
    distRoot: dir,
  });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    // 未带合法 Origin 的写请求应返回 403
    const forbidden = await fetch(`${base}/api/diy/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ characterId: 'deepseek-v4-pro', override: null }),
    });
    assert.equal(forbidden.status, 403);

    // 合法同源创建 DIY 角色
    const createRes = await fetch(`${base}/api/diy/character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({
        name: '零号机（测试角色）',
        rolePrompt: '沉着冷静的自动化专家。',
        idleDataUrl: TINY_PNG_DATA_URL,
      }),
    });
    assert.equal(createRes.status, 200);
    const createdBody = (await createRes.json()) as any;
    assert.equal(createdBody.ok, true);
    const customId = createdBody.savedPack.id as string;
    assert.match(customId, /^custom-/);

    // /characters/<custom-id>/art/idle.png 静态回退可读
    const artRes = await fetch(`${base}/characters/${customId}/art/idle.png`);
    assert.equal(artRes.status, 200);
    assert.equal(artRes.headers.get('content-type'), 'image/png');

    // 删除该自建角色后静态文件返回 404
    const delRes = await fetch(`${base}/api/diy/character/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ id: customId }),
    });
    assert.equal(delRes.status, 200);
    const artAfterDel = await fetch(`${base}/characters/${customId}/art/idle.png`);
    assert.equal(artAfterDel.status, 404);
  } finally {
    await app.close();
  }
});
