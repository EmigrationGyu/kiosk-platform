import { IME_ERROR_CODE } from 'kiosk-types';
import { BaseController } from '@/shared/IPCServer/Controller';
import { withErrorHandler } from '@/shared/IPCServer/errorHandler';
import { createSerialMutex } from '@/shared/IPCServer/serialMutex';
import type { ControllerHandlers } from '@/shared/IPCServer/types';
import { Logger } from '@/shared/Logger';
import { ENDPOINTS, type EndpointsMap } from '../constants/endpoints';
import { ImeError } from '../errors';
import { SerialPortService } from '../service/SerialPortService';

export class ImeController extends BaseController<EndpointsMap> {
  private service = new SerialPortService();
  private logger = Logger.getInstance();
  // 세션 1개를 공유하므로 조합/선택/초기화는 반드시 직렬화한다(응답 혼재·상태 경합 방지).
  private withMutex = createSerialMutex('Ime:Controller');

  constructor() {
    const handlers = {
      // IME 는 시리얼 포트가 없다 — 스캐너 경로로 오지 않지만 계약상 존재. 엔진 준비만 트리거.
      [ENDPOINTS.PORT_ASSIGNED]: withErrorHandler(async (_req, res) => {
        this.logger.info('[진단] port_assigned 수신 → ensureReady');
        const ready = this.service.ensureReady();
        this.logger.info('[진단] port_assigned', {
          unmasked: {
            ensureReady: ready,
          },
        });
        return res.ok(200);
      }, 'Failed to init ime'),

      [ENDPOINTS.HEALTH_CHECK]: withErrorHandler(
        async (_req, res) => {
          const healthy = this.service.healthCheck();
          this.logger.info('[진단] health_check', {
            unmasked: {
              healthy,
            },
          });
          if (!healthy) throw new Error('ime engine not ready');
          return res.ok(200);
        },
        'Failed to health check ime',
        503,
      ),

      [ENDPOINTS.PROCESS_KEY]: withErrorHandler(async (req, res) => {
        try {
          const state = await this.withMutex(ENDPOINTS.PROCESS_KEY, () =>
            this.service.processKey(req),
          );
          // [진단] 후보 미표시 원인 국소화용 — 이 라인이 아예 안 찍히면 요청이 여기까지 안 온 것.
          this.logger.info('[진단] process_key →', {
            unmasked: {
              lang: req.language,
              key: JSON.stringify(req.key),
              preedit: JSON.stringify(state.preedit),
              candidates: state.candidates.length,
              committed: JSON.stringify(state.committedText),
              composing: state.composing,
            },
          });
          return res.ok(200, state);
        } catch (e) {
          if (e instanceof ImeError) {
            return res.error(IME_ERROR_CODE[e.imeCause], e.imeCause);
          }
          throw e;
        }
      }, 'Failed to process ime key'),

      [ENDPOINTS.SELECT_CANDIDATE]: withErrorHandler(async (req, res) => {
        try {
          const state = await this.withMutex(ENDPOINTS.SELECT_CANDIDATE, () =>
            this.service.selectCandidate(req),
          );
          this.logger.info('[진단] select_candidate →', {
            unmasked: {
              index: req.index,
              preedit: JSON.stringify(state.preedit),
              candidates: state.candidates.length,
              committed: JSON.stringify(state.committedText),
              composing: state.composing,
            },
          });
          return res.ok(200, state);
        } catch (e) {
          if (e instanceof ImeError) {
            return res.error(IME_ERROR_CODE[e.imeCause], e.imeCause);
          }
          throw e;
        }
      }, 'Failed to select ime candidate'),

      [ENDPOINTS.CLEAR]: withErrorHandler(async (_req, res) => {
        this.logger.info('[진단] clear 수신 → 조합 초기화');
        const state = await this.withMutex(ENDPOINTS.CLEAR, () =>
          this.service.clear(),
        );
        return res.ok(200, state);
      }, 'Failed to clear ime'),
    } satisfies ControllerHandlers<EndpointsMap>;

    super(handlers);
  }
}
