import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ImeState } from 'kiosk-types';
import { IME_EVENTS } from '@/shared/constants/events/Ime';
import { LANGUAGES } from '@/shared/constants/i18n';
import { KEYBOARD_TYPE } from '@/shared/constants/keyboard';
import type { KeyboardProps } from './types';

// keyboardStore 는 registry(→키보드 컴포넌트→motion/VDS)·tolgee·IME Transport 를 import 한다.
// 전역 상태 로직만 격리 검증하기 위해 이 무거운 의존성을 목으로 끊는다.
mock.module('@/app/providers/keyboard/registry', () => ({
  KEYBOARD_MAP: { TEXT: () => null, NUMBER: () => null },
}));
mock.module('@/app/i18n/tolgee', () => ({
  // open() 이 읽는 앱 언어. 'zh' → toKeyboardLanguage 는 비-KO 라 EN 자판으로 연다.
  tolgee: { getLanguage: () => 'zh' },
}));

// IME Transport 목 — request 호출을 기록하고, 응답은 테스트가 respond 로 주입한다.
const imeCalls: Array<{ event: string; payload?: unknown }> = [];
let respond: (event: string, payload?: unknown) => unknown = () => ({
  success: true,
});
mock.module('@/shared/transport/Ime', () => ({
  Ime: class {
    request(event: string, payload?: unknown) {
      imeCalls.push({ event, payload });
      return Promise.resolve(respond(event, payload));
    }
  },
}));

const { useKeyboardStore } = await import('./store');

const EMPTY: ImeState = {
  committedText: '',
  preedit: '',
  candidates: [],
  highlightedIndex: -1,
  composing: false,
};
const imeState = (over: Partial<ImeState>): ImeState => ({ ...EMPTY, ...over });
const ok = (data: ImeState) => ({ success: true, data });
const err = (cause: string) => ({ success: false, cause, code: 4601 });
const st = () => useKeyboardStore.getState();
const lastSetValue = () =>
  imeSetValue.mock.calls.at(-1)?.[0] as string | undefined;
const lastSetCaret = () =>
  imeSetValue.mock.calls.at(-1)?.[1] as number | undefined;

// 소유 input 의 커서 컨텍스트 통로 모사 — 실제 컴포넌트처럼 imeSetValue(v, caret) 가
// "복원된 커서 기준 before/after 분할"로 컨텍스트를 갱신해 imeGetContext 와 일관되게.
let currentContext = { before: '', after: '' };
const imeGetContext = () => currentContext;
const imeSetValue = mock((v: string, caret: number) => {
  currentContext = { before: v.slice(0, caret), after: v.slice(caret) };
});

function seedOwner(
  language: (typeof LANGUAGES)[keyof typeof LANGUAGES],
  composition: Partial<ImeState> = {},
  committed = '',
  suffix = '',
  withOwner = true,
) {
  const props: KeyboardProps = {
    onKeyPress: () => undefined,
    ownerKey: 'owner',
    imeGetContext,
    imeSetValue,
  };
  useKeyboardStore.setState({
    keyboardItem: withOwner
      ? { keyboard: (() => null) as never, props }
      : { keyboard: null, props: null },
    keyboardLanguage: language,
    imeComposition: imeState(composition),
    imeCommitted: committed,
    imeSuffix: suffix,
    // seedOwner 는 open() 을 우회해 세션을 직접 세운다 — 실제 세션 경계와 같이
    // raw 누적도 함께 초기화해야 테스트 간 누수가 없다.
    imeRawInput: '',
    imeRawIntact: true,
  });
}

const clearEvents = () => imeCalls.filter((c) => c.event === IME_EVENTS.CLEAR);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  imeCalls.length = 0;
  currentContext = { before: '', after: '' };
  imeSetValue.mockClear();
  respond = () => ({ success: true });
});

describe('imeProcessKey', () => {
  it('첫 키(조합 없음): base=현재 입력값, preedit 인라인', async () => {
    seedOwner(LANGUAGES.CN);
    respond = () =>
      ok(
        imeState({
          preedit: 'n',
          candidates: [{ text: '你' }],
          composing: true,
        }),
      );

    await st().imeProcessKey('n');

    expect(st().imeCommitted).toBe('');
    expect(st().imeComposition.composing).toBe(true);
    expect(lastSetValue()).toBe('n');
  });

  it('기존 입력값 뒤에 이어 붙임(base 보존)', async () => {
    seedOwner(LANGUAGES.CN);
    currentContext = { before: '王', after: '' };
    respond = () => ok(imeState({ preedit: 'x', composing: true }));

    await st().imeProcessKey('x');

    expect(st().imeCommitted).toBe('王');
    expect(lastSetValue()).toBe('王x');
  });

  it('커서 중간 조합: 커서 뒤 텍스트(suffix)를 보존하고 커서는 preedit 끝', async () => {
    seedOwner(LANGUAGES.CN);
    currentContext = { before: '王', after: '李' };
    respond = () => ok(imeState({ preedit: 'n', composing: true }));

    await st().imeProcessKey('n');

    expect(st().imeCommitted).toBe('王');
    expect(st().imeSuffix).toBe('李');
    expect(lastSetValue()).toBe('王n李'); // committed + preedit + suffix
    expect(lastSetCaret()).toBe(2); // preedit 끝
  });

  it('커서 중간 확정: 확정 한자가 suffix 앞에 삽입된다', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni', composing: true }, '王', '李');
    respond = () => ok(imeState({ committedText: '你', composing: false }));

    await st().imeProcessKey(' ');

    expect(st().imeCommitted).toBe('王你');
    expect(lastSetValue()).toBe('王你李');
    expect(lastSetCaret()).toBe(2); // 확정분 끝(suffix 앞)
  });

  it('연속 입력: 조합 중이면 base=누적 확정분(컨텍스트 재캡처 안 함)', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'n', composing: true }, '');
    // 조합 중 input 컨텍스트가 (인라인으로) 바뀌어 있어도 base 는 imeCommitted 사용
    currentContext = { before: 'STALE', after: '' };
    respond = () => ok(imeState({ preedit: 'ni', composing: true }));

    await st().imeProcessKey('i');

    expect(st().imeCommitted).toBe(''); // '' + '' (committedText 없음)
    expect(lastSetValue()).toBe('ni'); // committed('') + preedit('ni')
  });

  it('스페이스 등으로 확정: committedText 누적 + preedit 비면 조합 종료', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni hao', composing: true }, '');
    respond = () => ok(imeState({ committedText: '你好', composing: false }));

    await st().imeProcessKey(' ');

    expect(st().imeCommitted).toBe('你好');
    expect(st().imeComposition.composing).toBe(false);
    expect(lastSetValue()).toBe('你好');
  });

  it('부분 확정(전진): committedText 없이 preedit 잔류 → 인라인=확정분+잔여', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni hao ma', composing: true }, '');
    // 부분 선택 후 조합 전진: preedit 에 확정 prefix + 남은 병음
    respond = () =>
      ok(
        imeState({
          preedit: '你好ma',
          candidates: [{ text: '吗' }],
          composing: true,
        }),
      );

    await st().imeProcessKey('a');

    expect(st().imeCommitted).toBe('');
    expect(lastSetValue()).toBe('你好ma');
    expect(st().imeComposition.candidates).toEqual([{ text: '吗' }]);
  });

  it('한 스텝에서 확정+연속조합: committedText 와 preedit 동시', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'a', composing: true }, '王');
    respond = () =>
      ok(imeState({ committedText: '你', preedit: 'hao', composing: true }));

    await st().imeProcessKey('h');

    expect(st().imeCommitted).toBe('王你'); // base('王') + committed('你')
    expect(lastSetValue()).toBe('王你hao'); // + preedit
  });

  it('실패 응답(ENGINE_NOT_READY): 상태 불변, 값 미갱신', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni', composing: true }, '你');
    respond = () => err('ENGINE_NOT_READY');

    await st().imeProcessKey('x');

    expect(st().imeComposition.preedit).toBe('ni'); // 그대로
    expect(st().imeCommitted).toBe('你');
    expect(imeSetValue).not.toHaveBeenCalled();
  });

  it('현재 keyboardLanguage 를 요청에 싣는다(번체 TW)', async () => {
    seedOwner(LANGUAGES.TW);
    respond = () => ok(imeState({ preedit: 'n', composing: true }));

    await st().imeProcessKey('n');

    const call = imeCalls.find((c) => c.event === IME_EVENTS.PROCESS_KEY);
    expect((call?.payload as { language: string }).language).toBe(LANGUAGES.TW);
  });

  it('소유 input(props) 없어도 크래시 없이 상태만 갱신', async () => {
    seedOwner(LANGUAGES.CN, {}, '', '', /* withOwner */ false);
    respond = () => ok(imeState({ preedit: 'n', composing: true }));

    await st().imeProcessKey('n');

    expect(st().imeComposition.composing).toBe(true);
    expect(imeSetValue).not.toHaveBeenCalled();
  });
});

describe('imeSelectCandidate', () => {
  it('전체 후보 확정: 한자 append + 조합 종료', async () => {
    seedOwner(
      LANGUAGES.CN,
      { preedit: 'ni hao', candidates: [{ text: '你好' }], composing: true },
      '',
    );
    respond = () => ok(imeState({ committedText: '你好', composing: false }));

    await st().imeSelectCandidate(0);

    expect(st().imeCommitted).toBe('你好');
    expect(st().imeComposition.composing).toBe(false);
    expect(lastSetValue()).toBe('你好');
  });

  it('부분 후보 선택: 확정 없이 조합 전진(남은 후보 유지)', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni hao ma', composing: true }, '');
    respond = () =>
      ok(
        imeState({
          preedit: '你好ma',
          candidates: [{ text: '吗' }],
          composing: true,
        }),
      );

    await st().imeSelectCandidate(2);

    expect(st().imeCommitted).toBe('');
    expect(st().imeComposition.composing).toBe(true);
    expect(lastSetValue()).toBe('你好ma');
  });

  it('기존 누적 확정분에 이어 붙임', async () => {
    seedOwner(LANGUAGES.CN, { composing: true }, '王');
    respond = () => ok(imeState({ committedText: '小明', composing: false }));

    await st().imeSelectCandidate(1);

    expect(st().imeCommitted).toBe('王小明');
    expect(lastSetValue()).toBe('王小明');
  });

  it('선택한 index 를 요청에 싣는다', async () => {
    seedOwner(LANGUAGES.CN, { composing: true }, '');
    respond = () => ok(imeState({ committedText: '你', composing: false }));

    await st().imeSelectCandidate(3);

    const call = imeCalls.find((c) => c.event === IME_EVENTS.SELECT_CANDIDATE);
    expect((call?.payload as { index: number }).index).toBe(3);
  });

  it('실패 응답: 상태 불변, 값 미갱신', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni', composing: true }, '');
    respond = () => err('UNKNOWN');

    await st().imeSelectCandidate(0);

    expect(st().imeComposition.preedit).toBe('ni');
    expect(imeSetValue).not.toHaveBeenCalled();
  });
});

describe('setKeyboardLanguage (언어 교차)', () => {
  it('CJK→비CJK 전환(조합 중): preedit 원문 확정(공백 제거) + CLEAR + 리셋', () => {
    seedOwner(
      LANGUAGES.CN,
      { preedit: 'ni hao', candidates: [{ text: '你好' }], composing: true },
      '你',
    );

    st().setKeyboardLanguage(LANGUAGES.EN);

    expect(st().keyboardLanguage).toBe(LANGUAGES.EN);
    expect(st().imeComposition.composing).toBe(false);
    expect(st().imeComposition.candidates).toEqual([]);
    expect(st().imeCommitted).toBe('');
    expect(lastSetValue()).toBe('你nihao'); // 친 병음은 증발하지 않는다(분절 공백만 제거)
    expect(lastSetCaret()).toBe(6); // 커서=확정된 preedit 끝
    expect(clearEvents().length).toBe(1);
  });

  it('CJK→비CJK 전환(조합 중, 커서 중간): suffix 앞에 확정된다', () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni', composing: true }, '你', '王');

    st().setKeyboardLanguage(LANGUAGES.EN);

    expect(lastSetValue()).toBe('你ni王'); // 확정분 + preedit 확정 + 커서 뒤 텍스트
    expect(lastSetCaret()).toBe(3);
    expect(st().imeSuffix).toBe('');
  });

  it('CJK→CJK 전환(간→번, 조합 중)도 조합 경계로 리셋', () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni', composing: true }, '');

    st().setKeyboardLanguage(LANGUAGES.TW);

    expect(st().keyboardLanguage).toBe(LANGUAGES.TW);
    expect(st().imeComposition.composing).toBe(false);
    expect(clearEvents().length).toBe(1);
  });

  it('조합이 없으면 언어만 바뀌고 CLEAR/값복원 없음', () => {
    seedOwner(LANGUAGES.CN, { composing: false }, '');

    st().setKeyboardLanguage(LANGUAGES.EN);

    expect(st().keyboardLanguage).toBe(LANGUAGES.EN);
    expect(imeSetValue).not.toHaveBeenCalled();
    expect(clearEvents().length).toBe(0);
  });

  it('비CJK→CJK 전환: 조합 없으니 조용히 언어만 (이후 조합 가능 상태)', () => {
    seedOwner(LANGUAGES.EN, { composing: false }, '');

    st().setKeyboardLanguage(LANGUAGES.CN);

    expect(st().keyboardLanguage).toBe(LANGUAGES.CN);
    expect(st().imeComposition).toEqual(EMPTY);
  });
});

describe('imeCommitComposition (조합 경계 — preedit 그 자리 확정)', () => {
  it('조합 중: preedit 확정(분절 공백 제거) + CLEAR + 리셋, 확정값 반환', () => {
    seedOwner(
      LANGUAGES.CN,
      { preedit: 'ni ho', composing: true },
      '你好',
      '王',
    );

    const finalized = st().imeCommitComposition();

    expect(finalized).toEqual({ value: '你好niho王', caret: 6 }); // 미지정 → preedit 끝
    expect(lastSetValue()).toBe('你好niho王'); // 분절 공백은 표시용 — 확정엔 없다
    expect(lastSetCaret()).toBe(6);
    expect(st().imeComposition).toEqual(EMPTY);
    expect(st().imeCommitted).toBe('');
    expect(st().imeSuffix).toBe('');
    expect(clearEvents().length).toBe(1);
  });

  it('탭 위치 보정: 확정분 안=그대로, preedit 안=앞의 제거 공백만큼, 그 뒤=전체 제거만큼', () => {
    // 인라인 표시 '你好ni h王'(7): committed='你好'(0..2), preedit='ni h'(2..6, 공백 1), suffix='王'(6..7)
    // 확정 결과 '你好nih王'(6)
    seedOwner(LANGUAGES.CN, { preedit: 'ni h', composing: true }, '你好', '王');
    expect(st().imeCommitComposition(1)?.caret).toBe(1); // 확정분 안 → 그대로

    seedOwner(LANGUAGES.CN, { preedit: 'ni h', composing: true }, '你好', '王');
    expect(st().imeCommitComposition(4)?.caret).toBe(4); // preedit 안, 앞에 제거 공백 0

    seedOwner(LANGUAGES.CN, { preedit: 'ni h', composing: true }, '你好', '王');
    expect(st().imeCommitComposition(6)?.caret).toBe(5); // preedit 끝, 앞에 제거 공백 1

    seedOwner(LANGUAGES.CN, { preedit: 'ni h', composing: true }, '你好', '王');
    expect(st().imeCommitComposition(7)?.caret).toBe(6); // suffix 끝 → 전체 제거(1)만큼
  });

  it('조합 없음: null 반환, CLEAR/값갱신 없음', () => {
    seedOwner(LANGUAGES.CN, { composing: false }, '');

    expect(st().imeCommitComposition(0)).toBeNull();
    expect(imeSetValue).not.toHaveBeenCalled();
    expect(clearEvents().length).toBe(0);
  });

  it('in-flight 응답은 확정(세대 bump) 이후 폐기된다', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'n', composing: true }, '');
    respond = async () => {
      await delay(20);
      return ok(imeState({ preedit: 'ni', composing: true }));
    };

    const p = st().imeProcessKey('i');
    st().imeCommitComposition(); // 응답 도착 전 조합 경계
    await p;

    expect(st().imeComposition.composing).toBe(false);
    expect(st().imeComposition.preedit).toBe('');
  });
});

describe('open/close 리셋 (세션 경계 단일 choke point)', () => {
  it('close(조합 중): preedit 그 자리 확정(공백 제거) + 리셋 + CLEAR', () => {
    seedOwner(
      LANGUAGES.CN,
      { preedit: 'ni ho', candidates: [{ text: '你' }], composing: true },
      '你',
      '王',
    );

    st().close();

    expect(lastSetValue()).toBe('你niho王'); // 친 입력은 남고 분절 공백만 제거
    expect(lastSetCaret()).toBe(5);
    expect(st().imeComposition).toEqual(EMPTY);
    expect(st().imeCommitted).toBe('');
    expect(st().imeSuffix).toBe('');
    expect(clearEvents().length).toBe(1);
  });

  it('close(조합 없음): 리셋만, CLEAR 없음(불필요 IPC 방지)', () => {
    seedOwner(LANGUAGES.CN, { composing: false }, '');

    st().close();

    expect(st().imeComposition).toEqual(EMPTY);
    expect(clearEvents().length).toBe(0);
  });

  it('open(이전 조합 잔류): 이전 소유자 필드에 preedit 확정 + 리셋 + CLEAR', () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni', composing: true }, '你');

    st().open(KEYBOARD_TYPE.TEXT, {
      onKeyPress: () => undefined,
      ownerKey: 'next',
    });

    expect(lastSetValue()).toBe('你ni'); // 이전 필드에서도 친 입력은 증발하지 않는다
    expect(st().imeComposition).toEqual(EMPTY);
    expect(st().imeCommitted).toBe('');
    expect(clearEvents().length).toBe(1);
  });

  it('open(조합 없음): 리셋, CLEAR 없음', () => {
    seedOwner(LANGUAGES.CN, { composing: false }, '');

    st().open(KEYBOARD_TYPE.TEXT, {
      onKeyPress: () => undefined,
      ownerKey: 'next',
    });

    expect(st().imeComposition).toEqual(EMPTY);
    expect(clearEvents().length).toBe(0);
  });
});

describe('동시성 (fire-and-forget 연타 / respawn 지연)', () => {
  it('확정+다음키 연타는 직렬화되어 누적 유실 없이 순서 유지', async () => {
    // 이미 조합 중 + 확정분 '王'. space(느린 응답)로 你好 확정, 곧바로 x 연타.
    seedOwner(LANGUAGES.CN, { composing: true }, '王');
    currentContext = { before: '王', after: '' };
    respond = async (event, payload) => {
      if (event !== IME_EVENTS.PROCESS_KEY) return { success: true };
      const key = (payload as { key?: string })?.key;
      if (key === ' ') {
        await delay(20); // 확정 응답이 느리게 와도
        return ok(imeState({ committedText: '你好', composing: false }));
      }
      return ok(imeState({ preedit: 'x', composing: true }));
    };

    const p1 = st().imeProcessKey(' ');
    const p2 = st().imeProcessKey('x'); // 응답은 x 가 먼저 오지만 직렬화로 space 뒤에 처리
    await Promise.all([p1, p2]);

    expect(st().imeCommitted).toBe('王你好'); // 확정 유실 없음
    expect(lastSetValue()).toBe('王你好x'); // 你好 뒤에 x preedit
  });

  it('in-flight 중 close(리셋)되면 뒤늦은 결과는 폐기(조합 부활 방지)', async () => {
    seedOwner(LANGUAGES.CN, { composing: true }, '');
    respond = async () => {
      await delay(20);
      return ok(imeState({ preedit: 'ni', composing: true }));
    };

    const p = st().imeProcessKey('n');
    st().close(); // 응답 도착 전 리셋(세대 bump)
    await p;

    // 뒤늦은 preedit 이 리셋된 조합을 되살리지 않는다
    expect(st().imeComposition.composing).toBe(false);
    expect(st().imeComposition.preedit).toBe('');
  });

  it('in-flight 중 언어전환되면 뒤늦은 결과 폐기', async () => {
    seedOwner(LANGUAGES.CN, { composing: true }, '');
    respond = async () => {
      await delay(20);
      return ok(imeState({ preedit: 'ni', composing: true }));
    };

    const p = st().imeProcessKey('n');
    st().setKeyboardLanguage(LANGUAGES.EN);
    await p;

    expect(st().keyboardLanguage).toBe(LANGUAGES.EN);
    expect(st().imeComposition.composing).toBe(false);
  });

  it('발행 후 turn 전에 리셋되면 엔진 요청 자체를 보내지 않는다', async () => {
    seedOwner(LANGUAGES.CN, { composing: true }, '');
    respond = async () => {
      await delay(20);
      return ok(imeState({ preedit: 'ni', composing: true }));
    };

    const p1 = st().imeProcessKey('n');
    const p2 = st().imeProcessKey('i');
    st().close(); // 두 op 의 turn 전에 리셋(동기) → gen bump
    await Promise.all([p1, p2]);

    // 스테일 op 은 request 를 아예 발행하지 않음(엔진 조합 오염 방지)
    expect(
      imeCalls.filter((c) => c.event === IME_EVENTS.PROCESS_KEY).length,
    ).toBe(0);
  });

  it('transport reject(타임아웃/IPC) 시 throw 없이 상태 불변', async () => {
    seedOwner(LANGUAGES.CN, { preedit: 'ni', composing: true }, '你');
    const before = st().imeComposition;
    respond = () => Promise.reject(new Error('ipc boom'));

    // void 호출자처럼 — reject 가 새어나오면 unhandled rejection. try/catch 로 삼켜야 함.
    await expect(st().imeProcessKey('x')).resolves.toBeUndefined();
    expect(st().imeComposition).toEqual(before);
    expect(imeSetValue).not.toHaveBeenCalled();
  });
});

describe('교차 시나리오: IME↔비IME 번갈아', () => {
  it('CN 조합 → EN 전환(리셋) → CN 복귀 후 새 조합 정상', async () => {
    // 1) CN 조합
    seedOwner(LANGUAGES.CN);
    respond = () => ok(imeState({ preedit: 'ni', composing: true }));
    await st().imeProcessKey('n');
    await st().imeProcessKey('i');
    expect(st().imeComposition.composing).toBe(true);

    // 2) EN 전환 → 조합 폐기
    st().setKeyboardLanguage(LANGUAGES.EN);
    expect(st().imeComposition).toEqual(EMPTY);
    expect(st().imeCommitted).toBe('');

    // 3) CN 복귀 → 잔재 없이 새 조합
    st().setKeyboardLanguage(LANGUAGES.CN);
    imeSetValue.mockClear();
    currentContext = { before: '', after: '' };
    respond = () => ok(imeState({ preedit: 'h', composing: true }));
    await st().imeProcessKey('h');
    expect(st().imeCommitted).toBe(''); // 이전 세션 누적 안 샘
    expect(lastSetValue()).toBe('h');
  });
});

// 손님이 실제로 친 로마자 누적 — 예약자명 검색의 "입력 로마자 전일치" 단계 근거.
// 한자에서 판독을 역산하는 건 추측이지만(東=azuma/higashi/tou) 이건 1차 증거다.
// 다만 필드와 선형 대응이 깨지면 엉뚱한 이름을 물 수 있어, 깨진 순간부터는 안 준다.
describe('imeRawInput (손님이 친 로마자)', () => {
  it('IME 로 흘려보낸 키가 순서대로 쌓인다', async () => {
    seedOwner(LANGUAGES.JA);
    for (const key of ['t', 'a', 'n', 'a', 'k', 'a']) {
      await st().imeProcessKey(key);
    }
    expect(st().getImeRawInput()).toBe('tanaka');
  });

  it('조합 중 백스페이스는 한 글자 되돌린다', async () => {
    seedOwner(LANGUAGES.JA);
    for (const key of ['t', 'a', 'n', 'x']) {
      await st().imeProcessKey(key);
    }
    await st().imeProcessKey('\b');
    expect(st().getImeRawInput()).toBe('tan');
  });

  it('후보 확정을 여러 번 거쳐도 필드 세션 내내 누적된다', async () => {
    seedOwner(LANGUAGES.JA);
    for (const key of ['t', 'a', 'n', 'a', 'k', 'a']) {
      await st().imeProcessKey(key);
    }
    await st().imeSelectCandidate(0);
    for (const key of ['t', 'a', 'r', 'o']) {
      await st().imeProcessKey(key);
    }
    expect(st().getImeRawInput()).toBe('tanakataro');
  });

  it('IME 밖 편집이 섞이면 신뢰를 잃는다 (breakImeRaw)', async () => {
    seedOwner(LANGUAGES.JA);
    await st().imeProcessKey('t');
    st().breakImeRaw();
    expect(st().getImeRawInput()).toBeNull();
  });

  it('커서 이동으로 인한 조합 경계도 신뢰를 잃는다', async () => {
    seedOwner(LANGUAGES.JA, { composing: true, preedit: 'た' });
    await st().imeProcessKey('t');
    st().imeCommitComposition(1);
    expect(st().getImeRawInput()).toBeNull();
  });

  it('새 필드(open)에서 초기화된다 — 이전 필드 입력이 새 지 않는다', async () => {
    seedOwner(LANGUAGES.JA);
    await st().imeProcessKey('t');
    st().breakImeRaw();

    st().open(KEYBOARD_TYPE.TEXT, {
      onKeyPress: () => undefined,
      ownerKey: 'next',
    });
    expect(st().imeRawInput).toBe('');
    expect(st().imeRawIntact).toBe(true);
    expect(st().getImeRawInput()).toBeNull(); // 비어 있으면 null
  });

  it('공백만 남으면 null', async () => {
    seedOwner(LANGUAGES.JA);
    await st().imeProcessKey(' ');
    expect(st().getImeRawInput()).toBeNull();
  });
});
