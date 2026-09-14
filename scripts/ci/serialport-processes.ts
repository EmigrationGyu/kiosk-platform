/**
 * serialport 서브프로세스 식별자를 한 줄에 하나씩 출력한다 — CI 용.
 *
 * 목록을 워크플로 YAML 에 적어두면 `bun gen bs` 로 만든 새 디바이스가 **조용히 빌드되지도
 * 업로드되지도 않는다**. 그래서 CI 도 계약의 단일 출처를 읽는다.
 *
 * types 를 읽는 이유(패키지 디렉토리 스캔이 아니라): 계약에 등록되지 않은 패키지는 상대와
 * 말이 통하지 않아 배포할 의미가 없고, 무엇보다 **electron 잡에는 serialport 레포가 없다**
 * — 거기서도 types 는 항상 체크아웃되어 있으므로 두 잡이 같은 방식으로 목록을 얻는다.
 */
import { SERIALPORT_PROCESS } from '../../kiosk-types/src/serialport/processes';

for (const process of Object.values(SERIALPORT_PROCESS)) {
  console.log(process);
}
