import 'dotenv/config';
import { App } from './src/app';

if (import.meta.hot) {
  if (!import.meta.hot.data.app) {
    const app = new App();
    app.start();
    import.meta.hot.data.app = app;
    console.log('[ready]');
  } else {
    // HMR: App/Router/Channel 인스턴스는 보존, Controller 핸들러만 교체
    App.reload(import.meta.hot.data.app);
  }

  import.meta.hot.accept();
} else {
  const app = new App();
  app.start();
  console.log('[ready]');
}
