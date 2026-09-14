import { BaseController } from '@/shared/IPCServer/Controller';
import { withErrorHandler } from '@/shared/IPCServer/errorHandler';
import { createSerialMutex } from '@/shared/IPCServer/serialMutex';
import type { ControllerHandlers } from '@/shared/IPCServer/types';
import { Logger } from '@/shared/Logger';
import { ENDPOINTS, type EndpointsMap } from '../constants/endpoints';
import { SerialPortService } from '../service/SerialPortService';

export class TokenDispenserController extends BaseController<EndpointsMap> {
  private serialPortService = new SerialPortService();
  private logger = Logger.getInstance();
  private withMutex = createSerialMutex('TokenDispenser:Controller');

  constructor() {
    const handlers = {
      [ENDPOINTS.PORT_ASSIGNED]: withErrorHandler(async (req, res) => {
        this.logger.info('[TokenDispenser:Controller] PORT_ASSIGNED', {
          unmasked: {
            portPath: req.portPath,
            serialOptions: JSON.stringify(req.serialOptions),
          },
        });
        await this.withMutex(ENDPOINTS.PORT_ASSIGNED, async () => {
          await this.serialPortService.connect({
            portPath: req.portPath,
            serialOptions: req.serialOptions,
          });
          // getStatus 단발이 아니라 준비 완료까지 대기 — TD-200 RF init 창을 흡수해
          // "PORT_ASSIGNED 완료 == 디바이스 사용가능" 을 보장한다.
          await this.serialPortService.waitUntilReady();
          await this.serialPortService.setCommandFeeding();
        });
        this.logger.info(`[TokenDispenser:Controller] PORT_ASSIGNED done`);
        return res.ok(200);
      }, 'Failed to assign port to token dispenser'),
      // 뮤텍스를 통과시킨다 — 진행 중 매크로 연산(발급 등) 도중에 포트를 빼앗지 않기 위함.
      // 백엔드가 healthCheck 실패를 "장비 사망"으로 오진하는 경로가 있어(ExclusiveDevice
      // 주석 참고), 뮤텍스를 우회하면 토큰에 블록 쓰는 중에 포트가 사라질 수 있다.
      [ENDPOINTS.RELEASE_PORT]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] RELEASE_PORT`);
        await this.withMutex(ENDPOINTS.RELEASE_PORT, () =>
          this.serialPortService.disconnect(),
        );
        this.logger.info(`[TokenDispenser:Controller] RELEASE_PORT done`);
        return res.ok(200);
      }, 'Failed to release port of token dispenser'),
      [ENDPOINTS.HEALTH_CHECK]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] HEALTH_CHECK`);
        const status = await this.withMutex(ENDPOINTS.HEALTH_CHECK, () =>
          this.serialPortService.getStatus(),
        );
        this.logger.info('[TokenDispenser:Controller] HEALTH_CHECK done', {
          unmasked: {
            status: JSON.stringify(status),
          },
        });
        return res.ok(200, status);
      }, 'Failed to health check token dispenser'),
      [ENDPOINTS.DISPENSE_TO_HOLD]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] DISPENSE`);
        const status = await this.withMutex(ENDPOINTS.DISPENSE, () =>
          this.serialPortService.dispenseToHold(),
        );
        this.logger.info(`[TokenDispenser:Controller] DISPENSE done`);
        return res.ok(200, status);
      }, 'Failed to dispense card'),
      [ENDPOINTS.DISPENSE]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] DISPENSE_TO_MOUTH`);
        const status = await this.withMutex(ENDPOINTS.DISPENSE, () =>
          this.serialPortService.dispense(),
        );
        this.logger.info(`[TokenDispenser:Controller] DISPENSE_TO_MOUTH done`);
        return res.ok(200, status);
      }, 'Failed to dispense card to mouth'),
      [ENDPOINTS.RETURN_TOKEN]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] RETURN_TOKEN`);
        const status = await this.withMutex(ENDPOINTS.RETURN_TOKEN, () =>
          this.serialPortService.returnToken(),
        );
        this.logger.info(`[TokenDispenser:Controller] RETURN_TOKEN done`);
        return res.ok(200, status);
      }, 'Failed to recycle card'),
      [ENDPOINTS.COLLECT_TO_HOPPER]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] COLLECT_TO_HOPPER`);
        const status = await this.withMutex(ENDPOINTS.COLLECT_TO_HOPPER, () =>
          this.serialPortService.collectToHopper(),
        );
        this.logger.info(`[TokenDispenser:Controller] COLLECT_TO_HOPPER done`);
        return res.ok(200, status);
      }, 'Failed to collect card to hopper'),
      [ENDPOINTS.SET_COMMAND_FEEDING]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] SET_COMMAND_FEEDING`);
        await this.withMutex(ENDPOINTS.SET_COMMAND_FEEDING, () =>
          this.serialPortService.setCommandFeeding(),
        );
        this.logger.info(
          `[TokenDispenser:Controller] SET_COMMAND_FEEDING done`,
        );
        return res.ok(200);
      }, 'Failed to set command card feeding'),
      [ENDPOINTS.RESET]: withErrorHandler(async (_req, res) => {
        this.logger.info(`[TokenDispenser:Controller] RESET`);
        // 리셋은 **비상 탈출**이다 — 얌전히 줄 서면 의미가 없다.
        // 채널을 되찾기 위해 뮤텍스를 잡기 전에 두 가지를 먼저 한다:
        //   ① emergencyAbort  — 점유 중인 폴링을 200ms 안에 끌어낸다(뮤텍스 해제 유도)
        //   ② purge           — 큐에 갇힌 요청을 전부 거절한다
        // ②가 없으면 큐가 FIFO 라, 리셋보다 먼저 줄 서 있던 요청들이 **리셋보다 앞서**
        // 실행된다 — 방금 중단돼 토큰 위치도 모르는 장비에 대고.
        this.serialPortService.emergencyAbort();
        this.withMutex.purge('device reset requested');
        const status = await this.withMutex(ENDPOINTS.RESET, async () => {
          const s = await this.serialPortService.reset();
          await this.serialPortService.setCommandFeeding();
          return s;
        });
        this.logger.info(`[TokenDispenser:Controller] RESET done`);
        return res.ok(200, status);
      }, 'Failed to reset token dispenser'),
    } satisfies ControllerHandlers<EndpointsMap>;
    super(handlers);
  }
}
