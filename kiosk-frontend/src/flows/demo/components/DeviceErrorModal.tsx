import { useTranslate } from '@tolgee/react';
import { A11Y_KEYS } from 'kiosk-types';
import { A11yNode } from '@/shared/a11y';
import Modal from '@/shared/components/Modal';
import { MODAL_TYPE } from '@/shared/constants/modal';
import { useModal } from '@/shared/lib/modal/useModal';
import { Button } from '@/shared/ui';

/** 장치가 돌려준 **원인 식별자**만 받는다 — 전문·응답 코드는 서비스 안에 남는다. */
export const DeviceErrorModal = ({ cause }: { cause: string }) => {
  const { t } = useTranslate();
  const { closeModal } = useModal();
  return (
    <Modal className="w-[320px] p-space-10">
      <p className="typo-t1-b text-glyph-gray-heading">장치 오류</p>
      <p className="typo-b2-r text-glyph-gray-description mt-space-4">
        {cause}
      </p>
      <A11yNode a11yKey={A11Y_KEYS.DEMO_CONFIRM}>
        <Button
          kind="common"
          hierarchy="primary"
          size="large"
          className="w-full min-w-0 mt-space-8"
          onPress={() => closeModal(MODAL_TYPE.DEVICE_ERROR)}
        >
          {t('common.confirm')}
        </Button>
      </A11yNode>
    </Modal>
  );
};

export default DeviceErrorModal;
