import { SerialPort } from '@serial/Port';
import type { SerialPortOpenOptions } from 'serialport';
import type { DeviceId } from 'src/constant/events/Hardware';
import {
  type DeviceBinding,
  decideNextStep,
  emptyHistory,
  recordStep,
} from './deviceBinding';
import type { DetectionResult, DeviceProbe } from './types';

const DEFAULT_PING_TIMEOUT = 500;
const DEFAULT_POLL_INTERVAL = 3000;
/**
 * 폴 간격의 상한. 성과 없는 사이클마다 2배씩 벌어져 여기서 멈춘다(3→6→…→300초).
 *
 * 폴링은 미탐지 프로브가 남아 있는 한 멈추지 않는데, 미장착 기기가 있으면 그 상태가 영구다 — 3초
 * 고정이면 무관한 포트(특히 VAN 카드 단말)를 하루 종일 두드린다. 회복 지연은 없다: 요청 시점 복구는
 * `recover` → `scanOnce` 가 폴 타이머와 무관하게 즉시 훑는다.
 */
const MAX_POLL_INTERVAL = 5 * 60_000;
const POLL_BACKOFF_FACTOR = 2;
// 복구가 진행 중인 워밍 스캔(spawn 후 탐지→PORT_ASSIGNED)을 기다리는 상한.
// 서브프로세스의 준비 대기(waitUntilReady, ~5s)보다 넉넉히 커야 정상 워밍이 완료된다.
const SCAN_WAIT_CAP_MS = 8000;
// recovery 스텝의 하드캡. history 가 스텝 반복을 차단하므로 이론상 3~4스텝에 끝나지만,
// 경쟁 스캔이 매번 새 포트 lease 를 공급하는 병리적 시퀀스만 여기서 끊는다.
const MAX_RECOVERY_STEPS = 5;

export class SerialPortScanner {
  private probes: DeviceProbe[] = [];
  // portPath → lease. lease 는 "스캔 결과"가 아니라 서브프로세스 수명과 독립인
  // 포트 소유권이다 — idle reaper 가 프로세스를 죽여도 유지되고, 재스폰 복구는
  // 이 lease 로의 재바인딩(스캔 생략)이 기본 경로다.
  private leases = new Map<string, DetectionResult>();
  // 디바이스당 in-flight 복구 — 동시 호출자는 같은 복구에 합류한다(single-flight).
  private recoveries = new Map<DeviceId, Promise<void>>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** 다음 폴까지의 현재 간격(백오프 상태). */
  private pollDelayMs = DEFAULT_POLL_INTERVAL;
  /** 백오프를 되돌릴 기준값 — startPolling 인자로 정해진다. */
  private basePollDelayMs = DEFAULT_POLL_INTERVAL;
  private scanning = false;

  registerProbe(probe: DeviceProbe): void {
    const { request, expect } = probe.handshake;
    if (Array.isArray(request) && Array.isArray(expect)) {
      if (request.length !== expect.length) {
        throw new Error(
          `[${probe.deviceId}] handshake.request/expect length mismatch: ${request.length} vs ${expect.length}`,
        );
      }
      if (request.length === 0) {
        throw new Error(
          `[${probe.deviceId}] handshake.request/expect must not be empty array`,
        );
      }
    }
    if (!this.probes.some((p) => p.deviceId === probe.deviceId)) {
      this.probes.push(probe);
    }
  }

  clearProbes(): void {
    this.probes = [];
  }

  /**
   * 탐지 폴링을 켠다. **찾을 것이 남아 있을 때만** 켜진다 — `scan()` 이 폴링을 멈추는 조건
   * (`hasUnclaimedProbes`)과 같은 술어를 시작 조건에도 걸어 대칭을 맞춘다.
   *
   * 비대칭이면 이렇게 샌다: 전부 탐지되면 scan() 이 intervalId 를 지우고, 그러면 `if (this.intervalId)
   * return` 가드가 무력해져 **다음 호출이 매번 전체 포트 스윕을 되살린다**. 호출부가 요청 경로에 있어
   * 정상 상태에서 요청 1건당 스윕 1회가 돌았다 — 무관한 포트(VAN 단말)에까지 프로토콜 바이트를 쓴다.
   *
   * 이미 claimed 인 기기의 회복은 폴링 소관이 아니다(scan() 은 leased 포트를 건너뛴다) — recover 담당.
   */
  startPolling(intervalMs: number = DEFAULT_POLL_INTERVAL): void {
    if (this.pollTimer) return;
    if (!this.hasUnclaimedProbes()) return;
    this.basePollDelayMs = intervalMs;
    this.pollDelayMs = intervalMs;
    this.scan();
    this.schedulePoll();
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 다음 폴을 예약한다. setInterval 이 아니라 자기 재예약 체인인 이유는 두 가지다:
   * 간격이 사이클마다 변하고(백오프), 스캔이 간격보다 길어져도 틱이 밀려 쌓이지 않는다.
   */
  private schedulePoll(): void {
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.runPollCycle();
    }, this.pollDelayMs);
  }

  /** 폴 한 사이클 — 스캔 → 다음 간격 결정 → 재예약. 찾을 게 없어지면 체인이 끊긴다. */
  private async runPollCycle(): Promise<void> {
    const claimedBefore = this.claimedDeviceCount();
    await this.scan();
    if (!this.hasUnclaimedProbes()) return;

    // 이번 사이클에 뭔가 새로 붙었으면 아직 기기들이 올라오는 중이다 — 간격을 되돌린다.
    // (부팅 직후 기기마다 준비 시점이 다른 구간을 백오프가 먹어버리지 않게)
    this.pollDelayMs =
      this.claimedDeviceCount() > claimedBefore
        ? this.basePollDelayMs
        : Math.min(this.pollDelayMs * POLL_BACKOFF_FACTOR, MAX_POLL_INTERVAL);
    this.schedulePoll();
  }

  private claimedDeviceCount(): number {
    return new Set([...this.leases.values()].map((l) => l.deviceId)).size;
  }

  releasePort(portPath: string): void {
    this.leases.delete(portPath);
  }

  isDeviceClaimed(deviceId: DeviceId): boolean {
    return [...this.leases.values()].some((l) => l.deviceId === deviceId);
  }

  releaseDevice(deviceId: DeviceId): void {
    for (const [path, lease] of this.leases) {
      if (lease.deviceId === deviceId) {
        this.leases.delete(path);
      }
    }
  }

  /**
   * 헬스체크 → 실패 시 바인딩 복구(deviceBinding 결정 코어가 스텝 선택) → 실패 시 throw.
   * 서비스 레이어에서 논리적 요청 전에 호출한다.
   *
   * 복구는 디바이스당 single-flight — 경쟁 복구가 서로의 lease 를 release 하고 점유된 포트를 재탐지하다
   * EBUSY 로 "없음" 오판을 만들던 레이스가 구조적으로 소멸한다.
   */
  async ensureDevice(deviceId: DeviceId): Promise<void> {
    console.log(`[Scanner] ensureDevice() deviceId=${deviceId}`);
    const probe = this.probes.find((p) => p.deviceId === deviceId);
    if (!probe) throw new Error(`Unknown device: ${deviceId}`);

    try {
      await probe.healthCheck();
      console.log(`[Scanner] ensureDevice() healthCheck passed`);
      return;
    } catch (e) {
      console.error(`[Scanner] ensureDevice() healthCheck failed:`, e);
      // 하위 프로세스가 에러 상태 — 복구 시도
    }

    const inFlight = this.recoveries.get(deviceId);
    if (inFlight) {
      console.log(
        `[Scanner] ensureDevice() joining in-flight recovery for ${deviceId}`,
      );
      return inFlight;
    }
    const recovery = this.recover(probe).finally(() =>
      this.recoveries.delete(deviceId),
    );
    this.recoveries.set(deviceId, recovery);
    return recovery;
  }

  /** 현재 스캐너 상태를 복구 결정의 입력(DeviceBinding)으로 파싱한다. */
  private bindingOf(deviceId: DeviceId): DeviceBinding {
    const lease = [...this.leases.values()].find(
      (l) => l.deviceId === deviceId,
    );
    return lease
      ? { kind: 'leased', lease }
      : { kind: 'unleased', scanInFlight: this.scanning };
  }

  /**
   * deviceBinding 결정 코어의 효과 인터프리터 — 스텝을 하나씩 시도하고,
   * 성공하면 종료, 스텝이 소진되면 unavailable 로 throw 한다.
   */
  private async recover(probe: DeviceProbe): Promise<void> {
    const { deviceId } = probe;
    let history = emptyHistory();

    for (let i = 0; i < MAX_RECOVERY_STEPS; i++) {
      const step = decideNextStep(this.bindingOf(deviceId), history);
      if (!step) break;
      history = recordStep(history, step);

      const recovered =
        step.kind === 'rebind'
          ? await this.tryRebind(probe, step.lease)
          : step.kind === 'await-scan'
            ? await this.tryAwaitScan(probe)
            : await this.tryRescan(probe);
      if (recovered) return;
    }

    throw new Error(`Device ${deviceId} is not available`);
  }

  /**
   * rebind: lease 로 PORT_ASSIGNED 재발급. 실패하면 그 lease 만 소거한다.
   *
   * 실패 시 서브프로세스가 포트를 연 채일 수 있어 후속 rescan 이 EBUSY 를 맞을 수 있다 — 그래도 판정은
   * 진실이다: connect 후 getStatus 에 침묵한 디바이스는 재탐지 핸드셰이크에도 답하지 않는다.
   */
  private async tryRebind(
    probe: DeviceProbe,
    lease: DetectionResult,
  ): Promise<boolean> {
    console.log(
      `[Scanner] recover(${probe.deviceId}) rebinding to leased port ${lease.portPath}`,
    );
    try {
      await probe.onDetected(lease);
      console.log(`[Scanner] recover(${probe.deviceId}) rebind OK`);
      return true;
    } catch (e) {
      console.error(
        `[Scanner] recover(${probe.deviceId}) rebind failed — releasing lease:`,
        e,
      );
      this.releasePort(lease.portPath);
      return false;
    }
  }

  /** await-scan: 진행 중 워밍 스캔에 편승 — 끝나길 기다렸다 헬스체크 재확인. */
  private async tryAwaitScan(probe: DeviceProbe): Promise<boolean> {
    console.log(
      `[Scanner] recover(${probe.deviceId}) scan in-flight — waiting`,
    );
    await this.waitForScanIdle(SCAN_WAIT_CAP_MS);
    try {
      await probe.healthCheck();
      console.log(
        `[Scanner] recover(${probe.deviceId}) ready after in-flight scan`,
      );
      return true;
    } catch (e) {
      console.error(
        `[Scanner] recover(${probe.deviceId}) still failing after in-flight scan:`,
        e,
      );
      return false;
    }
  }

  /**
   * rescan: 파괴적 최후 수단 — lease 를 버리고 포트를 직접 열어 재탐지.
   *
   * false = "이번 패스에서 못 찾음"이지 최종 판정이 아니다 — throw 로 조이지 말 것. releaseDevice 와
   * scanOnce 사이에 백그라운드 폴이 lease 를 새로 만들었으면 scanOnce 는 false 를 돌려주지만, 바깥
   * recover 루프가 bindingOf 를 재평가해 새 lease 로 rebind 를 탄다.
   */
  private async tryRescan(probe: DeviceProbe): Promise<boolean> {
    const { deviceId } = probe;
    console.log(`[Scanner] recover(${deviceId}) re-scanning`);
    this.releaseDevice(deviceId);

    // 재탐지는 포트를 직접 open 하는데 그 포트는 서브프로세스가 쥐고 있다. 특히 rebind 실패 경로에선
    // connect 까지 성공한 채 응답성 검증만 실패해 포트를 계속 물고 있어, 놓게 하지 않으면 아래 스캔이
    // EBUSY 로 전멸한다(그 상태로 굳으면 "동작은 하는데 lease 는 영영 못 따는" 흡수 상태가 된다).
    // 실패해도 스캔은 진행한다 — 프로세스가 죽은 경우엔 OS 가 이미 핸들을 회수했다.
    await probe.release().catch((e) => {
      console.error(`[Scanner] recover(${deviceId}) release failed:`, e);
    });

    if (await this.scanOnce(deviceId)) {
      console.log(`[Scanner] recover(${deviceId}) re-detected`);
      return true;
    }
    console.error(`[Scanner] recover(${deviceId}) not found after re-scan`);
    return false;
  }

  /** 진행 중 스캔이 끝나길(또는 cap 초과) 기다린다. PORT_ASSIGNED 뮤텍스 레이스 방지용. */
  private async waitForScanIdle(capMs: number): Promise<void> {
    const deadline = Date.now() + capMs;
    while (this.scanning && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // 내부 로직

  private async scan(): Promise<void> {
    if (this.scanning || this.probes.length === 0) return;
    this.scanning = true;

    try {
      const ports = await SerialPort.list();
      const unclaimed = ports.filter((p) => !this.leases.has(p.path));
      console.log(
        `[Scanner] scan() found ${ports.length} ports, ${unclaimed.length} unclaimed: ${unclaimed.map((p) => p.path).join(', ')}`,
      );

      await Promise.allSettled(
        unclaimed.map((port) => this.tryProbes(port.path)),
      );
      // 모든 기기가 탐지되었으면 폴링 중지
      if (!this.hasUnclaimedProbes()) {
        console.log(`[Scanner] scan() all devices detected, stopping polling`);
        this.stopPolling();
      }
    } catch (e) {
      console.error(`[Scanner] scan() error:`, e);
      // 스캔 실패는 치명적이지 않음 — 다음 사이클에서 재시도
    } finally {
      this.scanning = false;
    }
  }

  /** 특정 기기에 대해 단일 스캔. 폴링을 일시 중단하고 배타적으로 스캔한 뒤 재개한다. */
  private async scanOnce(deviceId: DeviceId): Promise<boolean> {
    const probe = this.probes.find((p) => p.deviceId === deviceId);
    if (!probe) return false;

    const wasPolling = this.pollTimer !== null;
    this.stopPolling();

    // 진행 중인 스캔이 끝날 때까지 대기
    while (this.scanning) {
      await new Promise((r) => setTimeout(r, 50));
    }

    this.scanning = true;
    try {
      const ports = await SerialPort.list();
      const unclaimed = ports.filter((p) => !this.leases.has(p.path));

      const results = await Promise.all(
        unclaimed.map((port) => this.tryHandshake(port.path, probe)),
      );
      const result = results.find((r) => r !== null);
      if (result) {
        await probe.onDetected(result);
        this.leases.set(result.portPath, result);
        return true;
      }
      return false;
    } finally {
      this.scanning = false;
      if (wasPolling) {
        this.startPolling();
      }
    }
  }

  private hasUnclaimedProbes(): boolean {
    const claimedDevices = new Set(
      [...this.leases.values()].map((l) => l.deviceId),
    );
    return this.probes.some((probe) => !claimedDevices.has(probe.deviceId));
  }

  private async tryProbes(portPath: string): Promise<void> {
    for (const probe of this.probes) {
      const result = await this.tryHandshake(portPath, probe);
      if (result) {
        await probe.onDetected(result);
        this.leases.set(portPath, result);
        return;
      }
    }
  }

  private async tryHandshake(
    portPath: string,
    probe: DeviceProbe,
  ): Promise<DetectionResult | null> {
    console.log(
      `[Scanner] tryHandshake() port=${portPath} device=${probe.deviceId}`,
    );
    const { request, expect, serialOptions, fallbackOptions, timeout } =
      probe.handshake;
    const pingTimeout = timeout ?? DEFAULT_PING_TIMEOUT;

    const requests = Array.isArray(request) ? request : [request];
    const expects = Array.isArray(expect)
      ? expect
      : ([expect] as (Buffer | ((data: Buffer) => boolean))[]);

    const allOptions = [serialOptions, ...(fallbackOptions ?? [])];

    for (const opts of allOptions) {
      const portOptions: SerialPortOpenOptions<unknown> = {
        path: portPath,
        autoOpen: false,
        ...opts,
      };

      const matched = await this.ping(
        portOptions,
        requests,
        expects,
        pingTimeout,
      );
      if (matched) {
        console.log(
          `[Scanner] tryHandshake() SUCCESS port=${portPath} device=${probe.deviceId}`,
        );
        return {
          deviceId: probe.deviceId,
          portPath,
          serialOptions: portOptions,
        };
      }
    }

    console.log(
      `[Scanner] tryHandshake() no match port=${portPath} device=${probe.deviceId}`,
    );
    return null;
  }

  private async ping(
    options: SerialPortOpenOptions<unknown>,
    requests: Buffer[],
    expects: (Buffer | ((data: Buffer) => boolean))[],
    timeout: number,
  ): Promise<boolean> {
    console.log(
      `[Scanner] ping() port=${options.path} stages=${requests.length} timeout=${timeout}`,
    );
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let port: SerialPort;

      try {
        port = new SerialPort(options);
      } catch (e) {
        console.error(
          `[Scanner] ping() failed to create port ${options.path}:`,
          e,
        );
        resolve(false);
        return;
      }

      const settle = async (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          port.removeAllListeners();
          if (port.isOpen) {
            // close 가 실패하면 OS 핸들이 release 되지 않아 다른 프로세스가 같은 포트를 잡을 때
            // EBUSY 가 난다. 콜백의 err 를 명시적으로 받아 트러블슈팅 트레일로 남긴다.
            await new Promise<void>((r) =>
              port.close((err) => {
                if (err) {
                  console.error(
                    `[Scanner] ping() port=${options.path} close error:`,
                    err,
                  );
                }
                r();
              }),
            );
          }
        } catch (e) {
          console.error(
            `[Scanner] ping() port=${options.path} cleanup error:`,
            e,
          );
        }
        console.log(`[Scanner] ping() port=${options.path} result=${result}`);
        resolve(result);
      };

      const timeoutId = setTimeout(() => settle(false), timeout);

      // 다단계 핸드쉐이크 상태머신:
      //   stage = 현재 진행 중인 round-trip 인덱스
      //   inGap = stage 전환 중 (다음 request 송신 대기) — 잔여 데이터 무시
      let stage = 0;
      let inGap = false;
      let rxBuffer = Buffer.alloc(0);

      const isMatch = (
        buf: Buffer,
        e: Buffer | ((data: Buffer) => boolean),
      ): boolean =>
        typeof e === 'function'
          ? e(buf)
          : buf.length >= e.length && buf.subarray(0, e.length).equals(e);

      port.on('data', (data: Buffer) => {
        // 단계 전환 중에 도착한 잔여 데이터는 다음 단계 매칭에 섞이지 않도록 폐기
        if (inGap) {
          console.log(
            `[Scanner] ping() port=${options.path} stage=${stage} (in gap, drop) rx=${data.toString('hex')}`,
          );
          return;
        }

        rxBuffer = Buffer.concat([rxBuffer, data]);
        console.log(
          `[Scanner] ping() port=${options.path} stage=${stage} rx=${data.toString('hex')} accumulated=${rxBuffer.toString('hex')}`,
        );

        if (!isMatch(rxBuffer, expects[stage]!)) return;

        console.log(
          `[Scanner] ping() port=${options.path} stage=${stage} matched`,
        );
        stage++;

        // 모든 단계 통과
        if (stage >= requests.length) {
          settle(true);
          return;
        }

        // 다음 단계 전환: OS RX 버퍼와 software 버퍼를 모두 flush 후 다음 request 송신. 50ms 지연은
        // 직전 응답의 잔여 chunk 가 우리 버퍼로 올라오길 기다려 flush 시점에 같이 비우기 위함.
        inGap = true;
        rxBuffer = Buffer.alloc(0);
        setTimeout(() => {
          if (settled || !port.isOpen) return;
          port.flush((err) => {
            if (err) {
              console.error(
                `[Scanner] ping() port=${options.path} flush error:`,
                err,
              );
            }
            if (settled || !port.isOpen) return;
            const next = requests[stage]!;
            console.log(
              `[Scanner] ping() port=${options.path} stage=${stage} send=${next.toString('hex')}`,
            );
            inGap = false;
            port.write(next);
          });
        }, 50);
      });

      port.open(async (err) => {
        if (err) {
          console.error(
            `[Scanner] ping() port=${options.path} open error:`,
            err,
          );
          settle(false);
          return;
        }
        const first = requests[0]!;
        console.log(
          `[Scanner] ping() port=${options.path} stage=0 send=${first.toString('hex')}`,
        );
        port.write(first);
      });
    });
  }
}
