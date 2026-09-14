import type {
  ImeProcessKeyRequest,
  ImeSelectCandidateRequest,
  ImeState,
} from '../constant/events/Ime';
import { IME_EVENTS } from '../hardwareTransport/events/Ime';
import { Ime } from '../hardwareTransport/Ime';

/**
 * 프론트 소켓 요청 → IME 서브프로세스(하드웨어 트랜스포트) 위임 글루.
 * 백엔드는 무상태 — 조합/후보 상태는 전부 rime 서브프로세스가 보유하고, 여기 `ime` 는
 * 상태가 아니라 트랜스포트 핸들(싱글턴)일 뿐이다.
 *
 * @EnsureDevice 미적용(의도): @EnsureDevice 는 serialPortScanner 가 탐지한 "시리얼 포트
 * 디바이스" 연결 게이트다. IME 는 COM 포트가 없는 rime.dll 서브프로세스라 스캔 대상이 아니다.
 * 엔진 미준비(미spawn/deploy 실패)는 ENGINE_NOT_READY cause 로 표면화되며, 이는 IME_ERROR_CODE
 * 에 매핑돼 있어 컨트롤러의 withHardwareErrorHandler 가 500 이 아닌 Result 실패로 흘려보낸다.
 */
export class ImeService {
  private ime: Ime = Ime.getInstance();

  async processKey(req: ImeProcessKeyRequest): Promise<ImeState> {
    return this.ime.request(IME_EVENTS.PROCESS_KEY, req);
  }

  async selectCandidate(req: ImeSelectCandidateRequest): Promise<ImeState> {
    return this.ime.request(IME_EVENTS.SELECT_CANDIDATE, req);
  }

  async clear(): Promise<ImeState> {
    return this.ime.request(IME_EVENTS.CLEAR);
  }
}
