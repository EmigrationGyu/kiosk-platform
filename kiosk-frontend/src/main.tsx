import { createRoot } from 'react-dom/client';
import './index.css';
import { ApolloProvider } from '@apollo/client/react';
import { TolgeeProvider } from '@tolgee/react';
import apolloClient from 'apollo/apolloClient';
import {
  CONTRACT_TOTAL,
  NAMESPACES,
  namespaceContractHash,
  shortHash,
} from 'kiosk-types';
import { initAnalytics } from '@/shared/analytics';
import { Logger } from '@/shared/logger/Logger';
import App from './app/App';
import { tolgee } from './app/i18n/tolgee';
import { installTouchGuards } from './app/touchGuard';

installTouchGuards();
initAnalytics();

// 어디서 적재됐고 어느 계약으로 빌드됐는지. React 바깥에 두어 화면과 무관하게 남는다.
//
// 네임스페이스별로 찍는 이유: 호환 판정은 `total` 이 아니라 경계별이어야 한다. total 은
// 합집합이라 장치 하나가 바뀌어도 달라져 프론트까지 갈아야 하는 것처럼 보인다.
const logger = new Logger();
logger.info(`[적재] frontend ← ${window.location.pathname}`);
logger.info(
  `[계약] total=${shortHash(CONTRACT_TOTAL)} 렌더러↔백엔드 ${Object.values(
    NAMESPACES,
  )
    .map((ns) => `${ns}=${shortHash(namespaceContractHash(ns))}`)
    .join(' ')}`,
);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element with id "root" not found');
}

/**
 * 크래시가 **어느 컴포넌트에서** 났는지는 여기서만 알 수 있다.
 *
 * 라우트 에러 바운더리(`RouteErrorPage`)가 받는 건 던져진 값 하나뿐이라, 스택이
 * 압축된 프로덕션 번들에서는 "무엇이 undefined 였는가"까지만 남고 "어느 화면의 어느
 * 컴포넌트인가"가 사라진다. 컴포넌트 스택은 React 루트만 들고 있으므로 여기서 남긴다.
 *
 * 콘솔에도 그대로 흘린다 — 이 훅을 지정하면 React 의 기본 콘솔 출력이 **대체**되고,
 * 파일 로거(pino)는 stdout 으로 나가지 않는다. 둘 다 빠지면 개발 중 크래시가 DevTools
 * 에서도 터미널에서도 완전히 조용해진다.
 */
const logReactCrash = (
  scope: string,
  error: unknown,
  componentStack: string | null | undefined,
) => {
  // biome-ignore lint/suspicious/noConsole: React 기본 콘솔 출력을 대체하므로 여기서 복원한다
  console.error(`[React] ${scope}`, error, componentStack);
  new Logger().error(
    `[React] ${scope} — 컴포넌트 스택:\n${componentStack ?? '(없음)'}`,
    error,
  );
};

createRoot(rootElement, {
  // 에러 바운더리가 잡은 크래시 = 라우트 오류 화면으로 떨어진 경우.
  onCaughtError: (error, errorInfo) => {
    logReactCrash('바운더리가 잡은 크래시', error, errorInfo.componentStack);
  },
  // 아무도 못 잡은 크래시 = 화면이 통째로 빈 경우. 바운더리 자신이 터져도 여기로 온다.
  onUncaughtError: (error, errorInfo) => {
    logReactCrash('처리되지 않은 크래시', error, errorInfo.componentStack);
  },
}).render(
  <ApolloProvider client={apolloClient}>
    <TolgeeProvider tolgee={tolgee}>
      <App />
    </TolgeeProvider>
  </ApolloProvider>,
);
