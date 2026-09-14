import { Transport } from 'transport/Transport';
import type { TokenDispenserEventMap } from '../constants/events/TokenDispenser';
import { TokenDispenserResponseSchemas } from '../constants/events/TokenDispenser';
import { NAMESPACES } from '../constants/Namespaces';

/**
 * 토큰 디스펜서 트랜스포트.
 *
 * 응답 스키마를 들고 있으므로 **경계에서 파싱한다** — 백엔드가 계약을 어기면 화면이 아니라
 * 여기서 터진다. 그 위 화면 코드는 이미 검증된 값만 본다.
 */
export class TokenDispenser extends Transport<TokenDispenserEventMap> {
  private static instance: TokenDispenser | undefined;

  private constructor() {
    super(NAMESPACES.TOKEN_DISPENSER, TokenDispenserResponseSchemas);
  }

  public static getInstance(): TokenDispenser {
    if (!TokenDispenser.instance)
      TokenDispenser.instance = new TokenDispenser();
    return TokenDispenser.instance;
  }
}
