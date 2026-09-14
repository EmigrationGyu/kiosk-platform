# 워크플로

빌드/배포 워크플로는 **이 레포에 없다.** 최상위 셸 레포(`kiosk-platform`)에 있다.

## 왜 여기에 없나

모든 패키지가 `kiosk-types` 를 참조하는데, 그 해소가 이 레포 밖에서 일어난다:

- backend·frontend·serialport — `workspace:*` 로 참조. 워크스페이스는 셸 레포에서만 조립된다.
- electron — `../kiosk-types` 라는 **레포 밖 형제 경로**로 참조(tsconfig·vite alias).

즉 어느 레포든 단독 체크아웃으로는 타입체크조차 되지 않는다. 파이프라인이 서브레포에
있으면 "types 를 어떻게든 끌어오는" 우회를 각 레포가 따로 발명하게 되고, 그 우회들이
서로 어긋나면 **같은 소스가 레포마다 다르게 빌드된다.** 그래서 조립 지점 하나에 모았다.

## 어디로 갔나

셸 레포의 `.github/workflows/`:

| 워크플로 | 범위 |
|---|---|
| `release-component.yml` | 컴포넌트 하나만 (부분 업데이트 공급) |
| `release-full.yml` | 전체 + .exe |
| `release-electron-only.yml` | S3 최신 산출물로 .exe 만 |

## 여기 남는 것

`claude-review.yml` — PR 리뷰. types 가 필요 없으므로 레포 안에서 성립한다.
