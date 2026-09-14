import { useRouteError } from 'react-router-dom';
import { Logger } from '@/shared/logger/Logger';
import { Button } from '@/shared/ui';

/**
 * 라우트 에러 바운더리.
 *
 * 여기 도달했다는 것은 화면이 통째로 죽었다는 뜻이라, **복구 경로가 평소와 달라야 한다.**
 * 정상 귀가(goHome)는 전역 잠금 가드와 정리 작업을 거치는데 그것들이 바로 지금 못 믿을
 * 상태다 — 그래서 가드를 타지 않는 하드 리로드를 쓴다.
 */
const RouteErrorPage = () => {
  const error = useRouteError();
  new Logger().error('[라우트] 처리되지 않은 오류', error);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-space-6 px-space-10">
      <p className="typo-t1-b text-glyph-gray-heading">문제가 발생했습니다</p>
      <p className="typo-b3-r text-glyph-gray-description text-center">
        화면을 다시 불러옵니다.
      </p>
      <Button
        kind="accent"
        hierarchy="primary"
        size="large"
        className="w-full min-w-0"
        onPress={() => window.location.reload()}
      >
        다시 시도
      </Button>
    </div>
  );
};

export default RouteErrorPage;
