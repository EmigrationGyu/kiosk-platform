import { DEVICE_IDS, type DeviceId } from 'src/constant/events/Hardware';
import { LogService } from 'src/service/LogService';
import { resolveAvailability } from './deviceAvailability';
import { tokenDispenserProbe } from './probes/tokenDispenser';
import { SerialPortScanner } from './SerialPortScanner';
import type { DeviceProbe } from './types';

const PROBES: Record<DeviceId, DeviceProbe> = {
  [DEVICE_IDS.TOKEN_DISPENSER]: tokenDispenserProbe,
};

const DEFAULT_SCAN_TIMEOUT = 5000;
const POLL_INTERVAL = 400;

// vite-node --watch 의 in-process HMR 은 backend 모듈 그래프를 재실행하므로, 싱글턴을
// 모듈 스코프 static 으로 잡으면 무관한 파일을 편집해도 instance 가 리셋된다(scanner=null).
// 프론트는 backend HMR 때 재SCAN 을 트리거하지 않아 scanner 가 다시 안 만들어지고,
// 이후 모든 ensureDevice 가 "Scanner not started" 로 실패한다.
// → 싱글턴을 globalThis 에 보존해 모듈 재평가를 넘어 scanner·claimedPorts·폴링 타이머를
//   살린다 (ManagedSerialPort.shared 와 동일 idiom).
// 트레이드오프: SerialPortScanner/probe 로직 자체를 편집하면 보존된 옛 인스턴스가 유지되어
// 변경이 안 먹는다 → 그 경우에만 dev 핫키 [r] 로 재시작.
const SCANNER_BOOTSTRAP_REGISTRY_KEY = '__SERIAL_PORT_SCANNER_BOOTSTRAP__';

export class SerialPortScannerBootstrap {
  private scanner: SerialPortScanner | null = null;

  static getInstance(): SerialPortScannerBootstrap {
    const registry = globalThis as unknown as Record<
      string,
      SerialPortScannerBootstrap | undefined
    >;
    return (registry[SCANNER_BOOTSTRAP_REGISTRY_KEY] ??=
      new SerialPortScannerBootstrap());
  }

  start(deviceIds: DeviceId[]): void {
    if (this.scanner) {
      this.stop();
    }
    const scanner = new SerialPortScanner();

    deviceIds.forEach((deviceId) => {
      scanner.registerProbe(PROBES[deviceId]);
    });

    scanner.startPolling();
    this.scanner = scanner;
  }

  stop(): void {
    this.scanner?.stopPolling();
    this.scanner?.clearProbes();
    this.scanner = null;
  }

  async scanAndWait(
    deviceIds: DeviceId[],
    timeoutMs = DEFAULT_SCAN_TIMEOUT,
  ): Promise<Record<DeviceId, boolean>> {
    // Fast path: 스캐너가 살아있고 모든 장치가 이미 claimed 상태면
    // 전체 스캔(포트 점유 시도) 없이 health check만 수행한다.
    // 프론트 hot reload 시 타임아웃 대기를 방지하기 위한 fast path.
    if (
      this.scanner &&
      deviceIds.every((id) => this.scanner!.isDeviceClaimed(id))
    ) {
      const healthResults = await Promise.allSettled(
        deviceIds.map((id) => this.scanner!.ensureDevice(id)),
      );
      return Object.fromEntries(
        deviceIds.map((id, i) => [
          id,
          healthResults[i]?.status === 'fulfilled',
        ]),
      ) as Record<DeviceId, boolean>;
    }

    // 스캐너가 없으면 새로 생성, 있으면 재사용한다.
    // 기존 스캐너를 파괴하면 이미 정상 연결된 기기의 claimedPorts 정보가
    // 소멸하여 해당 포트를 재ping 하는 race condition이 발생하므로
    // stop()을 호출하지 않는다.
    if (!this.scanner) {
      this.scanner = new SerialPortScanner();
    }

    // 미등록 프로브만 추가한다. registerProbe는 동일 deviceId가 있으면 무시한다.
    deviceIds.forEach((id) => this.scanner!.registerProbe(PROBES[id]));

    // startPolling은 이미 실행 중이거나 찾을 게 없으면 내부에서 early return한다.
    this.scanner.startPolling();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (deviceIds.every((id) => this.scanner!.isDeviceClaimed(id))) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    this.scanner.stopPolling();

    // 판정은 "쥐었나"가 아니라 "답하나"다 — 근거는 resolveAvailability 주석.
    const claimed = new Set(
      deviceIds.filter((id) => this.scanner!.isDeviceClaimed(id)),
    );
    const availability = await resolveAvailability(deviceIds, {
      isClaimed: (id) => claimed.has(id),
      healthCheck: (id) => PROBES[id].healthCheck(),
    });
    // 근거를 셋으로 갈라 남긴다 — "lease 없이 응답"은 세대 교체 직후의 정상 상태라
    // (실측 2026-09-01) 연결 실패와 구별돼 보여야 한다.
    const describe = (id: DeviceId) =>
      claimed.has(id) ? 'lease' : availability[id] ? '응답' : '무응답';
    LogService.getInstance().info('[기기점검]', {
      unmasked: Object.fromEntries(deviceIds.map((id) => [id, describe(id)])),
    });
    return availability;
  }

  async ensureDevice(deviceId: DeviceId): Promise<void> {
    // 부팅 스캔(scanAndWait)에 의존하지 않고 첫 요청에 스캐너를 자가 부트스트랩한다.
    // 서브프로세스 lazy spawn 과 짝 — 단말이 처음 필요해지는 시점에만 스캐너·probe·폴링을
    // 띄운다. (과거엔 scanner 가 null 이면 "Scanner not started" 로 throw 했고, 부팅 스캔이
    // 무조건 먼저 돌아 스캐너를 만들어준다는 숨은 전제에 의존했다.)
    if (!this.scanner) {
      console.log(
        `[ScannerBootstrap] lazy bootstrap scanner on first ensureDevice(${deviceId})`,
      );
      this.scanner = new SerialPortScanner();
    }
    this.scanner.registerProbe(PROBES[deviceId]); // 멱등 — 동일 deviceId 면 무시
    // 아직 못 찾은 프로브가 남아 있을 때만 켜진다 — 전부 claimed 면 no-op 이라,
    // 정상 상태의 요청이 전체 포트 스윕을 유발하지 않는다.
    this.scanner.startPolling();
    return this.scanner.ensureDevice(deviceId);
  }
}
