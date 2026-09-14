import {
  SERIALPORT_PROCESS,
  type SerialportProcess,
  surfaceContractOf,
} from 'kiosk-types';
import { createContractWitness } from './contractWitness';

const KNOWN_PROCESSES = new Set<string>(Object.values(SERIALPORT_PROCESS));

/**
 * 프로세스 전역 관측자 — 장치 응답과 렌더러 부팅 완주가 각각 여기에 표면 지문을 남긴다.
 *
 * 기대값은 상대별이다: 'frontend' 는 프론트↔백엔드 합성 표면, 장치는 자기 프로세스
 * 표면. 규칙은 types 의 `surfaceContractOf` 단일 출처 — 콘솔의 조합 제안이 같은 규칙을
 * 보므로, 콘솔이 배포 가능하다 한 조합을 여기서 되감는 일이 없다.
 *
 * 싱글턴인 이유: 관측 지점(하드웨어 트랜스포트)과 판정 지점(UpdateService)이 멀고, 둘을
 * 잇자고 인자를 그 사이 모든 계층에 흘려보낼 이유가 없다.
 */
export const contractWitness = createContractWitness((component) => {
  if (component === 'frontend') return surfaceContractOf('frontend');
  if (KNOWN_PROCESSES.has(component)) {
    return surfaceContractOf(component as SerialportProcess);
  }
  return undefined;
});
