/**
 * 데모 라우트.
 *
 * 원본은 업장 플로우(체크인·체크아웃·정산 등)가 열몇 개 붙어 있었다. 여기 남은 것은
 * **인프라를 실제로 밟는 화면**뿐이다 — 입력기는 서브프로세스 FFI 까지, 디스펜서는
 * 시리얼 스택까지 관통한다.
 */
export const ROUTES = {
  HOME: '/',
  IME: '/ime',
  DISPENSER: '/dispenser',
  GLOBAL_UI: '/global-ui',
  UPDATE: '/update',
} as const;

export type Route = (typeof ROUTES)[keyof typeof ROUTES];
