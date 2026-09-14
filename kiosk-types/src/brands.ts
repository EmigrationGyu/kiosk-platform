import { z } from 'zod';

/**
 * 브랜드 태그 레지스트리 — `.brand()` 태그 문자열의 단일 출처(SSOT). 매직 리터럴을 스키마마다
 * 흩뿌리지 않고 여기서 닫힌 집합으로 관리한다. 모든 브랜드 스키마·타입·생성자가 여기서 파생된다.
 */
export const BRAND = {
  BUILDING: 'Building',
  FLOOR: 'Floor',
  ROOM_NO: 'RoomNo',
  LOCK_MAC: 'LockMac',
  APPROVAL_NUMBER: 'ApprovalNumber',
  TRAN_SERIAL_NO: 'TranSerialNo',
  MASKED_CARD_NUMBER: 'MaskedCardNumber',
  MERCHANT_NUMBER: 'MerchantNumber',
  AMOUNT_WON: 'AmountWon',
  NOTE_COUNT: 'NoteCount',
  ISO_KST: 'IsoKst',
} as const;

export type BrandTag = (typeof BRAND)[keyof typeof BRAND];

// ── 객실 좌표 (Tier 1 #3) ──
// 동/층/호가 모두 raw int 라 인자 순서가 한 번 어긋나면 엉뚱한 방 카드가 구워지는 사고 클래스다.
// 값 제약은 int 하나뿐 — 좌표계는 서버가 SSOT 라 상·하한을 스키마가 단정하지 않는다.

export const BuildingSchema = z.number().int().brand<typeof BRAND.BUILDING>();
export const FloorSchema = z.number().int().brand<typeof BRAND.FLOOR>();
export const RoomNoSchema = z.number().int().brand<typeof BRAND.ROOM_NO>();

export type Building = z.infer<typeof BuildingSchema>;
export type Floor = z.infer<typeof FloorSchema>;
export type RoomNo = z.infer<typeof RoomNoSchema>;

/**
 * 비-zod 경계(GraphQL 서버 상태, 하드웨어 디코드 결과)에서 브랜드를 최초 발급하는 생성자. parse 라
 * 이 지점이 곧 int 검증 경계가 된다("경계서 파싱, 내부는 증명"). 프로세스 경계를 이미 통과한 값은
 * 스키마 parse 가 브랜드를 재발급하므로 이 생성자조차 필요 없다.
 */
export const buildingOf = (n: number): Building => BuildingSchema.parse(n);
export const floorOf = (n: number): Floor => FloorSchema.parse(n);
export const roomNoOf = (n: number): RoomNo => RoomNoSchema.parse(n);

/**
 * 도어락 MAC — 위 좌표와 **같은 페이로드에 나란히 실리는 방 식별자**라 같은 사고 클래스다.
 * 좌표와 달리 형식 자체가 계약이라(구분자 없는 12자리 대문자 hex) 브랜드에 regex 를 얹는다.
 * 서버·설정이 구분자를 섞어 줄 수 있으므로 **정규화는 발급 지점(=경계)이 책임진다.**
 */
export const LockMacSchema = z
  .string()
  .regex(/^[0-9A-F]{12}$/)
  .brand<typeof BRAND.LOCK_MAC>();

export type LockMac = z.infer<typeof LockMacSchema>;

/** raw 값을 정규화(구분자 제거 · 대문자)한 뒤 발급한다. 형식이 어긋나면 여기서 throw. */
export const lockMacOf = (raw: string): LockMac =>
  LockMacSchema.parse(raw.replace(/[:\-.\s]/g, '').toUpperCase());

// ── 카드결제 취소 식별자 (Tier 1 #1) ──
// 결제 SUCCESS 응답의 식별자 4종이 전부 raw string 이라, 취소 요청에 되싣을 때 서로 뒤바뀌면
// 런타임(NICE 8418 "조회불가카드")에만 터진다. 값 형식은 단말마다 다르므로 regex 제약 없이
// 브랜드만 씌운다 — 목적은 형식 검증이 아니라 식별자 상호 스왑 봉쇄다.

export const ApprovalNumberSchema = z
  .string()
  .brand<typeof BRAND.APPROVAL_NUMBER>();
/** NICE 에선 거래일련번호(20자리), DaouVP/Kovan 에선 인쇄용 마스킹 카드번호. */
export const TranSerialNoSchema = z
  .string()
  .brand<typeof BRAND.TRAN_SERIAL_NO>();
export const MerchantNumberSchema = z
  .string()
  .brand<typeof BRAND.MERCHANT_NUMBER>();
/**
 * **표시 전용** 마스킹 카드번호 (예: '5525-76**-****-****').
 *
 * `TranSerialNo` 와 갈라 둔 이유: 저건 취소 요청에 되싣는 원거래 식별자고 이건 영수증에 찍는
 * 값이라, 형식이 같아 보여도 되싣으면 NICE 8418 "조회불가카드"로 런타임에만 터진다.
 */
export const MaskedCardNumberSchema = z
  .string()
  .brand<typeof BRAND.MASKED_CARD_NUMBER>();

export type ApprovalNumber = z.infer<typeof ApprovalNumberSchema>;
export type TranSerialNo = z.infer<typeof TranSerialNoSchema>;
export type MerchantNumber = z.infer<typeof MerchantNumberSchema>;
export type MaskedCardNumber = z.infer<typeof MaskedCardNumberSchema>;

/**
 * 단말 응답 전문을 파싱한 raw string 을 브랜드로 발급하는 origin 생성자.
 * 취소 요청으로 되싣는 라운드트립 값은 이미 브랜드라 생성자가 필요 없다.
 */
export const approvalNumberOf = (s: string): ApprovalNumber =>
  ApprovalNumberSchema.parse(s);
export const tranSerialNoOf = (s: string): TranSerialNo =>
  TranSerialNoSchema.parse(s);
export const merchantNumberOf = (s: string): MerchantNumber =>
  MerchantNumberSchema.parse(s);
export const maskedCardNumberOf = (s: string): MaskedCardNumber =>
  MaskedCardNumberSchema.parse(s);

// ── 금액(원) / 지폐 매수 (Tier 1 #2) ──
// 같은 int 가 원(금액)·매수(NoteCount)·개월 등 여러 의미로 한 payload 에 공존한다. 브랜드는
// phantom 이라 런타임 무변경. 응답 필드는 기존이 `z.number()`(int 제약 없음)라 느슨한 base 로
// 브랜딩해 동작을 바꾸지 않고, 요청 필드는 기존 제약을 보존하려 `amountWonMin(n)` 을 쓴다.

export const AmountWonSchema = z.number().brand<typeof BRAND.AMOUNT_WON>();
export type AmountWon = z.infer<typeof AmountWonSchema>;
/** 계산·GraphQL 등 비-parse 경계에서 원 금액을 발급하는 생성자. */
export const wonOf = (n: number): AmountWon => AmountWonSchema.parse(n);
/** 요청 스키마용 — int + 하한 제약을 보존한 채 AmountWon 브랜드 부여. */
export const amountWonMin = (min: number) =>
  z.number().int().min(min).brand<typeof BRAND.AMOUNT_WON>();

export const NoteCountSchema = z
  .number()
  .int()
  .min(0)
  .brand<typeof BRAND.NOTE_COUNT>();
export type NoteCount = z.infer<typeof NoteCountSchema>;
export const noteCountOf = (n: number): NoteCount => NoteCountSchema.parse(n);

// ── 승인일시 (Tier 2) ──
// 단말마다 압축 포맷이 달라(DaouVP/Kovan 14자리, NICE 12자리) raw wire 문자열이 도메인 필드로
// 새면 취소 요청의 원승인일자가 단말마다 다른 의미를 갖는다. 실제로 그렇게 잘려서 VAN 이 원거래를
// 못 찾았다(2026-08-12, DaouVP 1094).
//
// 브랜드는 phantom 이라 소비를 막지는 못한다. 막는 건 **생산**이다 — 평문 string 을 approvedAt 에
// 대입할 수 없게 되어 값을 만드는 경로가 좁혀진다. origin 은 둘: 단말 raw 를 올리는 `kstStampToIso`,
// Date 를 올리는 `dateToKstIso`. 서버 wire 는 형태가 한 가지가 아니라(unix ms·ISO) 프론트의
// `parseWireInstant` 가 Date 로 모은 뒤에야 붙는다.
//
// base 가 느슨한 이유는 `AmountWonSchema` 와 같다: 응답 스키마는 프론트에서 실제로 parse 되므로
// 정규식을 걸면 일시가 깨진 승인이 응답 검증 실패로 튕긴다 — 돈은 나갔는데 결제가 실패로 보인다.

export const IsoKstSchema = z.string().brand<typeof BRAND.ISO_KST>();
export type IsoKst = z.infer<typeof IsoKstSchema>;
