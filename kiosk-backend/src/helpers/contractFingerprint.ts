import {
  CONTRACT_TOTAL,
  NAMESPACES,
  namespaceContractHash,
  processContractHash,
  SERIALPORT_PROCESS,
  shortHash,
} from 'kiosk-types';
import { LogService } from 'src/service/LogService';

/**
 * 부팅 시 이 번들의 계약 지문을 남긴다.
 *
 * 백엔드는 프론트·서브프로세스 양쪽과 말하는 허브라 두 축을 모두 찍는다. 서브프로세스는
 * 자기 축 하나만 찍으므로, 두 로그 파일의 같은 항목이 다르면 서로 다른 types 로 빌드된
 * 것이다 — 원격 부분 업데이트가 함께 배포됐어야 할 컴포넌트를 갈라놓았다는 신호.
 */
/**
 * 이 프로세스가 어느 파일에서 적재됐는지 — 세대 이름이 경로에 들어있다.
 * 재기동됐다는 사실만으로는 "새 세대로 갈렸는지"를 알 수 없다(포인터 교체가 조용히
 * 실패해도 부팅 로그는 똑같이 새로 찍힌다).
 */
const entryPath = globalThis.process.argv[2] ?? '(직접 실행)';

export function logContractFingerprint(): void {
  const logger = LogService.getInstance();
  logger.info('[적재] backend', { unmasked: { entryPath } });
  const namespaces = Object.values(NAMESPACES)
    .map((ns) => `${ns}=${shortHash(namespaceContractHash(ns))}`)
    .join(' ');
  const processes = Object.values(SERIALPORT_PROCESS)
    .map((proc) => `${proc}=${shortHash(processContractHash(proc))}`)
    .join(' ');

  logger.info('[계약] total', {
    unmasked: { total: shortHash(CONTRACT_TOTAL) },
  });
  logger.info('[계약] 프론트엔드↔백엔드', { unmasked: { namespaces } });
  logger.info('[계약] 백엔드↔서브프로세스', { unmasked: { processes } });
}
