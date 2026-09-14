/**
 * 신분증 검증 결과 (OCR / Suprema 공통)
 */
export type VerifyResult =
  | {
      type: 'verified';
      name: string;
      identifier: string;
      /**
       * 신분증 사진 — "실제로 인증에 사용된 그 프레임"(OCR 경로는 마스킹본).
       * 새 프레임이 아니라 인증 프레임 자체이므로 저장본이 인증과 동일하다.
       * Suprema 경로는 바이트 전달이 아직(=null), OCR 경로만 채운다.
       */
      idImage: Blob | null;
    }
  // invalid·minor 에 이미지가 없는 것은 우연이 아니다 — 판정 실패·미성년 건은 보관하지도
  // 표시하지도 않는다(조치 A-11). 필드가 없어야 되살아나지 않는다.
  | { type: 'invalid' }
  | { type: 'minor' }
  | {
      type: 'error';
      /**
       * 인식 실패 팝업이 "방금 스캔한 사진"으로 표시하는 프레임. 표시 전용이며
       * 저장하지 않는다 — 세션 메모리와 함께 소멸한다.
       */
      idImage: Blob | null;
    };
