import { describe, expect, it } from 'bun:test';
import { AUDIO_KEYS, type AudioClipPath } from 'kiosk-types';
import {
  type AudioSegmentManifest,
  buildAudioSequence,
  foldToClips,
  type SequenceItem,
} from './sequence';

const paths = (items: SequenceItem[]) =>
  items.map((it) => (it.kind === 'clip' ? it.path : `pause:${it.ms}`));

/** `_var/{슬러그}/{인코딩된 발화}` 에서 발화 텍스트만 꺼낸다. */
const spoken = (path: string) =>
  decodeURIComponent(path.split('/').slice(2).join('/'));

const bytes = (s: string) => new TextEncoder().encode(s);

describe('buildAudioSequence', () => {
  it('매니페스트에 없는 키 → 단일 정적 클립', () => {
    const items = buildAudioSequence('ko-KR', AUDIO_KEYS.DEMO_HOME_ENTER, {});
    expect(paths(items)).toEqual(['demo_home_enter']);
  });

  it('변수 키인데 그 언어 매니페스트가 비어 있으면 → 단일 정적 클립', () => {
    // zh 는 데모에서 정적 키만 쓴다. 조립 없이 통째 클립으로 떨어져야 한다.
    const items = buildAudioSequence('zh', AUDIO_KEYS.DEMO_DISPENSE_COUNT, {
      TOKEN_COUNT: 3,
    });
    expect(paths(items)).toEqual(['demo_dispense_count']);
  });

  it('세그먼트 + 변수 슬롯을 토큰 순서대로 펼친다', () => {
    const items = buildAudioSequence('ko-KR', AUDIO_KEYS.DEMO_DISPENSE_COUNT, {
      TOKEN_COUNT: 3,
    });
    const [seg0, varSlot, seg1] = paths(items);

    expect(seg0).toBe('demo_dispense_count/0');
    expect(seg1).toBe('demo_dispense_count/1');
    expect(varSlot).toStartWith('_var/count/');
  });

  it('ko + counter 바인딩 → 수사 단위로 읽는다 (원시값 그대로가 아니다)', () => {
    const items = buildAudioSequence('ko-KR', AUDIO_KEYS.DEMO_DISPENSE_COUNT, {
      TOKEN_COUNT: 3,
    });
    const said = spoken(paths(items)[1] as string);

    expect(said).toContain('개');
    expect(said).not.toBe('3');
  });

  it('counter 가 없는 언어는 원어값 그대로 — 같은 값, 다른 발화', () => {
    const ko = buildAudioSequence('ko-KR', AUDIO_KEYS.DEMO_DISPENSE_COUNT, {
      TOKEN_COUNT: 3,
    });
    const en = buildAudioSequence('en-US', AUDIO_KEYS.DEMO_DISPENSE_COUNT, {
      TOKEN_COUNT: 3,
    });

    expect(spoken(paths(en)[1] as string)).toBe('3');
    expect(spoken(paths(ko)[1] as string)).not.toBe('3');
  });

  it('언어마다 토큰 순서가 다르다 — 이 표가 존재하는 이유', () => {
    const vars = { DEVICE_NAME: 'TD-200', WAIT_TIME: 5 };
    const ko = paths(
      buildAudioSequence('ko-KR', AUDIO_KEYS.DEMO_DISPENSE_WAIT, vars),
    );
    const en = paths(
      buildAudioSequence('en-US', AUDIO_KEYS.DEMO_DISPENSE_WAIT, vars),
    );

    // ko 는 장치명이 먼저, en 은 세그먼트가 먼저.
    expect(ko[0]).toBe('_var/device/TD-200');
    expect(en[0]).toBe('demo_dispense_wait/0');
    expect(en[1]).toBe('_var/device/TD-200');
  });

  it('duration 슬러그는 전 언어에서 포맷을 거친다 (원시 분값이 아니다)', () => {
    const items = buildAudioSequence('en-US', AUDIO_KEYS.DEMO_DISPENSE_WAIT, {
      DEVICE_NAME: 'TD-200',
      WAIT_TIME: 90,
    });
    const said = spoken(paths(items)[3] as string);

    expect(said).not.toBe('90');
    expect(said.length).toBeGreaterThan(0);
  });

  it('time 슬러그는 Unix ms 를 시각 발화로 바꾼다', () => {
    const at = Date.UTC(2026, 0, 2, 5, 30);
    const items = buildAudioSequence('en-US', AUDIO_KEYS.DEMO_NEXT_WINDOW, {
      NEXT_TIME: at,
    });
    const varPath = paths(items)[1] as string;

    expect(varPath).toStartWith('_var/time/');
    expect(spoken(varPath)).not.toBe(String(at));
  });

  it('값이 없는 변수 슬롯 → pause (그 자리만 묵음, 문장은 이어진다)', () => {
    const items = buildAudioSequence(
      'ko-KR',
      AUDIO_KEYS.DEMO_DISPENSE_COUNT,
      {}, // TOKEN_COUNT 누락
    );

    expect(paths(items)).toEqual([
      'demo_dispense_count/0',
      'pause:400',
      'demo_dispense_count/1',
    ]);
  });

  it('매니페스트를 주입하면 기본값을 대체한다', () => {
    const injected: AudioSegmentManifest = {
      'ko-KR': {
        [AUDIO_KEYS.DEMO_DISPENSE_COUNT]: [
          { var: 'TOKEN_COUNT' },
          { seg: 0 },
        ],
      },
    };
    const items = buildAudioSequence(
      'ko-KR',
      AUDIO_KEYS.DEMO_DISPENSE_COUNT,
      { TOKEN_COUNT: 3 },
      injected,
    );

    expect(paths(items)).toEqual(['_var/count/3', 'demo_dispense_count/0']);
  });
});

describe('foldToClips', () => {
  const bytesFor = (table: Record<string, string>) => (p: AudioClipPath) => {
    const hit = table[p];
    return hit === undefined ? undefined : bytes(hit);
  };

  it('pause 를 다음 클립의 선행 delay 로 접는다', () => {
    const items: SequenceItem[] = [
      { kind: 'clip', path: 'demo_dispense_count/0' },
      { kind: 'pause', ms: 400 },
      { kind: 'clip', path: 'demo_dispense_count/1' },
    ];
    const clips = foldToClips(
      items,
      bytesFor({
        'demo_dispense_count/0': 'A',
        'demo_dispense_count/1': 'B',
      }),
    );

    expect(clips).toHaveLength(2);
    expect(clips[0]?.delay).toBeUndefined();
    expect(clips[1]?.delay).toBe(400);
  });

  it('연속된 pause 는 하나의 delay 로 합산된다', () => {
    const items: SequenceItem[] = [
      { kind: 'pause', ms: 400 },
      { kind: 'pause', ms: 400 },
      { kind: 'clip', path: 'demo_dispense_count/1' },
    ];
    const clips = foldToClips(
      items,
      bytesFor({ 'demo_dispense_count/1': 'B' }),
    );

    expect(clips).toHaveLength(1);
    expect(clips[0]?.delay).toBe(800);
  });

  it('바이트가 없는 클립은 pause 로 접혀 재생이 끊기지 않는다', () => {
    const items: SequenceItem[] = [
      { kind: 'clip', path: 'demo_dispense_count/0' },
      { kind: 'clip', path: '_var/count/세 개' }, // 아직 생성 안 된 변수 클립
      { kind: 'clip', path: 'demo_dispense_count/1' },
    ];
    const clips = foldToClips(
      items,
      bytesFor({
        'demo_dispense_count/0': 'A',
        'demo_dispense_count/1': 'B',
      }),
    );

    expect(clips).toHaveLength(2);
    expect(clips[1]?.delay).toBe(400);
  });

  it('끝에 남은 pause 는 버린다 (뒤에 붙일 클립이 없다)', () => {
    const items: SequenceItem[] = [
      { kind: 'clip', path: 'demo_dispense_count/0' },
      { kind: 'pause', ms: 400 },
    ];
    const clips = foldToClips(
      items,
      bytesFor({ 'demo_dispense_count/0': 'A' }),
    );

    expect(clips).toHaveLength(1);
    expect(clips[0]?.delay).toBeUndefined();
  });
});
