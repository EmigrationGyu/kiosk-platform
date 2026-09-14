export const Z_INDEX = {
  modal: 10000,
  keyboard: 10001,
  footer: 10002,
  toast: 10003,
  bottomSheet: 10004,
  overlayModal: 10005,
  bottomGradient: 10006,
  splash: 10007,
  // idle 경고는 항상 최상위 — 전용 포털(모달 스토어 미사용)로 모든 레이어 위에 뜬다.
  idleWarning: 10008,
} as const;
