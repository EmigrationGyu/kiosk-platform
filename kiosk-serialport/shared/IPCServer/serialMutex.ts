import { Logger } from '@/shared/Logger';
import { Mutex, MutexPurgedError } from '@/shared/Mutex';

/**
 * 단일 시리얼 채널을 직렬화하는 `withMutex` 헬퍼를 만든다.
 *
 * 하드웨어 1대당 물리 채널은 하나뿐이라 명령이 겹치면 응답이 섞인다. 그래서 카드키/영수증/카반 등은
 * 모든 핸들러를 뮤텍스로 직렬화하는데, 그 보일러플레이트를 이 팩토리가 흡수한다. 컨트롤러는 이를
 * 필드로 합성해 쓴다(상속 아님 — `withErrorHandler` 와 같은 HOF 합성 패턴).
 *
 * @param tag 경합 경고 로그용 컨트롤러 식별자 (예: 'ReceiptPrinter:Controller')
 * @returns `withMutex(label, fn)` — label 엔 해당 핸들러의 `ENDPOINTS.*` 를 그대로 전달
 */
export const createSerialMutex = (tag: string) => {
  const mutex = new Mutex();
  const logger = Logger.getInstance();

  const withMutex = <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    if (mutex.isLocked) {
      logger.warn('[Mutex] blocked — concurrent call detected', {
        unmasked: { tag, label },
      });
    }
    return mutex.runExclusive(fn);
  };

  /**
   * 대기 중인 요청을 전부 거절한다 (비상 복구 전용).
   *
   * 큐는 FIFO 라, 리셋이 진행 중 연산을 끊어도 그보다 먼저 줄 서 있던 요청들이
   * 리셋보다 앞서 실행된다 — 방금 중단된 장비에 대고. 그래서 리셋은 뮤텍스를 잡기
   * **전에** 이걸 불러 스테일 대기를 걷어내야 한다.
   */
  withMutex.purge = (reason: string): void => {
    if (mutex.pendingCount === 0) return;
    logger.warn('[Mutex] purging pending operations', {
      unmasked: { tag, pending: mutex.pendingCount, reason },
    });
    mutex.purge(new MutexPurgedError(reason));
  };

  return withMutex;
};
