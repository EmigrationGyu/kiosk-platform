import { createHash } from 'node:crypto';
import { canonicalContracts } from './canonical';

/**
 * 계약 지문 계산. **node 전용**이라 루트 배럴에 노출하지 않는다 — types 는 프론트
 * 브라우저 번들에도 들어가므로 crypto 의존이 새면 안 된다. 빌드 스크립트·테스트만
 * 깊은 경로로 직접 import 한다.
 */
export type ContractHashes = {
  algorithm: 'sha256';
  /** 프론트엔드 ↔ 백엔드, 네임스페이스별. */
  namespaces: Record<string, string>;
  /** 백엔드 ↔ serialport, 프로세스별. */
  processes: Record<string, string>;
  /**
   * 프론트엔드 ↔ 백엔드 관계 **전체**의 합성 지문 — 네임스페이스 지문들의 정렬 목록에서
   * 파생한다. 렌더러↔백엔드 일치 판정의 단위: 장치 스키마가 움직여도 이 값은 안 움직여,
   * 무관한 변경이 프론트를 되감게 만들지 않는다.
   */
  frontendBackend: string;
  /** 전체 계약의 단일 지문 — 개별 지문들을 정렬해 다시 해싱한 값. */
  total: string;
};

const sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

export function computeContractHashes(): ContractHashes {
  const { namespaces, processes } = canonicalContracts();

  const hashOf = (source: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(source)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, canonical]) => [key, sha256(canonical)]),
    );

  const namespaceHashes = hashOf(namespaces);
  const processHashes = hashOf(processes);

  // 합성·전체 지문은 개별 지문들의 정렬된 목록에서 파생한다 — 어느 하나라도 움직이면
  // 같이 움직인다. hashOf 가 키를 정렬해 넣으므로 직렬화 순서는 결정적이다.
  const frontendBackend = sha256(JSON.stringify(namespaceHashes));
  const total = sha256(
    JSON.stringify({
      namespaces: namespaceHashes,
      processes: processHashes,
    }),
  );

  return {
    algorithm: 'sha256',
    namespaces: namespaceHashes,
    processes: processHashes,
    frontendBackend,
    total,
  };
}
