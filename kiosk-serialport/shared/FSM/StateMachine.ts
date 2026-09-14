import { Logger } from '@/shared/Logger';
import { evaluateTransition } from './evaluateTransition';
import type { TransitionCondition, TransitionResult } from './types';

export type MachineState = 'IDLE' | 'EXECUTING' | 'ERROR';

export class StateMachine<TStatus> {
  private _state: MachineState = 'IDLE';
  private _condition: TransitionCondition<TStatus> | null = null;
  private _lastStatus: TStatus | null = null;

  private readonly logger = Logger.getInstance();

  constructor(private readonly tag = '[FSM]') {}

  get state(): MachineState {
    return this._state;
  }

  get lastStatus(): TStatus | null {
    return this._lastStatus;
  }

  start(condition: TransitionCondition<TStatus>): void {
    this.logger.info('[FSM] start()', {
      unmasked: { tag: this.tag, currentState: this._state },
    });
    if (this._state !== 'IDLE') {
      throw new Error(`Cannot start operation in '${this._state}' state`);
    }
    this._condition = condition;
    this._lastStatus = null;
    this._state = 'EXECUTING';
    this.logger.info('[FSM] start() → EXECUTING', {
      unmasked: { tag: this.tag },
    });
  }

  /**
   * 이전 작업이 ERROR로 남아있으면 리셋한 뒤 새 작업을 시작한다.
   * 폴링 실행기가 매 작업 진입 시 호출 — 상태명/복구 순서 지식을 FSM 안에 가둔다.
   */
  beginOrRecover(condition: TransitionCondition<TStatus>): void {
    if (this._state === 'ERROR') this.reset();
    this.start(condition);
  }

  /**
   * 폴링이 정상 종료(COMPLETE)에 도달하지 못한 채 빠져나갈 때(타임아웃/abort/예외)
   * EXECUTING으로 매달려 있으면 ERROR로 마감한다. 그 외 상태면 no-op.
   * 폴링 실행기의 finally에서 호출.
   */
  concludeIfRunning(): void {
    if (this._state === 'EXECUTING') this.forceError();
  }

  feed(status: TStatus): TransitionResult {
    if (this._state !== 'EXECUTING' || !this._condition) {
      throw new Error(`Cannot feed status in '${this._state}' state`);
    }

    const prev = this._lastStatus;
    this._lastStatus = status;
    const result = evaluateTransition(status, this._condition, prev);
    const nextState =
      result === 'COMPLETE'
        ? 'IDLE'
        : result === 'ERROR' || result === 'UNEXPECTED'
          ? 'ERROR'
          : this._state;
    this.logger.info('[FSM] feed()', {
      unmasked: { tag: this.tag, result, state: this._state, nextState },
    });

    switch (result) {
      case 'COMPLETE':
        this._state = 'IDLE';
        this._condition = null;
        break;
      case 'ERROR':
      case 'UNEXPECTED':
        this._state = 'ERROR';
        break;
      case 'IN_PROGRESS':
        break;
      default:
        throw new Error(`Invalid transition result: ${result}`);
    }

    return result;
  }

  forceError(status?: TStatus): void {
    this.logger.error('[FSM] forceError() → ERROR', undefined, {
      unmasked: { tag: this.tag, state: this._state },
    });
    if (status !== undefined) this._lastStatus = status;
    this._state = 'ERROR';
    this._condition = null;
  }

  reset(): void {
    if (this._state !== 'ERROR') {
      throw new Error(`Cannot reset in '${this._state}' state`);
    }
    this._state = 'IDLE';
    this._condition = null;
    this._lastStatus = null;
  }
}
