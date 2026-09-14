import { T } from '@tolgee/react';
import { useEffect, useState } from 'react';
import { emitIdleResume } from '@/app/providers/effects/idleResume';
import { AutoFitText } from '@/shared/components/AutoFitText';
import { Modal } from '@/shared/components/Modal';
import { useIdleWarningDeadline } from '@/shared/store/idleStore';
import { Button } from '@/shared/ui';

const remainingSeconds = (deadline: number): number =>
  Math.max(0, Math.ceil((deadline - performance.now()) / 1000));

/**
 * idle 경고 카드(표시 + "계속 사용" dispatch). 모달 스토어를 쓰지 않는 순수 오버레이 콘텐츠 —
 * 배경 dim·센터링·바깥 탭 처리는 IdleWarningContainer 가 담당한다.
 *
 * 카운트다운은 표시-전용: idleStore.warningDeadline(= effect 가 설정한 자동 리셋 시각)과
 * 같은 시계로 남은 초를 계산하므로 effect 의 발화 타이머와 항상 일치한다.
 */
const IdleWarningOverlay = () => {
  const deadline = useIdleWarningDeadline();
  const [seconds, setSeconds] = useState(() =>
    deadline === null ? 0 : remainingSeconds(deadline),
  );

  useEffect(() => {
    if (deadline === null) return;
    setSeconds(remainingSeconds(deadline));
    const timer = setInterval(() => {
      setSeconds(remainingSeconds(deadline));
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);

  return (
    <Modal>
      <div className="flex flex-col gap-space-10 w-[280px] px-space-8 pt-space-6 pb-space-7">
        <div className="flex flex-col gap-space-2">
          <span className="typo-h2-b text-glyph-gray-heading">
            <T>IDLE_WARNING_TITLE</T>
          </span>
          <span className="typo-b3-r text-glyph-gray-description">
            <T params={{ seconds }}>IDLE_WARNING_DESCRIPTION</T>
          </span>
        </div>
        {/* TODO(a11y): idle 경고 a11y 키가 figma 카탈로그에 아직 없음(핸드오프 대기).
            키 확정 시 이 Button 을 A11yNode 로 감싼다(CLAUDE.md 규칙 4). */}
        <Button
          kind="common"
          hierarchy="primary"
          size="large"
          className="w-full min-w-0"
          onPress={emitIdleResume}
        >
          <AutoFitText>
            <T>IDLE_WARNING_CONTINUE</T>
          </AutoFitText>
        </Button>
      </div>
    </Modal>
  );
};

export default IdleWarningOverlay;
