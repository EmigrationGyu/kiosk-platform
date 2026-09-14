import type { DeviceId } from 'src/constant/events/Hardware';
import { Mutex } from './Mutex';

// 디바이스 1대 = 물리 채널 1개 = 뮤텍스 1개.
//
// vite-node --watch 의 in-process HMR 이 backend 모듈 그래프를 재실행하므로, 레지스트리를 모듈 스코프
// static 으로 잡으면 무관한 파일 편집만으로 Map 이 비워지고 **락이 조용히 사라진다.** globalThis 에
// 보존해 모듈 재평가를 넘긴다(SerialPortScannerBootstrap 와 동일 idiom).
const DEVICE_MUTEX_REGISTRY_KEY = '__DEVICE_MUTEX_REGISTRY__';

const registry = (): Map<DeviceId, Mutex> => {
  const store = globalThis as unknown as Record<
    string,
    Map<DeviceId, Mutex> | undefined
  >;
  const existing = store[DEVICE_MUTEX_REGISTRY_KEY];
  if (existing) return existing;
  const created = new Map<DeviceId, Mutex>();
  store[DEVICE_MUTEX_REGISTRY_KEY] = created;
  return created;
};

const mutexFor = (deviceId: DeviceId): Mutex => {
  const mutexes = registry();
  const existing = mutexes.get(deviceId);
  if (existing) return existing;
  const created = new Mutex();
  mutexes.set(deviceId, created);
  return created;
};

/**
 * 메서드 전체를 해당 디바이스의 **매크로 연산 1건**으로 직렬화하는 선언적 가드.
 *
 * 서브프로세스의 `createSerialMutex` 는 **엔드포인트 1회 호출**만 잠근다. 그런데 `issueCard` 같은 매크로
 * 연산은 dispenseToRead → writeCardData xN → dispenseCard 처럼 여러 왕복이고 각 왕복은 개별 IPC 라 그
 * 사이가 벌어져 있다. 그 틈으로 다른 시퀀스가 끼어들면 카드에 블록을 쓰는 도중 그 카드가 회수되는 식의
 * 물리적 사고가 난다(2026-07-09: 원격 발급 2건이 겹쳐 writeCardData 사이로 collectToHopper 가 끼어든 실장애).
 *
 * ## `@EnsureDevice` 와 함께 쓸 때 — 순서가 동작을 바꾼다
 *
 * 데코레이터는 아래에서 위로 적용되므로 **위에 있는 것이 호출 시 먼저 실행**된다.
 * `@ExclusiveDevice` 를 반드시 위에 둔다(1. 채널 획득 → 2. health check).
 *
 * 뒤집으면 대기 중인 요청이 **채널을 잡기도 전에** health check 를 쏘고, 그 요청은 앞선 매크로 연산이 붙든
 * 서브프로세스 뮤텍스 뒤에 줄서다 IPC 타임아웃(10s)에 걸린다. `ensureDevice` 는 그걸 "장비 사망"으로 읽고
 * releaseDevice + 재탐지를 돌려 `Device ... is not available` 로 번진다.
 *
 * ## 붙이면 안 되는 메서드
 *
 * - **취소 계열**(`cancelEnterToRead`) — 진행 중 연산이 뮤텍스를 쥔 채 대기하므로 취소가 같은 뮤텍스를
 *   기다리면 영원히 못 깨운다(데드락). 취소는 뮤텍스 밖에서 abort 신호부터 보낸다.
 * - **폴링 계열**(`getStatus`) — 긴 매크로 연산 뒤에 줄서면 호출자 타임아웃만 유발한다.
 *
 * 재진입 불가 — 데코레이트된 메서드끼리 서로 호출하면 데드락이다. 내부에서는 서비스 메서드가 아니라
 * transport 를 직접 부른다.
 */
export function ExclusiveDevice(deviceId: DeviceId) {
  const wrap = (
    original: (this: unknown, ...args: unknown[]) => Promise<unknown>,
    label: string,
  ) =>
    async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const mutex = mutexFor(deviceId);
      if (mutex.isLocked) {
        console.log(
          `[${deviceId}] ${label} waiting — another exclusive operation holds the device`,
        );
      }
      return mutex.runExclusive(() => original.apply(this, args));
    };

  // 데코레이터 규격이 러너마다 갈린다 — Bun 테스트 러너는 legacy(2번째 인자가 키, descriptor 를 반환해야
  // 적용됨), vite/esbuild 프로덕션 빌드는 TC39 stage-3(2번째 인자가 context, 교체 함수를 반환). stage-3 만
  // 구현하면 legacy 쪽에서 **반환한 래퍼가 조용히 버려져 가드가 no-op 이 된다** — 그런데도 7건 중 5건은
  // 그대로 통과한다(실제 직렬화를 요구하는 2건만 빨간불이라 놓치기 쉽다). 2번째 인자 타입으로 갈라 양쪽을
  // 모두 잡는다.
  const impl = (
    target: unknown,
    context: unknown,
    descriptor?: PropertyDescriptor,
  ): unknown => {
    if (typeof context === 'string' || typeof context === 'symbol') {
      const desc =
        descriptor ??
        Object.getOwnPropertyDescriptor(target as object, context);
      if (!desc || typeof desc.value !== 'function') return desc;
      desc.value = wrap(desc.value, String(context));
      return desc;
    }

    return wrap(
      target as (this: unknown, ...args: unknown[]) => Promise<unknown>,
      String((context as ClassMethodDecoratorContext).name),
    );
  };

  return impl as <This, Args extends unknown[], Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Promise<Return>
    >,
  ) => (this: This, ...args: Args) => Promise<Return>;
}
