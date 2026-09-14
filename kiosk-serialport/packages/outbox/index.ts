import { SERIALPORT_PROCESS } from 'kiosk-types';
import { logContractFingerprint } from '@/shared/contract/fingerprint';
import { Logger } from '@/shared/Logger';
import { App } from './src/app';

Logger.getInstance(SERIALPORT_PROCESS.OUTBOX);
logContractFingerprint(SERIALPORT_PROCESS.OUTBOX);

if (import.meta.hot) {
  if (!import.meta.hot.data.app) {
    const app = new App();
    app.start();
    import.meta.hot.data.app = app;
    console.log('[ready]');
  } else {
    App.reload(import.meta.hot.data.app);
  }

  import.meta.hot.accept();
} else {
  new App().start();
  console.log('[ready]');
}
