import { ROUTES } from './routes';

/**
 * 전역 idle(무동작) 상수. 런타임 변경은 `idleStore.setIdleTimeoutMs`, on/off 는 `idleStore` 의
 * **심볼 disable 키**로 한다 — 컴포넌트 생명주기에 묶지 않는 이유는 "모달이 열려 있는 동안만"
 * 같은 조건이 마운트 경계와 일치하지 않기 때문이다.
 */

/** 무동작으로 판단하기까지의 대기. */
export const IDLE_DEFAULT_TIMEOUT_MS = 180_000; // 3분

/** 쇼케이스 화면에서 무동작 예산을 줄여 실제 경고 경로를 태우기 위한 값. */
export const IDLE_DEMO_TIMEOUT_MS = 5_000;

/** 경고 노출 후 자동 리셋까지의 유예. */
export const IDLE_WARNING_GRACE_MS = 60_000; // 1분

/**
 * 전역 idle 경고를 돌리지 않는 라우트(닫힌 집합) — 세션이 없는 진입 화면들.
 *
 * "세션 중인데 idle 을 꺼야 하는" 경우는 여기가 아니라 `idleStore` 의 disable 키가 담당한다.
 * 두 축을 한 곳에 합치면 "라우트 때문에 꺼진 것"과 "작업 중이라 꺼진 것"이 구분되지 않고,
 * 한쪽이 풀릴 때 다른 쪽까지 같이 풀린다.
 *
 * 면제 라우트가 **자기 idle 정책을 직접 opt-in** 하는 것이 이 코드베이스의 관례다. 전역이
 * 손을 떼는 것이지 아무 정책도 없는 것이 아니다.
 */
export const IDLE_EXEMPT_ROUTES: readonly string[] = [ROUTES.HOME];
