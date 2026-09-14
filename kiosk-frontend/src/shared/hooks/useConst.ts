import { useState } from 'react';

/**
 * 마운트당 한 번만 `init()` 을 호출하고, 이후 렌더에서는 같은 인스턴스를 돌려준다.
 *
 * `useRef` + 첫 렌더 초기화로 구현하면 렌더 중 ref 읽기/쓰기가 되어 React Compiler 가
 * 이 훅을 쓰는 쪽이 아니라 이 훅 자체를 최적화에서 제외한다. `useState` 의 lazy
 * initializer 는 같은 의미(마운트당 1회 · 동일 인스턴스)를 규칙 위반 없이 표현한다.
 * setter 는 쓰지 않는다 — 값이 바뀌지 않는 것이 이 훅의 계약이다.
 */
export const useConst = <T>(init: () => T): T => useState(init)[0];
