/**
 * opener ↔ 모달 공유 상태 저장소 (useSyncExternalStore 용 외부 스토어).
 *
 * 수명 규칙: 키의 상태는 (그 모달이 열려 있음) ∪ (그 키를 쓰는 useModal(key) 가
 * 마운트되어 있음 = hold) 동안 유지되고, 둘 다 사라지면 소멸한다.
 * 이 규칙 하나가 seed(열기 전 쓰기)·결과 회수(닫힌 뒤 읽기)·exit 애니메이션
 * (모달이 리스트에서 빠져도 언마운트 전까지 hold 유지)을 전부 커버한다.
 */

type Listener = () => void;
type FieldRecord = Readonly<Record<string, unknown>>;

export type ModalStateStore = {
  getRecord: (key: string) => FieldRecord | undefined;
  setField: (key: string, field: string, updater: unknown) => void;
  subscribe: (key: string, listener: Listener) => () => void;
  /** 마운트 동안 키를 붙잡는다. 반환값은 release(멱등). */
  hold: (key: string) => () => void;
  /** 현재 열려 있는 모달 키 집합을 반영하고 고아 상태를 청소한다. */
  syncOpenModals: (openKeys: ReadonlySet<string>) => void;
};

export function createModalStateStore(): ModalStateStore {
  const records = new Map<string, FieldRecord>();
  const listeners = new Map<string, Set<Listener>>();
  const holds = new Map<string, number>();
  let openKeys: ReadonlySet<string> = new Set();

  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) listener();
  };

  const wipeIfOrphan = (key: string) => {
    if (openKeys.has(key) || (holds.get(key) ?? 0) > 0) return;
    if (records.delete(key)) notify(key);
  };

  return {
    getRecord: (key) => records.get(key),

    setField: (key, field, updater) => {
      const record = records.get(key);
      const prev = record?.[field];
      const next =
        typeof updater === 'function'
          ? (updater as (prev: unknown) => unknown)(prev)
          : updater;
      if (record !== undefined && field in record && Object.is(prev, next))
        return;
      records.set(key, { ...record, [field]: next });
      notify(key);
    },

    subscribe: (key, listener) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },

    hold: (key) => {
      holds.set(key, (holds.get(key) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = (holds.get(key) ?? 1) - 1;
        if (remaining > 0) {
          holds.set(key, remaining);
        } else {
          holds.delete(key);
          wipeIfOrphan(key);
        }
      };
    },

    syncOpenModals: (next) => {
      openKeys = next;
      for (const key of [...records.keys()]) wipeIfOrphan(key);
    },
  };
}
