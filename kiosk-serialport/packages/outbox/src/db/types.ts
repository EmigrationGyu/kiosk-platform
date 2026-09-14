import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/**
 * 도메인 코드가 의존하는 추상 — 드라이버를 모른다.
 *
 * `client.ts` 와 갈라둔 이유: 배럴이 client 를 재export 하면 스키마만 필요한 테스트까지
 * 드라이버 모듈을 끌고 온다(그쪽은 `node:sqlite`, 테스트는 `bun:sqlite` 라 맞지 않는다).
 */
// biome-ignore lint/suspicious/noExplicitAny: TRunResult 가 드라이버별로 달라서 한 쪽으로 좁히면 다른 쪽 호환 깨짐
export type Db = BaseSQLiteDatabase<'sync', any, typeof schema>;
