import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { StageEvent } from '../../src/shared/stage-events';
import { PROTOCOL_VERSION, type ClientCommand, type ServerMessage, type SessionInfo } from '../../src/shared/wire';
import type { SettingsPatch } from '../../src/shared/settings';
import type { WorkerSession } from './adapters/types';
import type { AdapterRegistry } from './adapters/registry';
import { CharacterCatalog } from './characters';
import { SettingsStore } from './settings-store';
import { Voice } from './voice/voice';
import { listEndpointModels, testEndpoint } from './voice/endpoint';

export function parseCommand(value: unknown): ClientCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('命令必须是 JSON 对象');
  const c = value as Record<string, unknown>;
  const text = (key: string) => typeof c[key] === 'string' && !!(c[key] as string).trim() && (c[key] as string).length <= 100_000;
  switch (c.type) {
    case 'hello': if (typeof c.protocolVersion === 'number') break; throw new Error('协议版本无效');
    case 'send': case 'steer': if (text('id') && text('text')) break; throw new Error('消息 ID 或正文无效');
    case 'stop': case 'new_session': break;
    case 'resume_session': if (text('sessionId')) break; throw new Error('会话 ID 无效');
    case 'switch_character': if (text('characterId')) break; throw new Error('角色 ID 无效');
    case 'permission_decision': if (text('requestId') && typeof c.allowed === 'boolean') break; throw new Error('审批决定无效');
    case 'update_settings': if (c.patch && typeof c.patch === 'object' && !Array.isArray(c.patch)) break; throw new Error('设置补丁无效');
    case 'list_models': case 'test_connection': if (c.target === 'worker' || c.target === 'voice') break; throw new Error('模型目标无效');
    default: throw new Error('未知命令');
  }
  return c as unknown as ClientCommand;
}
export class SessionController {
  private worker?: WorkerSession;
  private info: SessionInfo | null = null;
  private history: StageEvent[] = [];
  private voice: Voice;
  private managementBusy = false;
  private stopPendingStart = false;
  private writingSettings = false;
  private closed = false;
  constructor(readonly store: SettingsStore, readonly characters: CharacterCatalog, readonly registry: AdapterRegistry,
    private broadcast: (message: ServerMessage) => void) {
    this.voice = new Voice(event => this.record(event)); this.configureVoice();
  }
  private configureVoice() {
    const settings = this.store.current;
    this.voice.configure(this.characters.get(settings.activeCharacterId), settings.voice);
  }
  private snapshot(): SessionInfo | null { return this.info ? { ...this.info, turnActive: this.worker?.turnActive ?? this.info.turnActive } : null; }
  private record(event: StageEvent) {
    this.history.push(event);
    if (this.history.length > 2000) this.history.splice(0, this.history.length - 2000);
    this.broadcast({ type: 'event', event });
    if (event.type === 'thinking' || event.type === 'user_message' || event.type === 'turn_done') {
      if (this.info) this.info.turnActive = event.type !== 'turn_done';
      this.broadcast({ type: 'session', session: this.snapshot() });
    }
    if (event.type !== 'character_line') this.voice.handle(event);
  }
  async welcome(): Promise<ServerMessage> {
    const workerAdapters = await this.registry.infos(this.store.current.worker);
    return { type: 'welcome', protocolVersion: PROTOCOL_VERSION, settings: this.store.public,
      characters: this.characters.summaries(), workerAdapters, session: this.snapshot(), history: [...this.history] };
  }
  private async project(path: string | null): Promise<string> {
    if (!path) throw new Error('请先选择项目文件夹');
    if (!isAbsolute(path)) throw new Error('项目目录必须是绝对路径');
    try { if (!(await stat(path)).isDirectory()) throw new Error(); return await realpath(path); }
    catch { throw new Error('项目文件夹不存在或无法访问'); }
  }
  private async openSession(resumeId?: string) {
    if (this.worker?.turnActive) throw new Error('请先喊停当前任务，再切换会话');
    const settings = this.store.current, cwd = await this.project(settings.projectDir);
    const adapter = this.registry.get(settings.worker.adapter);
    await this.worker?.close();
    this.worker = undefined; this.info = null; this.history = []; this.voice.reset();
    this.broadcast({ type: 'session', session: null });
    try {
      this.worker = await adapter.startSession({ cwd, model: settings.worker.model, sandbox: settings.worker.sandbox, extra: settings.worker.extra, resumeId, onEvent: event => this.record(event) });
      if (this.closed) { await this.worker.close(); this.worker = undefined; return; }
      this.info = { sessionId: this.worker.sessionId, adapter: adapter.id, model: settings.worker.model, cwd, turnActive: false };
      this.broadcast({ type: 'session', session: this.snapshot() });
    } catch (error) { this.broadcast({ type: 'session', session: null }); throw error; }
  }
  private async update(patch: SettingsPatch) {
    if (this.writingSettings) throw new Error('设置正在保存，请稍后重试');
    this.writingSettings = true;
    try {
      if (patch.activeCharacterId !== undefined && !this.characters.get(patch.activeCharacterId)) throw new Error('角色包不存在');
      if (patch.worker?.adapter !== undefined) this.registry.get(patch.worker.adapter);
      if (patch.projectDir !== undefined && patch.projectDir !== null) {
        const cwd = await this.project(patch.projectDir);
        patch = { ...patch, projectDir: cwd, recentProjects: [cwd, ...this.store.current.recentProjects.filter(p => p !== cwd)].slice(0, 20) };
      }
      await this.store.update(patch); this.configureVoice();
      this.broadcast({ type: 'settings', settings: this.store.public });
    } finally { this.writingSettings = false; }
  }
  async command(command: ClientCommand, reply: (message: ServerMessage) => void) {
    try {
      if (this.closed) throw new Error('服务正在关闭');
      switch (command.type) {
        case 'hello':
          if (command.protocolVersion !== PROTOCOL_VERSION) throw new Error(`不支持协议版本 ${command.protocolVersion}`);
          reply(await this.welcome()); break;
        case 'send': case 'new_session': case 'resume_session': {
          if (this.managementBusy) throw new Error('会话正在启动或切换，请稍后重试');
          this.managementBusy = true; this.stopPendingStart = false;
          try {
            if (command.type !== 'send' || !this.worker) await this.openSession(command.type === 'resume_session' ? command.sessionId : undefined);
            if (command.type === 'send' && this.stopPendingStart) {
              this.record({ type: 'user_message', at: Date.now(), id: command.id, text: command.text });
              this.record({ type: 'interrupted', at: Date.now(), reason: '用户在会话启动期间喊停，任务未提交执行' });
              this.record({ type: 'turn_done', at: Date.now(), ok: false, summary: '启动期间已取消' });
            } else if (command.type === 'send') await this.worker!.send(command.id, command.text);
          } finally { this.managementBusy = false; this.stopPendingStart = false; }
          break;
        }
        case 'steer': if (!this.worker) throw new Error('尚未建立会话'); await this.worker.steer(command.id, command.text); break;
        case 'stop':
          if (this.managementBusy && !this.worker) this.stopPendingStart = true;
          await this.worker?.interrupt(); break;
        case 'permission_decision':
          if (!this.worker) throw new Error('尚未建立会话');
          await this.worker.decidePermission(command.requestId, command.allowed); break;
        case 'switch_character': await this.update({ activeCharacterId: command.characterId }); break;
        case 'update_settings': await this.update(command.patch); break;
        case 'list_models': {
          const settings = this.store.current;
          const result = await (command.target === 'voice' ? listEndpointModels(settings.voice.endpoint) : this.registry.get(settings.worker.adapter).listModels(settings.worker));
          reply({ type: 'models', target: command.target, ...result }); break;
        }
        case 'test_connection': {
          const settings = this.store.current;
          const result = await (command.target === 'voice' ? testEndpoint(settings.voice.endpoint) : this.registry.get(settings.worker.adapter).testConnection(settings.worker));
          reply({ type: 'connection_test', target: command.target, ...result }); break;
        }
      }
    } catch (error) { reply({ type: 'command_error', commandType: command.type, message: (error as Error).message }); }
  }
  async close() { this.closed = true; try { await this.worker?.close(); } finally { this.voice.close(); } }
}
