// 원본은 디자인 시스템의 접근성 시트에서 **생성**되는 499키 카탈로그였다(`gen:a11y`).
// 그 키들은 업장 플로우의 어휘라 여기엔 데모 키셋만 남긴다 — 구조와 규약은 그대로다.

import { z } from 'zod';

/**
 * a11y 노드 키. `flow_screen_purpose` snake-case 이고 **Figma 레이어명과 같다.**
 *
 * 이름을 맞춘 것이 설계의 핵심이다. 디자이너가 레이어에 붙인 이름이 곧 조인 키라,
 * 음성 바인딩 시트와 코드가 **사람의 대조 없이** 만난다. 키가 갈리면 빌드가 아니라
 * 카탈로그 대조에서 드러난다.
 *
 * 닫힌 집합인 이유: `<A11yNode a11yKey>` 의 전체 주소 공간이라, 임의 문자열을 허용하면
 * 오타가 "음성 없는 노드"로 조용히 착지한다.
 */
export const A11Y_KEYS = {
  /** screen · demo */
  DEMO_HOME_PAGE: 'demo_home_page',
  /** button · demo */
  DEMO_HOME_IME: 'demo_home_ime',
  /** button · demo */
  DEMO_HOME_DISPENSER: 'demo_home_dispenser',
  /** button · demo */
  DEMO_HOME_UPDATE: 'demo_home_update',
  /** button · demo */
  DEMO_HOME_GLOBAL_UI: 'demo_home_global_ui',
  /** screen · demo */
  DEMO_IME_PAGE: 'demo_ime_page',
  /** input · demo */
  DEMO_IME_INPUT: 'demo_ime_input',
  /** screen · demo */
  DEMO_DISPENSER_PAGE: 'demo_dispenser_page',
  /** button · demo */
  DEMO_DISPENSE: 'demo_dispense',
  /** button · demo */
  DEMO_RETURN_TOKEN: 'demo_return_token',
  /** button · demo */
  DEMO_TOKEN_COUNT: 'demo_token_count',
  /** button · demo */
  DEMO_CONFIRM: 'demo_confirm',
  /** screen · demo */
  DEMO_DEVICE_ERROR_DIALOG: 'demo_device_error_dialog',
  /** screen · demo */
  DEMO_UPDATE_PAGE: 'demo_update_page',
  /** screen · demo */
  DEMO_GLOBAL_UI_PAGE: 'demo_global_ui_page',
  /** button · demo */
  DEMO_GLOBAL_UI_ACTION: 'demo_global_ui_action',
} as const;

export type A11yKeyName = keyof typeof A11Y_KEYS;
export type A11yKey = (typeof A11Y_KEYS)[A11yKeyName];

/** a11y 키 스키마 — 카탈로그에서 파생(리터럴 선언은 위 한 곳뿐). */
export const A11yKeySchema = z.enum(
  Object.values(A11Y_KEYS) as [A11yKey, ...A11yKey[]],
);
