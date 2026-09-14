import { A11Y_KEYS, type A11yKey } from 'kiosk-types';
import { MODAL_TYPE, type ModalType } from '@/shared/constants/modal';

/**
 * 모달 키 → a11y 화면 키. 코드 어휘와 디자인 어휘가 다르게 자라는 것을 여기서 흡수한다.
 *
 * `useModalContainer` 가 top 모달 진입 시 이 키의 mount 음성을 재생하므로, 개별 모달을
 * `A11yNode` 로 감쌀 필요가 없다(컨트롤만 감싼다). 맵에 없는 모달은 mount 음성 없음 — 무해하다.
 *
 * **변수 음성은 이 맵에서 제외한다.** 중앙 mount 는 값을 실을 수 없어 그 슬롯이 묵음이 된다.
 * 금액·시각 같은 변수를 담는 모달은 자기 컴포넌트에서 직접 구동해야 한다.
 */
export const MODAL_A11Y: Partial<Record<ModalType, A11yKey>> = {
  [MODAL_TYPE.DEVICE_ERROR]: A11Y_KEYS.DEMO_DEVICE_ERROR_DIALOG,
  // TOKEN_COUNT_SELECT 는 선택한 개수를 읽어야 해서 제외 — 모달이 직접 구동한다.
};
