/**
 * 여러 대상에 같은 일을 보낸다 — 진행률과 개별 결과를 남기면서.
 *
 * 키오스크마다 mutation 이 따로 나가므로 **원자적일 수 없다.** 일부만 성공하는 것이
 * 정상 상태이고, 그것을 숨기면 어느 기기가 갱신됐는지 아무도 모르게 된다. 그래서
 * 전체 성패가 아니라 **대상별 결과**를 남긴다.
 *
 * 동시 실행에 상한을 두는 이유: 수백 대를 한꺼번에 쏘면 서버가 밀리고, 브라우저도
 * 연결 수 제한에 걸려 앞의 요청들이 큐에서 굶는다.
 */

/** 실측으로 버티는 선. 더 올리면 서버가 밀리고 브라우저 연결 수 제한에도 걸린다. */
export const DISPATCH_CONCURRENCY = 30;

export type Status = 'pending' | 'sending' | 'ok' | 'failed';

export type Result = {
  id: string;
  status: Status;
  /** 실패했을 때의 사유. 성공이면 없다. */
  error?: string;
};

/**
 * `items` 각각에 `task` 를 돌린다. 하나가 실패해도 나머지는 계속한다.
 *
 * 진행이 있을 때마다 `onChange` 로 **현재 전체 상태**를 넘긴다 — 호출부가 그대로
 * 그리면 되도록. 부분 갱신을 조립하게 하면 화면과 실제가 어긋난다.
 */
export async function dispatch(
  ids: readonly string[],
  task: (id: string) => Promise<void>,
  onChange: (results: Result[]) => void,
  concurrency = DISPATCH_CONCURRENCY,
): Promise<Result[]> {
  const results: Result[] = ids.map((id) => ({ id, status: 'pending' }));
  const publish = () => onChange(results.map((result) => ({ ...result })));
  publish();

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const at = next;
      next += 1;
      const result = results[at];
      if (!result) continue;

      result.status = 'sending';
      publish();
      try {
        await task(result.id);
        result.status = 'ok';
      } catch (cause) {
        result.status = 'failed';
        result.error = cause instanceof Error ? cause.message : String(cause);
      }
      publish();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, worker),
  );
  return results;
}

/** 실패한 것들만 — 재시도 대상이자 사람이 봐야 할 목록. */
export const failedIds = (results: readonly Result[]): string[] =>
  results.filter((result) => result.status === 'failed').map((r) => r.id);

export const countBy = (results: readonly Result[], status: Status): number =>
  results.filter((result) => result.status === status).length;
