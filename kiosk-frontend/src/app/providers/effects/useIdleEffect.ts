import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { distinctUntilChanged, Observable } from 'rxjs';
import {
  type AbandonReason,
  ANALYTICS_EVENTS,
  resetSession,
  track,
} from '@/shared/analytics';
import {
  IDLE_EXEMPT_ROUTES,
  IDLE_WARNING_GRACE_MS,
} from '@/shared/constants/idle';
import { ROUTES } from '@/shared/constants/routes';
import { dismissGlobalUI } from '@/shared/lib/dismissGlobalUI';
import { useIdleStore } from '@/shared/store/idleStore';
import { createDomActivity$ } from './domActivity';
import { makeIdleCommandRunner } from './idleCommands';
import { idleResume$ } from './idleResume';
import { createIdleStream } from './idleStream';

/**
 * zustand 스토어의 한 조각을 Observable 로 — 구독 시 현재값을 즉시 흘린다.
 * (`createIdleStream` 의 `active$` 는 cold 게이트라 첫 값이 없으면 아무것도 시작되지 않는다.)
 */
const fromStore = <T>(
  subscribe: (onChange: () => void) => () => void,
  read: () => T,
): Observable<T> =>
  new Observable<T>((subscriber) => {
    subscriber.next(read());
    return subscribe(() => subscriber.next(read()));
  }).pipe(distinctUntilChanged());

/**
 * 전역 idle 의 **부수효과 shell**. 시간축은 `createIdleStream`(순수)이, 커맨드→효과 변환은
 * `makeIdleCommandRunner`(효과 주입)가 맡고, 여기서는 그 둘에 실제 입출력을 연결만 한다.
 *
 * 구독 지점이 없으면 파이프라인 전체가 죽은 코드가 된다 — "계속 사용" 버튼이 밀어넣는
 * `idleResume$` 를 아무도 듣지 않아 경고가 영영 안 닫힌다(실측).
 *
 * 면제 라우트에서는 아예 구독하지 않는다(`IDLE_EXEMPT_ROUTES` — 세션이 없는 진입 화면).
 * 라우트가 바뀌면 재구독되어 무동작 예산이 새로 시작되는데, 화면을 옮기는 조작 자체가
 * 활동이라 어차피 리셋될 시점이므로 관측상 차이가 없다.
 */
export const useIdleEffect = (): void => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const timeoutMs = useIdleStore((s) => s.timeoutMs);

  useEffect(() => {
    if (IDLE_EXEMPT_ROUTES.includes(pathname)) return;

    const enabled$ = fromStore(
      (onChange) => useIdleStore.subscribe(onChange),
      () => !useIdleStore.getState().isIdleDisabled,
    );

    const run = makeIdleCommandRunner({
      beginWarning: (deadline) =>
        useIdleStore.getState().beginWarning(deadline),
      dismissWarning: () => useIdleStore.getState().dismissWarning(),
      dismissGlobalUI,
      goHome: (reason: AbandonReason) => {
        track(ANALYTICS_EVENTS.SESSION_ABANDONED, {
          stepAtAbandon: pathname,
          reason,
        });
        // 매뉴얼로 줄여둔 timeoutMs·disable 키는 세션 경계를 넘지 않는다.
        useIdleStore.getState().resetIdle();
        resetSession();
        navigate(ROUTES.HOME);
      },
      // 경고 deadline 은 표시용 카운트다운과 **같은 시계**여야 한다 —
      // IdleWarningOverlay 가 performance.now() 로 남은 초를 센다.
      now: () => performance.now(),
      graceMs: IDLE_WARNING_GRACE_MS,
    });

    const sub = createIdleStream(enabled$, createDomActivity$(), idleResume$, {
      timeoutMs,
      graceMs: IDLE_WARNING_GRACE_MS,
    }).subscribe(run);

    return () => {
      sub.unsubscribe();
      // 구독이 끊긴 뒤에도 경고가 떠 있으면 해제할 주체가 없다.
      useIdleStore.getState().dismissWarning();
    };
  }, [pathname, timeoutMs, navigate]);
};
