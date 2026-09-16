import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TolgeeLanguage } from 'kiosk-types';
import type { AudioStore } from './types';

type AudioStoreOptions = {
  /** 캐시 루트 디렉토리. 호출부가 주입합니다 (프로덕션 경로는 store.ts). */
  cacheRoot: string;
  /** CDN base URL. 기본값은 env(AUDIO_CDN_BASE_URL). 테스트에서 로컬 서버 주입용. */
  baseUrl?: string;
};

/**
 * (lang, key) → mp3 바이트. **stale-while-revalidate** — 캐시가 있으면 즉시 반환하고
 * ETag 재검증은 백그라운드로 돌린다(재생 무지연). 콜드 캐시만 받아오기를 기다린다.
 * atomic write 로 캐시를 갱신한다.
 *
 * 환경을 모르는 순수 로직입니다 — 환경 의존은 `cacheRoot` 인자 하나로 좁혀집니다.
 */
export function createAudioStore({
  cacheRoot,
  baseUrl = process.env.AUDIO_CDN_BASE_URL ?? '',
}: AudioStoreOptions): AudioStore {
  async function getClip(
    lang: TolgeeLanguage,
    key: string,
  ): Promise<Uint8Array> {
    const url = `${baseUrl}/${lang}/${key}.mp3`;
    const cachePath = path.join(cacheRoot, lang, `${key}.mp3`);
    const etagPath = `${cachePath}.etag`;

    // 캐시 히트 → 즉시 반환 + 백그라운드 ETag 재검증 (stale-while-revalidate).
    // 재생을 네트워크 왕복에 막지 않는다. 음성은 거의 안 바뀌므로 변경 시 "다음 재생부터
    // 신선"으로 충분. 즉시 교체가 필요하면 클립 키 변경으로 cache-bust.
    const cached = await readFile(cachePath).catch(() => null);
    if (cached) {
      revalidate(url, cachePath, etagPath);
      return new Uint8Array(cached);
    }

    // 콜드 캐시 → 받아오기를 기다린다 (폴백 없음).
    return fetchAndCache(url, cachePath, etagPath);
  }

  return { getClip };
}

/**
 * 백그라운드 재검증 (fire-and-forget). 변경됐으면 캐시를 갱신하고, 304/실패는 조용히
 * 무시한다(캐시 유지 → 다음 재생 때 재시도). 호출부는 await 하지 않으므로 throw 금지.
 */
async function revalidate(
  url: string,
  cachePath: string,
  etagPath: string,
): Promise<void> {
  try {
    const cachedEtag = await readFile(etagPath, 'utf8').catch(() => null);
    const res = await fetch(url, {
      headers: cachedEtag ? { 'If-None-Match': cachedEtag } : {},
    });
    if (res.status === 304 || !res.ok) return;
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeAtomic(cachePath, bytes);
    const etag = res.headers.get('etag');
    if (etag) await writeFile(etagPath, etag);
  } catch {
    // 백그라운드 작업 — 실패는 흡수(기존 캐시 유지).
  }
}

/** 콜드 캐시: 받아서 atomic 캐시. 네트워크/HTTP 실패 시 캐시 폴백, 없으면 throw. */
async function fetchAndCache(
  url: string,
  cachePath: string,
  etagPath: string,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return readCacheOrThrow(cachePath, url);
  }
  if (res.ok) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeAtomic(cachePath, bytes);
    const etag = res.headers.get('etag');
    if (etag) await writeFile(etagPath, etag);
    return bytes;
  }
  return readCacheOrThrow(cachePath, url, res.status);
}

/** 캐시된 사본을 반환하고, 없으면 명확한 에러를 던진다. */
async function readCacheOrThrow(
  cachePath: string,
  url: string,
  status?: number,
): Promise<Uint8Array> {
  const cached = await readFile(cachePath).catch(() => null);
  if (cached) {
    return new Uint8Array(cached);
  }
  const suffix = status ? ` (HTTP ${status})` : '';
  throw new Error(`Audio clip unavailable: ${url}${suffix}, no cached copy`);
}

/** temp 파일에 쓴 뒤 rename — 반쯤 받은 파일이 재생되는 일을 막는다. */
async function writeAtomic(
  cachePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, cachePath);
}
