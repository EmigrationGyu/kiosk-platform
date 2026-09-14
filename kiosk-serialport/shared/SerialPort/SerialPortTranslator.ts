import type { TranslationStrategy } from './types';

export class SerialPortTranslator<TReq, TRes> {
  constructor(private readonly strategy: TranslationStrategy<TReq, TRes>) {}

  encode(request: TReq): Buffer {
    return this.strategy.encode(request);
  }

  decode(response: Buffer): TRes {
    return this.strategy.decode(response);
  }
}
