/**
 * 이 프로세스가 도는 환경에 대한 **사실**만 노출한다. 값이지 동작이 아니다 —
 * spawn·재기동·저장 같은 "어떻게 하느냐"는 각 포트(Spawner·Lifecycle·SecureStorage…)의
 * 몫이고, 여기에 메서드를 넣고 싶어지면 그건 포트여야 한다는 신호다.
 *
 * 이 타입이 있기 전에는 환경 값이 필요한 파일이 각자 electron 을 직접 import 했다
 * (audio·storage 가 app.getPath('userData') 를 서로 모른 채 중복 호출). 값 공급자를
 * 한 곳으로 모아 electron 을 아는 파일이 impl/electron.ts 하나로 줄어든다.
 *
 * 환경별 구현은 `@platform/Platform` alias 로 swap 된다 (tsconfig·vite·esbuild 3곳).
 */
export type Platform = {
  readonly paths: {
    /** 앱 재설치·갱신에도 살아남는 이 단말의 쓰기 가능 상태 디렉토리. */
    readonly userData: string;
    /** 패키지에 실려 온 교체 대상 아티팩트(backend·frontend·serialport)의 루트. */
    readonly baseline: string;
  };
  /** 이 앱의 버전 — 로그·supervisor heartbeat 의 단일 출처. */
  readonly appVersion: string;
  readonly isPackaged: boolean;
};
