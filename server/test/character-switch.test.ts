import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { CharacterPack } from '../../src/shared/character-pack';
import type { StageEvent } from '../../src/shared/stage-events';
import { createInitialStageState, stageReducer } from '../../src/stage/stageReducer';
import { Voice } from '../src/voice/voice';

test('切换角色立即发出新角色 happy 预置台词，优先 session_started 再回退口头禅', async () => {
  const pack: CharacterPack = JSON.parse(await readFile(new URL('./fixtures/characters/deepseek-v4-pro/character.json', import.meta.url), 'utf8'));
  const events: StageEvent[] = [], voice = new Voice(event => events.push(event));
  const settings = { ...DEFAULT_SETTINGS.voice, enabled: false };
  try {
    voice.configure(pack, settings);
    const next = { ...pack, id: 'gemini-4-argon', reactions: { session_started: { emotion: 'idle' as const, lines: ['哈基米到场。'] } } };
    voice.configure(next, settings);
    assert.equal(events.length, 1);
    assert.ok(events[0].type === 'character_line');
    assert.equal(events[0].characterId, next.id);
    assert.equal(events[0].text, '哈基米到场。');
    assert.equal(events[0].emotion, 'happy');
    assert.equal(events[0].source, 'preset');
    voice.configure(next, settings);
    assert.equal(events.length, 1, '同一角色的设置刷新不重复打招呼');
    voice.configure({ ...pack, reactions: {}, persona: { ...pack.persona, catchphrases: ['新角色口头禅。'] } }, settings);
    assert.equal(events.length, 2);
    assert.ok(events[1].type === 'character_line');
    assert.equal(events[1].text, '新角色口头禅。');
    assert.equal(events[1].characterId, pack.id);
    assert.equal(events[1].emotion, 'happy');
  } finally { voice.close(); }
});

const line = (characterId: string, lineId: string, text: string): Extract<StageEvent, { type: 'character_line' }> =>
  ({ type: 'character_line', at: 1, characterId, lineId, text, emotion: 'happy', source: 'preset' });

test('角色选择和设置回显不篡改旧台词归属，新预置台词不被旧模型响应覆盖', () => {
  const oldId = 'deepseek-v4-pro', nextId = 'gemini-4-argon';
  let state = createInitialStageState(oldId);
  state = stageReducer(state, { type: 'STAGE_EVENT', event: line(oldId, 'old-preset', '旧角色台词。') });
  state = stageReducer(state, { type: 'SET_CHARACTER', characterId: nextId });
  assert.equal(state.characterId, nextId);
  assert.equal(state.currentLine?.characterId, oldId);
  state = stageReducer(state, { type: 'SERVER_MESSAGE', message: { type: 'settings', settings: { ...state.serverSettings, activeCharacterId: oldId } } });
  state = stageReducer(state, { type: 'SERVER_MESSAGE', message: { type: 'settings', settings: { ...state.serverSettings, activeCharacterId: nextId } } });
  assert.equal(state.currentLine?.characterId, oldId);
  state = stageReducer(state, { type: 'STAGE_EVENT', event: line(nextId, 'new-preset', '哈基米到场。') });
  state = stageReducer(state, { type: 'STAGE_EVENT', event: { ...line(oldId, 'old-model', '旧角色延迟模型台词。'), source: 'model', replacesLineId: 'old-preset' } });
  assert.equal(state.currentLine?.text, '哈基米到场。');
  assert.equal(state.currentLine?.characterId, nextId);
  state = stageReducer(state, { type: 'STAGE_EVENT', event: { ...line(nextId, 'new-model', '哈基米模型台词。'), source: 'model', replacesLineId: 'new-preset' } });
  assert.equal(state.currentLine?.text, '哈基米模型台词。');
  assert.equal(state.currentLine?.characterId, nextId);
  assert.equal(state.currentLine?.replaceVersion, 1);
});
