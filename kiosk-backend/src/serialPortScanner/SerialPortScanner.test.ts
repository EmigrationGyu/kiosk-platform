import { describe, expect, mock, test } from 'bun:test';
import { DEVICE_IDS, type DeviceId } from 'src/constant/events/Hardware';
import { SerialPortScanner } from './SerialPortScanner';
import type { DetectionResult, DeviceProbe } from './types';

/**
 * recover() 효과 인터프리터 + single-flight 박제.
 * 결정 코어(deviceBinding)는 자체 테스트로 고정돼 있으므로, 여기서는 효과 배선만
 * 검증한다 — 스텁 probe 로 IPC 를, scanOnce 치환으로 실제 포트 열거를 대체.
 */

const DEVICE = DEVICE_IDS.TOKEN_DISPENSER;

const detection = (portPath: string): DetectionResult => ({
  deviceId: DEVICE,
  portPath,
  serialOptions: { path: portPath, baudRate: 9600, autoOpen: false },
});

/** 앞에서부터 순서대로 소진하고, 이후엔 마지막 outcome 을 반복하는 healthCheck 스텁. */
const healthCheckSeq = (...outcomes: ('ok' | 'fail')[]) => {
  let i = 0;
  return mock(async () => {
    const outcome = outcomes[Math.min(i++, outcomes.length - 1)] ?? 'ok';
    if (outcome === 'fail') throw new Error('subprocess unhealthy');
  });
};

/** private 내부 상태 시딩용 테스트 전용 뷰 — 프로덕션 코드에 seam 을 뚫지 않는다. */
type ScannerInternals = {
  scan: () => Promise<void>;
  scanOnce: (deviceId: string) => Promise<boolean>;
  runPollCycle: () => Promise<void>;
  leases: Map<string, DetectionResult>;
  scanning: boolean;
  pollTimer: unknown;
  pollDelayMs: number;
};
const internalsOf = (scanner: SerialPortScanner): ScannerInternals =>
  scanner as unknown as ScannerInternals;

type Stubs = {
  healthCheck?: ReturnType<typeof healthCheckSeq>;
  onDetected?: ReturnType<typeof mock<(r: DetectionResult) => Promise<void>>>;
  release?: ReturnType<typeof mock<() => Promise<void>>>;
  scanOnce?: ReturnType<typeof mock<() => Promise<boolean>>>;
  lease?: DetectionResult;
};

const setup = (stubs: Stubs) => {
  const scanner = new SerialPortScanner();
  const healthCheck = stubs.healthCheck ?? healthCheckSeq('ok');
  const onDetected =
    stubs.onDetected ?? mock(async (_r: DetectionResult) => undefined);
  const release = stubs.release ?? mock(async () => undefined);
  const probe: DeviceProbe = {
    deviceId: DEVICE,
    handshake: {
      request: Buffer.from([0x00]),
      expect: Buffer.from([0x00]),
      serialOptions: { baudRate: 9600 },
    },
    onDetected,
    healthCheck,
    release,
  };
  scanner.registerProbe(probe);
  const scanOnce = stubs.scanOnce ?? mock(async () => false);
  const internals = internalsOf(scanner);
  internals.scanOnce = scanOnce;
  if (stubs.lease) internals.leases.set(stubs.lease.portPath, stubs.lease);
  return { scanner, internals, healthCheck, onDetected, release, scanOnce };
};

describe('recover — rebind 경로', () => {
  test('lease 가 있으면 스캔 없이 leased port 로 onDetected 를 재발급한다', async () => {
    const { scanner, onDetected, scanOnce } = setup({
      healthCheck: healthCheckSeq('fail'),
      lease: detection('COM3'),
    });

    await scanner.ensureDevice(DEVICE);

    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected.mock.calls[0]?.[0]).toEqual(detection('COM3'));
    expect(scanOnce).not.toHaveBeenCalled();
    expect(scanner.isDeviceClaimed(DEVICE)).toBe(true);
  });

  test('rebind 실패 시 그 lease 를 소거하고 rescan 으로 낙하한다', async () => {
    const onDetected = mock(async (_r: DetectionResult) => {
      throw new Error('device silent after connect');
    });
    const { scanner, internals, scanOnce } = setup({
      healthCheck: healthCheckSeq('fail'),
      onDetected,
      scanOnce: mock(async () => true),
      lease: detection('COM3'),
    });

    await scanner.ensureDevice(DEVICE);

    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(internals.leases.has('COM3')).toBe(false); // stale lease 소거
    expect(scanOnce).toHaveBeenCalledTimes(1);
  });
});

describe('recover — rescan 경로', () => {
  test('재탐지 직전에 서브프로세스가 포트를 놓게 한다 (스캐너가 열 수 있도록)', async () => {
    // rebind 실패 경로에선 서브프로세스가 connect 까지 성공한 채 검증만 실패해 포트를
    // 계속 물고 있다 — 놓게 하지 않으면 뒤이은 스캔이 EBUSY 로 확정 실패한다.
    const order: string[] = [];
    const release = mock<() => Promise<void>>(async () => {
      order.push('release');
    });
    const scanOnce = mock<() => Promise<boolean>>(async () => {
      order.push('scanOnce');
      return true;
    });
    const { scanner } = setup({
      healthCheck: healthCheckSeq('fail'),
      onDetected: mock(async (_r: DetectionResult) => {
        throw new Error('device silent after connect');
      }),
      release,
      scanOnce,
      lease: detection('COM3'),
    });

    await scanner.ensureDevice(DEVICE);

    expect(release).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['release', 'scanOnce']); // 순서가 계약이다
  });

  test('release 가 실패해도 재탐지는 진행한다 — 죽은 프로세스면 OS 가 이미 핸들을 회수했다', async () => {
    const release = mock<() => Promise<void>>(async () => {
      throw new Error('ipc timeout');
    });
    const scanOnce = mock<() => Promise<boolean>>(async () => true);
    const { scanner } = setup({
      healthCheck: healthCheckSeq('fail'),
      release,
      scanOnce,
    });

    await scanner.ensureDevice(DEVICE);

    expect(release).toHaveBeenCalledTimes(1);
    expect(scanOnce).toHaveBeenCalledTimes(1);
  });
});

describe('startPolling — 시작/정지 조건 대칭', () => {
  test('전부 claimed 면 폴링을 켜지 않는다 — 정상 상태의 요청이 전체 스윕을 유발하면 안 된다', () => {
    const { scanner, internals } = setup({ lease: detection('COM3') });
    const scan = mock(async () => undefined);
    internals.scan = scan;

    scanner.startPolling();

    expect(scan).not.toHaveBeenCalled();
    expect(internals.pollTimer).toBeNull();
  });

  test('아직 못 찾은 프로브가 있으면 폴링을 켠다 — 탐지 능력은 그대로다', () => {
    const { scanner, internals } = setup({});
    const scan = mock(async () => undefined);
    internals.scan = scan;

    scanner.startPolling();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(internals.pollTimer).not.toBeNull();

    scanner.stopPolling(); // 타이머 누수 방지
  });
});

describe('폴 간격 백오프', () => {
  /** 예약된 실타이머를 걷어내고 사이클 본문만 직접 돌린다(실시간 대기 없이). */
  const runCycle = async (
    scanner: SerialPortScanner,
    internals: ScannerInternals,
  ) => {
    scanner.stopPolling();
    await internals.runPollCycle();
  };

  test('성과 없는 사이클마다 2배로 벌어지고 5분에서 멈춘다', async () => {
    const { scanner, internals } = setup({});
    internals.scan = mock(async () => undefined); // 아무것도 못 찾는 스캔

    scanner.startPolling(3_000);
    expect(internals.pollDelayMs).toBe(3_000);

    const observed: number[] = [];
    for (let i = 0; i < 10; i++) {
      await runCycle(scanner, internals);
      observed.push(internals.pollDelayMs);
    }
    scanner.stopPolling();

    expect(observed.slice(0, 4)).toEqual([6_000, 12_000, 24_000, 48_000]);
    expect(observed.at(-1)).toBe(5 * 60_000); // 상한에서 멈춘다
  });

  test('새로 잡힌 기기가 있으면 기준값으로 되돌린다 — 부팅 중 순차 기동 구간 보호', async () => {
    const { scanner, internals } = setup({});
    internals.scan = mock(async () => undefined);

    scanner.startPolling(3_000);
    await runCycle(scanner, internals);
    await runCycle(scanner, internals);
    expect(internals.pollDelayMs).toBe(12_000);

    // 이번 사이클에 하나 붙는다. 등록된 프로브(카드키)는 여전히 미탐지라 폴링은 이어진다.
    internals.scan = mock(async () => {
      internals.leases.set('COM9', {
        deviceId: 'device_b' as DeviceId,
        portPath: 'COM9',
        serialOptions: { path: 'COM9', baudRate: 9600, autoOpen: false },
      });
    });
    await runCycle(scanner, internals);
    scanner.stopPolling();

    expect(internals.pollDelayMs).toBe(3_000);
  });

  test('전부 잡히면 재예약하지 않는다 — 체인이 끊긴다', async () => {
    const { scanner, internals } = setup({});
    internals.scan = mock(async () => {
      internals.leases.set('COM3', detection('COM3')); // 등록된 프로브가 이걸로 전부 충족
    });

    scanner.startPolling(3_000);
    await runCycle(scanner, internals);

    expect(internals.pollTimer).toBeNull();
  });
});

describe('recover — await-scan 경로', () => {
  test('진행 중 스캔에 편승 — 끝나길 기다렸다 healthCheck 재확인, 파괴적 rescan 없음', async () => {
    const { scanner, internals, healthCheck, scanOnce } = setup({
      healthCheck: healthCheckSeq('fail', 'ok'),
    });
    internals.scanning = true;
    setTimeout(() => {
      internals.scanning = false;
    }, 30);

    await scanner.ensureDevice(DEVICE);

    expect(healthCheck).toHaveBeenCalledTimes(2);
    expect(scanOnce).not.toHaveBeenCalled();
  });
});

describe('recover — 단념', () => {
  test('rescan 까지 실패하면 unavailable 로 throw 한다', async () => {
    const { scanner } = setup({ healthCheck: healthCheckSeq('fail') });

    await expect(scanner.ensureDevice(DEVICE)).rejects.toThrow(
      `Device ${DEVICE} is not available`,
    );
  });
});

describe('single-flight', () => {
  test('동시 호출자들은 같은 복구에 합류한다 — 복구는 1회만 시작', async () => {
    let releaseRebind!: () => void;
    const rebindGate = new Promise<void>((r) => {
      releaseRebind = r;
    });
    const onDetected = mock(async (_r: DetectionResult) => rebindGate);
    const { scanner, scanOnce } = setup({
      healthCheck: healthCheckSeq('fail'),
      onDetected,
      lease: detection('COM3'),
    });

    const caller1 = scanner.ensureDevice(DEVICE);
    const caller2 = scanner.ensureDevice(DEVICE);
    releaseRebind();
    await Promise.all([caller1, caller2]);

    expect(onDetected).toHaveBeenCalledTimes(1); // 복구 1회를 둘이 공유
    expect(scanOnce).not.toHaveBeenCalled();
  });

  test('복구 실패 후에는 in-flight 가 정리되어 다음 호출이 새 복구를 시작한다', async () => {
    const { scanner, scanOnce } = setup({
      healthCheck: healthCheckSeq('fail'),
    });

    await expect(scanner.ensureDevice(DEVICE)).rejects.toThrow();
    await expect(scanner.ensureDevice(DEVICE)).rejects.toThrow();

    expect(scanOnce).toHaveBeenCalledTimes(2); // 순차 실패 = 복구가 매번 새로 시작됨
  });
});
