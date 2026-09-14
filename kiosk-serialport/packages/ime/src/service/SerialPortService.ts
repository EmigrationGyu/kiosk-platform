import type {
  ImeProcessKeyRequest,
  ImeSelectCandidateRequest,
  ImeState,
  TolgeeLanguage,
} from 'kiosk-types';
import { toImeState } from '../codec/imeState';
import type { ImeEngine } from '../engine/ImeEngine';
import { MozcEngine } from '../engine/mozc/MozcEngine';
import { RimeEngine } from '../engine/rime/RimeEngine';
import { ImeError } from '../errors';

const EMPTY_STATE = toImeState(
  { preedit: null, candidates: [], highlightedIndex: -1 },
  null,
);

/**
 * IME 서브프로세스 서비스. 언어별로 적절한 ImeEngine 을 골라 위임한다(전략 패턴).
 * rime(중국어 CN/TW) + mozc(일본어 JA) — engineFor 가 supports() 로 자동 라우팅한다.
 * 조합 상태는 활성 엔진(마지막 processKey 를 처리한 엔진)에 있으므로 select/clear 는 그쪽으로 보낸다.
 * 세션 직렬화는 컨트롤러의 createSerialMutex 가 담당한다.
 */
export class SerialPortService {
  private readonly engines: ImeEngine[] = [
    RimeEngine.shared(() => new RimeEngine()),
    MozcEngine.shared(() => new MozcEngine()),
  ];
  private active: ImeEngine | null = null;

  private engineFor(language: TolgeeLanguage): ImeEngine | null {
    return this.engines.find((e) => e.supports(language)) ?? null;
  }

  // 준비/헬스는 "하나라도 봉사 가능"(some) — 엔진별 자산은 배포마다 다르다(rime 데이터만
  // 있는 키오스크, mozc 미프로비저닝 등). every 로 묶으면 한 엔진 부재가 다른 언어 IME 까지
  // 죽인다. 엔진별 실패는 해당 언어 요청 시 ENGINE_NOT_READY cause 로 따로 표면화된다.

  /** 서브프로세스 부팅 시 모든 엔진 준비 트리거(멱등). */
  ensureReady(): boolean {
    return this.engines.map((e) => e.ensureReady()).some(Boolean);
  }

  /** 서브프로세스가 봉사 가능한지(엔진 하나라도 살아있으면 true). */
  healthCheck(): boolean {
    return this.engines.map((e) => e.health()).some(Boolean);
  }

  async processKey(req: ImeProcessKeyRequest): Promise<ImeState> {
    const engine = this.engineFor(req.language);
    if (!engine) throw new ImeError('SCHEMA_UNAVAILABLE');
    if (!engine.ensureReady()) throw new ImeError('ENGINE_NOT_READY');
    const { ctx, commit } = engine.processKey(req.language, req.key);
    // 성공한 엔진만 active 로 기록(실패 시 이전 active 유지 = "마지막 성공 엔진" 불변식).
    this.active = engine;
    return toImeState(ctx, commit);
  }

  async selectCandidate(req: ImeSelectCandidateRequest): Promise<ImeState> {
    // active 없으면 선택할 조합이 없다는 뜻(정상 no-op).
    // dev HMR edge: SerialPortService 재생성으로 active 가 null 이 됐는데 엔진 세션은 살아있으면,
    // 직후 select 는 빈 상태로 떨어지고 다음 processKey/clear 로 자가복구된다(prod 무관, 재입력).
    if (!this.active) return EMPTY_STATE;
    const { ctx, commit } = this.active.selectCandidate(req.index);
    return toImeState(ctx, commit);
  }

  async clear(): Promise<ImeState> {
    this.active?.clear();
    return EMPTY_STATE;
  }
}
