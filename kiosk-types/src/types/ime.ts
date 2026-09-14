import { z } from 'zod';
import { TolgeeLanguageSchema } from './i18n';

// IME 변환 엔진(librime) 도메인 공유 타입 — events(FE↔BE)와 serialport(BE↔서브프로세스)의 SSOT.

/**
 * 실패 원인 → 코드. controller 의 withErrorHandler 가 Result.Err 로 싣는다.
 * 정상 조합/후보 조회는 거의 항상 성공하며, 실패는 엔진 준비 문제에 가깝다.
 */
export const IME_ERROR_CODE = {
  UNKNOWN: 4600,
  /** rime init/deploy 미완 — 엔진이 아직 조합을 처리할 수 없음. */
  ENGINE_NOT_READY: 4601,
  /** 해당 언어에 매핑된 스키마가 없음(예: 비-CJK 언어로 호출). */
  SCHEMA_UNAVAILABLE: 4602,
} as const;
export type ImeCause = keyof typeof IME_ERROR_CODE;
export const ImeCauseSchema = z.enum(
  Object.keys(IME_ERROR_CODE) as [ImeCause, ...ImeCause[]],
);

/** 후보 하나. (rime candidate 의 comment 는 현재 미노출 — 필요 시 확장) */
export const ImeCandidateSchema = z.object({ text: z.string() }).strict();
export type ImeCandidate = z.infer<typeof ImeCandidateSchema>;

/**
 * 한 번의 입력(PROCESS_KEY / SELECT_CANDIDATE / CLEAR) 이후의 조합 상태 스냅샷.
 * 세 verb 공통 응답 1-shape. 조합의 ground truth 는 엔진이고 이건 그 투영이다.
 */
export const ImeStateSchema = z
  .object({
    /** 이번 스텝에서 확정되어 TextInput 에 append 할 텍스트. 없으면 "". */
    committedText: z.string(),
    /** 남은 조합 문자열(확정 prefix 포함). 비면 조합 종료. */
    preedit: z.string(),
    /** 현재 후보 목록(가로 스크롤용으로 넉넉히 채운다). */
    candidates: z.array(ImeCandidateSchema),
    /** 하이라이트된 후보의 index. 후보가 없으면 -1. */
    highlightedIndex: z.number().int(),
    /** preedit/candidates 가 남아 조합이 진행 중인지. */
    composing: z.boolean(),
  })
  .strict();
export type ImeState = z.infer<typeof ImeStateSchema>;

/**
 * PROCESS_KEY 요청 — 소프트 키보드가 낸 키 1개를 조합에 append. language 는 매 키에 실어
 * 서브프로세스가 스키마(간체/번체/일본어)를 보장하게 한다(무상태).
 */
export const ImeProcessKeyRequestSchema = z
  .object({
    language: TolgeeLanguageSchema,
    /** 단일 문자. 백스페이스 = '\b', 스페이스 = ' '. */
    key: z.string().length(1),
  })
  .strict();
export type ImeProcessKeyRequest = z.infer<typeof ImeProcessKeyRequestSchema>;

/** SELECT_CANDIDATE 요청 — 후보 절대 index(페이지 무관). 엔진이 확정/전진을 결정. */
export const ImeSelectCandidateRequestSchema = z
  .object({ index: z.number().int().nonnegative() })
  .strict();
export type ImeSelectCandidateRequest = z.infer<
  typeof ImeSelectCandidateRequestSchema
>;

// ── IME 자산 번들 배포 계약 ──
// S3 고정 키 1회 업로드(불변) + "없으면 받기" ensure. 조립 스크립트·백엔드 ensure·마이그레이션이
// 공유하는 단일 진실. 갱신은 객체 덮어쓰기가 아니라 **새 archive 파일명 업로드 + 여기 상수 교체**로
// 앱 릴리즈에 편승한다 — 그래서 CloudFront 무효화가 영원히 불필요하다.

/** 번들이 놓이는 CDN prefix (locales/audios 와 같은 CloudFront). */
export const IME_ASSET_CDN_PREFIX = 'https://assets.example.invalid/ime/v3/';

export const IME_ASSET_BUNDLES = {
  RIME: {
    /** `~/.kiosk` 하위 설치 디렉토리명. */
    dirName: 'rime',
    /** S3 고정 키 파일명(불변 객체 — 갱신 시 새 이름으로). */
    archive: 'rime-data.tar.gz',
    /** 해제 성공 검증용 핵심 파일(번들 루트 기준). */
    keyFile: 'rime.dll',
  },
  MOZC: {
    dirName: 'mozc',
    archive: 'mozc-win64.tar.gz',
    keyFile: 'mozc_server.exe',
  },
} as const;
export type ImeAssetBundle =
  (typeof IME_ASSET_BUNDLES)[keyof typeof IME_ASSET_BUNDLES];

/**
 * ensure 가 해제 완료 시 번들 루트에 남기는 마커 파일명(내용 = 풀린 archive 파일명). escape hatch 용
 * 장부 — 번들을 갱신하게 되면 앱 릴리즈의 1회성 마이그레이션이 이 마커로 구세대를 판별한다.
 * IME 전용이 아니다("없으면 받기"로 프로비저닝되는 모든 번들이 같은 규약) — 그래서 이름에 도메인이 없다.
 */
export const ASSET_MARKER_FILE = '.bundle';

/** ENSURE_ASSETS 응답의 번들 상태(닫힌 집합 — 소비처는 반드시 이 상수로 비교). */
export const IME_ASSET_STATUS = {
  /** 자산이 로컬에 존재 — 즉시 사용 가능. */
  READY: 'ready',
  /** 자산 없음 — 백그라운드 다운로드를 킥했고, 도착하면 엔진이 자가 치유한다. */
  PROVISIONING: 'provisioning',
} as const;
export type ImeAssetStatus =
  (typeof IME_ASSET_STATUS)[keyof typeof IME_ASSET_STATUS];
export const ImeAssetStatusSchema = z.enum(
  Object.values(IME_ASSET_STATUS) as [ImeAssetStatus, ...ImeAssetStatus[]],
);

/** ENSURE_ASSETS 응답 — 번들별 상태(키 = IME_ASSET_BUNDLES.*.dirName). */
export const ImeEnsureAssetsResultSchema = z
  .object({
    [IME_ASSET_BUNDLES.RIME.dirName]: ImeAssetStatusSchema,
    [IME_ASSET_BUNDLES.MOZC.dirName]: ImeAssetStatusSchema,
  })
  .strict();
export type ImeEnsureAssetsResult = z.infer<typeof ImeEnsureAssetsResultSchema>;
