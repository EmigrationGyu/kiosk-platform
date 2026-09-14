import {
  combineLatest,
  concat,
  EMPTY,
  type Observable,
  of,
  race,
  timer,
} from 'rxjs';
import {
  distinctUntilChanged,
  exhaustMap,
  map,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

/**
 * 게이트 합성 — 모든 조건이 참일 때만 열린다.
 *
 * 잠금(in-flight·idle 억제)은 **발화 시점에 건너뛰지 않고 게이트로 닫는다.** 정리 스트림은
 * 활동 리셋당 1회 방출이라 건너뛰면 잠금이 풀린 뒤 다시 발화하지 않는다 — 게이트가
 * 닫혔다 열리면 `gatedActivityIdle` 이 타이머를 처음부터 다시 세므로, 잠금이 풀리는
 * 순간부터 온전한 무동작 예산이 새로 주어진다.
 */
export const allGatesOpen = (
  ...gates: readonly Observable<boolean>[]
): Observable<boolean> =>
  combineLatest(gates).pipe(
    map((states) => states.every(Boolean)),
    distinctUntilChanged(),
  );

/**
 * **공유 골격** — `gate$` 가 열려있는(true) 동안 `activity$` 가 올 때마다 `inner` 를 취소·재시작하고,
 * 닫히면(false) `whenClosed` 로 전환한다. 바깥 switchMap = 게이트, 안쪽 switchMap = 활동 리셋.
 *
 * 정리(`createIdleCleanupStream`)가 이 골격을 쓴다. (경고 스트림은 "경고 중 활동 무시" 요구가 있어
 * exhaustMap 구조로 갈라졌다 — 아래 참고.)
 */
const gatedActivityIdle = <T>(
  gate$: Observable<boolean>,
  activity$: Observable<unknown>,
  inner: () => Observable<T>,
  whenClosed: Observable<T>,
): Observable<T> =>
  gate$.pipe(
    switchMap((open) =>
      open ? activity$.pipe(startWith(null), switchMap(inner)) : whenClosed,
    ),
  );

/**
 * 전역 idle 경고 파이프라인. 시간축 순수 코어 — DOM·store·goHome 없음.
 *
 * - `warn`     : 무동작이 `timeoutMs` 지속 → 경고 노출
 * - `fire`     : 경고 후 `graceMs` 까지 무동작 → 자동 리셋(goHome)
 * - `counting` : 경고 해제(버튼 resume / 비활성 전이) — 다시 카운팅으로
 *
 * **카운팅 단계**: `activity$` 가 무동작 타이머를 리셋(활동 = idle 아님).
 * **경고 단계**: `exhaustMap` 이 재진입을 막아, ambient 활동(배경 탭 등)은 경고를 못 끈다.
 *   경고를 끄는 유일한 길은 `resume$`(계속 사용 버튼) — `race` 로 유예 타이머(fire)와 경쟁.
 */
export type IdleCommand = 'counting' | 'warn' | 'fire';

export const createIdleStream = (
  active$: Observable<boolean>,
  activity$: Observable<unknown>,
  resume$: Observable<unknown>,
  cfg: { timeoutMs: number; graceMs: number },
): Observable<IdleCommand> =>
  active$.pipe(
    switchMap(
      (active) =>
        active
          ? activity$.pipe(
              startWith(null),
              switchMap(() => timer(cfg.timeoutMs)), // 카운팅: 활동이 리셋
              exhaustMap(() =>
                // 경고: 진입 후 ambient 활동 무시. resume(버튼)만 해제.
                concat(
                  of<IdleCommand>('warn'),
                  race(
                    timer(cfg.graceMs).pipe(map((): IdleCommand => 'fire')),
                    // take(1): resume$ 는 Subject라 미완료 → race 가 안 끝나 exhaustMap 이 막힘.
                    // 첫 emit 후 완료시켜 race·concat 을 종결, 다음 경고 사이클이 돌게 한다.
                    resume$.pipe(
                      take(1),
                      map((): IdleCommand => 'counting'),
                    ),
                  ),
                ),
              ),
            )
          : of<IdleCommand>('counting'), // 비활성 → 경고 해제
    ),
  );

/**
 * idle 정리 파이프라인. `hasOverlays$`(정리 대상 존재) 가 열린 동안 무동작이 `timeoutMs` 지속되면
 * 1회 방출(경고·유예·네비 없음). 오버레이가 사라져 게이트가 닫히면 `EMPTY` 로 전환해 **스스로 종료**.
 */
export const createIdleCleanupStream = (
  hasOverlays$: Observable<boolean>,
  activity$: Observable<unknown>,
  cfg: { timeoutMs: number },
): Observable<void> =>
  gatedActivityIdle<void>(
    hasOverlays$,
    activity$,
    () => timer(cfg.timeoutMs).pipe(map(() => undefined)),
    EMPTY,
  );
