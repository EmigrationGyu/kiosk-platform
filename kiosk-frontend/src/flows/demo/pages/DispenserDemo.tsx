import { useTranslate } from '@tolgee/react';
import { A11Y_KEYS, TOKEN_DISPENSER_EVENTS } from 'kiosk-types';
import { useState } from 'react';
import { A11yNode } from '@/shared/a11y';
import { MODAL_TYPE } from '@/shared/constants/modal';
import { useModal } from '@/shared/lib/modal/useModal';
import { Logger } from '@/shared/logger/Logger';
import { TokenDispenser } from '@/shared/transport/TokenDispenser';
import { Button } from '@/shared/ui';

type Line = { at: string; text: string };

/**
 * 디스펜서 데모 — 시리얼 스택을 화면에서 밟는다.
 *
 * 요청은 **원인 식별자만** 받는다. 장치 응답 코드·전문은 서비스 안에 남아 있어서, 장치를
 * 갈아끼워도 이 화면은 안 바뀐다.
 *
 * 방출 매수는 모달과 **상태를 공유**해서 받는다 — 콜백으로 돌려받지 않는다(`useModal` 참고).
 */
const DispenserDemo = () => {
  const [log, setLog] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const { openModal, modalState } = useModal(MODAL_TYPE.TOKEN_COUNT_SELECT);
  const [count] = modalState.count;
  const { t } = useTranslate();

  const append = (text: string) =>
    setLog((prev) =>
      [{ at: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 20),
    );

  const dispense = async () => {
    setBusy(true);
    try {
      const res = await TokenDispenser.getInstance().request(
        TOKEN_DISPENSER_EVENTS.DISPENSE,
        { count: count ?? 1 },
      );
      if (res.success) {
        append(
          `방출 ${res.data.dispensed}개 · 게이트=${res.data.status.tokenAtGate}`,
        );
        // 성공 응답인데 요청보다 적게 나갈 수 있다 — 회수 게이트가 중간에 끊은 것이다.
        // 이유는 cause 가 아니라 status 로 온다(실패가 아니므로). 그대로 두면 화면엔
        // "0개" 만 남아 고장으로 보인다.
        if (res.data.dispensed < (count ?? 1) && res.data.status.tokenAtGate) {
          append('게이트에 이전 토큰이 남아 중단됐다 — 회수 후 다시 방출한다');
        }
      } else {
        append(`실패 — ${res.cause}`);
        openModal(MODAL_TYPE.DEVICE_ERROR, { cause: res.cause });
      }
    } catch (e) {
      new Logger().error('[데모] 방출 요청 실패', e);
      append('요청 자체가 실패했다 — 백엔드가 떠 있는지 확인');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 게이트에 남은 토큰을 반환함으로 내린다. 실물에서는 손님이 집어가면 게이트 센서가
   * 풀리지만, 시뮬레이터에는 집어갈 손이 없다 — 그래서 남는 처분 경로가 이 명령이다.
   */
  const returnToken = async () => {
    setBusy(true);
    try {
      const res = await TokenDispenser.getInstance().request(
        TOKEN_DISPENSER_EVENTS.RETURN,
      );
      if (res.success) {
        append(`회수 완료 · 게이트=${res.data.tokenAtGate}`);
      } else {
        append(`회수 실패 — ${res.cause}`);
        openModal(MODAL_TYPE.DEVICE_ERROR, { cause: res.cause });
      }
    } catch (e) {
      new Logger().error('[데모] 회수 요청 실패', e);
      append('요청 자체가 실패했다 — 백엔드가 떠 있는지 확인');
    } finally {
      setBusy(false);
    }
  };

  return (
    <A11yNode a11yKey={A11Y_KEYS.DEMO_DISPENSER_PAGE}>
      <div className="flex h-full flex-col gap-space-6 px-space-10 pt-space-16">
        <p className="typo-t1-b text-glyph-gray-heading">
          {t('demo.home.dispenser')}
        </p>
        <div className="flex gap-space-4">
          <A11yNode a11yKey={A11Y_KEYS.DEMO_TOKEN_COUNT}>
            <Button
              kind="common"
              hierarchy="secondary"
              size="large"
              className="flex-1 min-w-0"
              onPress={() => openModal(MODAL_TYPE.TOKEN_COUNT_SELECT)}
            >
              {t('demo.dispenser.count', { count: count ?? 1 })}
            </Button>
          </A11yNode>
          <A11yNode a11yKey={A11Y_KEYS.DEMO_DISPENSE}>
            <Button
              kind="accent"
              hierarchy="primary"
              size="large"
              className="flex-1 min-w-0"
              disabled={busy}
              onPress={dispense}
            >
              {t('demo.dispenser.dispense')}
            </Button>
          </A11yNode>
        </div>
        <A11yNode a11yKey={A11Y_KEYS.DEMO_RETURN_TOKEN}>
          <Button
            kind="common"
            hierarchy="secondary"
            size="large"
            className="w-full min-w-0"
            disabled={busy}
            onPress={returnToken}
          >
            {t('demo.dispenser.return')}
          </Button>
        </A11yNode>
        <div className="flex-1 overflow-y-auto rounded-[10px] bg-background-base-elevate p-space-6">
          {log.length === 0 ? (
            <p className="typo-b3-r text-glyph-gray-description">
              {t('demo.dispenser.empty')}
            </p>
          ) : (
            log.map((l) => (
              <p
                key={`${l.at}-${l.text}`}
                className="typo-b3-r text-glyph-gray-body"
              >
                <span className="text-glyph-gray-caption">{l.at}</span> {l.text}
              </p>
            ))
          )}
        </div>
      </div>
    </A11yNode>
  );
};

export default DispenserDemo;
