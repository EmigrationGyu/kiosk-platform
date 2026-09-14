import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { LOCAL_DATA_DIR } from 'kiosk-types';
import { Logger } from '@/shared/Logger';
import {
  type CompatDatabase,
  createBetterSqliteCompat,
  type SqliteEngine,
} from './betterSqliteCompat';
import * as schema from './schema';
import type { Db } from './types';

/**
 * 이 단말의 로컬 데이터 루트 밑 — logs·auth·config·update 의 형제다.
 *
 * 홈에 `.kiosk` 를 따로 파면 백업·정리·장애 대응이 볼 곳이 두 군데가 된다.
 * WAL 모드가 `-wal`·`-shm` 형제 파일을 만들어서 디렉토리로 묶는다.
 */
const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  LOCAL_DATA_DIR,
  'outbox',
  'outbox.db',
);

const resolveDbPath = () => process.env.OUTBOX_DB_PATH ?? DEFAULT_DB_PATH;

/**
 * 번들 자신의 디렉토리. esbuild 가 `__dirname` 으로 치환하고, 소스 실행(vite-node)에는
 * 존재하지 않는다 — `@ipc/Router`·`@log/Sink` 와 같은 결의 토폴로지 주입이다.
 */
declare const __OUTBOX_BUNDLE_DIR__: string | undefined;

/**
 * cwd 는 기준이 못 된다 — 패키징된 앱의 cwd 는 이 패키지가 아니라서, 그대로 두면 `migrate()` 가 폴더를
 * 못 찾아 App 생성자에서 터지고 부팅이 죽는다. 번들은 dist/ 옆에 복사된 drizzle/(esbuild copy),
 * 소스 실행은 패키지 루트에서 돌아 cwd 가 맞다.
 */
const resolveMigrationsFolder = () => {
  if (process.env.OUTBOX_MIGRATIONS_PATH) {
    return process.env.OUTBOX_MIGRATIONS_PATH;
  }
  return typeof __OUTBOX_BUNDLE_DIR__ === 'string'
    ? path.join(__OUTBOX_BUNDLE_DIR__, 'drizzle')
    : path.join(process.cwd(), 'drizzle');
};

let _sqlite: CompatDatabase | undefined;
let _db: Db | undefined;

export function getDb(): Db {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  Logger.getInstance().info('[Outbox:DB] opening sqlite', {
    unmasked: { dbPath },
  });

  // `node:sqlite` 는 런타임 내장이라 ABI 도 rebuild 도 없다. 어댑터가 drizzle 이 기대하는
  // better-sqlite3 표면(transaction·raw)만 채운다 — betterSqliteCompat 주석 참고.
  _sqlite = createBetterSqliteCompat(
    new DatabaseSync(dbPath) as unknown as SqliteEngine,
  );
  _sqlite.exec('PRAGMA journal_mode = WAL');
  _sqlite.exec('PRAGMA synchronous = NORMAL');
  _sqlite.exec('PRAGMA foreign_keys = ON');

  // drizzle 의 better-sqlite3 드라이버는 위 표면만 쓰므로 어댑터를 그대로 받는다.
  _db = drizzle(_sqlite as never, { schema });
  return _db;
}

export function runMigrations(): void {
  const db = getDb();
  const migrationsFolder = resolveMigrationsFolder();
  Logger.getInstance().info('[Outbox:DB] running migrations', {
    unmasked: { migrationsFolder },
  });
  migrate(db, { migrationsFolder });
}

export function closeDb(): void {
  _sqlite?.close();
  _sqlite = undefined;
  _db = undefined;
}
