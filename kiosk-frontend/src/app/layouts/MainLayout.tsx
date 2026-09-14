import { Outlet } from 'react-router-dom';
import { Z_INDEX } from '@/app/constants/zIndex';
import ModalContainer from '@/app/providers/modal/ModalContainer';
import OverlayModalContainer from '@/app/providers/modal/OverlayModalContainer';
import ToastContainer from '@/app/providers/toast/ToastContainer';
import { Header } from '@/shared/components/Header';
import { ModalFlowProvider } from '@/shared/lib/modal/ModalFlowProvider';
import { ModalStateProvider } from '@/shared/lib/modal/ModalStateProvider';
import { ColorScheme, CVS, ThemeColor, VDSProvider } from '@/shared/ui';
import GlobalEffects from '../providers/effects/GlobalEffects';
import IdleWarningContainer from '../providers/idle/IdleWarningContainer';
import KeyboardContainer from '../providers/keyboard/KeyboardContainer';

export const MainLayout = () => {
  // 원본은 업장별 테마를 서버 옵션에서 받아 여기에 물렸다. 그 매핑은 서버 스키마에
  // 묶여 있어 걷어냈고, 기본값만 남긴다 — 프로바이더가 무엇을 받는 자리인지는 그대로 보인다.
  const themeColor = ThemeColor.Normal;
  const preferScheme = ColorScheme.Light;

  return (
    <VDSProvider
      themeColor={themeColor}
      cvsMode={CVS.Normal}
      preferScheme={preferScheme}
    >
      {/* modalState(opener ↔ 모달)는 페이지와 모달 컨테이너 양쪽에서 접근하므로 여기가 최소 공통 조상 */}
      <ModalStateProvider>
        <GlobalEffects />
        <div className="relative w-full h-full overflow-hidden">
          {/* 페이지 배경 레이어 (헤더와 콘텐츠만, Footer 제외) */}
          <div
            id="page-background"
            className="absolute top-0 left-0 right-0 bottom-[var(--safe-bottom-kiosk)]"
          />
          {/* 콘텐츠 레이어 */}
          <div className="relative z-10 flex flex-col h-full">
            <Header />
            {/* 남은 영역을 차지하는 메인 콘텐츠. 아래 Spacer가 커지면 자동으로 줄어듦 */}
            <div className="flex-1 w-full min-h-0 overflow-y-hidden">
              <Outlet />
            </div>
            <KeyboardContainer zIndex={Z_INDEX.keyboard} />
            {/* 키보드 높이만큼 밀어올리는 가변 Spacer */}
            {/* <KeyboardSpacer /> */}
            <div className="h-[calc(var(--safe-bottom-kiosk)+var(--bottom-banner-height))]" />
          </div>
          <ModalFlowProvider>
            <ModalContainer zIndex={Z_INDEX.modal} />
            <OverlayModalContainer zIndex={Z_INDEX.overlayModal} />
          </ModalFlowProvider>
          <ToastContainer zIndex={Z_INDEX.toast} />
          {/* idle 경고는 항상 최상위 — 전용 컨테이너(모달 스토어 미사용)로 모든 레이어 위에 */}
          <IdleWarningContainer zIndex={Z_INDEX.idleWarning} />
        </div>
      </ModalStateProvider>
    </VDSProvider>
  );
};
