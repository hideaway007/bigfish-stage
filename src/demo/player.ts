import type { StageEvent } from '../shared/stage-events';
import {
  buildAllowBranchSteps,
  buildPrePermissionSteps,
  buildRejectBranchSteps,
  INITIAL_BOOT_EVENTS,
  type ScriptStep,
  type StageEventPayload,
} from './script';
import { DEFAULT_CHARACTER_ID } from '../stage/reactions';

export type PlayerListener = (event: StageEvent) => void;

export class ScriptPlayer {
  private listener: PlayerListener;
  private characterId: string;
  private queue: ScriptStep[] = [];
  private timerId: number | null = null;
  private stepStartedAt = 0;
  private currentStepBaseDelay = 0;
  private fastForward = false;
  private running = false;
  private waitingForPermission = false;
  private steerTimers: Set<number> = new Set();

  constructor(
    listener: PlayerListener,
    characterId: string = DEFAULT_CHARACTER_ID
  ) {
    this.listener = listener;
    this.characterId = characterId;
  }

  public setCharacterId(characterId: string): void {
    this.characterId = characterId;
  }

  public boot(): void {
    this.clearTimers();
    this.running = false;
    this.waitingForPermission = false;
    this.queue = [];
    const now = Date.now();
    INITIAL_BOOT_EVENTS.forEach((payload, index) => {
      const event = {
        ...payload,
        ...(payload.type === 'character_line'
          ? { characterId: this.characterId }
          : {}),
        at: now + index,
      } as StageEvent;
      this.listener(event);
    });
  }

  public isRunning(): boolean {
    return this.running;
  }

  public isWaitingForPermission(): boolean {
    return this.waitingForPermission;
  }

  public setFastForward(fast: boolean): void {
    if (this.fastForward === fast) return;
    this.fastForward = fast;
    // Dynamically reschedule active timer if one is pending
    if (this.timerId !== null && this.queue.length > 0) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
      const elapsed = Date.now() - this.stepStartedAt;
      const targetDelay = this.computeEffectiveDelay(this.currentStepBaseDelay);
      const remaining = Math.max(25, targetDelay - elapsed);
      this.timerId = window.setTimeout(() => this.flushNext(), remaining);
    }
  }

  /**
   * 用户发出第一条消息（或新一轮消息）时启动剧本播放
   */
  public startTurn(userText: string): void {
    this.clearTimers();
    this.running = true;
    this.waitingForPermission = false;

    this.emit({
      type: 'user_message',
      id: `msg_user_${Date.now()}`,
      text: userText,
    });

    this.queue = buildPrePermissionSteps(this.characterId);
    this.scheduleNext();
  }

  /**
   * 剧本运行中，用户发消息 -> 立即发出 steer_queued，稍后剧本返回 steer_acked
   */
  public sendSteer(text: string): void {
    const steerId = `steer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.emit({
      type: 'steer_queued',
      id: steerId,
      text,
    });

    const ackDelay = this.fastForward ? 320 : 1350;
    const tId = window.setTimeout(() => {
      this.steerTimers.delete(tId);
      this.emit({
        type: 'steer_acked',
        id: steerId,
      });
    }, ackDelay);
    this.steerTimers.add(tId);
  }

  /**
   * 用户在权限选择肢中选择「允许」或「拒绝」
   */
  public resolvePermission(allowed: boolean): void {
    if (!this.waitingForPermission) return;
    this.waitingForPermission = false;
    this.queue = allowed
      ? buildAllowBranchSteps(this.characterId)
      : buildRejectBranchSteps(this.characterId);
    this.scheduleNext();
  }

  public dispose(): void {
    this.clearTimers();
  }

  private computeEffectiveDelay(baseMs: number): number {
    return this.fastForward ? Math.max(40, Math.round(baseMs * 0.22)) : baseMs;
  }

  private scheduleNext(): void {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.queue.length === 0) {
      return;
    }
    const nextStep = this.queue[0];
    this.currentStepBaseDelay = nextStep.delayMs;
    this.stepStartedAt = Date.now();
    const delay = this.computeEffectiveDelay(nextStep.delayMs);
    this.timerId = window.setTimeout(() => this.flushNext(), delay);
  }

  private flushNext(): void {
    this.timerId = null;
    const step = this.queue.shift();
    if (!step) return;

    this.emit(step.event);

    if (step.event.type === 'permission_request') {
      this.waitingForPermission = true;
      return;
    }

    if (step.event.type === 'turn_done' || step.event.type === 'error') {
      this.running = false;
      this.waitingForPermission = false;
      this.queue = [];
      return;
    }

    if (this.queue.length > 0) {
      this.scheduleNext();
    }
  }

  private emit(payload: StageEventPayload): void {
    const event = {
      ...payload,
      at: Date.now(),
    } as StageEvent;
    this.listener(event);
  }

  private clearTimers(): void {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    for (const id of this.steerTimers) {
      window.clearTimeout(id);
    }
    this.steerTimers.clear();
  }
}
