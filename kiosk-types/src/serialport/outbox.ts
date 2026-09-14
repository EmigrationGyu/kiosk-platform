import {
  OUTBOX_EVENTS,
  type OutboxEventMap,
  OutboxResponseSchemas,
  OutboxSchemas,
} from '../events/outbox';

/**
 * 백엔드 ↔ outbox 서브프로세스 계약. 지금은 `events/outbox.ts` 정의를 그대로 빌린다
 * (kovan-cardpayment 가 CARDPAYMENT_EVENTS 를 빌리는 것과 같은 모양).
 * 운영 콘솔이 프론트에서 같은 작업을 부르게 되면 여기가 갈라지는 자리다.
 */
export const OUTBOX_ENDPOINTS = OUTBOX_EVENTS;

export type OutboxEndpoint =
  (typeof OUTBOX_ENDPOINTS)[keyof typeof OUTBOX_ENDPOINTS];

export const OutboxSerialSchemas = OutboxSchemas;
export const OutboxSerialResponseSchemas = OutboxResponseSchemas;
export type OutboxSerialEventMap = OutboxEventMap;
