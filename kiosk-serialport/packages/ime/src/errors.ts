import type { ImeCause } from 'kiosk-types';

/**
 * 알려진 IME 실패를 나르는 에러. 컨트롤러가 잡아 res.error(IME_ERROR_CODE[cause], cause) 로 번역한다.
 * (cash-dispenser 의 DispenseError 와 동일한 typed-error → Result 번역 패턴)
 */
export class ImeError extends Error {
  constructor(readonly imeCause: ImeCause) {
    super(`ImeError: ${imeCause}`);
    this.name = 'ImeError';
  }
}
