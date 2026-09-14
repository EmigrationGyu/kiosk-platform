export type KeyboardProps = {
  onKeyPress: (value: string) => void;
  /**
   * 전역 키보드가 열려있는 동안 헤더 슬롯 등을 "해당 입력 소유자"만 갱신할 수 있게 하는 식별자입니다.
   * (키보드 컴포넌트는 사용하지 않아도 됩니다.)
   */
  ownerKey?: string;
  /**
   * CJK IME 조합이 "커서 위치"에서 일어나도록, 조합 세션 시작 시점의 소유 input 컨텍스트
   * (커서 앞/뒤 분할)를 읽는 통로. 범위 선택 중이면 선택 구간은 제외됩니다(입력=교체).
   * 소유 input 이 open() 시 등록합니다.
   */
  imeGetContext?: () => { before: string; after: string };
  /**
   * keyboardStore 가 "확정분 + 조합중 병음(preedit) + 커서 뒤 텍스트" 를 소유 input 에
   * 인라인 표시하는 통로. caret 은 표시 후 복원할 커서 위치(= preedit 끝)입니다.
   */
  imeSetValue?: (value: string, caret: number) => void;
};
