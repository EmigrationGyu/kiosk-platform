import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAudioStore } from './core';

// 로컬 HTTP 서버를 테스트 안에서 직접 띄워 core.ts 의 ETag/304/atomic/폴백을
// 검증한다 — 실제 CDN 없이 로직 위험을 닫기 위함.
//
// 본문이 'AUDIO_V1' 이라는 **문자열**인 것에 주목. core.ts 는 바이트를 해석하지
// 않으므로 실제 mp3 가 필요 없다 — 이 테스트가 그 경계를 문서화한다.
describe('createAudioStore (SWR 캐시)', () => {
  let cacheRoot: string;
  let server: ReturnType<typeof Bun.serve>;
  // 서버가 제공하는 현재 클립 상태 — 테스트 도중 교체해 "CDN 파일 변경"을 흉내낸다.
  let state: { body: string; etag: string };

  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  const makeStore = () =>
    createAudioStore({ cacheRoot, baseUrl: `http://localhost:${server.port}` });

  beforeEach(async () => {
    cacheRoot = await mkdtemp(path.join(tmpdir(), 'audio-test-'));
    state = { body: 'AUDIO_V1', etag: '"v1"' };
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname !== '/ko-KR/greeting.mp3') {
          return new Response('not found', { status: 404 });
        }
        if (req.headers.get('if-none-match') === state.etag) {
          return new Response(null, { status: 304 });
        }
        return new Response(state.body, { headers: { etag: state.etag } });
      },
    });
  });

  afterEach(async () => {
    server.stop(true);
    await rm(cacheRoot, { recursive: true, force: true });
  });

  it('콜드 페치 → 200, 바이트 반환 + 캐시/etag 기록, tmp 잔여물 없음', async () => {
    const bytes = await makeStore().getClip('ko-KR', 'greeting');
    expect(decode(bytes)).toBe('AUDIO_V1');

    const files = await readdir(path.join(cacheRoot, 'ko-KR'));
    expect(files).toContain('greeting.mp3');
    expect(files).toContain('greeting.mp3.etag');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('웜 페치 → SWR: 캐시 즉시 반환 (백그라운드 재검증)', async () => {
    const store = makeStore();
    await store.getClip('ko-KR', 'greeting'); // 캐시 적재 (etag 저장)
    const bytes = await store.getClip('ko-KR', 'greeting'); // 캐시 즉시 반환
    expect(decode(bytes)).toBe('AUDIO_V1');
  });

  it('CDN 파일 교체(etag 변경) → SWR: 1회 stale 후 다음부터 새 바이트', async () => {
    const store = makeStore();
    await store.getClip('ko-KR', 'greeting'); // V1 캐시

    state.body = 'AUDIO_V2';
    state.etag = '"v2"';

    // 캐시 히트 → 즉시 stale(V1) 반환 + 백그라운드 재검증(V2 로 캐시 갱신)
    const stale = await store.getClip('ko-KR', 'greeting');
    expect(decode(stale)).toBe('AUDIO_V1');

    await Bun.sleep(100); // 백그라운드 재검증 완료 대기

    const fresh = await store.getClip('ko-KR', 'greeting');
    expect(decode(fresh)).toBe('AUDIO_V2');
  });

  it('네트워크 실패 → 캐시된 사본으로 graceful 폴백', async () => {
    const store = makeStore();
    await store.getClip('ko-KR', 'greeting'); // 캐시 적재
    server.stop(true); // 서버 다운 → 다음 fetch 는 연결 거부

    const bytes = await store.getClip('ko-KR', 'greeting');
    expect(decode(bytes)).toBe('AUDIO_V1');
  });

  it('404 + 캐시 없음 → throw', async () => {
    await expect(makeStore().getClip('en-US', 'missing')).rejects.toThrow();
  });
});
