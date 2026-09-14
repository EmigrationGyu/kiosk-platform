import type { TolgeeLanguage } from 'kiosk-types';

// IME 엔진 교체 seam(카드결제 ICardPaymentTerminal 과 동형).
// rime(중국어) 는 물론 향후 mozc(일본어) 등도 이 인터페이스를 구현한다.
// 경계는 엔진-중립 RawImeContext — 엔진별 입력규약(keysym/스키마/protobuf)은 impl 내부로 격리한다.

/** 엔진이 산출한 조합 상태의 원시 투영(엔진-중립). codec.toImeState 가 계약 ImeState 로 변환. */
export type RawImeContext = {
  /** 조합 중 문자열(없으면 null). */
  preedit: string | null;
  /** 후보 텍스트 목록(가로 스크롤용으로 넉넉히). */
  candidates: readonly string[];
  /** 하이라이트된 후보 index(후보 없으면 -1 로 정규화됨). */
  highlightedIndex: number;
};

/** 엔진 조작 1스텝 결과. */
export type EngineResult = { ctx: RawImeContext; commit: string | null };

export interface ImeEngine {
  /** 이 엔진이 해당 언어 입력을 지원하는지 (rime=중국어 / mozc=일본어 식으로 갈림). */
  supports(language: TolgeeLanguage): boolean;
  /** 엔진 준비(멱등) — init/deploy/라이브러리 로드 등. 실패 시 false. */
  ensureReady(): boolean;
  /** 준비 + 실제 사용 가능 여부. */
  health(): boolean;
  /** 키 1개를 조합에 append. language 로 엔진 내부 설정(스키마/변환옵션)을 정렬한다. */
  processKey(language: TolgeeLanguage, key: string): EngineResult;
  /** 후보 index 선택(확정/전진은 엔진이 결정). */
  selectCandidate(index: number): EngineResult;
  /** 현재 조합 초기화. */
  clear(): void;
}

export const EMPTY_ENGINE_RESULT: EngineResult = {
  ctx: { preedit: null, candidates: [], highlightedIndex: -1 },
  commit: null,
};
