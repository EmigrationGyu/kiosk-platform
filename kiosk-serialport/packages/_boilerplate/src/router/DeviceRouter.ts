import { Router } from '@ipc/Router';
import type { EndpointsMap } from '../constants/endpoints';
import { DeviceSchemas } from '../constants/endpoints';

// TODO: 디바이스에 맞는 파이프 경로로 변경
const DEVICE_PIPE_PATH = '\\\\.\\pipe\\kiosk-your-device';

export class DeviceRouter extends Router<EndpointsMap> {
  constructor() {
    super(DEVICE_PIPE_PATH, DeviceSchemas);
  }
}
