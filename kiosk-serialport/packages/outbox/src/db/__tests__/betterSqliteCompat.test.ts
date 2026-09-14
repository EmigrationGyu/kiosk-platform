import { describe, expect, test } from 'bun:test';
import {
  createBetterSqliteCompat,
  type EngineStatement,
  type SqliteEngine,
} from '../betterSqliteCompat';

/**
 * bun 에는 `node:sqlite` 가 없다. 그래서 **이 파일의 판단**(트랜잭션 중첩·롤백·raw 매핑)만
 * fake 엔진으로 박제한다 — 실제 드라이버 연결은 런타임이 증명한다.
 */

type Fake = {
  engine: SqliteEngine;
  sql: string[];
};

function fakeEngine(
  rows: unknown[] = [],
  columns: { name: string | null }[] = [],
): Fake {
  const sql: string[] = [];

  const stmt: EngineStatement = {
    run: () => ({ changes: 1, lastInsertRowid: 1 }),
    all: () => rows,
    get: () => rows[0],
    columns: () => columns,
  };

  return {
    sql,
    engine: {
      exec: (s) => {
        sql.push(s);
      },
      prepare: (s) => {
        sql.push(`prepare:${s}`);
        return stmt;
      },
      close: () => {
        sql.push('close');
      },
    },
  };
}

describe('betterSqliteCompat — 트랜잭션', () => {
  test('정상 종료면 BEGIN → COMMIT', () => {
    const f = fakeEngine();
    const db = createBetterSqliteCompat(f.engine);

    const result = db.transaction(() => 'ok').deferred();

    expect(result).toBe('ok');
    expect(f.sql).toEqual(['BEGIN', 'COMMIT']);
  });

  test('예외가 나면 ROLLBACK 하고 원본 예외를 그대로 던진다', () => {
    const f = fakeEngine();
    const db = createBetterSqliteCompat(f.engine);

    expect(() =>
      db
        .transaction(() => {
          throw new Error('도메인 실패');
        })
        .deferred(),
    ).toThrow('도메인 실패');

    expect(f.sql).toEqual(['BEGIN', 'ROLLBACK']);
  });

  test.each([
    ['deferred', 'BEGIN'],
    ['immediate', 'BEGIN IMMEDIATE'],
    ['exclusive', 'BEGIN EXCLUSIVE'],
  ] as const)('%s 는 %s 로 연다', (behavior, expected) => {
    const f = fakeEngine();
    const db = createBetterSqliteCompat(f.engine);

    db.transaction(() => null)[behavior]();

    expect(f.sql[0]).toBe(expected);
  });

  test('인자를 그대로 넘긴다', () => {
    const f = fakeEngine();
    const db = createBetterSqliteCompat(f.engine);

    const out = db
      .transaction((a: number, b: string) => `${a}${b}`)
      .deferred(1, 'x');

    expect(out).toBe('1x');
  });

  // ── 중첩 ────────────────────────────────────────────────────────────

  /**
   * 이게 없으면 트랜잭션 안에서 트랜잭션을 열 때 sqlite 가
   * "cannot start a transaction within a transaction" 으로 터진다.
   */
  describe('중첩은 savepoint 로', () => {
    test('안쪽은 SAVEPOINT / RELEASE', () => {
      const f = fakeEngine();
      const db = createBetterSqliteCompat(f.engine);

      db.transaction(() => {
        db.transaction(() => null).deferred();
      }).deferred();

      expect(f.sql).toEqual([
        'BEGIN',
        'SAVEPOINT sp_compat_1',
        'RELEASE sp_compat_1',
        'COMMIT',
      ]);
    });

    test('안쪽 실패는 SAVEPOINT 까지만 되감고 바깥은 살아남을 수 있다', () => {
      const f = fakeEngine();
      const db = createBetterSqliteCompat(f.engine);

      db.transaction(() => {
        try {
          db.transaction(() => {
            throw new Error('안쪽 실패');
          }).deferred();
        } catch {
          // 바깥이 삼키기로 한 경우
        }
      }).deferred();

      expect(f.sql).toEqual([
        'BEGIN',
        'SAVEPOINT sp_compat_1',
        'ROLLBACK TO sp_compat_1',
        'COMMIT',
      ]);
    });

    test('깊이가 풀리면 다음 트랜잭션은 다시 BEGIN 이다', () => {
      const f = fakeEngine();
      const db = createBetterSqliteCompat(f.engine);

      db.transaction(() => null).deferred();
      db.transaction(() => null).deferred();

      expect(f.sql).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    });

    test('예외로 빠져나가도 깊이가 새지 않는다', () => {
      const f = fakeEngine();
      const db = createBetterSqliteCompat(f.engine);

      expect(() =>
        db
          .transaction(() => {
            throw new Error('x');
          })
          .deferred(),
      ).toThrow();

      db.transaction(() => null).deferred();

      // 두 번째가 SAVEPOINT 가 아니라 BEGIN 이어야 한다
      expect(f.sql).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
    });
  });
});

describe('betterSqliteCompat — raw 매핑', () => {
  test('all() 은 열 순서 배열로 편다', () => {
    const f = fakeEngine(
      [
        { a: 1, bee: 'x' },
        { a: 2, bee: 'y' },
      ],
      [{ name: 'a' }, { name: 'bee' }],
    );
    const db = createBetterSqliteCompat(f.engine);

    expect(db.prepare('select a, b as bee from t').raw().all()).toEqual([
      [1, 'x'],
      [2, 'y'],
    ]);
  });

  test('get() 도 배열로', () => {
    const f = fakeEngine(
      [{ a: 1, bee: 'x' }],
      [{ name: 'a' }, { name: 'bee' }],
    );
    const db = createBetterSqliteCompat(f.engine);

    expect(db.prepare('...').raw().get()).toEqual([1, 'x']);
  });

  test('행이 없으면 undefined — 빈 배열이 아니다', () => {
    const f = fakeEngine([], [{ name: 'a' }]);
    const db = createBetterSqliteCompat(f.engine);

    expect(db.prepare('...').raw().get()).toBeUndefined();
  });

  /**
   * better-sqlite3 의 raw() 는 statement 모드를 영구히 바꾼다. 뷰로 만든 이유가 이것 —
   * drizzle 은 같은 statement 로 values()(raw)와 all()(객체)을 번갈아 쓴다.
   */
  test('raw() 를 부른 뒤에도 원래 statement 는 객체를 돌려준다', () => {
    const f = fakeEngine([{ a: 1 }], [{ name: 'a' }]);
    const db = createBetterSqliteCompat(f.engine);
    const stmt = db.prepare('...');

    expect(stmt.raw().all()).toEqual([[1]]);
    expect(stmt.all()).toEqual([{ a: 1 }]);
  });
});

describe('betterSqliteCompat — 위임', () => {
  test('exec / close 는 엔진으로 그대로 간다', () => {
    const f = fakeEngine();
    const db = createBetterSqliteCompat(f.engine);

    db.exec('PRAGMA journal_mode = WAL');
    db.close();

    expect(f.sql).toEqual(['PRAGMA journal_mode = WAL', 'close']);
  });

  test('run 결과를 그대로 돌려준다', () => {
    const f = fakeEngine();
    const db = createBetterSqliteCompat(f.engine);

    expect(db.prepare('...').run()).toEqual({
      changes: 1,
      lastInsertRowid: 1,
    });
  });
});
