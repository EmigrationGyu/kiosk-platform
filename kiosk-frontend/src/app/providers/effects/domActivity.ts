import { fromEvent, merge, type Observable } from 'rxjs';

/** 사용자 활동 원시 입력(스크롤·오터치 포함해 물리적 상호작용 전부). */
const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;

/**
 * document capture 리스너를 합친 활동 스트림. cold — 구독 시 attach, 해제 시 detach 라서
 * 게이트가 닫히면(switchMap 이탈) 리스너도 자동으로 떨어진다. idle shell 들이 공유.
 */
export const createDomActivity$ = (): Observable<Event> =>
  merge(
    ...ACTIVITY_EVENTS.map((type) =>
      fromEvent<Event>(document, type, { capture: true }),
    ),
  );
