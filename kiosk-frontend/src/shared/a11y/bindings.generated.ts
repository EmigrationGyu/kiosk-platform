// 원본은 접근성 시트에서 **생성**되는 매니페스트였다(`gen:a11y:bindings`). 여기엔 데모
// 바인딩만 남기고, 생성물이라는 사실과 sparse 규약은 그대로 둔다.
//
// 빈 칸은 생략(sparse) — 런타임이 부재를 무음으로 무시한다. `always`=접근성 모드 OFF 에도 재생.

import type { A11yKey } from 'kiosk-types';
import type { A11yEventBinding } from './bindings';

/**
 * a11yKey → 이벤트별 음성.
 *
 * 코드가 이 표를 만들지 않는다 — 디자인 쪽 시트가 정본이고 코드는 생성물을 읽기만 한다.
 * 그래서 "화면에 문구를 넣었는데 음성이 없다"가 코드 리뷰가 아니라 **시트 검증**에서 걸린다.
 */
export const A11Y_BINDINGS: Partial<Record<A11yKey, A11yEventBinding>> = {
  demo_home_page: {
    mount: { key: 'demo_home_enter', always: true },
  },
  demo_home_ime: {
    focus: 'demo_home_ime_label',
  },
  demo_home_dispenser: {
    focus: 'demo_home_dispenser_label',
  },
  demo_ime_page: {
    mount: { key: 'demo_ime_enter', always: true },
  },
  demo_dispenser_page: {
    mount: { key: 'demo_dispenser_enter', always: true },
  },
  demo_dispense: {
    focus: 'demo_dispense_label',
    press: 'demo_dispense_press',
  },
  demo_device_error_dialog: {
    mount: { key: 'demo_device_error_enter', always: true },
  },
};
