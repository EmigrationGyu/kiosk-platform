import type { ImeCause, ImeState } from 'kiosk-types';
import type { ReactNode } from 'react';
import { tolgee } from '@/app/i18n/tolgee';
import { KEYBOARD_MAP } from '@/app/providers/keyboard/registry';
import { IME_EVENTS } from '@/shared/constants/events/Ime';
import type { TolgeeLanguage } from '@/shared/constants/i18n';
import { LANGUAGES, TolgeeLanguageSchema } from '@/shared/constants/i18n';
import type { KeyboardType } from '@/shared/constants/keyboard';
import { Logger } from '@/shared/logger/Logger';
import { createStore } from '@/shared/store/storeRegistry';
import { Ime } from '@/shared/transport/Ime';
import type { KeyboardProps } from './types';

// 기본 자판은 한국어일 때만 한글, 그 외 모든 언어는 EN 으로 연다 — 라틴 입력이
// 모든 언어권에서 통하는 최소 공통분모라서다. CJK 자판(CN/TW=rime, JA=mozc)은
// 세션 한정으로 바텀시트/언어키에서 직접 고른다.
const toKeyboardLanguage = (language: TolgeeLanguage): TolgeeLanguage =>
  language === LANGUAGES.KO ? LANGUAGES.KO : LANGUAGES.EN;

// IME 조합 상태의 초기(빈) 값. 조합 없음.
const EMPTY_IME_COMPOSITION: ImeState = {
  committedText: '',
  preedit: '',
  candidates: [],
  highlightedIndex: -1,
  composing: false,
};

// IME Transport 는 프로세스 스코프 단일 인스턴스로 재사용(키마다 new 지양).
let imeTransport: Ime | null = null;
const getIme = (): Ime => (imeTransport ??= new Ime());

// 에러 로깅 — console 대신 프로젝트 Logger 사용. 첫 에러 때 lazy 생성.
let imeLogger: Logger | null = null;
const logImeError = (message: string, err: unknown): void => {
  (imeLogger ??= new Logger()).error(message, err);
};

// IME 조작 직렬화 큐. 키는 handleKeyPress 에서 fire-and-forget 으로 들어오므로, 빠른 타이핑이나
// (reaper 후) respawn 지연 시 왕복이 겹치면 imeCommitted 누적이 stale snapshot 으로 꼬인다.
// → 한 번에 하나씩(이전 op 의 set 반영 후 다음 op 가 get) 실행해 순서·누적을 결정적으로 만든다.
let imeChain: Promise<unknown> = Promise.resolve();
// 리셋(open/close/언어전환) 세대. 리셋 이후 뒤늦게 도착한 in-flight 결과는 폐기한다(조합 부활 방지).
let imeGeneration = 0;
const bumpImeGeneration = (): number => ++imeGeneration;
function enqueueIme(op: () => Promise<void>): Promise<void> {
  const run = imeChain.then(op, op);
  imeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

type KeyboardComponent = (typeof KEYBOARD_MAP)[KeyboardType];
type KeyboardItem =
  | { keyboard: null; props: null; headerSlot?: ReactNode | null }
  | {
      keyboard: KeyboardComponent;
      props: KeyboardProps;
      headerSlot?: ReactNode | null;
    };

type KeyboardStore = {
  keyboardItem: KeyboardItem;
  keyboardHeight: number;
  isKeyboardAnimating: boolean;
  open: (
    type: KeyboardType,
    props: KeyboardProps,
    headerSlot?: ReactNode,
  ) => void;
  close: () => void;
  /** 바깥 탭 닫힘 직후, 닫힘 리플로우로 인한 의도치 않은 재-focus 의 재오픈을 무시할 기준 시각(epoch ms). */
  reopenSuppressedUntil: number;
  /** 지금부터 `ms` 동안 input focus 로 인한 키보드 재오픈을 억제한다. */
  suppressReopen: (ms: number) => void;
  setHeaderSlot: (ownerKey: string, headerSlot: ReactNode | null) => void;
  setKeyboardHeight: (height: number) => void;
  setIsKeyboardAnimating: (isKeyboardAnimating: boolean) => void;
  keyboardLanguage: TolgeeLanguage;
  setKeyboardLanguage: (language: TolgeeLanguage) => void;
  /** CJK IME 조합 상태(preedit/candidates). CandidateBar 가 구독. open/close 에 리셋 종속. */
  imeComposition: ImeState;
  /**
   * 직전 IME 호출이 실패한 원인. 엔진 자산은 배포마다 달라(rime 데이터만 있는 키오스크 등)
   * 특정 언어만 조용히 죽는 일이 생기는데, 키 하나에 토스트를 띄우면 타이핑마다 쌓인다.
   * 원인만 남겨 두고 후보 자리에 한 줄로 대신 그린다 — 성공하면 곧바로 지워진다.
   */
  imeUnavailable: ImeCause | null;
  /** 현재 조합 세션의 누적 확정 텍스트(= 커서 앞 base + 확정 한자들). 인라인 표시 계산용 내부 상태. */
  imeCommitted: string;
  /** 조합 세션 시작 시점의 커서 뒤 텍스트 — 인라인 표시 때 뒤에 그대로 붙는다. */
  imeSuffix: string;
  /**
   * 이번 필드 세션에서 IME 로 흘려보낸 키의 누적 — 손님이 **실제로 친 로마자**다(JA/mozc=romaji,
   * CN·TW/rime=한어병음).
   *
   * 한자에서 판독을 역산하는 것은 추측이지만 이건 손님 본인이 자기 이름을 어떻게 읽는지에 대한 1차
   * 증거다. 다만 접두사 확정("tana"까지 치고 田中 선택)으로 잘릴 수 있어 **전일치 판정에만** 쓸 것 —
   * 유사 검색에 넣으면 잘린 값이 동성 손님을 물어 오입실이 된다.
   */
  imeRawInput: string;
  /**
   * `imeRawInput` 이 필드 내용과 선형 대응하는가. 조합 밖 편집(커서 이동, 확정 텍스트 백스페이스, 라틴
   * 직접 입력)이 섞이는 순간 대응이 깨지므로 false 로 내린다 — 깨진 누적값으로 검색하면 엉뚱한 이름이 잡힌다.
   */
  imeRawIntact: boolean;
  /** IME 경로 밖의 편집이 일어났음을 알린다(= 이후 `getImeRawInput()` 은 null). */
  breakImeRaw: () => void;
  /** 신뢰할 수 있을 때만 손님이 친 로마자를 준다. 없거나 깨졌으면 null. */
  getImeRawInput: () => string | null;
  /** 키 1개를 IME 엔진에 append(현재 keyboardLanguage 로). 확정분+preedit+suffix 를 인라인 반영. */
  imeProcessKey: (key: string) => Promise<void>;
  /** 후보 index 선택(확정/전진은 엔진 결정). 확정분은 인라인 반영. */
  imeSelectCandidate: (index: number) => Promise<void>;
  /**
   * 조합 경계(닫기·필드 전환·커서 이동·언어 전환)에서 preedit 을 **그 자리에서 확정**한다 — 사용자가 친
   * 입력은 증발하지 않는다(모바일 IME 관습). rime 의 분절 공백은 표시용이라 확정 시 제거된다
   * (`ni h o`→`niho`). displayCaret 은 인라인 표시 문자열 기준 탭 위치 — 주면 공백 제거분만큼 보정한다.
   * 반환값은 확정된 값/커서(조합 없으면 null).
   */
  imeCommitComposition: (
    displayCaret?: number,
  ) => { value: string; caret: number } | null;
  /**
   * 조합을 확정 없이 버린다(필드 전체 삭제). 확정하면 삭제 직전에 스쳐가는 onChange 가
   * 소비처로 새어나간다. 빈 필드는 새 raw 세션이므로 누적도 함께 초기화한다.
   */
  imeDiscardComposition: () => void;
};

export const useKeyboardStore = createStore<KeyboardStore>((set, get) => ({
  keyboardItem: { keyboard: null, props: null, headerSlot: null },
  keyboardHeight: 0,
  isKeyboardAnimating: false,
  open: (type: KeyboardType, props: KeyboardProps, headerSlot?: ReactNode) => {
    // 새 필드 진입 = 세션 경계. 이전 소유자 필드에 조합이 남아있으면 preedit 을 그 자리에서
    // 확정한다(입력 증발 방지, 분절 공백만 제거). (엔진 CLEAR·세대 bump 포함)
    get().imeCommitComposition();
    bumpImeGeneration();
    set({
      keyboardItem: { keyboard: KEYBOARD_MAP[type], props, headerSlot },
      // 키보드는 항상 현재 앱 언어로 열린다(이후 바텀시트로 세션 한정 변경 가능).
      // tolgee 는 우리 싱글턴(availableLanguages 고정)이라 parse 실패 = 설정 버그 → throw.
      keyboardLanguage: toKeyboardLanguage(
        TolgeeLanguageSchema.parse(tolgee.getLanguage()),
      ),
      imeComposition: EMPTY_IME_COMPOSITION,
      imeUnavailable: null,
      imeCommitted: '',
      imeSuffix: '',
      // 새 필드 = 새 raw 세션. close 에서는 지우지 않는다 — 바깥 탭으로 키보드가 닫힌
      // 뒤 페이지 버튼으로 제출하는 경로가 있어, 제출 시점까지 값이 살아 있어야 한다.
      imeRawInput: '',
      imeRawIntact: true,
    });
  },
  close: () => {
    // 종료의 단일 choke point(RETURN·바깥탭·dismissGlobalUI). 조합 중이면 preedit 을
    // 그 자리에서 확정한다 — 친 입력은 남기되 분절 공백은 제거(모바일 IME 관습).
    // 엔진 CLEAR·세대 bump 포함.
    get().imeCommitComposition();
    bumpImeGeneration();
    set({
      keyboardItem: { keyboard: null, props: null, headerSlot: null },
      imeComposition: EMPTY_IME_COMPOSITION,
      imeUnavailable: null,
      imeCommitted: '',
      imeSuffix: '',
    });
  },
  reopenSuppressedUntil: 0,
  suppressReopen: (ms: number) =>
    set({ reopenSuppressedUntil: Date.now() + ms }),
  setHeaderSlot: (ownerKey: string, headerSlot: ReactNode | null) =>
    set((state) => {
      const { keyboardItem } = state;
      if (!keyboardItem.keyboard || !keyboardItem.props) return state;
      if (keyboardItem.props.ownerKey !== ownerKey) return state;

      return {
        ...state,
        keyboardItem: {
          ...keyboardItem,
          headerSlot,
        },
      };
    }),
  setKeyboardHeight: (height: number) => set({ keyboardHeight: height }),
  setIsKeyboardAnimating: (isKeyboardAnimating: boolean) =>
    set({ isKeyboardAnimating }),
  keyboardLanguage: LANGUAGES.KO,
  setKeyboardLanguage: (language: TolgeeLanguage) => {
    // 같은 언어 재선택(바텀시트에서 현재 언어 재탭)은 no-op — 진행 중 조합을 파괴하지 않는다.
    if (get().keyboardLanguage === language) return;
    // 키보드 언어 전환 = 조합 경계(CJK↔비CJK 교차 포함). 진행 중 조합이 있으면
    // preedit 을 그 자리에서 확정하고(분절 공백 제거) 엔진을 초기화한다.
    get().imeCommitComposition();
    bumpImeGeneration();
    set({
      keyboardLanguage: language,
      imeComposition: EMPTY_IME_COMPOSITION,
      imeUnavailable: null,
      imeCommitted: '',
      imeSuffix: '',
    });
  },
  imeComposition: EMPTY_IME_COMPOSITION,
  imeUnavailable: null,
  imeCommitted: '',
  imeSuffix: '',
  imeRawInput: '',
  imeRawIntact: true,
  breakImeRaw: () => {
    // 매 키 입력마다 불릴 수 있는 자리라(비CJK 자판은 전 키가 이 경로) 이미 내려가 있으면 no-op.
    if (get().imeRawIntact) set({ imeRawIntact: false });
  },
  getImeRawInput: () => {
    const { imeRawInput, imeRawIntact } = get();
    if (!imeRawIntact) return null;
    const trimmed = imeRawInput.trim();
    return trimmed || null;
  },
  imeProcessKey: (key: string) => {
    // 손님이 친 키를 그대로 누적한다 — 엔진 왕복(비동기)과 무관하게 호출 순서대로 쌓아야
    // 순서가 보존되므로 큐 밖에서 동기로 처리한다. 백스페이스는 조합 중에만 여기로 오므로
    // (조합 밖 백스페이스는 breakImeRaw 경로) 한 글자 되돌리는 게 누적과 정확히 대응한다.
    set((state) => ({
      imeRawInput:
        key === '\b' ? state.imeRawInput.slice(0, -1) : state.imeRawInput + key,
    }));
    // 세대는 "발행 시점"에 동기 캡처 — 이후 (동기)리셋이 bump 하면 뒤늦은 결과를 폐기한다.
    const gen = imeGeneration;
    return enqueueIme(async () => {
      // 큐 대기 중 리셋됐으면 엔진 호출 자체를 건너뛴다(스테일 키가 엔진 조합을 오염시키지 않게).
      if (gen !== imeGeneration) return;
      // op 진입(자기 차례)에서 get — 직전 op 의 set 이 이미 반영돼 imeCommitted 가 최신.
      const {
        keyboardLanguage,
        keyboardItem,
        imeComposition,
        imeCommitted,
        imeSuffix,
      } = get();
      try {
        const res = await getIme().request(IME_EVENTS.PROCESS_KEY, {
          language: keyboardLanguage,
          key,
        });
        if (!res.success) {
          logImeError('[IME] processKey failed', res.cause);
          // 실패도 성공과 같은 세대 검사를 받는다 — 언어를 바꾼 뒤 도착한 이전 언어의
          // 실패가 새 언어의 화면에 눌러앉는다(전환 직후 리셋이 이걸 못 지운다).
          if (gen === imeGeneration) set({ imeUnavailable: res.cause });
          return;
        }
        if (gen !== imeGeneration) return; // 응답 사이 리셋 → 결과 폐기
        const props = keyboardItem.props;
        // 조합 시작 시점의 커서 분할(before/after)을 base/suffix 로 잡아 그 사이에서
        // 조합한다(조합 중이면 세션 캡처값 유지 — 인라인 갱신으로 바뀐 input 재캡처 금지).
        const ctx = imeComposition.composing
          ? { before: imeCommitted, after: imeSuffix }
          : (props?.imeGetContext?.() ?? { before: '', after: '' });
        const committed = ctx.before + res.data.committedText;
        set({
          imeComposition: res.data,
          imeUnavailable: null,
          imeCommitted: committed,
          imeSuffix: ctx.after,
        });
        // 입력칸에 "확정분 + 조합중 병음(preedit) + 커서 뒤 텍스트" 인라인 표시, 커서는 preedit 끝.
        const inline = committed + res.data.preedit;
        props?.imeSetValue?.(inline + ctx.after, inline.length);
      } catch (e) {
        // 타임아웃/IPC/스키마 실패 → 로그만. void 호출자(handleKeyPress)의 unhandled rejection 방지.
        logImeError('[IME] processKey error', e);
      }
    });
  },
  imeSelectCandidate: (index: number) => {
    const gen = imeGeneration;
    return enqueueIme(async () => {
      if (gen !== imeGeneration) return; // 큐 대기 중 리셋 → 엔진 호출 skip
      const { keyboardItem, imeCommitted, imeSuffix } = get();
      try {
        const res = await getIme().request(IME_EVENTS.SELECT_CANDIDATE, {
          index,
        });
        if (!res.success) {
          logImeError('[IME] selectCandidate failed', res.cause);
          return;
        }
        if (gen !== imeGeneration) return; // 응답 사이 리셋 → 결과 폐기
        const committed = imeCommitted + res.data.committedText;
        set({ imeComposition: res.data, imeCommitted: committed, imeSuffix });
        const inline = committed + res.data.preedit;
        keyboardItem.props?.imeSetValue?.(inline + imeSuffix, inline.length);
      } catch (e) {
        logImeError('[IME] selectCandidate error', e);
      }
    });
  },
  imeCommitComposition: (displayCaret?: number) => {
    const { imeComposition, imeCommitted, imeSuffix, keyboardItem } = get();
    // displayCaret 이 있다 = 커서 이동으로 인한 조합 경계. 이후 입력은 다른 위치에 끼어들어
    // raw 누적이 필드와 선형 대응하지 않게 되므로 그 시점에 신뢰를 내린다.
    if (displayCaret != null) get().breakImeRaw();
    if (!imeComposition.composing) return null;
    // 조합 경계 — preedit 을 그 자리에서 확정(입력 증발 방지), 엔진 초기화,
    // in-flight 결과 무효화.
    bumpImeGeneration();
    void getIme()
      .request(IME_EVENTS.CLEAR)
      .catch(() => undefined);
    // rime 의 분절 공백은 표시용이지 입력이 아니다 — 확정 시 제거해 원문 병음을 남긴다
    // ('ni h o'→'niho'). JA(mozc)의 preedit 은 히라가나(무공백)라 영향 없다.
    const preedit = imeComposition.preedit;
    const stripped = preedit.replaceAll(' ', '');
    const value = imeCommitted + stripped + imeSuffix;
    // 탭 위치(인라인 표시 기준: committed+preedit+suffix)를 공백 제거 후 좌표로 보정:
    // 확정분 안=그대로, preedit 안=그 앞의 제거 공백 수만큼, 그 뒤=전체 제거 수만큼 앞으로.
    const committedEnd = imeCommitted.length;
    const preeditEnd = committedEnd + preedit.length;
    const removedBefore = (upto: number) =>
      preedit.slice(0, upto).split(' ').length - 1;
    const caret =
      displayCaret == null
        ? committedEnd + stripped.length
        : displayCaret <= committedEnd
          ? displayCaret
          : displayCaret <= preeditEnd
            ? displayCaret - removedBefore(displayCaret - committedEnd)
            : displayCaret - (preedit.length - stripped.length);
    keyboardItem.props?.imeSetValue?.(value, caret);
    set({
      imeComposition: EMPTY_IME_COMPOSITION,
      imeUnavailable: null,
      imeCommitted: '',
      imeSuffix: '',
    });
    return { value, caret };
  },
  imeDiscardComposition: () => {
    // 조합 중일 때만 엔진 왕복이 필요하다(in-flight 결과 무효화 + CLEAR).
    if (get().imeComposition.composing) {
      bumpImeGeneration();
      void getIme()
        .request(IME_EVENTS.CLEAR)
        .catch(() => undefined);
    }
    set({
      imeComposition: EMPTY_IME_COMPOSITION,
      imeUnavailable: null,
      imeCommitted: '',
      imeSuffix: '',
      imeRawInput: '',
      imeRawIntact: true,
    });
  },
}));
