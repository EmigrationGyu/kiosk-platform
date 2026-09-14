import { describe, expect, test } from 'bun:test';
import { killArgs } from './kiosk-task';

describe('키오스크 reap 인자', () => {
  test('이미지명으로 죽인다 — 기동 출처와 무관하게 ★', () => {
    expect(killArgs('Kiosk.exe')).toEqual([
      'taskkill',
      '/F',
      '/IM',
      'Kiosk.exe',
    ]);
  });

  /**
   * 되돌리기 쉬운 한 글자라 못을 박아둔다. `/T` 가 자식 트리를 잡는데, 프로덕션에서
   * 이름이 다른 자식은 우리를 갈아치우는 설치본 하나뿐이다(나머지는 utilityProcess 라
   * 이미지명이 같아 `/IM` 에 이미 걸린다). 되살리면 설치가 다시 찢긴다.
   */
  test('`/T` 는 쓰지 않는다 — 설치본이 자식 트리에 있다 ★', () => {
    expect(killArgs('Kiosk.exe')).not.toContain('/T');
  });
});
