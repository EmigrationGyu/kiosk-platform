// 원본은 음성 시트에서 생성되는 키 카탈로그였다(변수 음성 선언 포함). 데모 키셋만 남긴다.

/**
 * 음성 클립 키. a11y 바인딩이 이 키로 참조하고, 파일명이 곧 발화 계약이다 —
 * 키를 바꾸면 파일도 같이 바뀌어야 하므로, 양쪽이 갈리는 것을 카탈로그 대조가 잡는다.
 */
export const AUDIO_KEYS = {
  DEMO_HOME_ENTER: 'demo_home_enter',
  DEMO_HOME_IME_LABEL: 'demo_home_ime_label',
  DEMO_HOME_DISPENSER_LABEL: 'demo_home_dispenser_label',
  DEMO_IME_ENTER: 'demo_ime_enter',
  DEMO_DISPENSER_ENTER: 'demo_dispenser_enter',
  DEMO_DISPENSE_LABEL: 'demo_dispense_label',
  DEMO_DISPENSE_PRESS: 'demo_dispense_press',
  DEMO_DEVICE_ERROR_ENTER: 'demo_device_error_enter',
} as const;

export type AudioKey = (typeof AUDIO_KEYS)[keyof typeof AUDIO_KEYS];

/** 변수 음성의 슬롯 값(금액·개수 등). 데모에는 변수 음성이 없다. */
export type AudioVariable = string;
export type AudioVars = Partial<Record<AudioVariable, string | number>>;

/**
 * 키별로 요구하는 변수 목록. 변수 음성인데 값이 안 오면 그 슬롯이 **조용히 묵음**이 되므로,
 * 런타임 가드가 이 표를 보고 경고한다. 데모는 비어 있다.
 */
export const AUDIO_KEY_VARIABLES = {} as Partial<
  Record<AudioKey, readonly AudioVariable[]>
>;
