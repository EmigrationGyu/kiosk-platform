import { Logger } from '@/shared/Logger';
import type { MessageParser } from './types';

/**
 * 프로토콜 기반 파서 베이스 클래스 (template method 패턴).
 *
 * - 버퍼 누적 / drain 루프 / 리스너 관리는 여기서 담당한다.
 * - 실제 프레임 추출 로직(tryExtract)만 하위 클래스에서 구현한다.
 */
export abstract class ProtocolParser implements MessageParser {
  protected buffer = Buffer.alloc(0);
  protected readonly logger = Logger.getInstance();
  private listener: ((message: Buffer) => void) | null = null;

  feed(chunk: Buffer): void {
    this.logger.info('[ProtocolParser] feed()', {
      unmasked: {
        raw: chunk.toString('hex'),
        hasListener: !!this.listener,
        bufferBefore: this.buffer.length,
      },
    });
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  onMessage(callback: (message: Buffer) => void): void {
    if (this.buffer.length > 0) {
      this.logger.warn('[ProtocolParser] onMessage() stale buffer detected', {
        unmasked: {
          len: this.buffer.length,
          hex: this.buffer.toString('hex'),
        },
      });
    }
    this.listener = callback;
    this.drain();
  }

  removeListener(): void {
    this.listener = null;
  }

  reset(): void {
    if (this.buffer.length > 0) {
      this.logger.warn('[ProtocolParser] reset() discarding buffer', {
        unmasked: {
          len: this.buffer.length,
          hex: this.buffer.toString('hex'),
        },
      });
    }
    this.buffer = Buffer.alloc(0);
  }

  private drain(): void {
    while (this.buffer.length > 0 && this.listener) {
      const message = this.tryExtract();
      if (!message) break;
      this.buffer = this.buffer.subarray(message.length);
      this.logger.info('[ProtocolParser] drain()', {
        unmasked: {
          extracted: message.toString('hex'),
          remainingBuffer: this.buffer.length,
        },
      });
      this.listener(Buffer.from(message));
    }
  }

  /**
   * 현재 버퍼에서 완성된 프레임 하나를 추출한다.
   * - 완성 프레임이 있으면 해당 슬라이스를 반환한다.
   * - 아직 데이터가 부족하면 null을 반환한다.
   * - 알 수 없는 바이트는 this.buffer를 직접 앞으로 당겨 건너뛴다.
   */
  protected abstract tryExtract(): Buffer | null;
}
