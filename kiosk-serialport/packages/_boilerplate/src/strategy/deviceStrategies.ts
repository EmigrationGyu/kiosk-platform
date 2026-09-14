import type { TranslationStrategy } from '@/shared/SerialPort/types';

// TODO: 디바이스의 실제 헬스체크 커맨드 바이트로 변경
export const healthCheckStrategy: TranslationStrategy<void, Buffer> = {
  encode: () => Buffer.from([0x00]),
  decode: (buf) => buf,
};

// TODO: 디바이스별 전략 추가
// export const exampleStrategy: TranslationStrategy<ExampleRequest, ExampleResponse> = {
//   encode: (request) => Buffer.from([...]),
//   decode: (buf) => ({ ... }),
// };
