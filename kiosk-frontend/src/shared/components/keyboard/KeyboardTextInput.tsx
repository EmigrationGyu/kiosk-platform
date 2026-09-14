import { type A11yKey, A11yKeySchema } from 'kiosk-types';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { ANALYTICS_EVENTS, track } from '@/shared/analytics';
import { KeyboardTopButton } from '@/shared/components/keyboard/KeyboardTopButton';
import { LANGUAGES, type TolgeeLanguage } from '@/shared/constants/i18n';
import {
  BACKSPACE_KEY,
  KEYBOARD_TYPE,
  RETURN_KEY,
} from '@/shared/constants/keyboard';
import { PREVENT_KEYBOARD_CLOSE_ATTR } from '@/shared/lib/keyboard/constants';
import { applyBackspace, applyInsert } from '@/shared/lib/keyboard/editOps';
import { useKeyboardStore } from '@/shared/lib/keyboard/store';
import { IconButton, Input, TextInput, type TextInputProps } from '@/shared/ui';
import { ic_xmark } from '@/shared/ui/icons';

// CJK IME 라우팅 — 중국어(간/번체)·일본어 키보드 언어에선 조합을 IME 엔진(CN/TW=rime, JA=mozc)이
// 소유한다. 소프트 키보드 키를 keyboardStore.imeProcessKey 로 흘려보내고 조합/후보 상태·확정은
// 스토어가 관리한다(엔진 라우팅은 서브프로세스가 언어로 자동 해소).
const CJK_LANGUAGES = new Set<TolgeeLanguage>([
  LANGUAGES.CN,
  LANGUAGES.TW,
  LANGUAGES.JA,
]);

// 소프트 키보드 키 → IME 단일 문자. 글자/스페이스는 그대로, 백스페이스만 매핑.
const toImeKey = (rawKey: string): string =>
  rawKey === BACKSPACE_KEY ? '\b' : rawKey;

const DIGIT_KEY = /^[0-9]$/;

// 지우기(X) 버튼 크기. VDS 는 글리프를 이 박스의 2/3 로 그리므로 여기 하나만 바꾸면 된다
// (VDS 의 Input.Right.IconButton 은 size-8 이 하드코딩돼 있어 쓰지 않는다).
const CLEAR_BUTTON_CLASS = 'relative size-4 shrink-0';

type KeyboardHeaderButtonOptions = {
  labelKey: string;
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  // 키보드에 가려지는 본 버튼의 헤더 대체 — 같은 의미라 본 버튼과 동일 a11yKey 로 키잉(중복 의도됨).
  a11yKey: A11yKey;
};

type KeyboardTextInputProps = TextInputProps & {
  /**
   * 마운트 시 자동 포커스(= 키보드 자동 오픈) 여부. 기본 `true`.
   */
  autoFocusOnMount?: boolean;
  /**
   * 값이 있을 때 우측에 뜨는 전체 지우기(X) 버튼. 기본 `true`.
   */
  clearable?: boolean;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onClick?: React.MouseEventHandler<HTMLInputElement>;
  keyboardHeaderButton?: KeyboardHeaderButtonOptions;
  keyboardType: (typeof KEYBOARD_TYPE)[keyof typeof KEYBOARD_TYPE];
  /**
   * 텍스트 키보드 엔터 — 키보드를 닫은 뒤 제출성 동작을 실행한다(숫자 키보드엔 엔터가 없다).
   * 인자는 IME 확정까지 반영된 최종 값. 키보드는 disabled/loading 을 모르므로,
   * 버튼과 같은 게이트를 콜백 안에서 다시 검사해야 엔터로 우회 제출되지 않는다.
   */
  onEnter?: (value: string) => void;
};

export const KeyboardTextInput = (props: KeyboardTextInputProps) => {
  const {
    keyboardType,
    keyboardHeaderButton: headerButton,
    autoFocusOnMount = true,
    clearable = true,
    onFocus,
    onClick,
    // 실행은 propsRef 로 최신본을 읽는다(open() 시점 클로저는 stale) — 여기선 DOM 전달만 막는다.
    onEnter: _onEnter,
    ...textInputProps
  } = props;
  const { className, right, ...restTextInputProps } = textInputProps;
  const { kind } = restTextInputProps;

  const ownerKey = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // VDS(TextInput/Input)가 이 조합에선 ref 를 실제 <input> 으로 넘겨주지 않아 inputRef 가 null 이다.
  // <input> 은 DOM 에 확실히 렌더되므로, display:contents 래퍼에서 직접 질의해 실 노드를 잡는다.
  const containerRef = useRef<HTMLDivElement>(null);
  const getInputNode = (): HTMLInputElement | null =>
    containerRef.current?.querySelector('input') ?? null;
  const open = useKeyboardStore((s) => s.open);
  const close = useKeyboardStore((s) => s.close);
  const setHeaderSlot = useKeyboardStore((s) => s.setHeaderSlot);
  // 이 input 이 현재 전역 키보드의 소유자인지 (= 내가 연 키보드가 떠 있는지)
  const isOwner = useKeyboardStore(
    (s) => s.keyboardItem.props?.ownerKey === ownerKey,
  );

  // 마지막 동작이 '조합(입력)'이었는지 '완료(공백/삭제 등)'이었는지 추적
  const isComposing = useRef(false);

  // 전역 키보드는 open() 시점의 onKeyPress 클로저를 들고 있으므로,
  // 거기서 최신 props(value/onChange/disabled)를 읽도록 ref 로 추적한다.
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  // 소유 필드가 사라지면(라우트 이동·조건부 언마운트) 키보드도 내린다. 키보드는 전역
  // 레이어라 스스로 사라지지 않아, 입력칸이 없는 다음 화면에 그대로 떠서 그 화면을 덮는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only
  useEffect(
    () => () => {
      const { keyboardItem, close: closeKeyboard } =
        useKeyboardStore.getState();
      if (keyboardItem.props?.ownerKey === ownerKey) closeKeyboard();
    },
    [ownerKey],
  );

  // 마운트 시 자동 포커스(= 키보드 자동 오픈). 한 화면에 여러 필드가 있어도 mount effect 는 트리 위→아래로
  // 실행되고 위쪽 필드가 focus() 하면 open() 이 동기적으로 keyboardItem 을 채우므로, 아래쪽 필드는 이
  // 가드에서 skip 된다 — "가장 위의 활성 필드"만 포커스된다. 마운트 1회만.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    if (!autoFocusOnMount) return;
    if (restTextInputProps.disabled) return;
    if (useKeyboardStore.getState().keyboardItem.keyboard) return;
    getInputNode()?.focus();
  }, []);

  // a11y 키를 props 에서 직접 읽어 A11yKey 로 좁힌다. A11yNode 가 cloneElement 로 data-a11y-key 를 이
  // 컴포넌트 props 에 넣어준다 — DOM getAttribute 는 VDS Input 이 이 속성을 inputRef 노드로 forward 하지
  // 않아 null 이 나오므로 쓰지 않는다. 미래핑 필드는 키가 없어 safeParse 실패 → 추적 skip.
  const readFieldKey = (): A11yKey | null => {
    const parsed = A11yKeySchema.safeParse(
      (props as unknown as Record<string, unknown>)['data-a11y-key'],
    );
    return parsed.success ? parsed.data : null;
  };

  const headerSlot = headerButton ? (
    <KeyboardTopButton {...headerButton} />
  ) : null;

  // 커서 추적/복원 — 키 탭은 KeyboardContainer 가 pointerdown 을 preventDefault 해 focus 를 안 뺏으므로,
  // 소유 input 의 selectionStart/End 는 키 입력 시점에 항상 유효하다(리스너 없이 직접 읽는다).
  //
  // - expectedCaretRef: 직전 편집이 끝났을 때의 커서. 키 입력 시점의 실제 커서와 다르면 사용자가 커서를
  //   옮긴 것 → 조합 경계(isComposing 해제).
  // - pendingCaretRef: emitChange 로 내보낸 값이 부모 state 를 왕복해 돌아오면(커서가 끝으로 튐) 복원할
  //   커서. 부모가 값을 변형해 돌려주면(전화번호 하이픈 등) forValue 불일치 → 복원을 포기하고 브라우저
  //   기본(끝 커서)을 수용한다 — 포맷터 필드는 끝 입력이 주 경로다.
  const expectedCaretRef = useRef<number | null>(null);
  const pendingCaretRef = useRef<{ forValue: string; caret: number } | null>(
    null,
  );

  // input DOM 에서 현재 선택 범위를 읽는다. selection API 는 text 계열 type 전제
  // (현 소비처는 text/password 뿐) — number/email 등을 새로 쓰면 여기가 깨진다.
  const readSelection = (
    fallbackLen: number,
  ): { start: number; end: number } => {
    const node = getInputNode();
    const start = node?.selectionStart ?? fallbackLen;
    const end = node?.selectionEnd ?? start;
    return { start, end };
  };

  // propsRef 는 (layout effect 이후에 도는) useEffect 에서 갱신되므로 여기서 읽으면 한
  // 렌더 이전 값이다 — 이 렌더의 value 를 클로저에서 직접 읽는다.
  const renderedValue = restTextInputProps.value?.toString() ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: getInputNode 는 ref 질의 헬퍼(비반응성) — 반응 트리거는 value 왕복뿐
  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    if (renderedValue !== pending.forValue) return; // 부모가 값 변형 → 복원 포기
    getInputNode()?.setSelectionRange(pending.caret, pending.caret);
    expectedCaretRef.current = pending.caret;
  }, [renderedValue]);

  // 합성 onChange 발화 — 전역 키보드가 소유 input 값을 갱신하는 통로.
  const emitChange = (newVal: string) => {
    const { onChange } = propsRef.current;
    if (!onChange) return;
    onChange({
      target: { value: newVal },
      currentTarget: { value: newVal },
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  };

  // IME 스토어가 조합 세션의 커서 컨텍스트를 읽고(조합 시작 시점 1회) 인라인 표시를 쓰는 통로.
  // 컨텍스트는 커서 기준 before/after 분할 — 범위 선택이면 선택 구간은 제외(입력=교체).
  const imeGetContext = () => {
    const value = propsRef.current.value?.toString() ?? '';
    const { start, end } = readSelection(value.length);
    return { before: value.slice(0, start), after: value.slice(end) };
  };
  const imeSetValue = (v: string, caret: number) => {
    pendingCaretRef.current = { forValue: v, caret };
    emitChange(v);
  };

  const handleKeyPress = (key: string) => {
    if (propsRef.current.disabled) return;

    if (key === RETURN_KEY) {
      // close() 안에서도 확정되지만, 확정값을 동기적으로 받으려면 먼저 부른다 —
      // emitChange 는 부모 state 왕복이라 이 틱의 value prop 엔 아직 반영되지 않는다.
      const finalized = useKeyboardStore.getState().imeCommitComposition();
      const submitted =
        finalized?.value ?? propsRef.current.value?.toString() ?? '';
      close();
      propsRef.current.onEnter?.(submitted);
      return;
    }

    const currentVal = propsRef.current.value?.toString() || '';
    const { start, end } = readSelection(currentVal.length);
    // 직전 편집 이후 커서가 움직였으면(사용자 탭 이동) 조합 경계.
    const caretMoved = expectedCaretRef.current !== start || start !== end;

    // CJK(중·일): 조합/후보는 IME 엔진(CN/TW=rime, JA=mozc)이 소유. 실제 입력 언어는
    // tolgee(앱 언어)가 아니라 "키보드 언어"(바텀시트 세션 변경)다. CJK면 키를 IME 로 라우팅한다.
    const store = useKeyboardStore.getState();
    const kbLanguage = store.keyboardLanguage;
    if (CJK_LANGUAGES.has(kbLanguage)) {
      // CJK 는 한글 자소 조합이 아니다 — hangul 조합 플래그를 내려, 폴백 백스페이스가
      // disassemble(한자) 경로로 새지 않고 글자 단위로 지우게 한다.
      isComposing.current = false;
    }

    const imeOwnsKey =
      CJK_LANGUAGES.has(kbLanguage) &&
      keyboardType !== KEYBOARD_TYPE.NUMBER &&
      !(DIGIT_KEY.test(key) && !store.imeComposition.composing);

    if (imeOwnsKey) {
      // 조합 중 커서 이동 = 조합 경계: preedit 을 그 자리에서 확정하고(분절 공백 제거,
      // 입력 증발 없음 — 모바일 IME 관습) 새 커서 위치에서 이어간다. 탭 위치는 공백
      // 제거분만큼 보정돼 돌아온다.
      const finalized =
        store.imeComposition.composing && caretMoved
          ? store.imeCommitComposition(start)
          : null;
      const composing = finalized ? false : store.imeComposition.composing;
      // 조합 없음 + 백스페이스 → 확정 텍스트 삭제(일반 경로로 폴백). 그 외엔 IME 로.
      // (확정 직후의 새 조합 시작 컨텍스트는 imeProcessKey 가 비동기 응답 시점에
      //  imeGetContext 로 재캡처한다 — 그때는 확정 값/커서 복원이 왕복 완료된 뒤다.)
      if (!(key === BACKSPACE_KEY && !composing)) {
        void useKeyboardStore.getState().imeProcessKey(toImeKey(key));
        return;
      }
      // 백스페이스 폴백: 확정 직후엔 propsRef 가 아직 이전 표시값이므로,
      // 확정이 돌려준 값/커서에서 동기적으로 잇는다.
      if (finalized) {
        const outcome = applyBackspace({
          value: finalized.value,
          start: finalized.caret,
          end: finalized.caret,
          composing: false,
        });
        pendingCaretRef.current = {
          forValue: outcome.value,
          caret: outcome.caret,
        };
        emitChange(outcome.value);
        return;
      }
    }

    // 커서 이동 → 앞 글자와 병합하지 않는다.
    if (caretMoved) {
      isComposing.current = false;
    }

    // 여기부터는 IME 를 거치지 않는 편집(직접 삽입/확정 텍스트 백스페이스)이다.
    // imeRawInput 누적이 필드 내용과 더는 선형 대응하지 않으므로 신뢰를 내린다.
    useKeyboardStore.getState().breakImeRaw();

    const state = {
      value: currentVal,
      start,
      end,
      composing: isComposing.current,
    };
    const outcome =
      key === BACKSPACE_KEY ? applyBackspace(state) : applyInsert(state, key);

    isComposing.current = outcome.composing;
    // expectedCaret 은 여기서 미리 확정하지 않는다 — 소비처가 이 변경을 거부하면
    // (onChange 미호출: GhostNameInput 글자수 상한 등) 값도 커서도 안 움직이므로,
    // 왕복이 실제로 성공한 시점(layout effect)에만 확정해 조합이 끊기지 않게 한다.
    pendingCaretRef.current = { forValue: outcome.value, caret: outcome.caret };
    emitChange(outcome.value);
  };

  // 전역 키보드는 open() 시점의 headerSlot만 들고 있어서,
  // 키보드가 열린 상태에서 disabled/onClick 등이 바뀌면 최신 값으로 교체해준다.
  useEffect(() => {
    if (!isOwner) return;
    setHeaderSlot(
      ownerKey,
      headerButton ? <KeyboardTopButton {...headerButton} /> : null,
    );
  }, [isOwner, ownerKey, setHeaderSlot, headerButton]);

  // focus ⇔ 키보드 소유권 동기화.
  // 닫기는 store(바깥 탭/RETURN/다른 input 점유)에서 일어나고 onBlur 와 연결돼
  // 있지 않으므로, 소유권을 잃으면 여기서 직접 blur 해 focus 가 끈적하게 남는 것을 막는다.
  // (안 풀린 focus 는 재탭 시 onFocus 미발화 → 키보드 재오픈 실패로 이어진다.)
  useEffect(() => {
    if (isOwner) return;
    if (document.activeElement === inputRef.current) {
      inputRef.current?.blur();
    }
  }, [isOwner]);

  // 편집 종료(소유권 상실: RETURN/바깥탭/다른 필드 점유) 시 1회 — 값은 안 싣고 filled/length 만.
  const wasOwnerRef = useRef(false);
  useEffect(() => {
    if (wasOwnerRef.current && !isOwner) {
      // effect 안에서는 readFieldKey 를 호출하지 않고 inline — deps 를 [isOwner] 로 유지(매 렌더 thrash 방지).
      // 키는 props(ref 로 추적)에서 읽는다 — DOM 노드엔 data-a11y-key 가 없으므로.
      const parsed = A11yKeySchema.safeParse(
        (propsRef.current as unknown as Record<string, unknown>)[
          'data-a11y-key'
        ],
      );
      if (parsed.success) {
        const val = propsRef.current.value?.toString() ?? '';
        track(ANALYTICS_EVENTS.FIELD_COMPLETED, {
          a11yKey: parsed.data,
          filled: val.length > 0,
          length: val.length,
        });
      }
    }
    wasOwnerRef.current = isOwner;
  }, [isOwner]);

  // 소유(편집) 중인 채로 언마운트(라우트 이동/모달 close)되면 위 전이가 안 일어나 field_completed
  // 가 결측된다 — "입력 진입했는데 끝까지 안 간" 케이스. 언마운트 시 소유 중이었으면 강제 종결.
  // (전이로 이미 발화했으면 wasOwnerRef=false 라 중복 안 됨.)
  useEffect(() => {
    return () => {
      if (!wasOwnerRef.current) return;
      const parsed = A11yKeySchema.safeParse(
        (propsRef.current as unknown as Record<string, unknown>)[
          'data-a11y-key'
        ],
      );
      if (!parsed.success) return;
      const val = propsRef.current.value?.toString() ?? '';
      track(ANALYTICS_EVENTS.FIELD_COMPLETED, {
        a11yKey: parsed.data,
        filled: val.length > 0,
        length: val.length,
      });
    };
  }, []);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (restTextInputProps.disabled) return;
    // 바깥 탭으로 키보드를 막 닫는 중이면, 닫힘 리플로우로 input 이 손가락 밑으로
    // 들어와 발생한 의도치 않은 focus 다. 재오픈하지 않고 focus 만 해제한다.
    if (Date.now() < useKeyboardStore.getState().reopenSuppressedUntil) {
      inputRef.current?.blur();
      return;
    }
    open(
      keyboardType,
      { onKeyPress: handleKeyPress, ownerKey, imeGetContext, imeSetValue },
      headerSlot ?? undefined,
    );
    const fieldKey = readFieldKey();
    if (fieldKey) track(ANALYTICS_EVENTS.FIELD_FOCUSED, { a11yKey: fieldKey });
    onFocus?.(e);
  };

  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    onClick?.(e);
  };

  const handleClear = () => {
    useKeyboardStore.getState().imeDiscardComposition();
    isComposing.current = false;
    pendingCaretRef.current = { forValue: '', caret: 0 };
    emitChange('');
  };

  // 편집 중일 때만 — isOwner(키보드 소유)가 이 앱의 focus 다. DOM focus 는 키보드가
  // store 쪽에서 닫힐 때 뒤늦게 풀려서 신호로 못 쓴다.
  // disabled 는 Input 이 PressableContext 로 내려주므로 여기서 보지 않는다.
  const showClear = clearable && isOwner && renderedValue.length > 0;
  // 페이드를 걸려면 계속 마운트돼 있어야 한다(언마운트하면 트랜지션할 엘리먼트가 없다).
  // 자리를 늘 차지하는 만큼 X 가 뜰 때 입력 폭이 흔들리지도 않는다.
  const clearAccessory = clearable ? (
    // TODO(a11y): 지우기 버튼 키가 figma 카탈로그에 아직 없음(핸드오프 대기) — 키 확보 시 A11yNode 부착.
    <IconButton
      icon={ic_xmark}
      kind="accent"
      hierarchy="tertiary"
      shape="circle"
      // Input 박스와 동률. Pressable 은 150ms 다 — 거기 붙은 duration-400 은 테마에 없는 죽은 클래스.
      className={`${CLEAR_BUTTON_CLASS} duration-200 ${kind === 'naked' ? 'right-1' : '-right-2'} ${showClear ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      tabIndex={showClear ? 0 : -1}
      // 가드 없으면 <button> 이라 KeyboardContainer 의 "클릭 후 키보드 닫기" 규칙에 걸린다.
      {...{ [PREVENT_KEYBOARD_CLOSE_ATTR]: 'true' }}
      // focus 유지용. capture 라 Pressable 핸들러를 덮지 않고 onPress 는 그대로 발화한다.
      onPointerDownCapture={(e) => e.preventDefault()}
      onPress={handleClear}
    />
  ) : undefined;

  const commonProps = {
    ...restTextInputProps,
    className: `w-full ${className ?? ''}`,
    [PREVENT_KEYBOARD_CLOSE_ATTR]: 'true',
    right: right ?? clearAccessory,
    onFocus: handleFocus,
    onClick: handleClick,
  };

  // display:contents 래퍼 — 레이아웃에 영향 없이 containerRef 로 실제 <input> 을 질의하기 위함.
  return (
    <div ref={containerRef} style={{ display: 'contents' }}>
      {kind === 'naked' ? (
        <TextInput ref={inputRef} {...commonProps} />
      ) : (
        <Input ref={inputRef} {...commonProps} />
      )}
    </div>
  );
};
