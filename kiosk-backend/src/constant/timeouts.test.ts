import { describe, expect, test } from 'bun:test';
import { PROCESS_ARCH, PROCESS_ARCH_OF, SERIALPORT_PROCESS } from 'kiosk-types';
import {
  REQUEST_TIMEOUT_MS,
  RUNTIME_DOWNLOAD_TIMEOUT_MS,
  SELF_HOSTED_CONNECT_TIMEOUT_MS,
  SPAWN_CONNECT_TIMEOUT_MS,
  spawnConnectTimeoutMs,
} from './timeouts';

/**
 * 값이 아니라 **감싸는 관계**를 박제한다.
 *
 * 개별 숫자는 언제든 바뀔 수 있고 바뀌어도 된다. 깨지면 안 되는 것은 순서다 — 바깥이
 * 안쪽보다 짧으면 안쪽은 성립할 수 없다. 실제로 다운로드 예산(180s)이 연결 예산(60s)을
 * 넘겨 자기 런타임을 받는 첫 요청이 항상 죽는 상태가 잠깐 있었다.
 */
describe('시간 사다리 — 바깥이 안쪽을 감싼다', () => {
  test('연결 예산이 요청 예산보다 길다', () => {
    expect(SPAWN_CONNECT_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  test('자기 런타임을 받는 자식의 연결 예산이 다운로드를 감싼다', () => {
    expect(SELF_HOSTED_CONNECT_TIMEOUT_MS).toBeGreaterThan(
      RUNTIME_DOWNLOAD_TIMEOUT_MS,
    );
  });
});

describe('spawnConnectTimeoutMs', () => {
  test('호스트 런타임을 쓰는 자식은 기본 연결 예산', () => {
    expect(spawnConnectTimeoutMs(SERIALPORT_PROCESS.TOKEN_DISPENSER)).toBe(
      SPAWN_CONNECT_TIMEOUT_MS,
    );
  });

  test('선언이 바뀌면 예산도 따라간다 — 손으로 목록을 관리하지 않는다', () => {
    // 지금은 self-hosted 프로세스가 없다. 그래도 규칙은 선언에서 파생되므로,
    // 여기서는 "선언과 예산이 어긋나지 않는다"를 전 프로세스에 대해 확인한다.
    for (const process of Object.values(SERIALPORT_PROCESS)) {
      const expected =
        PROCESS_ARCH_OF[process] === PROCESS_ARCH.HOST
          ? SPAWN_CONNECT_TIMEOUT_MS
          : SELF_HOSTED_CONNECT_TIMEOUT_MS;
      expect(spawnConnectTimeoutMs(process)).toBe(expected);
    }
  });
});
