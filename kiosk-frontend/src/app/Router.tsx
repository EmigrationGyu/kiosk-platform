import { createHashRouter } from 'react-router-dom';
import DispenserDemo from '@/flows/demo/pages/DispenserDemo';
import GlobalUiDemo from '@/flows/demo/pages/GlobalUiDemo';
import Home from '@/flows/demo/pages/Home';
import ImeDemo from '@/flows/demo/pages/ImeDemo';
import UpdateStatus from '@/flows/demo/pages/UpdateStatus';
import { ROUTES } from '@/shared/constants/routes';
import NotFound from '../pages/NotFound';
import RouteErrorPage from '../pages/RouteErrorPage';
import { MainLayout } from './layouts/MainLayout';

export { ROUTES };

/**
 * 해시 라우터를 쓰는 이유: 패키징된 앱은 `file://` 에서 뜨므로 history API 경로가
 * 새로고침에 살아남지 못한다. 개발 서버에서만 되는 구성을 두면 그 차이가 배포에서 드러난다.
 */
export const router = createHashRouter([
  {
    element: <MainLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: ROUTES.HOME, element: <Home /> },
      { path: ROUTES.IME, element: <ImeDemo /> },
      { path: ROUTES.DISPENSER, element: <DispenserDemo /> },
      { path: ROUTES.GLOBAL_UI, element: <GlobalUiDemo /> },
      { path: ROUTES.UPDATE, element: <UpdateStatus /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
