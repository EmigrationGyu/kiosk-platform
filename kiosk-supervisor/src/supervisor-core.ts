// biome-ignore-all lint/suspicious/noConsole: stdout/stderr 가 의도된 로그 전송로 — NSSM 이 supervisor.log 로 캡처.
/**
 * Supervisor Core — "자식 하나를 자동 업데이트 + 감시 + 롤백"하는 제네릭 로직. 같은 로직을 두
 * 계층에서 인스턴스화한다: bootstrap.js → loader.js, loader.js → daemon.js. 둘 다 자식의
 * stdout `@@HB@@` heartbeat 를 감시하고 신버전이면 검증·교체·롤백한다.
 *
 * **오프라인 우선** — 네트워크 없이도 캐시된 자식을 무조건 먼저 실행한다. fetch 실패는 에러가
 * 아니라 정상 오프라인 경로다. 런타임 의존성은 Bun 네이티브 + 웹표준 글로벌뿐(node:* 미사용).
 */

import {
  BUN_PATH,
  FETCH_TIMEOUT_MS,
  HEARTBEAT_LINE_PREFIX,
  HEARTBEAT_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  PUBLIC_KEYS,
  SPAWN_BACKOFF_MS,
} from './constants';
import {
  type Manifest,
  ManifestSchema,
  type NegativeCache,
  NegativeCacheSchema,
} from './types';

export type SupervisorConfig = {
  /** 로그 라벨 = 감시 대상 이름 (예: 'loader', 'daemon'). */
  label: string;
  /** 자식 매니페스트 URL (S3). */
  manifestUrl: string;
  /** 자식 스크립트 절대경로 (예: INSTALL_DIR\daemon.js). */
  childPath: string;
  /** S3 자동 업데이트 활성화. 인프라 준비 전엔 false. */
  enableUpdate: boolean;
};

type Ctx = SupervisorConfig & {
  previousPath: string;
  versionPath: string;
  previousVersionPath: string;
  negativeCachePath: string;
};

type Outcome = 'startup-failed' | 'wedged' | 'exited' | 'update';

type Child = { kill: () => Promise<void>; exited: Promise<number> };

export function makeCtx(config: SupervisorConfig): Ctx {
  // 자식 경로로부터 부속 파일 경로를 파생 (별도 상수 불필요).
  return {
    ...config,
    previousPath: `${config.childPath}.previous`,
    versionPath: `${config.childPath}.version`,
    previousVersionPath: `${config.childPath}.version.previous`,
    negativeCachePath: `${config.childPath}.neg.json`,
  };
}

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

async function readLocalVersion(ctx: Ctx): Promise<string | null> {
  try {
    return (await Bun.file(ctx.versionPath).text()).trim() || null;
  } catch {
    return null;
  }
}

async function readNegativeCache(ctx: Ctx): Promise<NegativeCache> {
  try {
    return NegativeCacheSchema.parse(
      await Bun.file(ctx.negativeCachePath).json(),
    );
  } catch {
    return [];
  }
}

async function addNegativeCache(
  ctx: Ctx,
  version: string,
  reason: string,
): Promise<void> {
  const cache = await readNegativeCache(ctx);
  if (cache.some((e) => e.version === version)) return;
  cache.push({ version, failedAt: new Date().toISOString(), reason });
  await Bun.write(ctx.negativeCachePath, JSON.stringify(cache, null, 2));
}

// 서명 검증 — 웹표준 WebCrypto, 다중 키.
const SIGN_ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer as ArrayBuffer;
}

let cachedKeys: CryptoKey[] | null = null;
async function getPublicKeys(): Promise<CryptoKey[]> {
  if (!cachedKeys) {
    cachedKeys = await Promise.all(
      PUBLIC_KEYS.map((pem) =>
        crypto.subtle.importKey('spki', pemToDer(pem), SIGN_ALGO, false, [
          'verify',
        ]),
      ),
    );
  }
  return cachedKeys;
}

async function verifySignature(
  data: Uint8Array<ArrayBuffer>,
  sig: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  for (const key of await getPublicKeys()) {
    if (await crypto.subtle.verify(SIGN_ALGO.name, key, sig, data)) return true;
  }
  return false;
}

async function fetchOrThrow(url: string): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/** 적용할 신버전이 있으면 manifest, 없거나 도달 불가면 null (오프라인 정상 경로). */
export async function checkForUpdate(ctx: Ctx): Promise<Manifest | null> {
  try {
    const res = await fetchOrThrow(ctx.manifestUrl);
    const manifest = ManifestSchema.parse(await res.json());
    // 버전이 같아도 자식 파일이 사라졌으면 재설치 대상 — .version 단독을 신뢰하지 않음.
    const upToDate = manifest.version === (await readLocalVersion(ctx));
    if (upToDate && (await Bun.file(ctx.childPath).exists())) return null;
    const neg = await readNegativeCache(ctx);
    if (neg.some((e) => e.version === manifest.version)) return null; // 롤백된 버전 재시도 금지
    return manifest;
  } catch (err) {
    console.error(
      `[${ctx.label}] manifest check skipped (offline?):`,
      (err as Error).message,
    );
    return null;
  }
}

/** 자식 + .sig 다운로드 → sha256 무결성 → 서명 검증. 실패 시 throw — 절대 통과 금지. */
async function downloadAndVerify(manifest: Manifest): Promise<Uint8Array> {
  const buf = new Uint8Array(
    await (await fetchOrThrow(manifest.url)).arrayBuffer(),
  );
  const sha = new Bun.CryptoHasher('sha256').update(buf).digest('hex');
  if (sha !== manifest.sha256) {
    throw new Error(`sha256 mismatch: ${sha} != ${manifest.sha256}`);
  }
  const sig = new Uint8Array(
    await (await fetchOrThrow(manifest.sigUrl)).arrayBuffer(),
  );
  if (!(await verifySignature(buf, sig))) {
    throw new Error('signature verification failed');
  }
  return buf;
}

/** 현재 자식 → previous 백업 후 신버전 배치 (자식 미실행 중에만 — 파일 락 회피). */
async function applyUpdate(ctx: Ctx, manifest: Manifest): Promise<void> {
  const verified = await downloadAndVerify(manifest);
  const current = Bun.file(ctx.childPath);
  if (await current.exists()) {
    await Bun.write(ctx.previousPath, current);
    await Bun.write(
      ctx.previousVersionPath,
      (await readLocalVersion(ctx)) ?? '',
    );
  }
  await Bun.write(ctx.childPath, verified);
  await Bun.write(ctx.versionPath, manifest.version);
  console.log(`[${ctx.label}] applied ${manifest.version}`);
}

/** 기동 직후 죽는 버전 → previous 로 복구 + negative-cache 기록. */
async function rollback(
  ctx: Ctx,
  failedVersion: string,
  reason: string,
): Promise<void> {
  const prevFile = Bun.file(ctx.previousPath);
  if (await prevFile.exists()) {
    await Bun.write(ctx.childPath, prevFile);
    const prevVersion = (
      await Bun.file(ctx.previousVersionPath)
        .text()
        .catch(() => '')
    ).trim();
    await Bun.write(ctx.versionPath, prevVersion);
    console.error(
      `[${ctx.label}] rolled back ${failedVersion} → ${prevVersion || 'previous'} (${reason})`,
    );
  } else {
    console.error(
      `[${ctx.label}] rollback requested for ${failedVersion} but no previous (${reason})`,
    );
  }
  await addNegativeCache(ctx, failedVersion, reason);
}

// 현재 실행 중인 자식 — 종료 시그널 수신 시 명시적으로 kill (고아 프로세스 방지).
let currentChild: Child | null = null;

/** 자식 stdout 을 라인 단위로 읽어 heartbeat 를 파싱. 그 외 라인은 로그로 전달. */
async function pumpStdout(
  ctx: Ctx,
  stream: ReadableStream<Uint8Array>,
  onHeartbeat: () => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
      if (line.startsWith(HEARTBEAT_LINE_PREFIX)) onHeartbeat();
      else if (line) console.log(`[${ctx.label}] ${line}`);
      nl = buf.indexOf('\n');
    }
  }
}

function spawnChild(ctx: Ctx, onHeartbeat: () => void): Child {
  const proc = Bun.spawn([BUN_PATH, ctx.childPath], {
    cwd: ctx.childPath.slice(0, ctx.childPath.lastIndexOf('\\')) || undefined,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  pumpStdout(ctx, proc.stdout, onHeartbeat).catch(() => {
    /* stdout 파이프 종료 — 자식 종료 시 정상 */
  });
  const kill = async (): Promise<void> => {
    await Bun.spawn(['taskkill', '/F', '/T', '/PID', String(proc.pid)], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited;
  };
  return { kill, exited: proc.exited };
}

/**
 * 자식 한 세션을 감시. 네 watcher 중 가장 먼저 발생한 것으로 종료:
 *   - 기동 게이트: 30초 내 첫 heartbeat 미수신 → 'startup-failed'
 *   - 워치독: 가동 중 heartbeat 30초 끊김 → 'wedged'
 *   - 프로세스 종료: 첫 heartbeat 전이면 'startup-failed', 후면 'exited'
 *   - 신버전 폴링 적중 → 'update'
 * 종료 시 타이머·폴링(AbortController) 정리, 'exited' 아니면 kill (누수 0).
 */
async function supervise(ctx: Ctx): Promise<Outcome> {
  const ac = new AbortController();
  let gotFirst = false;
  let settled = false;
  let resolveEnd: (o: Outcome) => void = () => {
    /* Promise 실행기에서 주입됨 */
  };
  const ended = new Promise<Outcome>((r) => {
    resolveEnd = r;
  });
  const end = (o: Outcome) => {
    if (!settled) {
      settled = true;
      resolveEnd(o);
    }
  };

  let watchdog = setTimeout(() => end('startup-failed'), HEARTBEAT_TIMEOUT_MS);
  const onHeartbeat = () => {
    gotFirst = true;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => end('wedged'), HEARTBEAT_TIMEOUT_MS);
  };

  const child = spawnChild(ctx, onHeartbeat);
  currentChild = child;
  child.exited.then(() => end(gotFirst ? 'exited' : 'startup-failed'));
  if (ctx.enableUpdate) {
    pollUntilNewVersion(ctx, ac.signal).then((found) => {
      if (found) end('update');
    });
  }

  const outcome = await ended;

  clearTimeout(watchdog);
  ac.abort();
  if (outcome !== 'exited') {
    await child.kill();
    await child.exited;
  }
  currentChild = null;
  return outcome;
}

async function runSession(ctx: Ctx): Promise<Outcome> {
  // 1) best-effort 선업데이트 — 자식 미실행이라 파일 락 없음. 실패해도 캐시로 진행.
  let appliedVersion: string | null = null;
  if (ctx.enableUpdate) {
    const manifest = await checkForUpdate(ctx);
    if (manifest) {
      try {
        await applyUpdate(ctx, manifest);
        appliedVersion = manifest.version;
      } catch (err) {
        console.error(
          `[${ctx.label}] update apply failed, staying on cached:`,
          (err as Error).message,
        );
      }
    }
  }

  // 2) 실행 + 감시 (오프라인이어도 항상 실행)
  const outcome = await supervise(ctx);

  // 3) startup-failed / wedged: 이번 세션에 신버전을 적용했다면 그 버전 의심 → 롤백.
  if (outcome === 'startup-failed' || outcome === 'wedged') {
    if (appliedVersion) await rollback(ctx, appliedVersion, outcome);
    else console.error(`[${ctx.label}] ${outcome}; retrying after backoff`);
  }
  return outcome;
}

/** 신버전 폴링. 발견 시 true. signal abort 시 즉시 false (누수 방지). */
async function pollUntilNewVersion(
  ctx: Ctx,
  signal: AbortSignal,
): Promise<boolean> {
  while (!signal.aborted) {
    // ±10% 지터 — 박스 부팅 동기화로 인한 S3 요청 스파이크 방지.
    const jittered = POLL_INTERVAL_MS * (0.9 + Math.random() * 0.2);
    await delay(jittered, signal);
    if (signal.aborted) return false;
    if (await checkForUpdate(ctx)) return true;
  }
  return false;
}

/** 종료 시그널 수신 시 현재 자식을 kill 한 뒤 종료 (고아 프로세스 방지). */
function installShutdownHandlers(label: string): void {
  const shutdown = async (signal: string) => {
    console.error(`[${label}] ${signal} → killing child and exiting`);
    await currentChild?.kill();
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) {
    process.on(sig, () => shutdown(sig));
  }
}

/** 무한 supervise 루프. 이 프로세스의 메인. */
export async function runSupervisor(config: SupervisorConfig): Promise<void> {
  const ctx = makeCtx(config);
  installShutdownHandlers(ctx.label);
  for (;;) {
    let outcome: Outcome | 'error' = 'error';
    try {
      outcome = await runSession(ctx);
    } catch (err) {
      console.error(`[${ctx.label}] session error:`, err);
    }
    if (outcome !== 'update') await delay(SPAWN_BACKOFF_MS); // 의도된 업데이트는 즉시 교체
  }
}
