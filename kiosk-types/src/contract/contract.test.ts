import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { NAMESPACES } from '../namespaces';
import { SERIALPORT_PROCESS } from '../serialport/processes';
import { canonicalizePair } from './canonical';
import {
  CONTRACT_TOTAL,
  namespaceContractHash,
  processContractHash,
} from './fingerprint';
import { CONTRACT } from './generated';
import { type ContractHashes, computeContractHashes } from './hash';
import {
  NAMESPACE_SCHEMAS,
  PROCESS_SCHEMAS,
  type SchemaPair,
} from './registry';

/**
 * 계약 지문 박제.
 *
 * 이 지문의 쓸모는 **바뀌면 반드시 움직이고, 안 바뀌면 절대 안 움직인다**는 두 성질뿐이다.
 * 하나라도 깨지면 원격 부분 업데이트의 안전 판정이 통째로 거짓말이 되므로 여기서 고정한다.
 */

const pair = (
  request: Record<string, z.ZodType>,
  response: Record<string, z.ZodType>,
): SchemaPair => ({ request, response });

describe('계약 정규화', () => {
  test('같은 계약은 같은 문자열 — 선언 순서에 무관하다', () => {
    const a = pair(
      { '/x': z.object({ a: z.string(), b: z.number() }) },
      { '/x': z.void() },
    );
    const b = pair(
      { '/x': z.object({ b: z.number(), a: z.string() }) },
      { '/x': z.void() },
    );
    expect(canonicalizePair(a)).toBe(canonicalizePair(b));
  });

  test('필드 타입이 바뀌면 움직인다', () => {
    const before = pair({ '/x': z.object({ a: z.string() }) }, {});
    const after = pair({ '/x': z.object({ a: z.number() }) }, {});
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(after));
  });

  test('필드가 추가되면 움직인다', () => {
    const before = pair({ '/x': z.object({ a: z.string() }) }, {});
    const after = pair(
      { '/x': z.object({ a: z.string(), b: z.string() }) },
      {},
    );
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(after));
  });

  test('필드가 옵셔널로 바뀌면 움직인다', () => {
    const before = pair({ '/x': z.object({ a: z.string() }) }, {});
    const after = pair({ '/x': z.object({ a: z.string().optional() }) }, {});
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(after));
  });

  test('이벤트가 추가·제거되면 움직인다', () => {
    const before = pair({ '/x': z.void() }, {});
    const added = pair({ '/x': z.void(), '/y': z.void() }, {});
    const renamed = pair({ '/z': z.void() }, {});
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(added));
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(renamed));
  });

  test('응답 스키마만 바뀌어도 움직인다', () => {
    const before = pair({}, { '/x': z.object({ ok: z.boolean() }) });
    const after = pair({}, { '/x': z.object({ ok: z.string() }) });
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(after));
  });

  test('enum 값이 바뀌면 움직인다 — 닫힌 집합 확장이 계약 변경으로 잡힌다', () => {
    const before = pair({ '/x': z.enum(['A', 'B']) }, {});
    const after = pair({ '/x': z.enum(['A', 'B', 'C']) }, {});
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(after));
  });

  // ── 순서만 다른 것은 같아야 한다 (불필요한 동시 배포 방지) ──
  test('유니온 멤버 순서는 무관하다', () => {
    const a = pair({ '/x': z.union([z.string(), z.number()]) }, {});
    const b = pair({ '/x': z.union([z.number(), z.string()]) }, {});
    expect(canonicalizePair(a)).toBe(canonicalizePair(b));
  });

  test('enum 값 순서는 무관하다', () => {
    const a = pair({ '/x': z.enum(['A', 'B']) }, {});
    const b = pair({ '/x': z.enum(['B', 'A']) }, {});
    expect(canonicalizePair(a)).toBe(canonicalizePair(b));
  });

  // ── 그러나 순서를 무시해도 멤버 변화는 반드시 잡혀야 한다 ──
  test('유니온 멤버가 바뀌면 움직인다', () => {
    const before = pair({ '/x': z.union([z.string(), z.number()]) }, {});
    const added = pair(
      { '/x': z.union([z.string(), z.number(), z.boolean()]) },
      {},
    );
    const swapped = pair({ '/x': z.union([z.string(), z.boolean()]) }, {});
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(added));
    expect(canonicalizePair(before)).not.toBe(canonicalizePair(swapped));
  });

  test('tuple 순서는 의미이므로 움직인다', () => {
    const a = pair({ '/x': z.tuple([z.string(), z.number()]) }, {});
    const b = pair({ '/x': z.tuple([z.number(), z.string()]) }, {});
    expect(canonicalizePair(a)).not.toBe(canonicalizePair(b));
  });
});

describe('계약 지문', () => {
  test('결정론적이다', () => {
    expect(computeContractHashes()).toEqual(computeContractHashes());
  });

  test('전체 지문은 개별 지문에서 파생된다', () => {
    const { namespaces, processes, total } = computeContractHashes();
    expect(total).toHaveLength(64);
    expect(Object.keys(namespaces).length).toBeGreaterThan(0);
    expect(Object.keys(processes).length).toBeGreaterThan(0);
  });

  test('프론트↔백엔드 합성 지문은 네임스페이스에서만 파생된다 ★', () => {
    // 장치 스키마가 움직여도 이 값은 안 움직여야 한다 — 그래야 무관한 계약 변경이
    // 프론트를 되감게 만들지 않는다. 파생식 자체를 박제해 processes 의존이 스며드는
    // 것을 막는다.
    const { namespaces, frontendBackend } = computeContractHashes();
    const derived = createHash('sha256')
      .update(JSON.stringify(namespaces), 'utf8')
      .digest('hex');
    expect(frontendBackend).toBe(derived);
  });

  test('등록된 모든 스키마가 throw 없이 정규화된다 — zod 업그레이드 가드', () => {
    // 기본 옵션(unrepresentable:'throw')이었다면 z.void 만으로도 72곳이 터진다.
    // zod 를 올린 뒤 이 테스트가 깨지면 정규화 옵션을 다시 봐야 한다는 신호다.
    for (const registry of [NAMESPACE_SCHEMAS, PROCESS_SCHEMAS]) {
      for (const [who, schemas] of Object.entries(registry)) {
        expect(() => canonicalizePair(schemas), who).not.toThrow();
      }
    }
  });

  test('커밋된 contract.json 이 현재 스키마와 일치한다', () => {
    const committed = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', 'contract.json'),
        'utf8',
      ),
    );
    expect(committed).toEqual(computeContractHashes());
  });

  test('생성된 generated.ts 도 같은 값을 들고 있다', () => {
    // 런타임이 읽는 값과 CI/매니페스트가 읽는 값이 갈리면 지문 자체가 거짓말이 된다.
    const generated = CONTRACT as unknown as ContractHashes;
    expect(generated).toEqual(computeContractHashes());
  });

  test('통신 상대별 접근자가 생성값과 일치한다', () => {
    expect(namespaceContractHash(NAMESPACES.IME)).toBe(
      CONTRACT.namespaces[NAMESPACES.IME],
    );
    expect(processContractHash(SERIALPORT_PROCESS.TOKEN_DISPENSER)).toBe(
      CONTRACT.processes[SERIALPORT_PROCESS.TOKEN_DISPENSER],
    );
    expect(CONTRACT_TOTAL).toHaveLength(64);
  });
});

/**
 * 사각지대 트립와이어.
 *
 * `.refine()` 계열은 JSON Schema 에 흔적을 남기지 않아 지문이 **부착 여부조차** 못 잡는다.
 * zod 내부 순회로 감지하는 대신, 소스에서 사용량이 늘어나면 여기서 실패시켜 사람이
 * 판단하게 만든다 — "이 제약은 계약 지문에 안 잡히는데 그래도 괜찮은가?"
 *
 * 늘려야 한다면 기대값을 갱신하되, 그 제약이 통신 상대 간 호환성을 좌우한다면
 * 지문에 담을 방법을 함께 고민해야 한다.
 */
describe('사각지대 트립와이어', () => {
  const INVISIBLE = ['.refine(', '.superRefine(', '.transform(', '.pipe('];
  /**
   * 현재 알려진 사용처 1곳: log 의 `msg||meta` 교차 필드 제약.
   *
   * 받아들이는 근거는 **호환성을 좌우하지 않는다**는 것이다. 지문이 갈린 두 산출물이
   * 만나도 결과는 같고 거절 메시지만 다르다. 늘려야 한다면 기대값을 갱신하되, 그 제약이
   * 통신 상대 간 호환성을 좌우한다면 지문에 담을 방법을 함께 고민해야 한다.
   */
  const KNOWN_COUNT = 1;

  test('계약 스키마의 보이지 않는 제약이 늘어나지 않았다', () => {
    const roots = [
      join(import.meta.dirname, '..', 'events'),
      join(import.meta.dirname, '..', 'serialport'),
    ];
    let found = 0;
    for (const root of roots) {
      for (const file of readdirSync(root)) {
        if (!file.endsWith('.ts') || file.includes('.test.')) continue;
        const source = readFileSync(join(root, file), 'utf8');
        for (const marker of INVISIBLE) {
          found += source.split(marker).length - 1;
        }
      }
    }
    expect(found).toBe(KNOWN_COUNT);
  });
});
