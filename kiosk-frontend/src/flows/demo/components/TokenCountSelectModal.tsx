import { useTranslate } from '@tolgee/react';
import { A11Y_KEYS } from 'kiosk-types';
import { A11yNode } from '@/shared/a11y';
import Modal from '@/shared/components/Modal';
import { MODAL_TYPE } from '@/shared/constants/modal';
import { useModal } from '@/shared/lib/modal/useModal';
import { Button } from '@/shared/ui';

const CHOICES = [1, 2, 3, 4] as const;

/**
 * opener 와 **상태를 공유하는** 모달.
 *
 * 결과를 콜백으로 돌려주지 않는다. 여는 쪽이 `useModal(MODAL_TYPE.TOKEN_COUNT_SELECT)`
 * 로 같은 키를 잡으면 `modalState.count` 가 `[값, setter]` 튜플로 오고, 모달이 닫힌
 * 뒤에도 그 값을 읽을 수 있다(수명 = hold ∪ open). 콜백 방식이면 opener 가 결과를
 * 담을 로컬 상태를 또 만들어야 하고, 그 상태와 모달의 상태가 갈린다.
 */
export const TokenCountSelectModal = () => {
  const { t } = useTranslate();
  const { closeModal, modalState } = useModal(MODAL_TYPE.TOKEN_COUNT_SELECT);
  const [count, setCount] = modalState.count;

  return (
    <Modal className="w-[320px] p-space-10">
      <p className="typo-t1-b text-glyph-gray-heading mb-space-8">
        몇 개를 방출할까요?
      </p>
      <div className="flex gap-space-4">
        {CHOICES.map((n) => (
          <A11yNode key={n} a11yKey={A11Y_KEYS.DEMO_TOKEN_COUNT}>
            <Button
              kind={count === n ? 'accent' : 'common'}
              hierarchy={count === n ? 'primary' : 'secondary'}
              className="flex-1 min-w-0"
              onPress={() => setCount(n)}
            >
              {n}
            </Button>
          </A11yNode>
        ))}
      </div>
      <A11yNode a11yKey={A11Y_KEYS.DEMO_CONFIRM}>
        <Button
          kind="accent"
          hierarchy="primary"
          size="large"
          className="w-full min-w-0 mt-space-8"
          disabled={count === undefined}
          onPress={() => closeModal(MODAL_TYPE.TOKEN_COUNT_SELECT)}
        >
          {t('common.confirm')}
        </Button>
      </A11yNode>
    </Modal>
  );
};

export default TokenCountSelectModal;
