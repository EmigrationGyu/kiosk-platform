import { ProtocolParser } from '@/shared/SerialPort/ProtocolParser';
import { CONTROL_CHAR } from '../constants/protocol';
import { generateBCC } from './extractData';

/**
 * TD-200 토큰 디스펜서 프로토콜 파서.
 *
 * STX 데이터 프레임 추출 전략:
 * 길이 필드를 신뢰하지 않고, 버퍼를 순회하며 ETX를 직접 탐색한 뒤
 * 체크섬 + 길이 필드를 교차 검증하여 유효한 프레임만 추출한다.
 *
 * - 노이즈/오염 바이트: 스킵 후 다음 유효 패턴 재탐색
 * - 응답 쪼개짐: 버퍼에 계속 누적, 유효 프레임 완성 시 즉시 추출
 * - 타임아웃: 상위(ManagedSerialPort)에서 버퍼 reset 처리
 */
export class TD200ProtocolParser extends ProtocolParser {
  protected tryExtract(): Buffer | null {
    while (this.buffer.length > 0) {
      const first = this.buffer[0];

      // ACK/NAK: 고정 3바이트, 체크섬 없음
      if (first === CONTROL_CHAR.ACK || first === CONTROL_CHAR.NAK) {
        if (this.buffer.length >= 3) {
          return this.buffer.subarray(0, 3);
        }
        return null;
      }

      // STX 데이터 프레임: ETX 직접 탐색 방식
      if (first === CONTROL_CHAR.STX) {
        // 최소 프레임: STX(1) + ADDR(2) + LEN(2) + DATA(≥1) + ETX(1) + BCC(1) = 8
        // ETX 최소 위치: index 6 (DATA가 최소 1바이트일 때)
        for (let i = 6; i < this.buffer.length - 1; i++) {
          if (this.buffer[i] !== CONTROL_CHAR.ETX) continue;

          // STX ~ ETX 구간 발견, BCC까지 포함한 프레임 후보
          const frameEnd = i + 2;
          if (this.buffer.length < frameEnd) return null; // BCC 아직 안 옴

          const candidate = this.buffer.subarray(0, frameEnd);

          // 체크섬 검증
          const bcc = candidate[frameEnd - 1];
          const expectedBcc = generateBCC(candidate.subarray(0, frameEnd - 1));
          if (bcc !== expectedBcc) {
            this.logger.warn(
              '[TD-200Parser] tryExtract() BCC mismatch at ETX',
              {
                unmasked: {
                  index: i,
                  expected: `0x${expectedBcc.toString(16)}`,
                  got: `0x${(bcc ?? 0).toString(16)}`,
                  candidate: candidate.toString('hex'),
                },
              },
            );
            continue;
          }

          // 길이 필드 교차 검증
          const declaredLen = ((candidate[3] ?? 0) << 8) | (candidate[4] ?? 0);
          if (declaredLen !== i - 5) {
            this.logger.warn('[TD-200Parser] tryExtract() length mismatch', {
              unmasked: {
                declaredLen,
                actualDataLen: i - 5,
                candidate: candidate.toString('hex'),
              },
            });
            continue;
          }

          // 유효한 프레임
          return candidate;
        }

        // ETX를 못 찾았거나 BCC가 아직 안 옴 → 다음 chunk 대기
        return null;
      }

      // STX도 ACK/NAK도 아닌 바이트 → 스킵
      this.logger.warn('[TD-200Parser] tryExtract() skipping unknown', {
        unmasked: {
          byte: `0x${first!.toString(16)}`,
          bufferHex: this.buffer
            .subarray(0, Math.min(16, this.buffer.length))
            .toString('hex'),
        },
      });
      this.buffer = this.buffer.subarray(1);
    }
    return null;
  }
}
