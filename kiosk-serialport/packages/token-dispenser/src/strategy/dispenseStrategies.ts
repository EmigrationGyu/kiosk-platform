import type { TranslationStrategy } from '@/shared/SerialPort/types';
import { COMMAND } from '../constants/protocol';
import {
  buildCommandPacket,
  buildEnqPacket,
  buildEotPacket,
} from '../utils/buildCommandPacket';

/**
 * 명령 1개 = 전략 1개. 인코딩만 갈리고 디코딩은 공통(원시 버퍼)이라, 서비스는
 * `SerialPortTranslator` 에 전략을 꽂아 쓰고 바이트 조립을 직접 알지 않는다.
 */

/** 상태 조회(4니블) */
export const statusCommandStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.CHECK_STATUS_FULL)),
  decode: (buf) => buf,
};

/** ENQ — ACK 수신 후 응답/실행 요청 */
export const enqRequestStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildEnqPacket(),
  decode: (buf) => buf,
};

/** EOT 취소 — 프로토콜의 유일한 취소 수단(전용 취소 명령이 없다) */
export const eotCancelStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildEotPacket(),
  decode: (buf) => buf,
};

/** T1: 게이트까지 방출(손이 닿는 위치) */
export const dispenseStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.DISPENSE)),
  decode: (buf) => buf,
};

/** P4: 게이트 직전 대기 위치까지만 방출 */
export const dispenseToHoldStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.DISPENSE_TO_HOLD)),
  decode: (buf) => buf,
};

/** P6: 중간 센서 위치까지만 방출 */
export const dispenseToMidStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.DISPENSE_TO_MID)),
  decode: (buf) => buf,
};

/** T2: 게이트의 토큰을 반환함으로 */
export const returnTokenStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.RETURN_TOKEN)),
  decode: (buf) => buf,
};

/** T3: 게이트의 토큰을 호퍼로 되돌림(재사용) */
export const collectToHopperStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.COLLECT_TO_HOPPER)),
  decode: (buf) => buf,
};

/** Z0: 리셋 */
export const resetStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.RESET)),
  decode: (buf) => buf,
};

/** F1: 명령 급지 모드 — 방출 명령이 있을 때만 호퍼가 돈다 */
export const setCommandFeedingStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => buildCommandPacket(Buffer.from(COMMAND.SET_COMMAND_FEEDING)),
  decode: (buf) => buf,
};
