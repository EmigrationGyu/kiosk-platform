import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/shared/constants/routes';
import { Button } from '@/shared/ui';

/**
 * 상단 바. 홈에서는 숨는다 — 돌아갈 곳이 없는 화면에 뒤로가기를 두면
 * "눌렀는데 아무 일도 안 일어나는" 버튼이 생긴다.
 */
export const Header = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (pathname === ROUTES.HOME) return <div className="h-space-16" />;

  return (
    <div className="flex h-space-16 items-center px-space-6">
      <Button
        kind="common"
        hierarchy="tertiary"
        size="small"
        onPress={() => navigate(ROUTES.HOME)}
      >
        ← 홈
      </Button>
    </div>
  );
};

export default Header;
