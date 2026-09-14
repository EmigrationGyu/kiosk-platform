import { isSelfHosted, type SerialportProcess } from 'kiosk-types';

/**
 * 서브프로세스 요청 경로의 **시간 사다리** — 단일 출처.
 *
 * 이 값들은 서로 감싸는 관계라 따로 보면 뜻이 없다. 흩어져 있던 동안 두 transport impl 이 같은 상수를
 * 각자 선언했고, 새로 생긴 다운로드 예산이 연결 예산을 넘겨 **첫 요청이 죽는 역전**이 잠깐 있었다.
 *
 * ```
 *   요청     10s   장비가 답하나            ← 안쪽. 길면 고장을 늦게 안다
 *   연결     60s   자식이 말할 수 있게 됐나  ← 요청을 감싼다(콜드 부팅은 요청 잘못이 아니다)
 *   다운로드 180s  런타임을 받았나          ← 연결을 감싼다(자기 런타임을 받는 자식만)
 * ```
 *
 * 바깥이 안쪽보다 짧으면 안쪽이 성립할 수 없다 — 그래서 자기 런타임을 받는 자식의 연결 예산은
 * 다운로드 예산에서 **파생**한다.
 *
 * 여기 없는 것: 장비 프로토콜 대기는 이 사다리가 아니라 **그 장비가 사람을 얼마나 기다리나**이고,
 * 호출부가 `withTimeout` 으로 그때만 늘려 쓴다. 스캐너 폴링·idle reaper 도 요청 경로 밖이라 각자의
 * 자리에 둔다(여기 모으면 관계없는 값들이 사다리처럼 보인다).
 */

/**
 * 요청 하나의 예산 — **장비가 답하는가**를 재는 값이다. 늘리고 싶어지면 대개 재는 대상이 틀린 것이다:
 * 부팅을 기다리는 거라면 연결 예산이, 사람을 기다리는 거라면 호출부의 `withTimeout` 이 그 자리다.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * 자식이 **말할 수 있게 되기까지** 기다리는 상한. 요청 예산과 별개다 —
 * 콜드 부팅(vite-node 컴파일, fork 왕복)이 요청 예산보다 오래 걸릴 수 있다.
 */
export const SPAWN_CONNECT_TIMEOUT_MS = 60_000;

/**
 * 런타임 번들 하나를 받아오는 상한. 위 둘보다 훨씬 길지만 이건 장비 응답성이 아니라 ~30MB 전송이고
 * 한 단말에서 평생 한 번만 일어난다. 짧게 자르면 느린 업장이 영영 못 받고, 길게 두는 비용은 죽은 CDN 을
 * 오래 무는 것뿐인데 그건 연결 예산이 앞에서 막는다.
 */
export const RUNTIME_DOWNLOAD_TIMEOUT_MS = 180_000;

/**
 * 다운로드가 끝난 뒤 실제로 말이 트이기까지의 여유 — 해제 + rename + fork + 부팅.
 * 30MB 해제가 1~2초, 나머지가 1초 남짓이라 넉넉히 잡는다.
 */
const POST_DOWNLOAD_MARGIN_MS = 30_000;

/**
 * 자기 런타임을 들고 오는 자식의 연결 예산 — **다운로드를 감싸야 한다.**
 * 파생값이라 다운로드 상한을 바꾸면 자동으로 따라온다.
 */
export const SELF_HOSTED_CONNECT_TIMEOUT_MS =
  RUNTIME_DOWNLOAD_TIMEOUT_MS + POST_DOWNLOAD_MARGIN_MS;

/**
 * 이 프로세스의 연결 예산. 자기 런타임을 받아야 하는 자식은 그 다운로드가 첫 연결 안에서 벌어지므로,
 * 같은 60초로 재면 첫 요청이 항상 죽는다(다운로드는 계속 돌고 다음 요청만 성립하는, 고쳐지긴 하지만
 * 매번 한 번씩 실패하는 상태).
 */
export const spawnConnectTimeoutMs = (process: SerialportProcess): number =>
  isSelfHosted(process)
    ? SELF_HOSTED_CONNECT_TIMEOUT_MS
    : SPAWN_CONNECT_TIMEOUT_MS;

/**
 * 개발 스포너가 자식의 `[ready]` 를 기다리는 상한. 연결 예산과 같은 값이되 다른 신호를 본다 — 이쪽은
 * stdout 한 줄이고 저쪽은 파이프·포트다. 자기 런타임을 받는 경우를 감쌀 필요가 없다: dev 스포너는
 * 런타임이 없으면 기다리지 않고 거절한다(impl/node.ts 참고).
 */
export const DEV_READY_TIMEOUT_MS = SPAWN_CONNECT_TIMEOUT_MS;
