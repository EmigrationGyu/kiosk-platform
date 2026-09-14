import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import { LANGUAGES } from 'kiosk-types';
import { Logger } from '@/shared/Logger';
import { MozcEngine } from '../engine/mozc/MozcEngine';
import { resolveRimePaths } from '../engine/rime/paths';
import { ImeError } from '../errors';
import { SerialPortService } from './SerialPortService';

// 실제 엔진을 물리는 통합 테스트. 자산이 있어야 실행되고 없으면(CI 등) 블록별 skip:
// - rime: rime.dll(기본 ~/.kiosk/rime, 또는 env RIME_DATA_PATH)
// - mozc: mozc_server 기동 상태(dev=MSI prelauncher, 파이프 ping 으로 판별)
const HAS_DLL = fs.existsSync(resolveRimePaths().dllPath);

Logger.getInstance('test');

// 서비스와 같은 shared 인스턴스로 프로브 — 성공 시 엔진 워밍까지 겸한다.
const HAS_MOZC = MozcEngine.shared(() => new MozcEngine()).ensureReady();

const svc = new SerialPortService();

const CN = LANGUAGES.CN;
const TW = LANGUAGES.TW;
const JA = LANGUAGES.JA;

/** 유저가 병음 단어를 한 글자씩 치는 것을 시뮬레이션(clear 후 시작). 마지막 상태 반환. */
async function typeWord(language: string, word: string) {
  let state = await svc.clear();
  for (const ch of word) {
    state = await svc.processKey({ language: language as never, key: ch });
  }
  return state;
}

/** clear 없이 현재 조합에 이어서 한 글자씩 타이핑. 마지막 상태 반환. */
async function typeChars(language: string, chars: string) {
  let state!: Awaited<ReturnType<SerialPortService['processKey']>>;
  for (const ch of chars) {
    state = await svc.processKey({ language: language as never, key: ch });
  }
  return state;
}

const idxOf = (
  state: { candidates: { text: string }[] },
  text: string,
): number => state.candidates.findIndex((c) => c.text === text);

const has = (state: { candidates: { text: string }[] }, sub: string): boolean =>
  state.candidates.some((c) => c.text.includes(sub));

// dll 불필요: 방어 코드 (비-IME 언어 / 비정상 호출)
describe('SerialPortService — 방어 코드 (dll 불필요)', () => {
  // 비-CJK 언어는 지원 엔진이 없어 SCHEMA_UNAVAILABLE 로 거부(엔진 로드 전 차단).
  // (JA 는 mozc 지원으로 승격 — 아래 mozc 통합 블록에서 검증)
  for (const lang of [LANGUAGES.KO, LANGUAGES.EN]) {
    it(`비-CJK(${lang}) processKey → SCHEMA_UNAVAILABLE`, async () => {
      expect.assertions(2);
      try {
        await svc.processKey({ language: lang, key: 'a' });
      } catch (e) {
        expect(e).toBeInstanceOf(ImeError);
        expect((e as ImeError).imeCause).toBe('SCHEMA_UNAVAILABLE');
      }
    });
  }

  it('활성 엔진 없이 selectCandidate → 빈 상태 반환(throw 없음)', async () => {
    const state = await svc.selectCandidate({ index: 0 });
    expect(state.composing).toBe(false);
    expect(state.candidates).toEqual([]);
    expect(state.committedText).toBe('');
  });

  it('활성 엔진 없이 clear → 빈 상태 반환(throw 없음)', async () => {
    const state = await svc.clear();
    expect(state.composing).toBe(false);
    expect(state.candidates).toEqual([]);
  });
});

// 실제 유저 입력 시나리오 (rime.dll 필요)
describe.skipIf(!HAS_DLL)('SerialPortService — 실제 유저 입력', () => {
  beforeAll(() => {
    expect(svc.ensureReady()).toBe(true);
    expect(svc.healthCheck()).toBe(true);
  });
  beforeEach(async () => {
    await svc.clear();
  });

  it('병음 "nihao" → 후보에 你好, 선택 시 你好 확정·조합 종료', async () => {
    const state = await typeWord(CN, 'nihao');
    expect(state.composing).toBe(true);
    expect(state.candidates.length).toBeGreaterThan(0);

    const i = idxOf(state, '你好');
    expect(i).toBeGreaterThanOrEqual(0);

    const after = await svc.selectCandidate({ index: i });
    expect(after.committedText).toBe('你好');
    expect(after.composing).toBe(false);
    expect(after.preedit).toBe('');
  });

  it('한 글자씩 칠 때마다 조합/후보가 갱신된다', async () => {
    await svc.clear();
    const s1 = await svc.processKey({ language: CN, key: 'n' });
    expect(s1.composing).toBe(true);
    expect(s1.candidates.length).toBeGreaterThan(0);
    const s2 = await svc.processKey({ language: CN, key: 'i' });
    expect(s2.preedit.length).toBeGreaterThanOrEqual(s1.preedit.length);
  });

  it('부분 후보 선택 → 확정 없이 조합 전진(남은 병음 유지)', async () => {
    const state = await typeWord(CN, 'nihaoma');
    const i = idxOf(state, '你好');
    expect(i).toBeGreaterThanOrEqual(0);

    const after = await svc.selectCandidate({ index: i });
    expect(after.committedText).toBe('');
    expect(after.composing).toBe(true);
    expect(after.preedit).toContain('你好');
    expect(after.candidates.length).toBeGreaterThan(0);
  });

  it('간체(CN) vs 번체(TW) — 같은 병음이 다른 자형', async () => {
    const cn = await typeWord(CN, 'guojia');
    const tw = await typeWord(TW, 'guojia');
    expect(has(cn, '国')).toBe(true);
    expect(has(tw, '國')).toBe(true);
  });

  it('스페이스로 상단 후보 확정', async () => {
    await typeWord(CN, 'nihao');
    const after = await svc.processKey({ language: CN, key: ' ' });
    expect(after.committedText.length).toBeGreaterThan(0);
    expect(after.composing).toBe(false);
  });

  it('백스페이스로 조합 자소 삭제 → 다 지우면 조합 종료', async () => {
    let state = await typeWord(CN, 'ni');
    const before = state.preedit;
    state = await svc.processKey({ language: CN, key: '\b' });
    expect(state.preedit.length).toBeLessThan(before.length);
    state = await svc.processKey({ language: CN, key: '\b' });
    expect(state.composing).toBe(false);
    expect(state.candidates).toEqual([]);
  });

  it('백스페이스로 비운 뒤 재입력 정상', async () => {
    await typeWord(CN, 'ni');
    await svc.processKey({ language: CN, key: '\b' });
    await svc.processKey({ language: CN, key: '\b' });
    const s = await typeChars(CN, 'hao');
    expect(s.composing).toBe(true);
    expect(s.candidates.length).toBeGreaterThan(0);
  });

  it('clear() 로 진행 중 조합 초기화', async () => {
    await typeWord(CN, 'nihao');
    const cleared = await svc.clear();
    expect(cleared.composing).toBe(false);
    expect(cleared.candidates).toEqual([]);
    expect(cleared.preedit).toBe('');
  });

  it('확정 후 새 조합이 잔재 없이 시작된다', async () => {
    const first = await typeWord(CN, 'nihao');
    await svc.selectCandidate({ index: idxOf(first, '你好') });
    // 곧바로 다른 단어
    const s = await typeWord(CN, 'beijing');
    expect(s.composing).toBe(true);
    expect(s.preedit).toContain('bei');
    expect(has(s, '北')).toBe(true);
  });

  it('진행 중 비-CJK 입력 거부는 CJK 조합을 깨지 않는다', async () => {
    await svc.clear();
    await svc.processKey({ language: CN, key: 'n' });
    const mid = await svc.processKey({ language: CN, key: 'i' });
    expect(mid.composing).toBe(true);

    // 비-CJK 는 엔진 건드리기 전에 throw → 세션 무손상
    await expect(
      svc.processKey({ language: LANGUAGES.EN, key: 'x' }),
    ).rejects.toBeInstanceOf(ImeError);

    // CN 조합 계속 정상
    await svc.processKey({ language: CN, key: 'h' });
    await svc.processKey({ language: CN, key: 'a' });
    const s = await svc.processKey({ language: CN, key: 'o' });
    expect(has(s, '你好')).toBe(true);
  });

  it('언어 교차: CN 확정 → 비-CJK 거부 → CN 재개 정상', async () => {
    const first = await typeWord(CN, 'nihao');
    await svc.selectCandidate({ index: idxOf(first, '你好') });

    await expect(
      svc.processKey({ language: LANGUAGES.KO, key: 'a' }),
    ).rejects.toBeInstanceOf(ImeError);

    const s = await typeWord(CN, 'nihao');
    expect(has(s, '你好')).toBe(true);
  });

  it('범위 밖 후보 index 선택은 안전(크래시/오염 없음)', async () => {
    await typeWord(CN, 'nihao');
    const after = await svc.selectCandidate({ index: 9999 });
    expect(after).toBeDefined();
    // 이후 정상 동작 유지
    const s = await typeWord(CN, 'guojia');
    expect(s.candidates.length).toBeGreaterThan(0);
  });
});

// mozc(ja) — mozc_server 필요
describe.skipIf(!HAS_MOZC)('SerialPortService — mozc(ja) 통합', () => {
  it('romaji 타이핑 → 가나 preedit + 예측 후보(모바일 프로파일)', async () => {
    const s = await typeWord(JA, 'kau');
    expect(s.composing).toBe(true);
    expect(s.preedit).toBe('かう');
    expect(s.candidates.length).toBeGreaterThan(0);
    // mixed_conversion 증거: 음역(가나 그대로) 후보가 타이핑 중에 항상 포함된다.
    expect(has(s, 'かう')).toBe(true);
  });

  it('후보 탭 = 즉시 확정(commit-on-tap) + 조합 종료', async () => {
    const s = await typeWord(JA, 'kau');
    const expected = s.candidates[0]?.text ?? '';
    expect(expected).not.toBe('');
    const after = await svc.selectCandidate({ index: 0 });
    expect(after.committedText).toBe(expected);
    expect(after.composing).toBe(false);
    expect(after.preedit).toBe('');
  });

  it('백스페이스(\\b) → 조합 축소', async () => {
    await typeWord(JA, 'kau'); // かう
    const s = await svc.processKey({ language: JA, key: '\b' });
    expect(s.preedit).toBe('か');
    expect(s.composing).toBe(true);
  });

  it('clear → 빈 상태, 이후 새 조합 정상', async () => {
    await typeWord(JA, 'ka');
    const cleared = await svc.clear();
    expect(cleared.composing).toBe(false);
    const s = await typeWord(JA, 'ku');
    expect(s.preedit).toBe('く');
  });

  it('범위 밖 후보 index 선택은 안전(크래시/오염 없음)', async () => {
    await typeWord(JA, 'ka');
    const after = await svc.selectCandidate({ index: 9999 });
    expect(after).toBeDefined();
    const s = await typeWord(JA, 'ki');
    expect(s.preedit).toBe('き');
  });

  it.skipIf(!HAS_DLL)(
    '언어 교차: CN ↔ JA 세션 독립 + 활성 엔진 라우팅',
    async () => {
      await typeWord(CN, 'ni');
      const ja = await typeWord(JA, 'ka');
      expect(ja.preedit).toBe('か');
      // JA 가 활성 엔진 — selectCandidate 는 mozc 로 간다(탭=확정).
      const expected = ja.candidates[0]?.text ?? '';
      const after = await svc.selectCandidate({ index: 0 });
      expect(after.committedText).toBe(expected);
      // 다시 CN 재개도 정상.
      const cn = await typeWord(CN, 'nihao');
      expect(has(cn, '你好')).toBe(true);
    },
  );
});
