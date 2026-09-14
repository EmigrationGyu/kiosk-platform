import { describe, expect, test } from 'bun:test';
import { countBy, dispatch, failedIds, type Result } from './dispatch';

const ids = (count: number) =>
  Array.from({ length: count }, (_, at) => `kiosk-${at}`);

describe('여러 대상 전송', () => {
  test('전부 성공하면 전부 ok', async () => {
    const results = await dispatch(
      ids(5),
      async () => undefined,
      () => undefined,
    );

    expect(countBy(results, 'ok')).toBe(5);
    expect(failedIds(results)).toEqual([]);
  });

  test('하나가 실패해도 나머지는 계속한다 - 원자적일 수 없다 ★', async () => {
    const results = await dispatch(
      ids(5),
      async (id) => {
        if (id === 'kiosk-2') throw new Error('연결 실패');
      },
      () => undefined,
    );

    expect(countBy(results, 'ok')).toBe(4);
    expect(failedIds(results)).toEqual(['kiosk-2']);
    expect(results.find((r) => r.id === 'kiosk-2')?.error).toBe('연결 실패');
  });

  test('동시 실행이 상한을 넘지 않는다 - 수백 대를 한꺼번에 쏘면 굶는다 ★', async () => {
    let running = 0;
    let peak = 0;

    await dispatch(
      ids(50),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
      },
      () => undefined,
      4,
    );

    expect(peak).toBeLessThanOrEqual(4);
  });

  test('대상이 상한보다 적으면 그만큼만 돈다', async () => {
    let peak = 0;
    let running = 0;
    await dispatch(
      ids(2),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
      },
      () => undefined,
      8,
    );

    expect(peak).toBeLessThanOrEqual(2);
  });

  test('진행할 때마다 전체 상태를 넘긴다 - 부분 갱신은 화면과 어긋난다 ★', async () => {
    const snapshots: Result[][] = [];

    await dispatch(
      ids(3),
      async () => undefined,
      (results) => snapshots.push(results),
      1,
    );

    // 첫 스냅샷은 전부 pending, 마지막은 전부 ok.
    expect(snapshots[0]?.every((r) => r.status === 'pending')).toBe(true);
    expect(snapshots.at(-1)?.every((r) => r.status === 'ok')).toBe(true);
    // 넘긴 것을 나중에 바꾸지 않는다(사본이어야 한다).
    expect(snapshots[0]?.every((r) => r.status === 'pending')).toBe(true);
  });

  test('빈 목록도 그냥 끝난다', async () => {
    expect(
      await dispatch(
        [],
        async () => undefined,
        () => undefined,
      ),
    ).toEqual([]);
  });
});
