import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  A11Y_BINDINGS,
  resolveCues,
  useAccessibilityStore,
} from '@/shared/a11y';
import { ANALYTICS_EVENTS, track } from '@/shared/analytics';
import { PLAY_MODE_INTERRUPT } from '@/shared/audio/AudioPlayer';
import { useAudio } from '@/shared/hooks/useAudio';
import { useKeyboardStore } from '@/shared/lib/keyboard/store';
import { useModalStore } from '@/shared/lib/modal/store';
import { MODAL_A11Y } from './modalA11y';
import { useModalPresenceStore } from './modalPresenceStore';

type ModalContainerMode = 'standard' | 'overlay';

export const useModalContainer = (mode: ModalContainerMode) => {
  const modalList = useModalStore((s) => s.modalList);
  const closeModal = useModalStore((s) => s.closeModal);
  const { keyboardItem, close: closeKeyboard } = useKeyboardStore();
  const filteredList = useMemo(
    () =>
      modalList.filter((m) =>
        mode === 'overlay' ? m.options?.overlay : !m.options?.overlay,
      ),
    [modalList, mode],
  );

  const topModal = filteredList[filteredList.length - 1];
  const hasModal = filteredList.length > 0;

  // top 모달 진입 시 a11y mount 음성 (B: 컨테이너 중앙 처리). MODAL_A11Y 맵 등록 모달만.
  const { play } = useAudio();
  const a11yEnabled = useAccessibilityStore((s) => s.enabled);
  // enabled 를 ref 로 캡처 — deps 에 넣으면 모달 열린 채 a11y 토글 시 mount 음성이 재발화한다.
  // (모달 진입 시점의 enabled 만 의미; 토글은 다음 모달부터 반영)
  const a11yEnabledRef = useRef(a11yEnabled);
  // dep array 없음 = 매 커밋 실행 → 재구독 없이 최신값만 갱신(표준 "latest ref" 패턴).
  // 아래 mount 음성 effect 보다 먼저 선언해야 한다 — effect 는 선언 순서대로 실행되므로
  // 같은 커밋 안에서 미러가 먼저 갱신되고, 그래야 렌더 중 쓰기와 동일한 값을 읽는다.
  useEffect(() => {
    a11yEnabledRef.current = a11yEnabled;
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: topModal.modalType 변화에만 반응
  useEffect(() => {
    if (mode !== 'standard') return;
    const a11yKey = topModal ? MODAL_A11Y[topModal.modalType] : undefined;
    const cues = resolveCues(
      a11yKey ? A11Y_BINDINGS[a11yKey]?.mount : undefined,
      a11yEnabledRef.current,
    );
    if (cues.length > 0)
      play(
        cues.map((key) => ({ key })),
        PLAY_MODE_INTERRUPT,
      );
  }, [topModal?.modalType, mode]);

  // 모달 표시/해제 추적 — standard·overlay 컨테이너가 각자 자기 모달을 잡는다(모드 가드 없음,
  // topModal 이 이미 mode 로 필터됨). topModal.modalType 진입=mount, cleanup=unmount (음성 cue 와 동일 정의).
  useEffect(() => {
    const modalType = topModal?.modalType;
    if (!modalType) return;
    track(ANALYTICS_EVENTS.MODAL_VIEWED, { modalType });
    return () => {
      track(ANALYTICS_EVENTS.MODAL_CLOSED, { modalType });
    };
  }, [topModal?.modalType]);

  const markPresent = useModalPresenceStore((s) => s.markPresent);
  const markGone = useModalPresenceStore((s) => s.markGone);
  useEffect(() => {
    if (hasModal) markPresent(mode);
  }, [hasModal, mode, markPresent]);
  const handleExitComplete = useCallback(() => {
    markGone(mode);
  }, [markGone, mode]);

  // overlay 클릭 핸들러
  const handleOverlayClick = useCallback(() => {
    // standard: 키보드가 열려있다면 키보드만 닫고 모달은 유지
    if (mode === 'standard' && keyboardItem.keyboard) {
      closeKeyboard();
      return;
    }

    if (!topModal) return;
    if (topModal.options?.closeOnOverlayClick) {
      closeModal(topModal.modalType);
    }
  }, [mode, keyboardItem.keyboard, closeKeyboard, topModal, closeModal]);

  const handleCloseButtonClick = useCallback(() => {
    if (!topModal) return;
    closeModal(topModal.modalType);
  }, [topModal, closeModal]);

  return {
    topModal,
    hasModal,
    handleOverlayClick,
    handleCloseButtonClick,
    handleExitComplete,
  } as const;
};
