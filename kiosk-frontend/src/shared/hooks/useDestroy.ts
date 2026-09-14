import { useEffect } from 'react';
import { type Observable, Subject } from 'rxjs';
import { useConst } from './useConst';

/**
 * 컴포넌트 라이프타임에 묶이는 destroy 스트림. unmount 시 next() + complete() 자동 발화.
 * `.pipe(takeUntil(destroy$))` 에 그대로 꽂아 쓰기 위함.
 *
 * 반환 타입을 Observable 로 좁혀 호출부에서 next/complete 를 잘못 부르는 것을 막는다.
 * 런타임 인스턴스는 Subject 그대로라 identity 는 라이프타임 내내 안정적.
 */
export function useDestroy$(): Observable<void> {
  const subject = useConst(() => new Subject<void>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: 마운트/언마운트 1회만
  useEffect(() => {
    return () => {
      subject.next();
      subject.complete();
    };
  }, []);
  return subject;
}
