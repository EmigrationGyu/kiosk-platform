import type {
  ArtifactDescriptor,
  ArtifactSurfaces,
  HostKey,
  Target,
} from './types';
import { ARTIFACT_BASE_URL, prefixOf } from './types';
import { newestFirst, passesChannel, passesSurfaces } from './versions';

/**
 * S3 에서 배포 가능한 버전을 읽는다.
 *
 * **배포 가능하다 = `artifact.json` 이 있다.** 버킷에는 그 이전 방식으로 올라간 산출물이
 * 잔뜩 남아 있는데(cash-dispenser 만 75개), 아카이브도 서명도 없어 키오스크가 받을 수
 * 없다. 목록에서 빼는 별도 규칙을 두지 않고 **서술자의 존재 자체를 기준**으로 삼는다.
 */

/** 서술자를 찾으러 몇 개까지 뒤져볼 것인가 — 옛 산출물이 섞여 있어 여유가 필요하다. */
const PROBE_LIMIT = 12;

type Part = { core: number[]; pre: number };

/**
 * 버전 문자열을 **대략** 최신순으로 세우는 비교자 — 후보를 고르는 데만 쓴다.
 *
 * semver 로는 못 푼다: 이 레포는 master 에서 `X.Y+1.0`, develop 에서 `X.Y.Z-N` 을 굽는데,
 * 그러면 `0.24.0-1` 이 `0.24.0` **뒤에** 나온다(semver 는 반대로 본다). 진짜 순서는
 * 서술자의 `bakedAt` 이 쥐고 있고, 그것은 받아봐야 안다.
 */
function parse(version: string): Part {
  const [core, pre] = version.split('-');
  return {
    core: (core ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0),
    pre: pre ? Number.parseInt(pre, 10) || 0 : 0,
  };
}

function likelyNewestFirst(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (
    let at = 0;
    at < Math.max(left.core.length, right.core.length);
    at += 1
  ) {
    const diff = (right.core[at] ?? 0) - (left.core[at] ?? 0);
    if (diff !== 0) return diff;
  }
  return right.pre - left.pre;
}

/** 이 대상 아래 있는 모든 버전 디렉토리 이름. */
export async function listVersions(target: Target): Promise<string[]> {
  const prefix = `${prefixOf(target)}/`;
  const res = await fetch(
    `${ARTIFACT_BASE_URL}/?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=%2F`,
  );
  if (!res.ok) throw new Error(`목록을 읽지 못했습니다 (HTTP ${res.status})`);

  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  return [...xml.getElementsByTagName('Prefix')]
    .map((node) => node.textContent ?? '')
    .filter((value) => value.startsWith(prefix) && value.length > prefix.length)
    .map((value) => value.slice(prefix.length).replace(/\/$/, ''))
    .sort(likelyNewestFirst);
}

/** 서술자. 없으면 null — 옛 산출물이다. */
export async function fetchDescriptor(
  target: Target,
  version: string,
): Promise<ArtifactDescriptor | null> {
  const res = await fetch(
    `${ARTIFACT_BASE_URL}/${prefixOf(target)}/${version}/artifact.json`,
  );
  if (!res.ok) return null;
  try {
    return (await res.json()) as ArtifactDescriptor;
  } catch {
    return null;
  }
}

/**
 * 배포 가능한 버전을 `size` 개 모아 온다.
 *
 * 후보를 최신순으로 훑으며 통과하는 것만 취하고, 모이면 멈춘다 - 컴포넌트당 90여 개를
 * 전부 받지 않기 위해서다. 채널은 **받아보기 전에** 버전 문자열로 거르므로 그만큼
 * 요청이 줄고, 계약은 서술자를 봐야 알 수 있어 받은 뒤에 거른다.
 *
 * 더 뒤져도 안 나오면(옛 산출물만 남았다) 거기서 끝이다.
 */
export async function loadVersions(options: {
  target: Target;
  host: HostKey;
  /** 기준 백엔드의 표면 - 있으면 그것과 말이 통하는 것만 취한다. */
  reference?: ArtifactSurfaces;
  size: number;
  /** 앞의 몇 개를 건너뛸 것인가(더 보기). */
  skip?: number;
}): Promise<{ items: ArtifactDescriptor[]; exhausted: boolean }> {
  const { target, host, reference, size, skip = 0 } = options;

  const candidates = (await listVersions(target)).filter((version) =>
    passesChannel(version, host),
  );

  const items: ArtifactDescriptor[] = [];
  let seen = 0;
  let at = 0;
  let misses = 0;

  while (
    at < candidates.length &&
    items.length < size &&
    misses < PROBE_LIMIT
  ) {
    const version = candidates[at];
    at += 1;
    if (!version) continue;

    const descriptor = await fetchDescriptor(target, version);
    if (!descriptor || !passesSurfaces(descriptor, target, reference)) {
      misses += 1;
      continue;
    }
    misses = 0; // 연속 실패만 센다 - 하나 찾으면 여유를 되돌린다
    seen += 1;
    if (seen > skip) items.push(descriptor);
  }

  items.sort(newestFirst);
  return { items, exhausted: at >= candidates.length || misses >= PROBE_LIMIT };
}
