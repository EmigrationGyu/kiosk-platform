import { z } from 'zod';

// TODO: 'your_device'를 실제 디바이스 이름으로 변경 (예: 'cash_dispenser', 'card_reader')
export const ENDPOINTS = {
  PORT_ASSIGNED: '/your_device/port-assigned',
  /** 성공 = 이 서브프로세스가 COM 포트를 쥐고 있지 않음(멱등). README 의 계약 절 참고. */
  RELEASE_PORT: '/your_device/release-port',
  HEALTH_CHECK: '/your_device/health-check',
  // TODO: 디바이스별 엔드포인트 추가
  // EXAMPLE_COMMAND: '/your_device/example-command',
} as const;

export const DeviceSchemas = {
  [ENDPOINTS.PORT_ASSIGNED]: z.object({
    portPath: z.string(),
    serialOptions: z.object({
      baudRate: z.number(),
      dataBits: z.number(),
      stopBits: z.number(),
      parity: z.string(),
    }),
  }),
  [ENDPOINTS.RELEASE_PORT]: z.void(),
  [ENDPOINTS.HEALTH_CHECK]: z.void(),
  // TODO: 추가 엔드포인트의 요청 스키마 정의
  // [ENDPOINTS.EXAMPLE_COMMAND]: z.object({ ... }),
};

export type DeviceRequestMap = {
  [ENDPOINTS.PORT_ASSIGNED]: z.infer<
    (typeof DeviceSchemas)[typeof ENDPOINTS.PORT_ASSIGNED]
  >;
  [ENDPOINTS.RELEASE_PORT]: void;
  [ENDPOINTS.HEALTH_CHECK]: void;
  // TODO: 추가 엔드포인트의 요청 타입 정의
  // [ENDPOINTS.EXAMPLE_COMMAND]: z.infer<(typeof DeviceSchemas)[typeof ENDPOINTS.EXAMPLE_COMMAND]>;
};

export type DeviceResponseMap = {
  [ENDPOINTS.PORT_ASSIGNED]: void;
  [ENDPOINTS.RELEASE_PORT]: void;
  [ENDPOINTS.HEALTH_CHECK]: void;
  // TODO: 추가 엔드포인트의 응답 타입 정의
  // [ENDPOINTS.EXAMPLE_COMMAND]: { result: string };
};

export type EndpointsMap = {
  [E in keyof DeviceRequestMap & keyof DeviceResponseMap]: {
    request: DeviceRequestMap[E];
    response: DeviceResponseMap[E];
  };
};
