/**
 * **타입 레벨 동작의 박제.** 런타임 테스트로는 확인할 수 없으므로 `@ts-expect-error` 로 못
 * 박는다 — 표시한 줄에서 에러가 **나지 않으면** 타입체크가 실패한다. 즉 가드가 느슨해지는
 * 순간 빌드가 깨진다.
 *
 * 이 파일은 실행되지 않는다. `bun run typecheck` 가 검증한다.
 */
import type { LogErrorArgs, LogMessageArgs, LogMeta } from './index';

declare function info<M extends string>(
  msg: M,
  ...args: LogMessageArgs<M>
): void;
declare function error<M extends string>(
  msg: M,
  ...args: LogErrorArgs<M>
): void;

// 실제 호출부처럼 넓은 string — 리터럴 const 로 두면 템플릿이 구체 리터럴로 접혀 통과한다.
declare const guestName: string;
declare const searchName: string;
declare const roomName: string;
declare const attempt: number;
declare const amount: number;
declare const size: bigint;
declare const codeOrNull: number | null;
declare const brandedAmount: number & { __brand: 'AmountWon' };
declare const brandedName: string & { __brand: 'GuestName' };

// ── 통과해야 하는 것 ─────────────────────────────────────────────────────────
info('[체크인] 다중 예약 중 선택');
info('[체크인] 다중 예약 중 선택', { guestName, roomName });
info('[예약검색] 대조', { guestName, searchName });
info('[예약검색] 명부', { guestNames: ['홍길동', '김철수'] });
info('[예약검색] 후보', { matches: [{ guestName, score: 0.8 }] });
info('[성인인증] 시도', { attempt });
error('[체크인] 해제 실패', new Error('boom'));
error('[체크인] 해제 실패', new Error('boom'), { reservationId: 'R1' });

// 리터럴 상수 보간은 동적 데이터가 아니므로 통과한다.
const STEP = 2;
info(`[예약검색] 시도 ${STEP}단계`);

// 리터럴 유니온도 닫힌 집합이라 통과한다 — 서브프로세스 실패 코드가 이 형태로 올라온다.
declare const failCode: 'INVALID_RRN' | 'SDK_MRZ_FAILED';
info(`[신분증] 판독 실패 ${failCode}`);

// 상수 메시지가 숫자로 시작해도 오탐하지 않는다(머리 판정이 구체 글자를 placeholder 로 보면 깨진다).
info('2회 재시도 후 포기');

// ── 막혀야 하는 것 ───────────────────────────────────────────────────────────

// @ts-expect-error 메시지에 값을 보간하면 안 된다 — meta 로 넘겨야 한다.
info(`[체크인] 선택 예약자=${guestName}`);

// @ts-expect-error error 의 메시지도 마찬가지다.
error(`[체크인] 해제 실패 예약자=${guestName}`, new Error('boom'));

// @ts-expect-error 숫자 보간도 동적 데이터다. 한 글자씩 분해하면 머리로 `${number}` 가
// 통째로 떨어지므로, 꼬리만 보던 시절엔 이 줄이 조용히 통과했다(실측: 백엔드 8곳).
info(`[카드결제] 승인 금액=${amount}`);

// @ts-expect-error 숫자가 메시지 끝에 오지 않아도 마찬가지다.
info(`[카드결제] 승인 금액=${amount}원 완료`);

// @ts-expect-error bigint 도 같다.
info(`[업데이트] 크기 ${size}`);

// @ts-expect-error 브랜드된 숫자도 동적 데이터다. 브랜드 placeholder 는 구체 글자와
// 할당가능성으로 구별되지 않아 `${number}` 열거로는 닿지 않는다.
info(`[카드결제] 금액=${brandedAmount}`);

// @ts-expect-error 브랜드된 문자열은 더 위험하다 — 성명·연락처가 이 형태로 샌다.
info(`[체크인] 예약자=${brandedName}`);

// @ts-expect-error 일부만 동적인 유니온도 막는다. `${number | null}` 은 판정이
// `true | false` 로 갈려, 분배 비교(`extends true`)로는 걸리지 않는다(실측: electron).
info(`[백엔드] 종료 code=${codeOrNull}`);

// @ts-expect-error 레지스트리에 없는 키는 쓸 수 없다.
info('[관리자] 처리', { staffName: guestName });

// @ts-expect-error 중첩 안쪽도 마찬가지 — 초과 속성 검사가 적용된다.
const meta: LogMeta = { ownerName: guestName };
void meta;
