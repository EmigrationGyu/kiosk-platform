import { describe, expect, test } from 'bun:test';
import { summarizeTargets } from './targets';
import type { Kiosk } from './types';

const kiosk = (id: string, accommodationName?: string): Kiosk => ({
  id,
  name: id,
  connectionState: 'connected',
  accommodationName,
  versions: [],
});

const kiosks = [
  kiosk('a1', '가나호텔'),
  kiosk('a2', '가나호텔'),
  kiosk('b1', '다라모텔'),
  kiosk('c1'),
  kiosk('d1', '마바호텔'),
];

describe('summarizeTargets', () => {
  test('고른 것만, 업장별 대수로, 많은 쪽이 위', () => {
    expect(summarizeTargets(kiosks, new Set(['a1', 'a2', 'b1', 'c1']))).toEqual(
      [
        { name: '가나호텔', count: 2 },
        { name: '다라모텔', count: 1 },
        { name: '업장 미상', count: 1 },
      ],
    );
  });

  test('같은 대수면 이름순', () => {
    expect(summarizeTargets(kiosks, new Set(['d1', 'b1']))).toEqual([
      { name: '다라모텔', count: 1 },
      { name: '마바호텔', count: 1 },
    ]);
  });

  test('아무것도 안 골랐으면 비어 있다', () => {
    expect(summarizeTargets(kiosks, new Set())).toEqual([]);
  });
});
