import {
  CONTRACT_TOTAL,
  processContractHash,
  type SerialportProcess,
  shortHash,
} from 'kiosk-types';
import { Logger } from '@/shared/Logger';

/**
 * 부팅 시 이 서브프로세스의 계약 지문을 남긴다.
 *
 * 백엔드도 같은 값을 자기 로그에 찍으므로, 두 로그의 같은 항목이 다르면 서로 다른
 * types 로 빌드된 것이다 — 원격 부분 업데이트가 함께 배포됐어야 할 컴포넌트를
 * 갈라놓았다는 신호.
 */
/** 적재 경로 — 세대 교체가 실제로 먹혔는지에 답한다. */
const entryPath = globalThis.process.argv[2] ?? '(직접 실행)';

/** 이 프로세스의 정체 — entry 가 부팅 시 신고한다(아래 logContractFingerprint). */
let declared: SerialportProcess | null = null;

export function logContractFingerprint(process: SerialportProcess): void {
  declared = process;
  Logger.getInstance().info('[적재]', {
    unmasked: { process, entryPath },
  });
  Logger.getInstance().info('[계약]', {
    unmasked: {
      total: shortHash(CONTRACT_TOTAL),
      process,
      hash: shortHash(processContractHash(process)),
    },
  });
}

/**
 * 응답 봉투에 실을 **자기 표면 지문** — 백엔드가 이 장치와 말이 통하는지의 근거.
 *
 * total 이 아니라 자기 표면인 이유: 무관한 계약 변경(다른 장치·프론트 스키마)이 이 장치를 되감게 만들면
 * 안 된다. 정체는 entry 의 신고에서 오고, 신고 없이 쓰면 즉시 실패시킨다 — 조용히 표면을 빼먹으면
 * 이 장치는 영영 승격 근거가 못 된다.
 */
export function ownSurface(): string {
  if (declared === null) {
    throw new Error(
      'logContractFingerprint 이 먼저 불려야 합니다 — 정체를 모른 채 표면을 신고할 수 없습니다',
    );
  }
  return processContractHash(declared);
}
