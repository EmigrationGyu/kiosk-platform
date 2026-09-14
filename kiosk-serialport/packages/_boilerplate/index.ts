import { App } from './src/app';

if (import.meta.hot) {
  if (!import.meta.hot.data.app) {
    const app = new App();
    app.start();
    import.meta.hot.data.app = app;
  } else {
    App.reload(import.meta.hot.data.app);
  }

  import.meta.hot.accept();
} else {
  new App().start();
}
