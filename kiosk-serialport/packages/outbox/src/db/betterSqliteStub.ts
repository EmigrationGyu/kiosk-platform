/**
 * `better-sqlite3` 자리에 끼우는 스텁.
 *
 * drizzle 의 better-sqlite3 드라이버는 모듈 최상단에서 이 패키지를 import 하지만,
 * **클라이언트를 직접 넘기면 절대 생성하지 않는다**(파일명을 넘기는 편의 경로에서만 쓴다).
 * 우리는 `node:sqlite` 어댑터를 넘기므로, 네이티브 패키지를 설치할 이유가 없다.
 *
 * 혹시 그 경로로 흘러들면 조용히 다른 드라이버가 열리는 대신 여기서 크게 터진다.
 */
export default class BetterSqliteStub {
  constructor() {
    throw new Error(
      '[outbox] better-sqlite3 는 이 프로젝트에서 쓰지 않는다 — ' +
        'node:sqlite 어댑터(betterSqliteCompat)를 drizzle 에 직접 넘겨야 한다.',
    );
  }
}
