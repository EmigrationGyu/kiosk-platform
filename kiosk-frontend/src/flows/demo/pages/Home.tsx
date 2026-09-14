import { useTranslate } from '@tolgee/react';
import { A11Y_KEYS } from 'kiosk-types';
import { useNavigate } from 'react-router-dom';
import { A11yNode } from '@/shared/a11y';
import { ROUTES } from '@/shared/constants/routes';
import { usePrewarm } from '@/shared/hooks';
import { Button } from '@/shared/ui';

const ENTRIES = [
  {
    route: ROUTES.IME,
    a11yKey: A11Y_KEYS.DEMO_HOME_IME,
    titleKey: 'demo.home.ime',
    descKey: 'demo.home.ime.desc',
  },
  {
    route: ROUTES.DISPENSER,
    a11yKey: A11Y_KEYS.DEMO_HOME_DISPENSER,
    titleKey: 'demo.home.dispenser',
    descKey: 'demo.home.dispenser.desc',
  },
  {
    route: ROUTES.GLOBAL_UI,
    a11yKey: A11Y_KEYS.DEMO_HOME_GLOBAL_UI,
    titleKey: 'demo.home.globalUi',
    descKey: 'demo.home.globalUi.desc',
  },
  {
    route: ROUTES.UPDATE,
    a11yKey: A11Y_KEYS.DEMO_HOME_UPDATE,
    titleKey: 'demo.home.update',
    descKey: 'demo.home.update.desc',
  },
] as const;

/**
 * 데모 진입.
 *
 * 서브프로세스는 첫 요청에 lazy spawn 되므로, 화면에 들어오는 시점에 미리 깨운다 —
 * 손님이 버튼을 누른 뒤 spawn 을 기다리면 그 지연이 "기계가 느리다"로 읽힌다.
 */
const Home = () => {
  const navigate = useNavigate();
  const { t } = useTranslate();
  usePrewarm(['ime', 'token-dispenser']);

  return (
    <A11yNode a11yKey={A11Y_KEYS.DEMO_HOME_PAGE}>
      <div className="flex h-full flex-col justify-center gap-space-6 px-space-10">
        {ENTRIES.map(({ route, a11yKey, titleKey, descKey }) => (
          <A11yNode key={route} a11yKey={a11yKey}>
            <Button
              kind="common"
              hierarchy="secondary"
              size="large"
              className="w-full min-w-0 flex-col items-start"
              onPress={() => navigate(route)}
            >
              <span className="typo-b1-sb text-glyph-gray-heading">
                {t(titleKey)}
              </span>
              <span className="typo-b3-r text-glyph-gray-description">
                {t(descKey)}
              </span>
            </Button>
          </A11yNode>
        ))}
      </div>
    </A11yNode>
  );
};

export default Home;
