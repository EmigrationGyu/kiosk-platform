import { Database } from 'bun:sqlite';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { SERIALPORT_PROCESS } from 'kiosk-types';
import { Logger } from '@/shared/Logger';
import type { Db } from '../db';
import * as schema from '../db/schema';

// Logger 싱글톤은 최초 호출 시 origin 필수 — 테스트 환경에서 한 번 부트스트랩.
Logger.getInstance(SERIALPORT_PROCESS.OUTBOX);

export type TestDbHandle = {
  db: Db;
  sqlite: Database;
  cleanup: () => void;
};

const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

/**
 * 테스트용 in-memory SQLite DB.
 *
 * - bun:sqlite 사용 (bun이 better-sqlite3 native binding 미지원)
 * - prod 의 better-sqlite3 와 SQL 생성은 동일하므로 schema/migration 그대로 재사용
 * - 매 테스트마다 새 DB 만들어서 격리, cleanup() 으로 닫음
 */
export function createTestDb(): TestDbHandle {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db: db as unknown as Db,
    sqlite,
    cleanup: () => sqlite.close(),
  };
}

/**
 * 결정적 시계 — 테스트에서 시간을 직접 제어.
 * `now` 메서드로 현재값 읽고 `advance` / `set` 으로 조작.
 */
export class FakeClock {
  constructor(private current = 0) {}

  now = (): number => this.current;

  set(t: number): void {
    this.current = t;
  }

  advance(deltaMs: number): void {
    this.current += deltaMs;
  }
}

/**
 * 결정적 id 생성기 — 'id-1', 'id-2', ... 순서로.
 */
export function makeFakeIdGen(prefix = 'id'): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}
