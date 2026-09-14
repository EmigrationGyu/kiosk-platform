/**
 * 하드웨어 없는 시리얼 — 스캐너가 쓰는 **열거까지** 포함한다.
 *
 * 서브프로세스 쪽 루프백(`serialport/shared/SerialPort/impl/loopback.ts`)과 짝이다.
 * 그쪽만 갈아끼우면 장치 I/O 는 흉내내지만 **탐지가 실패한다** — 스캐너는 실제 COM
 * 목록을 뒤지고 아무것도 못 찾아 `PORT_ASSIGNED` 를 영영 보내지 않는다(실측: 전 스택이
 * 도는데 "포트가 설정되지 않았다"로 끝났다). 시리얼은 I/O 와 열거가 한 능력이다.
 */
export { SerialPort } from '../../../../kiosk-serialport/shared/SerialPort/impl/loopback';
