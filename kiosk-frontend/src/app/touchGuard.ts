declare global {
  interface GlobalEventHandlersEventMap {
    gesturestart: Event;
  }
}

export function installTouchGuards(): void {
  // capture + passive:false: 2점 이상 동시 터치일 때, 하위 onClick이 중복 발화하기 전에 선점해서 삼킨다.
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { passive: false, capture: true },
  );

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
