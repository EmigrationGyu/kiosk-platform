import { BaseController } from '@/shared/IPCServer/Controller';
import type { ControllerHandlers } from '@/shared/IPCServer/types';
import { ENDPOINTS, type EndpointsMap } from '../constants/endpoints';
import { SerialPortService } from '../service/SerialPortService';

export class DeviceController extends BaseController<EndpointsMap> {
  private serialPortService = new SerialPortService();

  constructor() {
    const handlers = {
      [ENDPOINTS.PORT_ASSIGNED]: async (req, res) => {
        await this.serialPortService.connect({
          portPath: req.portPath,
          serialOptions: req.serialOptions,
        });
        return res.ok(200);
      },
      // 백엔드 스캐너의 재탐지 전제조건 — 이 응답 이후 포트는 스캐너가 열 수 있다.
      // 뮤텍스를 도입했다면 이 핸들러도 반드시 통과시킬 것(진행 중 연산 중간에 포트를 뺏지 않기 위함).
      [ENDPOINTS.RELEASE_PORT]: async (_req, res) => {
        await this.serialPortService.disconnect();
        return res.ok(200);
      },
      [ENDPOINTS.HEALTH_CHECK]: async (_req, res) => {
        await this.serialPortService.healthCheck();
        return res.ok(200);
      },
      // TODO: 추가 핸들러 구현
      // [ENDPOINTS.EXAMPLE_COMMAND]: async (req, res) => {
      //   const result = await this.serialPortService.exampleCommand(req);
      //   return res.ok(200, result);
      // },
    } satisfies ControllerHandlers<EndpointsMap>;
    super(handlers);
  }
}
