import { describe, expect, test } from 'bun:test';
import { SERIALPORT_PROCESS } from '../serialport/processes';
import {
  decodeLogLine,
  encodeLogLine,
  formatLogRecord,
  formatLogTime,
  LOG_ORIGIN,
  type LogRecord,
} from './record';

/**
 * 로그 계약 박제.
 *
 * 로그를 만드는 프로세스와 파일에 쓰는 프로세스가 **이 파일 하나로만** 연결된다. 여기가
 * 어긋나면 서브프로세스 로그가 에러 없이 통째로 사라지므로(파일도 안 열고 부모도 못 알아봄)
 * 왕복과 거절 조건을 촘촘히 고정한다.
 */

const record: LogRecord = {
  origin: SERIALPORT_PROCESS.TOKEN_DISPENSER,
  level: 'warn',
  time: '2026-08-28 10:11:12.130',
  msg: '토큰 회수 지연',
};

describe('로그 줄 codec', () => {
  test('왕복하면 레코드가 그대로 돌아온다', () => {
    expect(decodeLogLine(encodeLogLine(record))).toEqual(record);
  });

  test('meta·err 까지 왕복한다', () => {
    const full: LogRecord = {
      ...record,
      level: 'error',
      meta: { slot: 2, retry: true },
      err: {
        name: 'Error',
        message: '타임아웃',
        stack: 'Error: 타임아웃\n  at x',
      },
    };
    expect(decodeLogLine(encodeLogLine(full))).toEqual(full);
  });

  test('한 줄로 인코딩된다 — 스택이 있어도 줄이 쪼개지지 않는다', () => {
    const line = encodeLogLine({
      ...record,
      err: { message: '실패', stack: 'Error: 실패\n  at a\n  at b' },
    });
    expect(line).not.toInclude('\n');
  });

  test('프레이밍 없는 줄은 로그가 아니다 ([ready]·번들러 잡음)', () => {
    expect(decodeLogLine('[ready]')).toBeNull();
    expect(decodeLogLine('vite v7.1.7 building...')).toBeNull();
  });

  test('프레이밍은 있는데 내용이 깨졌으면 throw 하지 않고 거절한다', () => {
    expect(decodeLogLine('@log:{not json')).toBeNull();
    expect(decodeLogLine('@log:{"level":"info"}')).toBeNull();
  });

  test('닫힌 집합 밖의 origin 은 거절한다 — 새 출처는 LOG_ORIGIN 에 등록해야 한다', () => {
    const line = `@log:${JSON.stringify({ ...record, origin: 'nope' })}`;
    expect(decodeLogLine(line)).toBeNull();
  });
});

describe('로그 줄 포맷', () => {
  test('출처가 줄에 남는다 — 파일이 하나라 파일명 대신 이 태그가 근거다', () => {
    expect(formatLogRecord(record)).toInclude('[token-dispenser]');
  });

  test('레벨은 사람이 읽는 라벨로 나간다', () => {
    expect(formatLogRecord({ ...record, level: 'info' })).toStartWith('[정보]');
    expect(formatLogRecord({ ...record, level: 'warn' })).toStartWith('[경고]');
    expect(formatLogRecord({ ...record, level: 'fatal' })).toStartWith(
      '[에러]',
    );
  });

  test('버전은 쓰는 쪽이 넣는다 (레코드에 싣지 않는다)', () => {
    expect(formatLogRecord(record)).not.toInclude('버전');
    expect(formatLogRecord(record, { version: '1.24.0' })).toInclude(
      '[버전:1.24.0]',
    );
  });

  test('문맥(msg)과 원인(err.message)을 둘 다 남긴다', () => {
    const line = formatLogRecord({
      ...record,
      level: 'error',
      msg: '[체크인] 자동배정 객실 해제 실패',
      err: { message: 'Request /reset timeout' },
    });
    expect(line).toInclude('[체크인] 자동배정 객실 해제 실패');
    expect(line).toInclude('Request /reset timeout');
  });

  test('문맥과 원인이 같으면 한 번만 남긴다', () => {
    const line = formatLogRecord({
      ...record,
      level: 'error',
      msg: '같은 문장',
      err: { message: '같은 문장' },
    });
    expect(line).toInclude('[메세지: 같은 문장]');
    expect(line).not.toInclude('—');
  });

  test('msg 가 이미 원인을 품고 있으면 덧붙이지 않는다 (withErrorHandler 형태)', () => {
    // withErrorHandler 는 `${문맥}: ${원인}` 으로 msg 를 만들고 에러도 함께 넘긴다.
    const line = formatLogRecord({
      ...record,
      level: 'error',
      msg: '생존 선언 처리 실패: Bridge client 미설정',
      err: { message: 'Bridge client 미설정' },
    });
    expect(line).toInclude(
      '[메세지: 생존 선언 처리 실패: Bridge client 미설정]',
    );
    expect(line).not.toInclude('—');
  });

  test('원인이 msg 의 것과 다르면 덧붙인다 (디바이스 코드 등)', () => {
    const line = formatLogRecord({
      ...record,
      level: 'error',
      msg: '카드 발급 실패: SEARCH_CARD_FAILURE',
      err: { message: 'Request /issue_card timeout' },
    });
    expect(line).toInclude(
      '카드 발급 실패: SEARCH_CARD_FAILURE — Request /issue_card timeout',
    );
  });

  test('스택은 다음 줄에 붙는다', () => {
    const line = formatLogRecord({
      ...record,
      level: 'error',
      err: { message: '실패', stack: 'Error: 실패\n  at a' },
    });
    expect(line).toInclude('\n스택: Error: 실패');
  });

  /**
   * 값은 전부 meta 로 오므로(메시지 보간 금지) 여기서 줄이 갈라지면 **모든 로그가** 여러 줄이
   * 된다. 얕고 스칼라면 한 줄에 붙이고, 중첩일 때만 아래로 내린다.
   */
  test('얕은 meta 는 key=value 로 같은 줄에 붙는다', () => {
    const line = formatLogRecord({
      ...record,
      meta: { roomName: '301', attempt: 2 },
    });
    expect(line).toInclude(' roomName=301 attempt=2');
    expect(line).not.toInclude('데이터:');
  });

  test('공백이 든 값은 감싸서 key=value 경계를 지킨다', () => {
    expect(
      formatLogRecord({ ...record, meta: { roomName: '3층 101호' } }),
    ).toInclude('roomName="3층 101호"');
  });

  test('스칼라 배열은 한 줄에', () => {
    expect(
      formatLogRecord({
        ...record,
        meta: { guestNames: ['홍길동', '김철수'] },
      }),
    ).toInclude('guestNames=[홍*동, 김*수]');
  });

  /**
   * 경계가 원소별로 가리려면 호출부가 `[{ guestName, score }]` 를 넘겨야 한다(조치 A-10).
   * 이걸 블록으로 내리면 **실패 검색마다 찍히는 최빈 진단 줄이 20줄**이 된다.
   */
  test('얕은 객체의 배열도 한 줄에 — 원소별 마스킹과 한 줄 형식이 양립한다', () => {
    const line = formatLogRecord({
      ...record,
      meta: {
        nearMisses: [
          { guestName: '홍길순', score: 0.72 },
          { guestName: '김철수', score: 0.65 },
        ],
      },
    });
    expect(line).toInclude(
      'nearMisses=[{guestName=홍*순 score=0.72}, {guestName=김*수 score=0.65}]',
    );
    expect(line).not.toInclude('데이터:');
  });

  test('원소 안의 unmasked 도 같은 높이로 편다', () => {
    expect(
      formatLogRecord({
        ...record,
        meta: {
          searchAttempts: [
            { searchName: '홍길동', unmasked: { label: '원문', minScore: 1 } },
          ],
        },
      }),
    ).toInclude('searchAttempts=[{searchName=홍*동 label=원문 minScore=1}]');
  });

  test('얕은 객체는 한 줄에', () => {
    expect(
      formatLogRecord({
        ...record,
        meta: { unmasked: { counts: { 발음불일치: 2, 길이초과: 1 } } },
      }),
    ).toInclude('counts={발음불일치=2 길이초과=1}');
  });

  test('한 겹보다 깊으면 블록으로 내린다 — 한 줄에 욱여넣어도 못 읽는다', () => {
    expect(
      formatLogRecord({
        ...record,
        meta: { unmasked: { deep: [{ inner: { a: 1 } }] } },
      }),
    ).toInclude('데이터: {');
  });

  test('객체가 아닌 meta 는 예전 형태를 유지한다', () => {
    expect(formatLogRecord({ ...record, meta: 3 })).toInclude('[데이터: 3]');
  });

  /**
   * 마스킹이 포맷터 안에 있는 이유 — 로그 줄이 되는 유일한 통로라, 백엔드를 안 거치는
   * writer(serialport 파일 sink·electron 메인)까지 한 번에 덮인다.
   */
  test('개인정보는 여기서 가려진다 — 원문이 줄에 남지 않는다', () => {
    const line = formatLogRecord({
      ...record,
      meta: { guestName: '홍길동', roomName: '301' },
    });
    expect(line).not.toInclude('홍길동');
    expect(line).toInclude('guestName=홍*동');
    expect(line).toInclude('roomName=301');
  });

  // `unmasked={…}` 로 한 겹 더 들어가면 지금 로그보다 읽기 나빠진다 — 같은 높이로 편다.
  test('unmasked 안쪽은 같은 높이로 펼쳐지고 가려지지 않는다', () => {
    const line = formatLogRecord({
      ...record,
      meta: {
        guestName: '홍길동',
        unmasked: { expected: '0x1f', candidate: '02301f03' },
      },
    });
    expect(line).toInclude('guestName=홍*동 expected=0x1f candidate=02301f03');
    expect(line).not.toInclude('unmasked=');
  });

  test('등록되지 않은 키는 값이 버려진다', () => {
    expect(formatLogRecord({ ...record, meta: { a: 1 } })).toInclude(
      'a=[미등록]',
    );
  });

  test('줄바꿈으로 끝난다 — 뒤 줄과 붙지 않는다', () => {
    expect(formatLogRecord(record)).toEndWith('\n');
    expect(
      formatLogRecord({ ...record, err: { message: 'x', stack: 'y' } }),
    ).toEndWith('\n');
  });
});

describe('formatLogTime', () => {
  test('YYYY-MM-DD HH:mm:ss.SSS', () => {
    expect(formatLogTime(new Date(2026, 7, 28, 9, 5, 3, 7))).toBe(
      '2026-08-28 09:05:03.007',
    );
  });

  test('앞 10글자가 로그 파일의 날짜와 같다', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5, 6);
    expect(formatLogTime(d).slice(0, 10)).toBe('2026-01-02');
  });
});

describe('LOG_ORIGIN', () => {
  test('electron 메인도 같은 어휘를 쓴다 (파일만 분리되어 있다)', () => {
    const line = formatLogRecord({
      origin: LOG_ORIGIN.MAIN,
      level: 'error',
      time: record.time,
      msg: 'uncaught: boom',
    });
    expect(line).toInclude('[main]');
  });
});
