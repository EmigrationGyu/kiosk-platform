import { useTranslate } from '@tolgee/react';
import { A11Y_KEYS } from 'kiosk-types';
import { useEffect, useState } from 'react';
import { idleResume$ } from '@/app/providers/effects/idleResume';
import { A11yNode } from '@/shared/a11y';
import { useAccessibilityStore } from '@/shared/a11y/accessibilityStore';
import { KeyboardTextInput } from '@/shared/components/keyboard/KeyboardTextInput';
import {
  IDLE_DEFAULT_TIMEOUT_MS,
  IDLE_DEMO_TIMEOUT_MS,
  IDLE_WARNING_GRACE_MS,
} from '@/shared/constants/idle';
import { KEYBOARD_TYPE } from '@/shared/constants/keyboard';
import { MODAL_TYPE } from '@/shared/constants/modal';
import { TOAST_TYPE } from '@/shared/constants/toast';
import { useToast } from '@/shared/hooks';
import { useModal } from '@/shared/lib/modal/useModal';
import { useIdleStore } from '@/shared/store/idleStore';
import { Button } from '@/shared/ui';

type Row = { title: string; desc: string; action: () => void; label: string };

/**
 * 전역 UI 층 쇼케이스.
 *
 * 이 화면의 목적은 **각 층이 화면에 묶여 있지 않다는 것**을 보이는 것이다. 모달·토스트·
 * 키보드·idle 경고는 페이지가 소유하지 않고 각자 포털과 스토어를 가지므로, 여기서 띄운
 * 것들이 라우트를 옮겨도 그대로 산다(idle 경고는 특히 — 밑의 모달을 언마운트하지 않는다).
 */
const GlobalUiDemo = () => {
  const { t } = useTranslate();
  const { openModal, modalState } = useModal(MODAL_TYPE.TOKEN_COUNT_SELECT);
  const [count] = modalState.count;
  const { openToast } = useToast();
  const setIdleTimeoutMs = useIdleStore((s) => s.setIdleTimeoutMs);
  const a11yEnabled = useAccessibilityStore((s) => s.enabled);
  const toggleA11y = useAccessibilityStore((s) => s.toggle);
  const [text, setText] = useState('');

  // "계속 사용" 을 누르면 무동작 예산을 원래대로 돌린다. resume$ 는 스트림 전용 채널이
  // 아니라 누구나 들을 수 있는 신호라, 쇼케이스가 자기 사정(5초로 줄여둔 것)을 여기서
  // 스스로 되돌린다 — 안 그러면 5초마다 경고가 다시 뜬다.
  useEffect(() => {
    const sub = idleResume$.subscribe(() =>
      setIdleTimeoutMs(IDLE_DEFAULT_TIMEOUT_MS),
    );
    return () => sub.unsubscribe();
  }, [setIdleTimeoutMs]);

  const rows: Row[] = [
    {
      title: '모달 — opener 와 상태 공유',
      desc: `선택 결과가 콜백이 아니라 공유 필드로 온다. 지금 값: ${count ?? '없음'}`,
      label: '열기',
      action: () => openModal(MODAL_TYPE.TOKEN_COUNT_SELECT),
    },
    {
      title: '모달 — 원인만 받는 오류 표시',
      desc: '장치 응답 코드·전문은 서비스 안에 남고 원인 식별자만 올라온다',
      label: '열기',
      action: () =>
        openModal(MODAL_TYPE.DEVICE_ERROR, { cause: 'TOKEN_EMPTY' }),
    },
    {
      title: '토스트 — 자가소멸 피드백',
      desc: '되돌릴 것이 없는 통지. 스택으로 쌓이고 스스로 사라진다',
      label: '띄우기',
      action: () => openToast(TOAST_TYPE.SUCCESS, '처리했습니다'),
    },
    {
      title: 'idle 경고 — 무동작 복귀',
      // 스토어를 직접 찔러 경고를 띄우면 파이프라인 밖이라 "계속 사용" 이 안 먹는다
      // (resume$ 를 듣는 것은 스트림의 경고 단계뿐). 무동작 예산만 줄여 진짜 경로를 태운다.
      desc: `무동작 ${IDLE_DEMO_TIMEOUT_MS / 1000}초 → 경고, ${
        IDLE_WARNING_GRACE_MS / 1000
      }초 더 방치하면 홈. 전용 컨테이너라 밑의 모달을 언마운트하지 않는다`,
      label: `무동작 ${IDLE_DEMO_TIMEOUT_MS / 1000}초로 줄이기`,
      action: () => setIdleTimeoutMs(IDLE_DEMO_TIMEOUT_MS),
    },
    {
      title: `접근성 모드 — 현재 ${a11yEnabled ? 'ON' : 'OFF'}`,
      desc: '켜면 A11yNode 가 포커스 순서에 편입되고 이벤트마다 음성이 걸린다',
      label: '토글',
      action: toggleA11y,
    },
  ];

  return (
    <A11yNode a11yKey={A11Y_KEYS.DEMO_GLOBAL_UI_PAGE}>
      <div className="flex h-full flex-col gap-space-4 overflow-y-auto px-space-10 pt-space-10 pb-space-10">
        <p className="typo-t1-b text-glyph-gray-heading">전역 UI 층</p>
        {rows.map((r) => (
          <div
            key={r.title}
            className="flex items-center gap-space-4 rounded-[10px] bg-background-base-elevate p-space-6"
          >
            <div className="min-w-0 flex-1">
              <p className="typo-b2-sb text-glyph-gray-body">{r.title}</p>
              <p className="typo-b3-r text-glyph-gray-description">{r.desc}</p>
            </div>
            <A11yNode a11yKey={A11Y_KEYS.DEMO_GLOBAL_UI_ACTION}>
              <Button
                kind="common"
                hierarchy="secondary"
                size="small"
                className="shrink-0"
                onPress={r.action}
              >
                {r.label}
              </Button>
            </A11yNode>
          </div>
        ))}

        <div className="rounded-[10px] bg-background-base-elevate p-space-6">
          <p className="typo-b2-sb text-glyph-gray-body">
            키보드 — 전역 컨테이너
          </p>
          <p className="typo-b3-r text-glyph-gray-description mb-space-4">
            입력은 이 페이지가, 키보드는 레이아웃이 소유한다. 언어를 바꾸면
            자판과 IME 엔진이 함께 갈린다
          </p>
          <A11yNode a11yKey={A11Y_KEYS.DEMO_IME_INPUT}>
            <KeyboardTextInput
              keyboardType={KEYBOARD_TYPE.TEXT}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('demo.ime.placeholder')}
            />
          </A11yNode>
        </div>
      </div>
    </A11yNode>
  );
};

export default GlobalUiDemo;
