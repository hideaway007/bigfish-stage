import type { StageEvent } from '../shared/stage-events';
import {
  buildAllowBranchSteps,
  buildInitialBootEvents,
  buildPrePermissionSteps,
  buildRejectBranchSteps,
  type ScriptStep,
  type StageEventPayload,
} from './script';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  pickReactionForEvent,
} from '../stage/characterLoader';

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
    // Update any queued character_line events to reflect the newly switched character
    this.queue = this.queue.map((step) => {
      if (step.event.type === 'character_line') {
        return {
          ...step,
          event: {
            ...step.event,
            characterId,
          },
        };
      }
      if (
        step.event.type === 'sub_navigator_line' &&
        step.event.characterId === characterId
      ) {
        const fallbackNavi =
          characterId === 'gemini-4-argon'
            ? 'claude-opus-5-5'
            : 'gemini-4-argon';
        return {
          ...step,
          event: {
            ...step.event,
            characterId: fallbackNavi,
          },
        };
      }
      return step;
    });
  }

  public boot(): void {
    this.clearTimers();
    this.running = false;
    this.waitingForPermission = false;
    this.queue = [];
    const now = Date.now();
    const bootEvents = buildInitialBootEvents(this.characterId);
    bootEvents.forEach((payload, index) => {
      const event = {
        ...payload,
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
    if (this.timerId !== null && this.queue.length > 0) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
      const elapsed = Date.now() - this.stepStartedAt;
      const targetDelay = this.computeEffectiveDelay(this.currentStepBaseDelay);
      const remaining = Math.max(25, targetDelay - elapsed);
      this.timerId = window.setTimeout(() => this.flushNext(), remaining);
    }
  }

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

  public sendSteer(text: string): void {
    const steerId = `steer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.emit({
      type: 'steer_queued',
      id: steerId,
      text,
    });

    const pack = getCachedCharacterPack(this.characterId);
    const queuedReaction = pickReactionForEvent(pack, {
      type: 'steer_queued',
      id: steerId,
      text,
      at: Date.now(),
    });
    if (queuedReaction) {
      this.emit({
        type: 'character_line',
        lineId: `line_steer_q_${steerId}`,
        source: 'preset',
        characterId: this.characterId,
        emotion: queuedReaction.emotion,
        text: queuedReaction.text,
      });
    }

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

  public resolvePermission(allowed: boolean): void {
    if (!this.waitingForPermission) return;
    this.waitingForPermission = false;
    this.queue = allowed
      ? buildAllowBranchSteps(this.characterId)
      : buildRejectBranchSteps(this.characterId);
    this.scheduleNext();
  }

  public stop(): void {
    if (!this.running) return;
    this.clearTimers();
    this.running = false;
    this.waitingForPermission = false;
    this.queue = [];
    this.emit({
      type: 'interrupted',
      reason: '用户主动喊停',
    });
    const pack = getCachedCharacterPack(this.characterId);
    const reaction = pickReactionForEvent(pack, {
      type: 'interrupted',
      reason: '用户主动喊停',
      at: Date.now(),
    });
    if (reaction) {
      this.emit({
        type: 'character_line',
        lineId: `line_stop_${Date.now()}`,
        source: 'preset',
        characterId: this.characterId,
        emotion: reaction.emotion,
        text: reaction.text,
      });
    }
    this.emit({
      type: 'turn_done',
      ok: false,
      summary: '用户已喊停本轮演出',
    });
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
