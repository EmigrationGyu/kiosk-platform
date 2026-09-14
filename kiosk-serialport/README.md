# kiosk-serialport

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.17. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## PORT_ASSIGNED 계약 — 모든 디바이스 패키지 필수

**PORT_ASSIGNED 의 성공 응답 = "디바이스가 이 포트에서 실제로 응답한다"** 여야 한다.
connect(포트 오픈)만으로 성공을 응답하면 안 된다 — COM 포트 오픈은 디바이스 부재와
무관하게 성공한다.

이 계약은 backend 의 **lease rebind** 가 신뢰하는 성공 신호다: idle reaper 가 죽인
서브프로세스를 재스폰할 때 backend 스캐너는 재탐지(스캔) 없이 기억해 둔 포트로
PORT_ASSIGNED 를 재발급하고, 그 응답만으로 "사용 가능"을 판정한다. 계약을 어기면
포트가 재배열된 단말에서 rebind 가 빈 포트에 "성공"해 **재탐지에 영원히 도달하지
못한다** (백엔드 재시작 전까지 복구 불가).

구현 규칙:

1. **connect 후 응답성 검증 왕복 1회 이상** — 보통 `getStatus()` 한 번이면 충분.
   - 검증할 것은 **응답성**(장비가 거기 있는가)이지 건강(fault-free)이 아니다.
     용지 부족 따위로 throw 하는 `healthCheck()` 를 쓰면 소모품 문제로 탐지 자체가
     실패한다 — receipt-printer 컨트롤러 주석 참고.
   - init 창이 있는 디바이스(예: cardkey K750 의 RF 안테나)는 단발 대신 bounded
     재폴링(`waitUntilReady`, cardkey-dispenser 참고)으로 창을 흡수한다.
2. **`PortNotConfiguredError` 는 재시도 금지** — connect 없인 치유 불가능한
   전제조건 위반이다. 재시도 루프(transact 류)가 있다면 이 에러는 즉시 rethrow 한다.
   재시도는 컨트롤러 뮤텍스만 점유해 치유 그 자체인 PORT_ASSIGNED 처리를 지연시킨다.

적용 현황: cardkey-dispenser(waitUntilReady) · cash-dispenser(getStatus) ·
receipt-printer(getStatus). 새 디바이스 패키지(`bun gen bs`)를 만들면 PORT_ASSIGNED
핸들러에 같은 검증을 반드시 추가할 것.

## RELEASE_PORT 계약 — 스캔 대상 디바이스 필수

**RELEASE_PORT 의 성공 응답 = "이 서브프로세스는 더 이상 COM 포트를 쥐고 있지 않다"** 여야
한다. 포트를 안 쥐고 있던 상태에서 호출해도 성공한다(**멱등**).

이 계약은 backend 스캐너의 **재탐지(rescan)** 가 신뢰하는 전제조건이다. 재탐지는 포트를
직접 open 해서 핸드셰이크를 돌리는데, 정상 동작 중인 디바이스의 포트는 이 서브프로세스가
쥐고 있어 스캐너가 열 수 없다(EBUSY). 특히 **rebind 실패 경로**에선 서브프로세스가 connect
까지 성공한 채 응답성 검증만 실패해 포트를 계속 물고 있다 — 이때 포트를 안 놓으면 rescan 이
확정 실패하고, **"실사용은 정상인데 lease 는 영영 못 따는" 흡수 상태**로 굳는다.

구현 규칙:

1. **`ManagedSerialPort.disconnect()` 위임** — 멱등성은 거기서 보장된다. 핸들러에
   `PortNotConfiguredError` 분기를 복제하지 말 것.
2. **뮤텍스가 있는 패키지는 반드시 통과시킬 것** — 백엔드는 healthCheck 실패를 "장비 사망"
   으로 오진할 수 있고(backend `ExclusiveDevice` 주석 참고), 뮤텍스를 우회하면 카드에 블록을
   쓰는 도중 포트가 사라진다. 뮤텍스 뒤에 줄서다 타임아웃 나는 편이 안전하다.
3. **backend `DeviceProbe.release()` 와 짝** — 스캐너 probe 를 만드는 디바이스는 이
   엔드포인트가 없으면 컴파일이 막힌다.

적용 현황: cardkey-dispenser · cash-dispenser · receipt-printer.
