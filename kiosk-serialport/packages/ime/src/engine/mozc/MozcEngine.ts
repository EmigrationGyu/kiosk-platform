import fs from 'node:fs';
import { LANGUAGES, type TolgeeLanguage } from 'kiosk-types';
import { Logger } from '@/shared/Logger';
import {
  EMPTY_ENGINE_RESULT,
  type EngineResult,
  type ImeEngine,
} from '../ImeEngine';
import { charToMozcKey } from './keymap';
import {
  callMozcServer,
  readIpcFile,
  resolveMozcBrokerPath,
  resolveMozcIpcFile,
  sleepSync,
  spawnMozcBroker,
} from './pipeClient';
import { type MozcProjection, projectOutput } from './projection';
import {
  decodeOutput,
  encodeInput,
  type MozcOutput,
  type MozcRequest,
  type MozcRequestConfig,
} from './proto/commands';
import { decodeIpcPathInfo, sessionPipePathOf } from './proto/ipcPathInfo';

// HMR 을 넘어 살아남아야 하는 프로세스 스코프 싱글턴 슬롯(RimeEngine 과 동일 idiom).
// 파이프 경로 + 서버측 세션 id 를 소유하므로 재평가마다 세션을 다시 만들면 안 된다.
const SHARED_KEY = '__MOZC_ENGINE__';

// 키오스크(터치) = 모바일 프로파일: 변환/음역 후보까지 타이핑 중 후보창에 실려 탭 확정이
// 주 경로가 된다(데스크톱 문절 변환 UX 는 화살표 키 전제라 터치에 부적합).
// zero_query 는 CN(rime)과 동작 일관을 위해 의도적으로 끔. 페이지 9 = CandidateBar 스트립 기준.
const MOBILE_REQUEST: MozcRequestConfig = {
  mixedConversion: true,
  candidatePageSize: 9,
};

// broker prelaunch 후 서버가 session.ipc 를 쓰기까지의 짧은 지연을 흡수하는 폴링 예산.
// 실측 기동 ~1s 내 — 첫 일본어 입력 1회에만 밟히는 경로라 동기 대기를 수용한다
// (컨트롤러 createSerialMutex 가 직렬화하므로 다른 IME 요청과 경합하지 않는다).
const BROKER_PROBE_RETRIES = 10;
const BROKER_PROBE_INTERVAL_MS = 300;

/**
 * mozc 기반 ImeEngine 구현(impure shell). 파이프 왕복·세션 상태를 여기 격리한다.
 * mozc 고유 규약(TURN_ON_IME 시퀀스, 후보 id 선택, session.ipc 발견)도 이 impl 내부에만 존재.
 *
 * - 서버 발견: session.ipc → ping. 미기동이면 캐리셋 broker(prelaunch)로 기동 폴백 —
 *   dev(MSI prelauncher 상주)에선 안 밟히고, 키오스크(ensure 로 펼친 캐리셋)의 주 경로.
 *   자산도 broker 도 없으면 ensureReady=false → ENGINE_NOT_READY 로 표면화(자산 도착 시
 *   다음 요청에서 자가 치유 — 실패를 캐시하지 않는다).
 * - 수용된 결정: mozc_server 는 ime 서브프로세스가 reap 되어도 상주(고정비용 수용),
 *   서버의 프로필 쓰기(LocalLow\Mozc)는 ~/.kiosk 격리 밖 leak 으로 인정.
 * - 선택은 표시 index 가 아니라 후보 id — 직전 응답의 index→id 매핑(candidateIds)을
 *   다음 selectCandidate 까지 보유한다.
 */
export class MozcEngine implements ImeEngine {
  private readonly logger = Logger.getInstance();
  private pipePath: string | null = null;
  private sessionId: bigint | null = null;
  private candidateIds: readonly number[] = [];

  static shared(factory: () => MozcEngine): MozcEngine {
    const registry = globalThis as unknown as Record<
      string,
      MozcEngine | undefined
    >;
    return (registry[SHARED_KEY] ??= factory());
  }

  supports(language: TolgeeLanguage): boolean {
    return language === LANGUAGES.JA;
  }

  ensureReady(): boolean {
    if (this.pipePath !== null) return true;

    const direct = this.probePipe();
    if (direct !== null) {
      this.pipePath = direct;
      return true;
    }

    // 서버 미기동(session.ipc 부재/stale) — 캐리셋 broker 로 프리런치 폴백.
    const brokerPath = resolveMozcBrokerPath();
    if (!fs.existsSync(brokerPath)) {
      this.logger.error(
        '[Mozc] 서버 미기동 + broker 없음(자산 미설치?)',
        undefined,
        { unmasked: { brokerPath } },
      );
      return false;
    }
    try {
      this.logger.info('[Mozc] broker prelaunch 폴백', {
        unmasked: { brokerPath },
      });
      spawnMozcBroker(brokerPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error('[Mozc] broker 실행 실패', undefined, {
        unmasked: { error: msg },
      });
      return false;
    }
    for (let i = 0; i < BROKER_PROBE_RETRIES; i++) {
      const pipePath = this.probePipe();
      if (pipePath !== null) {
        this.pipePath = pipePath;
        return true;
      }
      sleepSync(BROKER_PROBE_INTERVAL_MS);
    }
    this.logger.error('[Mozc] broker prelaunch 후에도 파이프 미발견');
    return false;
  }

  /** session.ipc → 파이프 조립 → 생존 ping. 서버가 안 떠 있으면(파일 부재/stale) null. */
  private probePipe(): string | null {
    try {
      const info = decodeIpcPathInfo(readIpcFile(resolveMozcIpcFile()));
      if (info.key === '') return null;
      const pipePath = sessionPipePathOf(info.key);
      decodeOutput(
        callMozcServer(pipePath, encodeInput({ type: 'NO_OPERATION' })),
      );
      this.logger.info('[Mozc] ready', {
        unmasked: {
          pipe: pipePath,
          serverVersion: info.productVersion,
          pid: info.processId,
        },
      });
      return pipePath;
    } catch {
      return null;
    }
  }

  health(): boolean {
    if (!this.ensureReady()) return false;
    try {
      this.roundTrip({ type: 'NO_OPERATION' });
      return true;
    } catch (e) {
      this.resetPipe(e);
      return false;
    }
  }

  processKey(_language: TolgeeLanguage, key: string): EngineResult {
    // language 는 supports() 로 이미 가드됨 — mozc 는 언어 분기가 없다(ja 단일).
    try {
      const sessionId = this.ensureSession();
      if (sessionId === null) return EMPTY_ENGINE_RESULT;
      const output = this.roundTrip({
        type: 'SEND_KEY',
        sessionId,
        key: charToMozcKey(key),
      });
      if (output.errorCode !== 0) {
        // 세션층 실패(서버 재시작으로 stale 등) — 세션만 버리면 다음 키에서 재생성된다.
        this.logger.error('[Mozc] SEND_KEY 세션 실패', undefined, {
          unmasked: {
            code: output.errorCode,
          },
        });
        this.resetSession();
        return EMPTY_ENGINE_RESULT;
      }
      return this.capture(projectOutput(output));
    } catch (e) {
      this.resetPipe(e);
      return EMPTY_ENGINE_RESULT;
    }
  }

  selectCandidate(index: number): EngineResult {
    const sessionId = this.sessionId;
    if (sessionId === null) return EMPTY_ENGINE_RESULT;
    // 직전 응답의 표시 순번 → 후보 id. 범위 밖/미제공 id 는 안전하게 no-op.
    const candidateId = this.candidateIds[index] ?? null;
    if (candidateId === null) return EMPTY_ENGINE_RESULT;
    try {
      const output = this.roundTrip({
        type: 'SEND_COMMAND',
        sessionId,
        // 실측: suggestion 단계 SUBMIT_CANDIDATE = 즉시 확정(commit-on-tap UX 와 일치).
        command: { type: 'SUBMIT_CANDIDATE', candidateId },
      });
      if (output.errorCode !== 0) {
        this.logger.error('[Mozc] SUBMIT_CANDIDATE 세션 실패', undefined, {
          unmasked: {
            code: output.errorCode,
          },
        });
        this.resetSession();
        return EMPTY_ENGINE_RESULT;
      }
      return this.capture(projectOutput(output));
    } catch (e) {
      this.resetPipe(e);
      return EMPTY_ENGINE_RESULT;
    }
  }

  clear(): void {
    const sessionId = this.sessionId;
    if (sessionId === null) return;
    try {
      this.roundTrip({
        type: 'SEND_COMMAND',
        sessionId,
        command: { type: 'REVERT' },
      });
      this.candidateIds = [];
    } catch (e) {
      this.resetPipe(e);
    }
  }

  // 내부

  private roundTrip(request: MozcRequest): MozcOutput {
    if (this.pipePath === null) {
      throw new Error('[Mozc] engine not ready — ensureReady() 먼저');
    }
    return decodeOutput(callMozcServer(this.pipePath, encodeInput(request)));
  }

  /**
   * 세션 보장. 실측 시퀀스: CREATE_SESSION → SET_REQUEST(모바일 프로파일) → TURN_ON_IME
   * (세션은 IME off 로 시작). SET_REQUEST 는 서버 전역 스티키(실측)지만 서버 재시작 후
   * 상태에 의존하지 않도록 세션마다 명시적으로 쏜다.
   */
  private ensureSession(): bigint | null {
    if (this.sessionId !== null) return this.sessionId;
    const created = this.roundTrip({ type: 'CREATE_SESSION' });
    if (created.id === null || created.id === 0n) {
      this.logger.error('[Mozc] CREATE_SESSION 실패 — id 미수신');
      return null;
    }
    this.roundTrip({
      type: 'SET_REQUEST',
      sessionId: created.id,
      request: MOBILE_REQUEST,
    });
    this.roundTrip({
      type: 'SEND_COMMAND',
      sessionId: created.id,
      command: { type: 'TURN_ON_IME' },
    });
    this.sessionId = created.id;
    return created.id;
  }

  private capture(projection: MozcProjection): EngineResult {
    this.candidateIds = projection.candidateIds;
    return { ctx: projection.ctx, commit: projection.commit };
  }

  private resetSession(): void {
    this.sessionId = null;
    this.candidateIds = [];
  }

  /** 파이프 계층 실패 — 전체 리셋. 다음 요청의 ensureReady 가 재발견한다(자가 복구). */
  private resetPipe(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.logger.error('[Mozc] 파이프 실패 — 리셋 후 재발견 대기', undefined, {
      unmasked: { error: msg },
    });
    this.pipePath = null;
    this.resetSession();
  }
}
