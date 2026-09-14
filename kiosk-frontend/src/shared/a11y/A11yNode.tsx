import type { A11yKey, AudioVars } from 'kiosk-types';
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
} from 'react';
import { ANALYTICS_EVENTS, track } from '@/shared/analytics';
import { PLAY_MODE_INTERRUPT, type PlayMode } from '@/shared/audio/AudioPlayer';
import { useAudio } from '@/shared/hooks/useAudio';
import { Logger } from '@/shared/logger/Logger';
import { useAccessibilityStore } from './accessibilityStore';
import { A11Y_BINDINGS, type A11yEventCues, resolveCues } from './bindings';
import {
  type A11yFocusMap,
  directionOfKey,
  ensureFocusable,
  focusByKey,
  registerA11yNode,
  unregisterA11yNode,
} from './registry';

interface A11yNodeProps {
  /** Figma 레이어명 == 이 키 (types `A11Y_KEYS` 의 값). 바인딩·검증의 조인 키. */
  a11yKey: A11yKey;
  /** 변수 음성 값(예: `{ AMOUNT: 50000 }`). 해당 이벤트 음성이 변수를 가질 때만 의미. */
  vars?: AudioVars;
  /**
   * 방향키 포커스 이동 지도(옵셔널). `{ right: A11Y_KEYS.FOO }` = 이 노드에 포커스가 있을 때
   * → 키를 누르면 `FOO` 노드로 이동. **지정하지 않은 방향·미마운트 대상은 브라우저 기본 동작**.
   */
  focusOn?: A11yFocusMap;
  /** 정확히 하나의 포커스 가능한 엘리먼트(또는 그렇게 만들 엘리먼트). */
  children: ReactNode;
}

type AnyHandler = ((arg: unknown) => void) | undefined;
const compose =
  (theirs: AnyHandler, ours: (arg: unknown) => void) => (arg: unknown) => {
    ours(arg);
    theirs?.(arg);
  };

type AnyRef = Ref<HTMLElement> | undefined;
// 자식이 이미 ref 를 가졌을 수 있어 합성한다(우리 등록용 ref + 자식 본래 ref).
const mergeRefs =
  (...refs: AnyRef[]) =>
  (node: HTMLElement | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as { current: HTMLElement | null }).current = node;
    }
  };

/**
 * 자식의 실제 DOM 엘리먼트를 캡처하는 콜백 ref 와 그 저장소를 함께 돌려준다. 전역 querySelector 를 쓰지
 * 않아 같은 a11yKey 가 동시에 둘 이상 마운트돼도 각 노드가 자기 엘리먼트를 소유한다.
 *
 * 훅으로 가른 이유: `setEl` 은 `elRef.current` 를 쓰므로 React Compiler 가 ref 오염값으로 보고, 그 값이
 * `mergeRefs`/`cloneElement` 같은 **일반 함수 호출**로 넘어가는 순간 컴포넌트 전체를 최적화에서 제외한다.
 * 훅 경계 밖으로는 그 오염이 전파되지 않아 A11yNode 가 정상 컴파일된다.
 */
function useCapturedElement(a11yKey: A11yKey) {
  const elRef = useRef<HTMLElement | null>(null);
  const setEl = useCallback(
    (node: unknown) => {
      if (node !== null && !(node instanceof HTMLElement)) {
        // 조용히 넘기면 포커스·방향키가 안 되는 이유를 아무도 모른다.
        // ref 미forward(=null)는 이미 정상 경로라 여기 걸리지 않는다.
        new Logger().error(
          `[a11y] ${a11yKey}: 자식 ref 가 DOM 엘리먼트가 아님 — 포커스/방향키 바인딩 생략됨`,
        );
        elRef.current = null;
        return;
      }
      elRef.current = node;
    },
    [a11yKey],
  );
  return [elRef, setEl] as const;
}

/**
 * UI 노드를 a11y 모델에 키로 등록하고, 그 키의 이벤트별 음성을 자동 바인딩한다.
 *
 * 래퍼 엘리먼트를 만들지 않고 **단일 자식에 props 를 병합**(Radix Slot 식, cloneElement) — 레이아웃
 * 영향·이중 탭스톱 없음. 자식이 비-focusable 이면 마운트 후 tabIndex 를 주입한다.
 *
 * 음성 재생 규칙: 이벤트 cue 중 **a11y 모드 ON 이면 전부, OFF 면 `always` 만** 재생(`resolveCues`).
 * - **모든 이벤트(mount/unmount/focus/press) → INTERRUPT** — 새 음성이 이전 음성을 취소(barge-in).
 * - press 는 자식의 `onPress`(VDS 가 포인터+키보드를 모음)에 합성 — DOM click 버블링에 기대지 않음.
 *
 * 방향키(`focusOn`)는 **옵트인**이다. 지정한 방향만 가로채고, 나머지(및 대상이 안 잡히는 경우)는
 * `preventDefault` 없이 브라우저 기본 동작으로 남는다.
 *
 * @example 방향키로 짝 버튼 사이 이동
 *   <A11yNode a11yKey={A11Y_KEYS.…PAY_CARD} focusOn={{ right: A11Y_KEYS.…PAY_CASH }}>
 *     <Button onPress={payCard}>카드</Button>
 *   </A11yNode>
 */
export function A11yNode({ a11yKey, vars, focusOn, children }: A11yNodeProps) {
  const { play } = useAudio();
  const enabled = useAccessibilityStore((s) => s.enabled);
  const binding = A11Y_BINDINGS[a11yKey];

  const playCues = (cues: A11yEventCues | undefined, mode: PlayMode) => {
    const keys = resolveCues(cues, enabled);
    if (keys.length === 0) return;
    // fire-and-forget — play 내부에서 fetch 실패/로그 처리(resolveAudioClips·AudioPlayer).
    play(
      keys.map((key) => ({ key, vars })),
      mode,
    );
  };

  const [elRef, setEl] = useCapturedElement(a11yKey);

  // 마운트/언마운트 음성 + (모드 ON 시) 포커스 레지스트리 등록.
  // ref 콜백은 effect 보다 먼저(커밋 단계) 실행되므로 여기선 elRef.current 가 채워져 있다.
  // deps 를 [a11yKey, enabled] 로 좁힌다 — play/binding/vars 는 매 렌더 새 참조라 넣으면 thrash.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 의도적 — 위 사유.
  useEffect(() => {
    playCues(binding?.mount, PLAY_MODE_INTERRUPT);

    let registered: string | null = null;
    const el = elRef.current;
    if (el) {
      // 탭 순서 편입은 접근성 모드에서만 — 일반 모드의 탭 순서를 건드리지 않는다.
      // (등록 자체는 모드 무관: focusOn 이 같은 주소 공간을 쓴다.)
      if (enabled) ensureFocusable(el);
      registerA11yNode(a11yKey, el);
      registered = a11yKey;
    }
    return () => {
      playCues(binding?.unmount, PLAY_MODE_INTERRUPT);
      if (registered) unregisterA11yNode(registered);
    };
  }, [a11yKey, enabled]);

  // 방향키 이동. focusOn 은 매 렌더 새 객체라 deps 에 넣으면 리스너가 thrash —
  // useEffectEvent 가 항상 최신 클로저를 보므로 리스너는 마운트 때 한 번만 건다.
  const onDirectionKey = useEffectEvent((e: KeyboardEvent, el: HTMLElement) => {
    // 자식(예: 입력 캐럿)이 포커스를 가진 경우는 그쪽 소관 — 이 노드가 직접 포커스일 때만 가로챈다.
    if (e.target !== el) return;
    const direction = directionOfKey(e.key);
    const target = direction && focusOn?.[direction];
    // 대상이 안 잡히면 preventDefault 없이 흘려보내 브라우저 기본 동작을 남긴다.
    if (target && focusByKey(target)) e.preventDefault();
  });
  // elRef 가 useCapturedElement 산출물이라 biome 이 useRef 임을 추적하지 못해 `.current` 를
  // 의존성으로 본다. deps 에 넣으면 안 된다 — ref 변경은 리렌더를 유발하지 않아 무의미하고,
  // 리스너만 thrash 한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 의도적 — 위 사유.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => onDirectionKey(e, el);
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!isValidElement(children)) return <>{children}</>;
  const child = Children.only(children) as ReactElement<{
    onFocus?: AnyHandler;
    onPress?: AnyHandler;
    ref?: AnyRef;
  }>;

  // 인트린식 엘리먼트(`<div>`/`<span>` 등 string type)는 onPress 가 유효한 DOM 핸들러가 아니다.
  // VDS Pressable/Button(함수형 컴포넌트)에만 주입해야 React 미인식 prop 경고를 피한다.
  const isIntrinsic = typeof child.type === 'string';

  // 등록용 ref 를 자식 본래 ref 와 합성해 주입. (함수형 컴포넌트 자식이 ref 를 forward 하지
  //  않으면 elRef 는 null 로 남아 등록이 스킵된다 — 페이지 래퍼는 DOM 자식(div)으로 감쌀 것.)
  const childRef = child.props.ref;
  const merged: Record<string, unknown> = {
    'data-a11y-key': a11yKey,
    ref: childRef ? mergeRefs(setEl, childRef) : setEl,
  };
  if (binding?.focus || child.props.onFocus) {
    merged.onFocus = compose(child.props.onFocus, () =>
      playCues(binding?.focus, PLAY_MODE_INTERRUPT),
    );
  }
  if (!isIntrinsic && (binding?.press || child.props.onPress)) {
    merged.onPress = compose(child.props.onPress, () => {
      track(ANALYTICS_EVENTS.UI_PRESS, { a11yKey });
      playCues(binding?.press, PLAY_MODE_INTERRUPT);
    });
  }
  return cloneElement(child, merged);
}
