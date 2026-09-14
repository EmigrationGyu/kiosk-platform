import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
} from '@apollo/client';
import { RetryLink } from '@apollo/client/link/retry';
import { Logger } from '@/shared/logger/Logger';
import { idempotencyLink } from './idempotencyLink';

const MAX_RETRY_ATTEMPTS = 3;

/**
 * 네트워크 재시도.
 *
 * **GraphQL 에러는 재시도하지 않는다** — 서버가 답을 준 것이고, 같은 요청을 다시 보내도
 * 같은 답이 온다. AbortError 도 재시도하지 않는다: 호출자가 명시적으로 취소한 의도를
 * 재시도가 뒤집으면 취소 버튼이 동작하지 않는 것처럼 보인다.
 *
 * 재시도가 **멱등하지 않은 요청**에 붙으면 사고가 난다 — 같은 작업이 두 번 실행될 수 있다.
 * 그래서 `idempotencyLink` 가 앞단에서 키를 붙이고, 서버가 그 키로 중복을 접는다.
 */
const retryLink = new RetryLink({
  attempts: {
    max: MAX_RETRY_ATTEMPTS,
    retryIf: (error, operation) => {
      if (!error) return false;
      if (error instanceof Error && error.name === 'AbortError') {
        new Logger().info(
          `[RetryLink] "${operation.operationName}" aborted — skipping retry.`,
        );
        return false;
      }
      return true;
    },
  },
  delay: { initial: 300, jitter: true },
});

/**
 * 데모용 종단 링크 — 서버 없이 빈 데이터를 돌려준다.
 *
 * 원본은 HTTP 링크 + WebSocket 구독 링크를 오퍼레이션 종류로 갈랐고, 소켓은 토큰이 바뀌면
 * 끊어서 재협상시켰다(`connectionParams` 는 소켓당 1회만 평가되므로 갱신이 안 먹는다).
 * 그 배선은 서버 스키마에 묶여 있어 걷어냈고, **캐시 경계**만 남긴다 — 서버 상태가 어디
 * 사는지가 이 레이어의 논점이기 때문이다.
 */
const demoTerminatingLink = new ApolloLink(
  (operation) =>
    new Observable((observer) => {
      new Logger().info(`[Apollo] mock "${operation.operationName}"`);
      observer.next({ data: {} });
      observer.complete();
    }),
);

/**
 * **서버 상태는 여기에만 산다.** 클라이언트 스토어로 복사하지 않는다 — 같은 사실이 두 곳에
 * 있으면 반드시 갈리고, 갈린 순간 어느 쪽이 맞는지 알 방법이 없다.
 */
const apolloClient = new ApolloClient({
  link: ApolloLink.from([idempotencyLink, retryLink, demoTerminatingLink]),
  cache: new InMemoryCache(),
});

export default apolloClient;
