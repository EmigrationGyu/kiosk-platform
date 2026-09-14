/**
 * 한 번에 하나씩 — 들어온 순서대로.
 *
 * 적용 파이프라인은 배타를 가정한다(정숙 대기 → 잠금 → 부모 요청). 그런데 진입점이
 * 셋이다: 렌더러 드레인, 부팅 때의 롤백 이어가기, 하네스 파일. 드레인은 자기 안에서
 * 직렬이지만 나머지와는 아니라서, 부팅 이어가기가 산출물을 받는 몇 분 사이에 홈 진입
 * 드레인이 또 하나를 넣으면 잠금을 두 번 쥐고 부모 요청이 겹친다.
 *
 * 앞의 것이 던져도 다음 것은 돈다 — 실패는 그 지시의 결과이지 줄의 결과가 아니다.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const next = tail.then(task, task);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
