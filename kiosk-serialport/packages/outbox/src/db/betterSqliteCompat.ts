/**
 * `node:sqlite` 위에 better-sqlite3 의 표면을 씌운다.
 *
 * **왜 네이티브 드라이버를 안 쓰나.** better-sqlite3 는 V8 ABI 에 묶여 런타임마다 다른 바이너리가
 * 필요한데 이 프로젝트엔 ABI 가 셋이다 — 설치본(127) · 개발 Node(137) · Electron 번들 Node(145).
 * 하나를 맞추면 다른 데서 깨지고, koffi 를 택할 때 세운 게이트("N-API 이거나 prebuilt 동봉")도 통과
 * 못 한다. `node:sqlite` 는 런타임 내장이라 ABI 도 rebuild 도 패키징도 없다(두 런타임 실측 확인).
 *
 * 대신 drizzle 에 그 드라이버가 없어서 요구하는 좁은 표면만 여기서 채운다 — client.prepare/transaction,
 * stmt.run/all/get/raw. 엔진을 주입받는 이유는 테스트다: bun 에는 `node:sqlite` 가 없어서 트랜잭션
 * 중첩과 raw 매핑 같은 **이 파일의 판단**은 fake 엔진으로 박제한다.
 */

export type EngineStatement = {
  run(...params: unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  /** 결과 키 순서 — raw(배열) 매핑에 쓴다. */
  columns(): { name: string | null }[];
};

export type SqliteEngine = {
  exec(sql: string): void;
  prepare(sql: string): EngineStatement;
  close(): void;
};

/** drizzle 의 better-sqlite3 드라이버가 statement 에 기대하는 모양. */
export type CompatStatement = {
  run(...params: unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  /** 열 이름 대신 위치 배열로 돌려주는 뷰. */
  raw(): Pick<CompatStatement, 'all' | 'get'>;
};

export type TransactionBehavior = 'deferred' | 'immediate' | 'exclusive';

export type CompatDatabase = {
  prepare(sql: string): CompatStatement;
  exec(sql: string): void;
  close(): void;
  transaction<A extends unknown[], R>(
    fn: (...args: A) => R,
  ): Record<TransactionBehavior, (...args: A) => R>;
};

const BEGIN: Record<TransactionBehavior, string> = {
  deferred: 'BEGIN',
  immediate: 'BEGIN IMMEDIATE',
  exclusive: 'BEGIN EXCLUSIVE',
};

/**
 * 행 객체를 열 순서 배열로 편다. better-sqlite3 의 `raw()` 는 statement 의 모드를 **영구히** 바꾸지만
 * 여기서는 뷰를 돌려준다 — 같은 statement 로 raw 와 비-raw 를 번갈아 써도 앞 호출이 뒤를 오염시키지
 * 않는다(drizzle 은 매번 `raw()` 를 다시 부르므로 동작은 같다).
 */
const toArray = (row: unknown, keys: (string | null)[]): unknown[] =>
  keys.map((k) => (k === null ? null : (row as Record<string, unknown>)[k]));

export function createBetterSqliteCompat(engine: SqliteEngine): CompatDatabase {
  /**
   * 중첩 깊이. 0 이면 BEGIN/COMMIT, 그보다 깊으면 SAVEPOINT 다 — better-sqlite3 와 같은
   * 규약이다. 이게 없으면 트랜잭션 안에서 트랜잭션을 열 때 "cannot start a transaction
   * within a transaction" 으로 터진다.
   */
  let depth = 0;

  const wrap = (stmt: EngineStatement): CompatStatement => ({
    run: (...params) => stmt.run(...params),
    all: (...params) => stmt.all(...params),
    get: (...params) => stmt.get(...params),
    raw: () => {
      const keys = stmt.columns().map((c) => c.name);
      return {
        all: (...params) => stmt.all(...params).map((r) => toArray(r, keys)),
        get: (...params) => {
          const row = stmt.get(...params);
          return row === undefined || row === null
            ? undefined
            : toArray(row, keys);
        },
      };
    },
  });

  const runInTransaction = <A extends unknown[], R>(
    behavior: TransactionBehavior,
    fn: (...args: A) => R,
  ) => {
    return (...args: A): R => {
      const nested = depth > 0;
      const savepoint = `sp_compat_${depth}`;

      engine.exec(nested ? `SAVEPOINT ${savepoint}` : BEGIN[behavior]);
      depth += 1;

      try {
        const result = fn(...args);
        engine.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (e) {
        // 롤백까지 실패하면 원래 예외를 잃는다 — 원인이 그쪽이 아니므로 원본을 던진다.
        try {
          engine.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
        } catch {
          // 이미 롤백된 트랜잭션. 아래에서 원본 예외를 던진다.
        }
        throw e;
      } finally {
        depth -= 1;
      }
    };
  };

  return {
    prepare: (sql) => wrap(engine.prepare(sql)),
    exec: (sql) => engine.exec(sql),
    close: () => engine.close(),
    transaction: (fn) => ({
      deferred: runInTransaction('deferred', fn),
      immediate: runInTransaction('immediate', fn),
      exclusive: runInTransaction('exclusive', fn),
    }),
  };
}
