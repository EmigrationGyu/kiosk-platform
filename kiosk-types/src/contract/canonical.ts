import { z } from 'zod';
import {
  NAMESPACE_SCHEMAS,
  PROCESS_SCHEMAS,
  type SchemaPair,
} from './registry';

/**
 * 계약을 **결정론적 바이트열**로 만든다. 해싱은 하지 않는다 — types 는 프론트 브라우저 번들에도
 * 들어가므로 crypto 의존을 두지 않는다. 와이어 형태는 "보내는 쪽이 만들어 받는 쪽이 parse 하는 것"
 * 이므로 request·response 둘 다 `io: 'input'` 이 맞고, `unrepresentable: 'any'` 로 두면 어떤 zod
 * 구성자도 throw 하지 않는다(40종 실측).
 *
 * ── 알려진 사각지대 ──
 * `.refine()`/`.superRefine()` 의 **조건은 물론 부착 여부조차** JSON Schema 에 나타나지 않는다.
 * 즉 교차 필드 제약을 조이거나 푸는 변경은 지문이 못 잡는다 — 와이어 *형태*가 아니라 *수용 범위*의
 * 변경이라 실제 호환성 문제가 될 수 있다. zod 내부를 깊이 순회하면 감지할 수는 있으나 노드 하나를
 * 놓치면 조용히 틀리고 zod 업그레이드마다 깨진다 — 사용량 대비 그 브리틀함이 더 위험하다고 보고
 * **감지하지 않되 증가를 테스트로 막는다**(contract.test.ts 의 트립와이어).
 *
 * brand·custom 은 사각지대가 아니다 — 둘 다 런타임 검증이 동일해 와이어 계약이 실제로 같다.
 */
function schemaToJson(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
}

/**
 * 순서 무관 직렬화 — 선언 순서가 바뀌어도 해시가 흔들리지 않게.
 *
 * 배열은 원칙적으로 순서를 보존한다(tuple 처럼 순서가 의미인 것이 있다). 예외는 `required` 하나 —
 * JSON Schema 에서 집합 의미이고 그 순서는 필드 선언 순서의 부산물일 뿐이라, 정렬하지 않으면 단순
 * 필드 재배치가 계약 변경으로 둔갑한다. 판단 기준은 오류의 비용이다: 해시가 괜히 움직이면 불필요한
 * 동시 업데이트로 끝나지만, 움직여야 할 때 안 움직이면 어긋난 계약이 통과한다.
 */
const ORDER_INSENSITIVE_KEYS = new Set([
  'required', // 객체 필드 선언 순서의 부산물
  'enum', // 허용 값 **집합**
  'anyOf', // 유니온 멤버 — 받아들이는 집합은 순서와 무관
  'oneOf',
  'allOf',
]);
// `prefixItems`(tuple)는 의도적으로 제외한다 — 거기선 순서가 곧 의미다.

function canonicalize(value: unknown, key?: string): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    if (key && ORDER_INSENSITIVE_KEYS.has(key)) items.sort();
    return `[${items.join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v, k)}`).join(',')}}`;
}

/** 한 통신 상대와의 계약을 정규화한 문자열. 이벤트 키 집합도 이 안에 포함된다. */
export function canonicalizePair(pair: SchemaPair): string {
  const shape = {
    request: Object.fromEntries(
      Object.entries(pair.request).map(([event, schema]) => [
        event,
        schemaToJson(schema),
      ]),
    ),
    response: Object.fromEntries(
      Object.entries(pair.response).map(([event, schema]) => [
        event,
        schemaToJson(schema),
      ]),
    ),
  };
  return canonicalize(shape);
}

/** 통신 상대 → 정규화 문자열. 해시는 소비하는 쪽(빌드 스크립트)이 계산한다. */
export function canonicalContracts(): {
  namespaces: Record<string, string>;
  processes: Record<string, string>;
} {
  const namespaces: Record<string, string> = {};
  for (const [ns, pair] of Object.entries(NAMESPACE_SCHEMAS)) {
    namespaces[ns] = canonicalizePair(pair);
  }
  const processes: Record<string, string> = {};
  for (const [proc, pair] of Object.entries(PROCESS_SCHEMAS)) {
    processes[proc] = canonicalizePair(pair);
  }
  return { namespaces, processes };
}
