# 가격 계산 서버 단일 공급원화 (searchAvailableRatePlans 마이그레이션)

## 배경

백엔드 GraphQL 명세가 변경되어 가격 모델이 단순화됨:

- `AriRatePlan` / `AriPackage` / `AriRatePlanHistory` 타입 폐기 → `RatePlan` + `RatePlanHistory` + `Price` + `RatePlanCheckTime`
- 가격 계산이 프론트(`dailyBaseRateAmounts` 합산 + `extraPersonCharge` 가산)에서 서버로 이전 — `searchAvailableRatePlans.options[].preview.total` 가 모든 결과를 들고 옴
- `RatePlan.rates` 폐기 → `FolioRatePlanInput.appliedRateId` 도 폐기, transit 인풋이 `ratePlans` → `segments` (range 기반) 으로 바뀜
- `Price.ariPackageId` → `Price.ratePlanId`
- `RatePlanCheckTime` 에 요일별 체크인/체크아웃 시각 14개 필드 (minutes-from-midnight)

24개 codegen error 가 발생, 다운스트림 가격 계산/매칭 로직이 같이 물려있어 한 PR 로 통합 마이그레이션.

## 핵심 전략

**프론트의 가격 산수 0**. `option.preview.total` 을 그대로 표시·박제. transit 시 `amountOverride` 안 보내고 서버 재계산 신뢰.

## 주요 변경

### GraphQL
- 신규: `src/shared/graphql/searchAvailableRatePlans.graphql`
- 삭제: `ariPackages.graphql`, `ariRatePlans.graphql`
- 갱신: `ReservationFragment` (`appliedRatePlan.ratePlanId` 추가, `checkInAt/checkOutAt` 제거, `Price.ariPackageId` → `ratePlanId`), `ariRatePlanForStay` (`AriRatePlan` → `RatePlan`)
- `accommodation.graphql` 의 미사용 `roomTypes.ratePlans` 서브셀렉션 / `roomTypes.graphql` 통째 삭제 (over-fetch 정리)

### walkIn 가격·표시
- `useRoomTypes` 재작성: `useSearchAvailableRatePlansQuery` 로 교체, `calcAmount` / `resolveRatePlan` 제거
- `RoomCard` / `RoomSelect`: `extraPersonCharge` 가산 제거, `preview.total` 직접 사용
- 요일별 체크아웃 시각 추출 헬퍼 신규 (`shared/utils/checkTime.ts` — `pickCheckTimeOnDate`)

### 박제 모델 (`WalkInSelection`)
- 제거: `baseRateId`
- 추가: `roomTypeId`
- `baseRateAmount` 은 RoomSelect 의 `preview.total` 그대로 박제 (display 용, transit 미사용)

### 점유 / transit
- `createEphemeralOccupation` 에 `ratePlanId` 추가 (백엔드 expand 로직 완성 시 transit 의 segments 제거 가능)
- `useMaterializeStay`: `ratePlans` (nights loop) → `segments` (range 1개) 로 교체. `appliedAdjustmentFlat/Multiplier`, `Number()` 캐스트 제거

### check-in 매칭
- `decideCheckInStep`, `useCheckReservationStatus`: `prices.find(p => p.ariPackageId === appliedRatePlan.id)` → `p.ratePlanId === appliedRatePlan.ratePlanId`

## 알려진 미완 작업

- dayuse `duration` 대체 필드 미정 — `MOCK_DAYUSE_DURATION_HOURS = 4` 로 자리 잡아둠 + TODO (`RoomCard.tsx`, `RoomSelect.tsx`)
- 백엔드 "segments 없으면 점유 ratePlan 으로 expand" 로직 완성 시 `useMaterializeStay.ts` 의 segments 블록 제거 (TODO 코멘트 명시)
- `mockRegistry.ts` 의 `searchAvailableRatePlans` / `previewReservationAmount` 시드 — 별도 follow-up

## 검증

- `bun run code-gen` — 0 errors
- `bun run typecheck:strict` — 0 errors
- `bun test` — 186 pass / 1 skip
