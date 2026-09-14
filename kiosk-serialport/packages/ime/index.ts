import { logContractFingerprint } from '@/shared/contract/fingerprint';
import { Logger } from '@/shared/Logger';
import { App } from './src/app';

const logger = Logger.getInstance('ime');
logContractFingerprint('ime');
// 부팅 라인 — 서브프로세스가 실행되기만 하면 곧바로 ime.log 가 생긴다. 이 라인이 없으면
// (요청은 오는데 응답 타임아웃인 경우) 서브프로세스가 fork 되지 못했거나 import 단계에서
// 크래시한 것 → 원인은 부모(electron 메인)가 남기는 {date}_ime.log 의 [메인/spawn] 라인 참조.
logger.info('[부팅] ime 서브프로세스 시작', {
  unmasked: {
    pid: process.pid,
  },
});

if (import.meta.hot) {
  if (!import.meta.hot.data.app) {
    const app = new App();
    app.start();
    import.meta.hot.data.app = app;
    logger.info('[부팅] IPC 라우터 서브 완료 (HMR)');
    console.log('[ready]');
  } else {
    App.reload(import.meta.hot.data.app);
    logger.info('[부팅] 핸들러 재로드 (HMR)');
  }

  import.meta.hot.accept();
} else {
  new App().start();
  logger.info('[부팅] IPC 라우터 서브 완료 — 요청 대기');
  console.log('[ready]');
}
