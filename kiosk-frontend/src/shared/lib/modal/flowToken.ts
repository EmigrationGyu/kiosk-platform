declare const __flowTokenType: unique symbol;

/**
 * 모달 플로우 내 공유 상태의 타입을 보증하는 불투명 토큰.
 * 런타임에는 Symbol이지만 컴파일 타임에 T를 phantom type으로 운반한다.
 *
 * @example
 * // src/flows/payment/constants/flowTokens.ts
 * export const PAYMENT_FLOW_TOKEN = createFlowToken<PaymentFlowData>();
 */
export type FlowToken<T> = symbol & {
  readonly [__flowTokenType]: T;
};

export function createFlowToken<T>(): FlowToken<T> {
  return Symbol() as FlowToken<T>;
}
