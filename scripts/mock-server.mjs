#!/usr/bin/env node
/**
 * Mock WebSocket Server for Task D Verification (scripts/mock-server.mjs)
 *
 * - Implements `src/shared/wire.ts` protocol on 127.0.0.1:5300/ws (or PORT env).
 * - Loads character packs from `public/characters/<id>/character.json`.
 * - Replays `bridge/samples/app-full.stage.jsonl` on `send`, pausing at
 *   `permission_request` until the client sends `permission_decision`.
 * - Responds to `switch_character`, `update_settings`, `steer`, `stop`,
 *   `list_models`, `test_connection`, `new_session`.
 * - Persists state to a temp file (unless `--fresh` is passed) so stopping
 *   and restarting the mock server restores `welcome.history` and `settings`.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SAMPLE_JSONL_PATH = path.join(
  ROOT_DIR,
  'bridge',
  'samples',
  'app-full.stage.jsonl'
);
const CHARACTERS_DIR = path.join(ROOT_DIR, 'public', 'characters');

const PORT = Number(process.env.PORT || 5300);
const HOST = '127.0.0.1';
const STATE_FILE =
  process.env.MOCK_STATE_FILE || '/tmp/bigfish-mock-server-state.json';
const IS_FRESH = process.argv.includes('--fresh');
const SPEED_SCALE = Number(process.env.MOCK_SPEED_SCALE || 0.08);

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Load all character packs from public/characters/*/character.json
function loadCharacterPacks() {
  const packs = new Map();
  const summaries = [];
  if (!fs.existsSync(CHARACTERS_DIR)) return { packs, summaries };

  const dirs = fs
    .readdirSync(CHARACTERS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const id of dirs) {
    const file = path.join(CHARACTERS_DIR, id, 'character.json');
    if (!fs.existsSync(file)) continue;
    try {
      const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
      packs.set(pack.id, pack);
      const portraitRel = pack.art?.portrait;
      summaries.push({
        id: pack.id,
        name: pack.name,
        codename: pack.codename,
        themeColor: pack.themeColor,
        portraitUrl: portraitRel
          ? `/characters/${pack.id}/${portraitRel.replace(/^\.\//, '')}`
          : null,
        renderer: pack.art?.renderer || 'sprites',
      });
    } catch {
      // ignore invalid
    }
  }
  return { packs, summaries };
}

// Parse bridge/samples/app-full.stage.jsonl
function loadSampleEvents() {
  if (!fs.existsSync(SAMPLE_JSONL_PATH)) {
    throw new Error(`Sample file not found: ${SAMPLE_JSONL_PATH}`);
  }
  return fs
    .readFileSync(SAMPLE_JSONL_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const { packs: characterPacks, summaries: characterSummaries } =
  loadCharacterPacks();
const sampleEvents = loadSampleEvents();

function pickReaction(characterId, reactionKey, vars = {}) {
  const pack =
    characterPacks.get(characterId) || characterPacks.get('deepseek-v4-pro');
  if (!pack || !pack.reactions) return null;
  const r =
    pack.reactions[reactionKey] ||
    pack.reactions[reactionKey.split(':')[0]];
  if (!r || !Array.isArray(r.lines) || r.lines.length === 0) return null;
  const raw = r.lines[0];
  const text = raw
    .replace(/\{file\}/g, vars.file || vars.summary || '目标文件')
    .replace(/\{tool\}/g, vars.tool || '工具')
    .replace(/\{summary\}/g, vars.summary || vars.file || '当前操作');
  return { emotion: r.emotion, text };
}

function createDefaultState() {
  const activeCharacterId = 'deepseek-v4-pro';
  const greeting = pickReaction(activeCharacterId, 'session_started') || {
    emotion: 'idle',
    text: '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？',
  };
  const now = Date.now();
  const initialSession = {
    sessionId: '01a1bfaf-ed6d-7023-809d-1cb889b893df',
    adapter: 'codex',
    model: 'gpt-6.1-sol',
    cwd: '/private/tmp/p5-bridge-sandbox',
    turnActive: false,
  };
  return {
    settings: {
      version: 1,
      activeCharacterId,
      projectDir: '/private/tmp/p5-bridge-sandbox',
      recentProjects: [
        '/private/tmp/p5-bridge-sandbox',
        '/workspace/bigfish-login-app',
      ],
      worker: {
        adapter: 'codex',
        model: 'gpt-6.1-sol',
        sandbox: 'workspace-write',
        connection: 'endpoint',
        endpoint: { baseUrl: 'http://127.0.0.1:3425/v1', apiKeySet: false },
      },
      voice: {
        enabled: true,
        endpoint: {
          baseUrl: 'http://127.0.0.1:3425/v1',
          model: 'remote-magpie/antigravity/gemini-3.8-flash',
          apiKeySet: false,
        },
        maxLinesPerMinute: 6,
      },
      performance: {
        typingCharsPerSec: 40,
      },
    },
    session: initialSession,
    history: [
      {
        type: 'session_started',
        sessionId: initialSession.sessionId,
        model: initialSession.model,
        cwd: initialSession.cwd,
        at: now,
      },
      {
        type: 'character_line',
        lineId: 'line_welcome_0',
        source: 'preset',
        characterId: activeCharacterId,
        emotion: greeting.emotion,
        text: greeting.text,
        at: now + 1,
      },
    ],
  };
}

function loadPersistedState() {
  if (IS_FRESH && fs.existsSync(STATE_FILE)) {
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(STATE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (saved && saved.settings && Array.isArray(saved.history)) {
        return saved;
      }
    } catch {
      // fallback
    }
  }
  return createDefaultState();
}

const serverState = loadPersistedState();

function savePersistedState() {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          settings: serverState.settings,
          session: serverState.session,
          history: serverState.history.slice(-2000),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // ignore
  }
}

const workerAdapters = [
  {
    id: 'codex',
    name: 'OpenAI Codex (codex app-server)',
    available: true,
  },
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    available: false,
    unavailableReason: 'Phase 1 暂未启用 Claude Code 适配器',
  },
];

const availableModels = [
  'codex/gpt-6.1-sol',
  'codex/codex-mini-latest',
  'remote-magpie/antigravity/gemini-3.8-flash',
  'remote-magpie/antigravity/gemini-4-argon',
  'gpt-6.1-sol',
  'gpt-6-luna',
  'deepseek-v4-pro',
  'claude-opus-5-5',
];

const MOCK_CONN_FAIL = process.env.MOCK_CONN_FAIL || '';
const MOCK_MODELS_FAIL = process.env.MOCK_MODELS_FAIL || '';

function resolveMockConnFailMessage(mode, target) {
  const normalized = String(mode).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'econnrefused') {
    const url =
      target === 'voice'
        ? serverState.settings.voice.endpoint.baseUrl
        : serverState.settings.worker.endpoint.baseUrl;
    return `TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:3425 -> ${url}/chat/completions)`;
  }
  if (normalized === '401' || normalized === '403') {
    return `模型接口 HTTP ${normalized} Unauthorized: invalid_api_key`;
  }
  if (normalized === '404') {
    const model =
      target === 'voice'
        ? serverState.settings.voice.endpoint.model
        : serverState.settings.worker.model;
    return `模型接口 HTTP 404 Not Found: The model '${model}' does not exist`;
  }
  if (normalized === 'timeout') {
    return 'TimeoutError: The operation was aborted due to timeout (12000 ms)';
  }
  if (normalized === 'codex') {
    return '找不到可用的 codex 可执行文件 (spawn codex ENOENT)';
  }
  return String(mode).trim();
}

const clients = new Set();
let replayTimers = [];
let pendingPermissionIndex = null;

function clearReplayTimers() {
  for (const t of replayTimers) {
    clearTimeout(t);
  }
  replayTimers = [];
}

function encodeWsFrame(jsonText) {
  const payload = Buffer.from(jsonText, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function sendToSocket(socket, msgObj) {
  if (socket.destroyed) return;
  try {
    socket.write(encodeWsFrame(JSON.stringify(msgObj)));
  } catch {
    // ignore
  }
}

function broadcast(msgObj) {
  for (const sock of clients) {
    sendToSocket(sock, msgObj);
  }
}

function emitStageEvent(eventPayload) {
  const event = {
    ...eventPayload,
    at: Date.now(),
  };
  // Handle in-place replacement in server history
  if (event.type === 'character_line' && event.replacesLineId) {
    const idx = serverState.history.findIndex(
      (e) => e.type === 'character_line' && e.lineId === event.replacesLineId
    );
    if (idx !== -1) {
      serverState.history[idx] = {
        ...event,
        lineId: event.lineId || event.replacesLineId,
      };
    } else {
      serverState.history.push(event);
    }
  } else {
    serverState.history.push(event);
  }
  savePersistedState();
  broadcast({ type: 'event', event });
}

function scheduleReplaySlice(startIndex, endIndexInclusive, onReachedEnd) {
  clearReplayTimers();
  let cumulativeDelayMs = 60;
  let prevAt = sampleEvents[startIndex]?.at ?? Date.now();

  for (let i = startIndex; i <= endIndexInclusive; i += 1) {
    const rawEv = sampleEvents[i];
    if (!rawEv) continue;

    const rawDelta = Math.max(0, (rawEv.at || prevAt) - prevAt);
    prevAt = rawEv.at || prevAt;

    // Compress long LLM pauses while preserving realistic ordering
    const scaledDelta =
      rawEv.type === 'worker_text'
        ? Math.min(18, Math.max(4, Math.round(rawDelta * SPEED_SCALE)))
        : Math.min(220, Math.max(45, Math.round(rawDelta * SPEED_SCALE)));

    cumulativeDelayMs += scaledDelta;
    const delayCapture = cumulativeDelayMs;

    const timer = setTimeout(() => {
      const charId = serverState.settings.activeCharacterId;
      emitStageEvent(rawEv);

      // Inject character reactions for key tool/permission/turn events
      if (rawEv.type === 'tool_start' && rawEv.tool === 'edit') {
        const r = pickReaction(charId, 'tool_start:edit', {
          file: rawEv.file,
          tool: rawEv.tool,
          summary: rawEv.summary,
        });
        if (r) {
          emitStageEvent({
            type: 'character_line',
            lineId: `line_edit_${Date.now()}`,
            source: 'preset',
            characterId: charId,
            emotion: r.emotion,
            text: r.text,
          });
        }
      } else if (rawEv.type === 'permission_request') {
        const r = pickReaction(charId, 'permission_request', {
          tool: rawEv.tool,
          summary: rawEv.summary,
        });
        if (r) {
          emitStageEvent({
            type: 'character_line',
            lineId: `line_perm_${Date.now()}`,
            source: 'preset',
            characterId: charId,
            emotion: r.emotion,
            text: r.text,
          });
        }
      } else if (rawEv.type === 'turn_done') {
        serverState.session.turnActive = false;
        const r = pickReaction(
          charId,
          rawEv.ok ? 'turn_done' : 'turn_done:fail',
          { summary: rawEv.summary }
        );
        if (r) {
          emitStageEvent({
            type: 'character_line',
            lineId: `line_done_${Date.now()}`,
            source: 'preset',
            characterId: charId,
            emotion: r.emotion,
            text: r.text,
          });
        }
        savePersistedState();
        broadcast({ type: 'session', session: serverState.session });
      }

      if (i === endIndexInclusive && onReachedEnd) {
        onReachedEnd();
      }
    }, delayCapture);

    replayTimers.push(timer);
  }
}

function handleStartTurn(userMsgId, userText) {
  clearReplayTimers();
  pendingPermissionIndex = null;
  serverState.session.turnActive = true;
  broadcast({ type: 'session', session: serverState.session });

  const charId = serverState.settings.activeCharacterId;
  emitStageEvent({
    type: 'user_message',
    id: userMsgId || `msg_${Date.now()}`,
    text: userText,
  });

  // 1. Immediate preset character_line (<50ms)
  const presetLineId = `line_start_${Date.now()}`;
  const startReaction = pickReaction(charId, 'user_message') || {
    emotion: 'thinking',
    text: '收到指令捏！让我先看看文件！',
  };
  emitStageEvent({
    type: 'character_line',
    lineId: presetLineId,
    source: 'preset',
    characterId: charId,
    emotion: startReaction.emotion,
    text: startReaction.text,
  });

  // 2. Model replacement line (replacesLineId) shortly after if voice.enabled
  if (serverState.settings.voice.enabled) {
    const modelTimer = setTimeout(() => {
      const pack = characterPacks.get(charId);
      const shortName = pack ? pack.name.split('（')[0] : '大肥鱼';
      emitStageEvent({
        type: 'character_line',
        lineId: `${presetLineId}_model`,
        replacesLineId: presetLineId,
        source: 'model',
        characterId: charId,
        emotion: 'thinking',
        text: `${shortName}收到投喂：「${userText.slice(0, 22)}」！马上潜入仓库检查 add.js 并修复测试捏！`,
      });
    }, 240);
    replayTimers.push(modelTimer);
  }

  // Find permission_request index in sampleEvents (skip index 0 which is user_message)
  const permIdx = sampleEvents.findIndex(
    (ev) => ev.type === 'permission_request'
  );
  const stopIdx = permIdx !== -1 ? permIdx : sampleEvents.length - 1;

  scheduleReplaySlice(1, stopIdx, () => {
    if (permIdx !== -1) {
      pendingPermissionIndex = permIdx;
    }
  });
}

function handlePermissionDecision(requestId, allowed) {
  if (pendingPermissionIndex === null) return;
  const permIdx = pendingPermissionIndex;
  pendingPermissionIndex = null;

  const charId = serverState.settings.activeCharacterId;

  if (allowed) {
    // Replay from permission_resolved (permIdx + 1) to end of sampleEvents
    scheduleReplaySlice(permIdx + 1, sampleEvents.length - 1);
  } else {
    clearReplayTimers();
    emitStageEvent({
      type: 'permission_resolved',
      requestId: requestId || '0',
      allowed: false,
    });
    const r = pickReaction(charId, 'interrupted') || {
      emotion: 'worried',
      text: '明白捏！既然店长选了 LOW 拒绝执行终端测试，大肥鱼就先收起工具待命啦！',
    };
    emitStageEvent({
      type: 'character_line',
      lineId: `line_reject_${Date.now()}`,
      source: 'preset',
      characterId: charId,
      emotion: 'worried',
      text: r.text,
    });
    serverState.session.turnActive = false;
    emitStageEvent({
      type: 'turn_done',
      ok: false,
      summary: '用户拒绝终端测试审批，本轮提前结束',
      durationMs: 3200,
    });
    broadcast({ type: 'session', session: serverState.session });
  }
}

function applySettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return;
  const s = serverState.settings;
  if (typeof patch.activeCharacterId === 'string') {
    s.activeCharacterId = patch.activeCharacterId;
  }
  if (patch.projectDir !== undefined) {
    s.projectDir = patch.projectDir;
    if (
      typeof patch.projectDir === 'string' &&
      patch.projectDir &&
      !s.recentProjects.includes(patch.projectDir)
    ) {
      s.recentProjects = [patch.projectDir, ...s.recentProjects].slice(0, 8);
    }
  }
  if (Array.isArray(patch.recentProjects)) {
    s.recentProjects = patch.recentProjects;
  }
  if (patch.worker && typeof patch.worker === 'object') {
    const { endpoint, ...workerPatch } = patch.worker;
    s.worker = { ...s.worker, ...workerPatch };
    if (endpoint && typeof endpoint === 'object') {
      if (endpoint.baseUrl !== undefined) s.worker.endpoint.baseUrl = endpoint.baseUrl;
      if (endpoint.apiKey !== undefined) s.worker.endpoint.apiKeySet = endpoint.apiKey.length > 0;
    }
  }
  if (patch.voice && typeof patch.voice === 'object') {
    if (patch.voice.enabled !== undefined) {
      s.voice.enabled = Boolean(patch.voice.enabled);
    }
    if (patch.voice.maxLinesPerMinute !== undefined) {
      s.voice.maxLinesPerMinute = Number(patch.voice.maxLinesPerMinute);
    }
    if (patch.voice.endpoint && typeof patch.voice.endpoint === 'object') {
      if (patch.voice.endpoint.baseUrl !== undefined) {
        s.voice.endpoint.baseUrl = patch.voice.endpoint.baseUrl;
      }
      if (patch.voice.endpoint.model !== undefined) {
        s.voice.endpoint.model = patch.voice.endpoint.model;
      }
      if (patch.voice.endpoint.apiKey !== undefined) {
        s.voice.endpoint.apiKeySet = patch.voice.endpoint.apiKey.length > 0;
      }
    }
  }
  if (patch.performance && typeof patch.performance === 'object') {
    if (patch.performance.typingCharsPerSec !== undefined) {
      s.performance.typingCharsPerSec = Number(
        patch.performance.typingCharsPerSec
      );
    }
  }
  savePersistedState();
}

function handleClientCommand(socket, cmd) {
  if (!cmd || typeof cmd.type !== 'string') return;

  switch (cmd.type) {
    case 'hello': {
      sendToSocket(socket, {
        type: 'welcome',
        protocolVersion: 1,
        settings: serverState.settings,
        characters: characterSummaries,
        workerAdapters,
        session: serverState.session,
        history: serverState.history,
      });
      break;
    }

    case 'send': {
      handleStartTurn(cmd.id, cmd.text || 'Fix add.js and run npm test');
      break;
    }

    case 'steer': {
      const steerId = cmd.id || `steer_${Date.now()}`;
      emitStageEvent({
        type: 'steer_queued',
        id: steerId,
        text: cmd.text,
      });
      const charId = serverState.settings.activeCharacterId;
      const r = pickReaction(charId, 'steer_queued');
      if (r) {
        emitStageEvent({
          type: 'character_line',
          lineId: `line_steer_${steerId}`,
          source: 'preset',
          characterId: charId,
          emotion: r.emotion,
          text: r.text,
        });
      }
      const t = setTimeout(() => {
        emitStageEvent({
          type: 'steer_acked',
          id: steerId,
        });
      }, 450);
      replayTimers.push(t);
      break;
    }

    case 'stop': {
      clearReplayTimers();
      pendingPermissionIndex = null;
      serverState.session.turnActive = false;
      emitStageEvent({
        type: 'interrupted',
        reason: '用户主动喊停',
      });
      emitStageEvent({
        type: 'turn_done',
        ok: false,
        summary: '已按用户要求喊停本轮任务',
      });
      broadcast({ type: 'session', session: serverState.session });
      break;
    }

    case 'permission_decision': {
      handlePermissionDecision(cmd.requestId, Boolean(cmd.allowed));
      break;
    }

    case 'switch_character': {
      if (typeof cmd.characterId === 'string') {
        serverState.settings.activeCharacterId = cmd.characterId;
        savePersistedState();
        broadcast({ type: 'settings', settings: serverState.settings });

        const r = pickReaction(cmd.characterId, 'session_started');
        if (r) {
          emitStageEvent({
            type: 'character_line',
            lineId: `line_switch_${Date.now()}`,
            source: 'preset',
            characterId: cmd.characterId,
            emotion: r.emotion,
            text: r.text,
          });
        }
      }
      break;
    }

    case 'update_settings': {
      applySettingsPatch(cmd.patch);
      broadcast({ type: 'settings', settings: serverState.settings });
      break;
    }

    case 'new_session': {
      clearReplayTimers();
      pendingPermissionIndex = null;
      const newSessionId = `ses_mock_${Date.now().toString(36)}`;
      serverState.session = {
        sessionId: newSessionId,
        adapter: serverState.settings.worker.adapter,
        model: serverState.settings.worker.model,
        cwd:
          serverState.settings.projectDir || '/private/tmp/p5-bridge-sandbox',
        turnActive: false,
      };
      serverState.history = [];
      broadcast({ type: 'session', session: serverState.session });
      emitStageEvent({
        type: 'session_started',
        sessionId: serverState.session.sessionId,
        model: serverState.session.model,
        cwd: serverState.session.cwd,
      });
      const charId = serverState.settings.activeCharacterId;
      const r = pickReaction(charId, 'session_started');
      if (r) {
        emitStageEvent({
          type: 'character_line',
          lineId: `line_newses_${Date.now()}`,
          source: 'preset',
          characterId: charId,
          emotion: r.emotion,
          text: r.text,
        });
      }
      break;
    }

    case 'resume_session': {
      serverState.session.sessionId = cmd.sessionId;
      savePersistedState();
      broadcast({ type: 'session', session: serverState.session });
      break;
    }

    case 'list_models': {
      if (MOCK_MODELS_FAIL) {
        sendToSocket(socket, {
          type: 'models',
          target: cmd.target,
          models: [],
          error:
            MOCK_MODELS_FAIL === '1'
              ? '无法读取模型列表，请检查接口地址与凭据 (connect ECONNREFUSED 127.0.0.1:3425)'
              : MOCK_MODELS_FAIL,
        });
        break;
      }
      sendToSocket(socket, {
        type: 'models',
        target: cmd.target,
        models: availableModels,
      });
      break;
    }

    case 'test_connection': {
      const targetEndpointUrl =
        cmd.target === 'voice'
          ? serverState.settings.voice.endpoint.baseUrl
          : serverState.settings.worker.endpoint.baseUrl;
      const failMode =
        MOCK_CONN_FAIL ||
        (/fail|:9999/i.test(targetEndpointUrl) ? 'econnrefused' : '');

      if (failMode) {
        sendToSocket(socket, {
          type: 'connection_test',
          target: cmd.target,
          ok: false,
          message: resolveMockConnFailMessage(failMode, cmd.target),
          latencyMs: 9,
        });
        break;
      }

      sendToSocket(socket, {
        type: 'connection_test',
        target: cmd.target,
        ok: true,
        message:
          cmd.target === 'worker'
            ? `Mock 服务已就绪：适配器 ${serverState.settings.worker.adapter} · 模型 ${serverState.settings.worker.model}`
            : `Mock 台词网关连通正常：${serverState.settings.voice.endpoint.baseUrl} (${serverState.settings.voice.endpoint.model})`,
        latencyMs: 14,
      });
      break;
    }

    default:
      break;
  }
}

// Decode incoming RFC 6455 WebSocket frames from client
function attachWebSocketFrameParser(socket) {
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      const totalFrameLen = offset + maskLen + payloadLen;
      if (buffer.length < totalFrameLen) return;

      let payload = buffer.subarray(offset + maskLen, totalFrameLen);
      if (isMasked) {
        const maskKey = buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i += 1) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = unmasked;
      }

      buffer = buffer.subarray(totalFrameLen);

      if (opcode === 0x08) {
        // Close frame
        socket.end();
        return;
      }
      if (opcode === 0x09) {
        // Ping -> Pong
        const pong = Buffer.from([0x8a, 0x00]);
        socket.write(pong);
        continue;
      }
      if (opcode === 0x01) {
        // Text frame
        const text = payload.toString('utf8');
        try {
          const cmd = JSON.parse(text);
          handleClientCommand(socket, cmd);
        } catch {
          // ignore malformed JSON
        }
      }
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Big Fish Stage Mock WebSocket Server (/ws)\n');
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key || typeof key !== 'string') {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + WS_MAGIC_GUID)
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      '',
    ].join('\r\n')
  );

  clients.add(socket);
  attachWebSocketFrameParser(socket);

  socket.on('close', () => {
    clients.delete(socket);
  });
  socket.on('error', () => {
    clients.delete(socket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[mock-server] Listening on ws://${HOST}:${PORT}/ws (sample=${sampleEvents.length} events, characters=${characterSummaries.length})`
  );
});
