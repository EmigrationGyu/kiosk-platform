/**
 * 실물 포트 구현 — `@serial/Port` 의 기본값.
 *
 * `ManagedSerialPort` 가 이 심볼만 보고 동작하므로, 루프백으로 갈아끼워도 상위 계층은
 * 자기가 무엇과 말하는지 모른다. 그게 이 alias 의 목적이다.
 */
export { SerialPort } from 'serialport';
