import {
  TOKEN_DISPENSER_ERROR_CODE as ERROR_CODE,
  TOKEN_DISPENSER_ERROR_MESSAGE as ERROR_CODE_MESSAGE,
  isTokenDispenserErrorCode,
  RESET_TIMEOUTS,
} from 'kiosk-types';
import type { PollBudget } from '@/shared/FSM/runStatusPoll';
import { runStatusPoll } from '@/shared/FSM/runStatusPoll';
import type { TransitionCondition } from '@/shared/FSM/types';
import { Logger } from '@/shared/Logger';
import {
  ManagedSerialPort,
  PortNotConfiguredError,
} from '@/shared/SerialPort/ManagedSerialPort';
import { SerialPortTranslator } from '@/shared/SerialPort/SerialPortTranslator';
import type { SerialPortConnectionInfo } from '@/shared/SerialPort/types';
import { COMMAND, CONTROL_CHAR, RESPONSE_CODE } from '../constants/protocol';
import { DispenserStateMachine } from '../fsm/DispenserStateMachine';
import {
  collectToHopperTransition,
  dispenseToMidTransition,
  dispenseTransition,
  isCommandBlocked,
  resetTransition,
  returnTokenTransition,
} from '../fsm/transitions';
import {
  collectToHopperStrategy,
  dispenseStrategy,
  enqRequestStrategy,
  eotCancelStrategy,
  resetStrategy,
  returnTokenStrategy,
  setCommandFeedingStrategy,
  statusCommandStrategy,
} from '../strategy/dispenseStrategies';
import { buildCommandPacket } from '../utils/buildCommandPacket';
import { extractData } from '../utils/extractData';
import type { DispenserStatus } from '../utils/parseStatus';
import { parseStatus } from '../utils/parseStatus';
import { TD200ProtocolParser } from '../utils/TD200ProtocolParser';

const COMMAND_TIMEOUT_MS = 500;
const POLL_INTERVAL_MS = 200;
const MAX_POLL_COUNT = 50; // 폴 50회. 모터 동작 기준 — 벽시계로 환산하지 말 것.
// 리셋도 벽시계다 — 굳은 장비에서 폴 한 번은 간격(200ms)이 아니라 getStatus 재시도까지
// 얹혀 수 초가 될 수 있어, 폴 횟수 예산은 위층 타임아웃이 맞출 값 자체가 없다.
const RESET_BUDGET_MS = RESET_TIMEOUTS.DEVICE_BUDGET_MS;
// RS 완료 후 최소 체류 — `reset()` 의 "반환 = 다음 명령 가능" 계약을 세우는 값.
const POST_RESET_DWELL_MS = RESET_TIMEOUTS.POST_RESET_DWELL_MS;
const ACK_RESPONSE = Buffer.from([CONTROL_CHAR.ACK, 0x30, 0x30]);
const DEFAULT_TRANSACT_ATTEMPTS = 3;
const TRANSACT_RETRY_GAP_MS = 100;
// connect() 직후 TD-200 RF 안테나는 첫 Command List 1(getStatus) 풀사이클로 init 되며
// 그 첫 조회는 대개 1회 타임아웃난다. PORT_ASSIGNED 가 이 준비 창을 흡수해 "연결됨=사용가능"
// 을 보장하도록, getStatus 를 성공할 때까지 bounded 재폴링하는 상한/간격.
const READY_TOTAL_BUDGET_MS = 5000;
const READY_POLL_GAP_MS = 300;
// RS(리셋) 직후 장비는 잠시 commandNotExecutable/dispenseError 를 세운 채로 여진이 남는다.
// 실측상 가라앉는 데 3초 안팎이 필요해, 그 전에 다음 명령을 넣으면 사전 검사에 튕긴다.
// 고정 대기 대신 사전 검사와 **같은 술어**로 폴링하므로, 빨리 개면 빨리 끝난다.
const SETTLE_TOTAL_BUDGET_MS = 8000;

/**
 * 여러 신호 중 하나라도 abort 되면 abort 되는 파생 신호. `dispose()` 로 리스너를 반드시 걷어야 한다 —
 * 디바이스 신호는 비상 중단 때까지 살아있어, 연산마다 붙인 리스너를 안 떼면 장시간 구동에서 계속 쌓인다.
 */
const anySignal = (
  signals: (AbortSignal | undefined)[],
): { signal: AbortSignal; dispose: () => void } => {
  const sources = signals.filter((s): s is AbortSignal => s !== undefined);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const source of sources) {
    if (source.aborted) {
      controller.abort();
      break;
    }
    source.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const source of sources)
        source.removeEventListener('abort', onAbort);
    },
  };
};

export class SerialPortService {
  private readonly logger = Logger.getInstance();
  private readonly managedPort = ManagedSerialPort.shared(
    () => new ManagedSerialPort({ messageParser: new TD200ProtocolParser() }),
  );
  private readonly apCommandTranslator = new SerialPortTranslator(
    statusCommandStrategy,
  );
  private readonly enqTranslator = new SerialPortTranslator(enqRequestStrategy);
  private readonly dispenseToHoldTranslator = new SerialPortTranslator(
    dispenseStrategy,
  );
  private readonly returnTokenTranslator = new SerialPortTranslator(
    returnTokenStrategy,
  );
  private readonly resetTranslator = new SerialPortTranslator(resetStrategy);
  private readonly dispenseTranslator = new SerialPortTranslator(
    dispenseStrategy,
  );
  private readonly eotCancelTranslator = new SerialPortTranslator(
    eotCancelStrategy,
  );
  private readonly collectToHopperTranslator = new SerialPortTranslator(
    collectToHopperStrategy,
  );
  private readonly setCommandFeedingTranslator = new SerialPortTranslator(
    setCommandFeedingStrategy,
  );
  private readonly fsm = new DispenserStateMachine();
  /**
   * 디바이스 전체를 덮는 비상 중단 신호. **모든** 폴링 연산이 이걸 관측하므로, 방출처럼 중간에
   * 못 끊던 매크로 연산도 다음 틱(200ms)에 빠져나온다.
   */
  private deviceAbortController = new AbortController();

  async connect({ portPath, serialOptions }: SerialPortConnectionInfo) {
    this.logger.info('[TokenDispenser] connect()', {
      unmasked: {
        portPath,
        serialOptions: JSON.stringify(serialOptions),
      },
    });
    try {
      await this.managedPort.connect({ portPath, serialOptions });
      this.logger.info(`[TokenDispenser] connect() success`);
    } catch (e) {
      this.logger.error(`[TokenDispenser] connect() failed:`, e);
      throw e;
    }
  }

  /** 포트 소유권 반납 — 백엔드 스캐너가 이 포트를 직접 열어 재탐지할 수 있게 한다(멱등). */
  async disconnect() {
    this.logger.info(`[TokenDispenser] disconnect()`);
    await this.managedPort.disconnect();
  }

  // 2단계 통신 흐름 유틸

  /** 1단계: 커맨드 전송 → ACK 대기 */
  private async sendCommandAndAwaitAck(commandPacket: Buffer): Promise<void> {
    this.logger.info('[TokenDispenser] sendCommandAndAwaitAck()', {
      unmasked: {
        packet: commandPacket.toString('hex'),
      },
    });
    try {
      await this.managedPort.sendAndAwait(
        commandPacket,
        ACK_RESPONSE,
        COMMAND_TIMEOUT_MS,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        '[TokenDispenser] sendCommandAndAwaitAck() failed',
        undefined,
        {
          unmasked: { packet: commandPacket.toString('hex'), error: msg },
        },
      );
      throw e;
    }
    this.logger.info(`[TokenDispenser] sendCommandAndAwaitAck() ACK received`);
  }

  /** 2단계(응답 있음): ENQ 전송 → 응답 대기 (AP/RF, Command List 1) */
  private async sendEnqAndAwaitResponse(
    responseMatcher: (buf: Buffer) => boolean,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<Buffer> {
    const enqPacket = this.enqTranslator.encode(undefined);
    this.logger.info('[TokenDispenser] sendEnqAndAwaitResponse()', {
      unmasked: {
        ENQ: enqPacket.toString('hex'),
        timeout: timeoutMs,
      },
    });
    const response = await this.managedPort.sendAndAwait(
      enqPacket,
      responseMatcher,
      timeoutMs,
    );
    this.logger.info('[TokenDispenser] sendEnqAndAwaitResponse()', {
      unmasked: {
        response: response.toString('hex'),
      },
    });
    return response;
  }

  /**
   * Command List 1 전용 트랜잭션: 커맨드 → ACK → (선택적 턴어라운드) → ENQ → 응답을 한 단위로 묶어
   * N회 재시도한다. timeout/오류 시 파서 버퍼를 리셋해 이전 시도의 지연 응답이 다음 시도에 새지 않게 한다.
   */
  private async transact(
    commandPacket: Buffer,
    responseMatcher: (buf: Buffer) => boolean,
    options?: {
      turnaroundMs?: number;
      responseTimeoutMs?: number;
      maxAttempts?: number;
    },
  ): Promise<Buffer> {
    const turnaround = options?.turnaroundMs ?? 0;
    const respTimeout = options?.responseTimeoutMs ?? COMMAND_TIMEOUT_MS;
    const maxAttempts = options?.maxAttempts ?? DEFAULT_TRANSACT_ATTEMPTS;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        this.logger.info('[TokenDispenser] transact() retry', {
          unmasked: {
            attempt,
            maxAttempts,
            cmd: commandPacket.toString('hex'),
          },
        });
        this.managedPort.resetParser();
      }
      try {
        await this.sendCommandAndAwaitAck(commandPacket);
        if (turnaround > 0) await this.delay(turnaround);
        return await this.sendEnqAndAwaitResponse(responseMatcher, respTimeout);
      } catch (e) {
        // 포트 미설정은 connect() 없인 치유 불가능 — 재시도는 뮤텍스 점유만 늘려
        // PORT_ASSIGNED(=치유 그 자체) 처리를 뒤로 민다. 즉시 단념한다.
        if (e instanceof PortNotConfiguredError) throw e;
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn('[TokenDispenser] transact() attempt failed', {
          unmasked: { attempt, maxAttempts, error: msg },
        });
        if (attempt < maxAttempts) {
          await this.delay(TRANSACT_RETRY_GAP_MS);
        }
      }
    }
    throw lastError;
  }

  /**
   * Command List 2 전용: 커맨드 전송 → ACK 수신 → ENQ 전송.
   * Half-duplex 라 ACK 수신 후 짧은 지연을 두고 ENQ 를 보낸다.
   */
  private async sendCommandThenEnq(commandPacket: Buffer): Promise<void> {
    this.logger.info('[TokenDispenser] sendCommandThenEnq()', {
      unmasked: {
        command: commandPacket.toString('hex'),
      },
    });
    await this.sendCommandAndAwaitAck(commandPacket);

    // Half-duplex turnaround: 장비가 ACK 전송 후 수신 모드로 전환하는 시간 확보
    await this.delay(10);
    const enqPacket = this.enqTranslator.encode(undefined);
    this.logger.info('[TokenDispenser] sendCommandThenEnq() sending', {
      unmasked: {
        ENQ: enqPacket.toString('hex'),
      },
    });
    await this.managedPort.write(enqPacket);
    this.logger.info(`[TokenDispenser] sendCommandThenEnq() complete`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 상태 조회

  async getStatus(): Promise<DispenserStatus> {
    this.logger.info(`[TokenDispenser] getStatus() querying...`);
    const apPacket = this.apCommandTranslator.encode(undefined);
    const response = await this.transact(apPacket, (buf) => {
      if (buf[0] !== CONTROL_CHAR.STX) return false;
      const data = extractData(buf);
      const command = data.subarray(0, 2);
      const status = data.subarray(2, data.length);
      return (
        command.toString('ascii') === COMMAND.STATUS_RESPONSE &&
        status.length === 4
      );
    });

    const data = extractData(response);
    const statusBytes = data.subarray(2);
    const status = parseStatus(statusBytes);
    this.logger.info('[TokenDispenser] getStatus()', {
      unmasked: {
        result: JSON.stringify(status),
      },
    });
    return status;
  }

  /**
   * 디바이스가 응답 가능해질 때까지 getStatus 를 bounded 재폴링한다. connect() 직후 TD-200 RF init 창
   * (첫 조회 타임아웃)을 흡수하는 용도 — 준비되면 첫 성공 status 를, 예산을 넘기면 마지막 에러를 던진다.
   */
  async waitUntilReady(): Promise<DispenserStatus> {
    const deadline = Date.now() + READY_TOTAL_BUDGET_MS;
    // 비상 중단을 관측한다 — 이 루프는 뮤텍스를 쥔 채 최대 5s 를 쓴다. 신호를 놓치면
    // emergencyAbort 의 계약("다음 틱에 채널 회수")이 그만큼 늦어진다.
    const { signal } = this.deviceAbortController;
    let lastError: unknown;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.getStatus();
      } catch (e) {
        // 비재시도 분류의 완결 — transact 가 fail-fast 로 던진 것을 여기서 도로
        // 삼켜 재시도하면 분류가 무효화된다. connect 없인 치유 불가.
        if (e instanceof PortNotConfiguredError) throw e;
        lastError = e;
        if (signal.aborted || Date.now() >= deadline) break;
        this.logger.warn(
          '[TokenDispenser] waitUntilReady() not ready — retrying',
          { unmasked: { attempt } },
        );
        await this.delay(READY_POLL_GAP_MS);
      }
    }
    this.logger.error(
      `[TokenDispenser] waitUntilReady() gave up after ${READY_TOTAL_BUDGET_MS}ms`,
    );
    throw lastError;
  }

  /**
   * 장비가 **새 명령을 받을 수 있는** 상태가 될 때까지 bounded 폴링한다.
   *
   * `waitUntilReady()` 와 조건이 다르다 — 저쪽은 "응답하나?", 이쪽은 "명령을 받나?". RS 직후처럼 응답은
   * 잘 하면서 commandNotExecutable/dispenseError 를 세워둔 창이 있고, 그 창에 명령을 넣으면 튕긴다.
   * 판정은 사전 검사와 **같은 술어**(`isCommandBlocked`)라 "기다렸는데 튕기는" 어긋남이 없다.
   *
   * 예산을 넘기면 마지막 상태를 그대로 돌려준다(throw 하지 않음) — 취소는 최선을 다하는 정리 경로라,
   * 여기서 던지면 호출부는 정리 결과조차 못 받는다.
   */
  private async waitUntilExecutable(): Promise<DispenserStatus> {
    const deadline = Date.now() + SETTLE_TOTAL_BUDGET_MS;
    // waitUntilReady 와 같은 이유로 비상 중단을 관측한다(여긴 최대 8s 를 쥔다).
    const { signal } = this.deviceAbortController;
    let status = await this.getStatus();
    while (
      isCommandBlocked(status) &&
      !signal.aborted &&
      Date.now() < deadline
    ) {
      this.logger.info(
        `[TokenDispenser] waitUntilExecutable() still blocked — retrying`,
      );
      await this.delay(READY_POLL_GAP_MS);
      status = await this.getStatus();
    }
    if (isCommandBlocked(status)) {
      this.logger.error(
        '[TokenDispenser] waitUntilExecutable() gave up',
        undefined,
        {
          unmasked: {
            budgetMs: SETTLE_TOTAL_BUDGET_MS,
            status: JSON.stringify(status),
          },
        },
      );
    }
    return status;
  }

  // Command List 2 실행 + 폴링 공통 흐름

  /**
   * Command List 2 명령을 실행하고 FSM 기반 폴링으로 완료를 대기한다.
   * 사전 상태 체크 → 명령 전송(COMMAND → ACK → ENQ) → 폴링 루프(getStatus → fsm.feed → 전이 판단).
   */
  private async executeAndPoll(
    commandPacket: Buffer,
    transition: TransitionCondition<DispenserStatus>,
    options?: {
      skipPreCheck?: boolean;
      signal?: AbortSignal;
      /** 폴 예산 override. 기본은 모터 동작 기준(MAX_POLL_COUNT 횟수). */
      budget?: PollBudget;
    },
  ): Promise<DispenserStatus> {
    this.logger.info('[TokenDispenser] executeAndPoll()', {
      unmasked: {
        packet: commandPacket.toString('hex'),
        skipPreCheck: !!options?.skipPreCheck,
      },
    });

    // 연산 자체의 신호(취소)와 디바이스 비상 신호(리셋)를 합친다. **함수 진입 즉시** 캡처한다: 사전 검사·
    // 명령 전송이 도는 동안 emergencyAbort 가 컨트롤러를 갈아끼우면 그 뒤에 읽는 신호는 새 컨트롤러
    // (=미중단)라 이 연산이 중단을 통째로 놓친다.
    const abort = anySignal([
      this.deviceAbortController.signal,
      options?.signal,
    ]);

    try {
      // 1. 사전 상태 체크 (reset 등은 건너뜀)
      if (!options?.skipPreCheck) {
        const preStatus = await this.getStatus();
        this.logger.info('[TokenDispenser] executeAndPoll()', {
          unmasked: {
            preStatus: JSON.stringify(preStatus),
          },
        });
        if (isCommandBlocked(preStatus)) {
          this.logger.error(
            `[TokenDispenser] executeAndPoll() device in error state, aborting`,
          );
          throw new Error(
            `Cannot execute command: device is in error state (${JSON.stringify(preStatus)})`,
          );
        }
      }

      // 2. 명령 전송 (COMMAND → ACK → ENQ)
      await this.sendCommandThenEnq(commandPacket);

      // 3. FSM 폴링 — 라이프사이클(복구/시작/마감)은 runStatusPoll이 소유한다.
      const budget = options?.budget ?? { maxPollCount: MAX_POLL_COUNT };
      // 로그에 예산을 **쓴 단위 그대로** 남긴다 — 횟수 예산을 벽시계로 환산해 적으면
      // 실제보다 짧은 값이 로그에 남아, 바깥 타임아웃을 그 값에 맞추는 실수가 반복된다.
      const budgetLabel =
        budget.budgetMs !== undefined
          ? `${budget.budgetMs}ms (wall clock)`
          : `${budget.maxPollCount} polls`;
      return await runStatusPoll<DispenserStatus, DispenserStatus>({
        fsm: this.fsm,
        transition,
        getStatus: () => this.getStatus(),
        intervalMs: POLL_INTERVAL_MS,
        ...budget,
        signal: abort.signal,
        settle: (outcome) => {
          switch (outcome.kind) {
            case 'COMPLETE':
              this.logger.info(`[TokenDispenser] executeAndPoll() COMPLETE`);
              return outcome.status;
            case 'ERROR':
              this.logger.error(
                '[TokenDispenser] executeAndPoll() ERROR',
                undefined,
                {
                  unmasked: {
                    status: JSON.stringify(outcome.status),
                  },
                },
              );
              throw new Error(
                `Operation failed: ${JSON.stringify(outcome.status)}`,
              );
            case 'UNEXPECTED':
              this.logger.error(
                '[TokenDispenser] executeAndPoll() UNEXPECTED',
                undefined,
                {
                  unmasked: {
                    status: JSON.stringify(outcome.status),
                  },
                },
              );
              throw new Error(
                `Unexpected dispenser state: ${JSON.stringify(outcome.status)}`,
              );
            case 'ABORTED':
              this.logger.info(`[TokenDispenser] executeAndPoll() aborted`);
              throw new Error('ABORTED');
            case 'TIMEOUT':
              this.logger.error(
                '[TokenDispenser] executeAndPoll() timed out ()',
                undefined,
                {
                  unmasked: {
                    budget: budgetLabel,
                  },
                },
              );
              throw new Error(`Operation timed out (budget=${budgetLabel})`);
            default:
              return outcome satisfies never;
          }
        },
      });
    } finally {
      abort.dispose();
    }
  }

  // 공개 메서드

  /** 토큰 발급 (앞쪽 홀딩 위치) */
  async dispenseToHold(): Promise<DispenserStatus> {
    this.logger.info(`[TokenDispenser] dispenseToHold() start`);
    const packet = this.dispenseToHoldTranslator.encode(undefined);
    const status = await this.executeAndPoll(packet, dispenseToMidTransition);
    this.logger.info(`[TokenDispenser] dispenseToHold() done`);
    return status;
  }

  /** 토큰을 토큰 입구 밖으로 방출 (RF 영역 → 외부) */
  async dispense(): Promise<DispenserStatus> {
    this.logger.info(`[TokenDispenser] dispense() start`);
    const packet = this.dispenseTranslator.encode(undefined);
    const status = await this.executeAndPoll(packet, dispenseTransition);
    this.logger.info(`[TokenDispenser] dispense() done`);
    return status;
  }

  /**
   * 비상 중단 — 진행 중인 **모든** 폴링 연산을 다음 틱(200ms)에 ABORTED 로 끝낸다. `abortEnterToRead()`
   * 는 FC8 대기 하나만 끊지만 이건 발급·이송·회수까지 전부 덮는다.
   *
   * 뮤텍스를 획득하지 않고 신호만 띄우므로 반드시 뮤텍스 **밖에서** 호출해야 한다(안에서 부르면 점유자를
   * 깨우기도 전에 자기가 그 점유자를 기다린다). 중단 직후 새 컨트롤러를 발급한다.
   */
  emergencyAbort(): void {
    this.logger.warn(`[TokenDispenser] emergencyAbort() aborting all polls`);
    this.deviceAbortController.abort();
    this.deviceAbortController = new AbortController();
  }

  /**
   * 프로토콜 취소 제어문자 EOT(0x04 + ADDH + ADDL) 전송. Command list 2 는 실행 결과를 응답으로 주지
   * 않으므로(문서 Note1) 여기서도 응답을 기다리지 않는다 — 판정은 뒤따르는 AP 상태 조회가 한다.
   * 반드시 뮤텍스를 쥔 상태에서 호출한다(폴링 루프의 AP 왕복과 프레임이 섞이면 파서가 깨진다).
   */
  private async sendCancelControl(): Promise<void> {
    const packet = this.eotCancelTranslator.encode(undefined);
    this.logger.info('[TokenDispenser] sendCancelControl()', {
      unmasked: {
        EOT: packet.toString('hex'),
      },
    });
    await this.managedPort.write(packet);
  }

  /** 토큰 회수 */
  async returnToken(): Promise<DispenserStatus> {
    this.logger.info(`[TokenDispenser] returnToken() start`);
    const packet = this.returnTokenTranslator.encode(undefined);
    const status = await this.executeAndPoll(packet, returnTokenTransition);
    this.logger.info(`[TokenDispenser] returnToken() done`);
    return status;
  }

  /** 토큰을 호퍼(적재함)로 수거 */
  async collectToHopper(): Promise<DispenserStatus> {
    this.logger.info(`[TokenDispenser] collectToHopper() start`);
    const packet = this.collectToHopperTranslator.encode(undefined);
    const status = await this.executeAndPoll(packet, collectToHopperTransition);
    this.logger.info(`[TokenDispenser] collectToHopper() done`);
    return status;
  }

  /** 명령 급지 모드로 설정 (COMMAND → ACK → ENQ) */
  async setCommandFeeding(): Promise<void> {
    this.logger.info(`[TokenDispenser] setCommandFeeding() start`);
    const packet = this.setCommandFeedingTranslator.encode(undefined);
    await this.sendCommandThenEnq(packet);
    this.logger.info(`[TokenDispenser] setCommandFeeding() done`);
  }

  /**
   * 리셋 (에러 상태에서도 실행 가능).
   *
   * **반환 = 장비가 실제로 다음 명령을 받을 수 있음.** 상태 비트가 개는 것과 기구가 리셋을 마치는 것은
   * 다른 사건이라 폴링 완료만으로는 그 계약을 못 세운다 — 뒤에 최소 체류를 붙여 여기서 지킨다.
   * 체류를 호출부로 빼면 누가 기다릴 차례인지를 caller 마다 다시 판단하게 된다.
   */
  async reset(): Promise<DispenserStatus> {
    this.logger.info(`[TokenDispenser] reset() start`);
    const packet = this.resetTranslator.encode(undefined);
    const status = await this.executeAndPoll(packet, resetTransition, {
      skipPreCheck: true,
      budget: { budgetMs: RESET_BUDGET_MS },
    });
    // 상태 비트로는 안 보이는 창이라 시간으로 막는다(POST_RESET_DWELL_MS 주석 참고).
    await this.delay(POST_RESET_DWELL_MS);
    this.logger.info(`[TokenDispenser] reset() done`);
    return status;
  }

  // Command List 1: RF 토큰 조작
}
