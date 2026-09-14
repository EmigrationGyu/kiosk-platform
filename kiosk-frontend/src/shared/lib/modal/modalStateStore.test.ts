import { describe, expect, test } from 'bun:test';
import { createModalStateStore } from './modalStateStore';

const KEY = 'TEST_MODAL';
const open = (...keys: string[]) => new Set(keys);

describe('createModalStateStore', () => {
  describe('setField / getRecord', () => {
    test('필드를 쓰면 레코드에 반영된다', () => {
      const store = createModalStateStore();
      store.setField(KEY, 'sleeps', 2);
      expect(store.getRecord(KEY)).toEqual({ sleeps: 2 });
    });

    test('함수 updater 는 이전 필드 값을 받는다', () => {
      const store = createModalStateStore();
      store.setField(KEY, 'count', 1);
      store.setField(KEY, 'count', (prev: number) => prev + 1);
      expect(store.getRecord(KEY)?.count).toBe(2);
    });

    test('다른 필드는 서로 독립이다', () => {
      const store = createModalStateStore();
      store.setField(KEY, 'a', 1);
      store.setField(KEY, 'b', 'x');
      store.setField(KEY, 'a', 2);
      expect(store.getRecord(KEY)).toEqual({ a: 2, b: 'x' });
    });

    test('레코드는 불변 갱신된다 (스냅샷 참조가 변경마다 갈린다)', () => {
      const store = createModalStateStore();
      store.setField(KEY, 'a', 1);
      const before = store.getRecord(KEY);
      store.setField(KEY, 'a', 2);
      expect(store.getRecord(KEY)).not.toBe(before);
    });
  });

  describe('subscribe', () => {
    test('같은 키의 변경만 통지된다', () => {
      const store = createModalStateStore();
      let notified = 0;
      store.subscribe(KEY, () => notified++);
      store.setField(KEY, 'a', 1);
      store.setField('OTHER_MODAL', 'a', 1);
      expect(notified).toBe(1);
    });

    test('같은 값 재기록은 통지하지 않는다 (Object.is 베일아웃)', () => {
      const store = createModalStateStore();
      let notified = 0;
      store.subscribe(KEY, () => notified++);
      store.setField(KEY, 'a', 1);
      store.setField(KEY, 'a', 1);
      expect(notified).toBe(1);
    });

    test('undefined 를 처음 쓰는 것은 필드 생성이므로 통지된다', () => {
      const store = createModalStateStore();
      let notified = 0;
      store.subscribe(KEY, () => notified++);
      store.setField(KEY, 'a', undefined);
      expect(notified).toBe(1);
      expect(store.getRecord(KEY)).toEqual({ a: undefined });
    });

    test('구독 해제 후에는 통지되지 않는다', () => {
      const store = createModalStateStore();
      let notified = 0;
      const unsubscribe = store.subscribe(KEY, () => notified++);
      unsubscribe();
      store.setField(KEY, 'a', 1);
      expect(notified).toBe(0);
    });
  });

  describe('수명: (모달 열림) ∪ (hold)', () => {
    test('모달이 닫혀도 hold 가 있으면 유지된다 — opener 가 결과를 읽는 경로', () => {
      const store = createModalStateStore();
      const release = store.hold(KEY);
      store.syncOpenModals(open(KEY));
      store.setField(KEY, 'result', 42);
      store.syncOpenModals(open()); // 모달 닫힘
      expect(store.getRecord(KEY)?.result).toBe(42);
      release();
    });

    test('hold 없이 모달이 닫히면 소멸한다', () => {
      const store = createModalStateStore();
      store.syncOpenModals(open(KEY));
      store.setField(KEY, 'a', 1);
      store.syncOpenModals(open());
      expect(store.getRecord(KEY)).toBeUndefined();
    });

    test('모달 닫힌 뒤 마지막 hold 해제 시점에 소멸한다', () => {
      const store = createModalStateStore();
      const release = store.hold(KEY);
      store.setField(KEY, 'a', 1);
      store.syncOpenModals(open());
      release();
      expect(store.getRecord(KEY)).toBeUndefined();
    });

    test('모달이 열려 있으면 hold 를 전부 해제해도 유지된다', () => {
      const store = createModalStateStore();
      const release = store.hold(KEY);
      store.syncOpenModals(open(KEY));
      store.setField(KEY, 'a', 1);
      release();
      expect(store.getRecord(KEY)?.a).toBe(1);
    });

    test('hold 는 refcount — 하나 남아 있으면 유지된다', () => {
      const store = createModalStateStore();
      const releaseOpener = store.hold(KEY);
      const releaseModal = store.hold(KEY);
      store.setField(KEY, 'a', 1);
      releaseModal();
      expect(store.getRecord(KEY)?.a).toBe(1);
      releaseOpener();
      expect(store.getRecord(KEY)).toBeUndefined();
    });

    test('release 는 멱등이다 — 두 번 불러도 다른 hold 를 깎지 않는다', () => {
      const store = createModalStateStore();
      const releaseA = store.hold(KEY);
      store.hold(KEY);
      store.setField(KEY, 'a', 1);
      releaseA();
      releaseA();
      expect(store.getRecord(KEY)?.a).toBe(1);
    });

    test('seed: 열기 전에 쓴 값은 무관한 모달 여닫힘에 휩쓸리지 않는다', () => {
      const store = createModalStateStore();
      const release = store.hold(KEY);
      store.setField(KEY, 'seed', 'value');
      store.syncOpenModals(open('OTHER_MODAL'));
      store.syncOpenModals(open());
      expect(store.getRecord(KEY)?.seed).toBe('value');
      release();
    });

    test('소멸도 구독자에게 통지된다 (스냅샷이 undefined 로 갱신)', () => {
      const store = createModalStateStore();
      let notified = 0;
      store.subscribe(KEY, () => notified++);
      store.syncOpenModals(open(KEY));
      store.setField(KEY, 'a', 1);
      store.syncOpenModals(open());
      expect(notified).toBe(2);
      expect(store.getRecord(KEY)).toBeUndefined();
    });

    test('상태가 없는 키는 여닫혀도 아무 일도 일어나지 않는다', () => {
      const store = createModalStateStore();
      let notified = 0;
      store.subscribe(KEY, () => notified++);
      store.syncOpenModals(open(KEY));
      store.syncOpenModals(open());
      expect(notified).toBe(0);
    });
  });
});
