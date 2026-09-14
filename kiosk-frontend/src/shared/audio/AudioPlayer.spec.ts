import { beforeEach, describe, expect, it } from 'bun:test';

import {
  AUDIO_STATUS_COMPLETED,
  AUDIO_STATUS_INTERRUPTED,
  type AudioClip,
  AudioPlayer,
  PLAY_MODE_INTERRUPT,
  PLAY_MODE_QUEUE,
} from './AudioPlayer';

/** N ms 뒤에 해당 클립으로 resolve 되는 Promise — S3 fetch 지연을 모사. */
const clipsAfter = (ms: number, ...urls: string[]): Promise<AudioClip[]> =>
  new Promise((resolve) =>
    setTimeout(() => resolve(urls.map((url) => ({ url }))), ms),
  );

describe('AudioPlayer (Bun Test)', () => {
  let player: AudioPlayer;

  beforeEach(() => {
    player = AudioPlayer.getInstance();
    // 이전 테스트의 모든 태스크와 큐를 정리
    player.stop();
  });

  it('should play a single audio file', async () => {
    const playPromise = player.play([{ url: 'test.mp3' }]);
    await expect(playPromise).resolves.toBe(AUDIO_STATUS_COMPLETED);
  });

  it('should play multiple files sequentially in a single task', async () => {
    const playPromise = player.play([{ url: '1.mp3' }, { url: '2.mp3' }]);
    await expect(playPromise).resolves.toBe(AUDIO_STATUS_COMPLETED);
  });

  it('should honor per-clip delay before playing', async () => {
    const start = Date.now();
    await player.play([{ url: '1.mp3' }, { url: '2.mp3', delay: 300 }]);
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
  });

  it('should clear a pending delay timer when interrupted', async () => {
    // 첫 클립 뒤 매우 긴 delay를 건 task를 즉시 interrupt → 대기 중 취소되어야 함
    const delayed = player.play([{ url: '1.mp3', delay: 100000 }]);
    player.play([{ url: 'interrupt.mp3' }], PLAY_MODE_INTERRUPT);

    await expect(delayed).resolves.toBe(AUDIO_STATUS_INTERRUPTED);
  });

  it('should play tasks sequentially in QUEUE mode', async () => {
    let task1Finished = false;
    let task2Finished = false;

    const task1 = player.play([{ url: '1.mp3' }], PLAY_MODE_QUEUE).then(() => {
      task1Finished = true;
      expect(task2Finished).toBe(false);
    });

    const task2 = player.play([{ url: '2.mp3' }], PLAY_MODE_QUEUE).then(() => {
      task2Finished = true;
      expect(task1Finished).toBe(true);
    });

    await Promise.all([task1, task2]);
  });

  it('should cancel pending tasks and stop current task in INTERRUPT mode', async () => {
    const task1 = player.play([{ url: 'long.mp3' }], PLAY_MODE_QUEUE);
    const task2 = player.play([{ url: 'queue.mp3' }], PLAY_MODE_QUEUE);
    const task3 = player.play([{ url: 'interrupt.mp3' }], PLAY_MODE_INTERRUPT);

    await expect(task1).resolves.toBe(AUDIO_STATUS_INTERRUPTED);
    await expect(task2).resolves.toBe(AUDIO_STATUS_INTERRUPTED);
    await expect(task3).resolves.toBe(AUDIO_STATUS_COMPLETED);
  });

  it('should handle empty array gracefully', async () => {
    await expect(player.play([])).resolves.toBe(AUDIO_STATUS_COMPLETED);
  });

  it('should handle massive queue requests without stack overflow', async () => {
    const tasks = [];
    for (let i = 0; i < 100; i++) {
      tasks.push(player.play([], PLAY_MODE_QUEUE));
    }
    await expect(Promise.all(tasks)).resolves.toBeDefined();
  });

  it('should continue playing next file even if one file fails in a playlist', async () => {
    await expect(
      player.play([{ url: '1.mp3' }, { url: 'error.mp3' }, { url: '3.mp3' }]),
    ).resolves.toBe(AUDIO_STATUS_COMPLETED);
  }, 10000);

  it('should execute next task even if previous task had file errors', async () => {
    let task1Finished = false;

    const task1 = player
      .play([{ url: 'error.mp3' }], PLAY_MODE_QUEUE)
      .then(() => {
        task1Finished = true;
      });

    const task2 = player
      .play([{ url: 'valid.mp3' }], PLAY_MODE_QUEUE)
      .then(() => {
        expect(task1Finished).toBe(true);
      });

    await Promise.all([task1, task2]);
  });

  it('should handle mixed scenario: playlist with error + multiple tasks', async () => {
    const executionOrder: string[] = [];

    const task1 = player
      .play(
        [{ url: 't1-1.mp3' }, { url: 't1-error.mp3' }, { url: 't1-2.mp3' }],
        PLAY_MODE_QUEUE,
      )
      .then(() => executionOrder.push('task1-done'));

    const task2 = player
      .play([{ url: 't2-1.mp3' }], PLAY_MODE_QUEUE)
      .then(() => executionOrder.push('task2-done'));

    await Promise.all([task1, task2]);

    expect(executionOrder).toEqual(['task1-done', 'task2-done']);
  }, 10000);

  // --- 클립이 Promise(=S3 fetch 진행 중)로 들어오는 경로 ---

  it('should accept clips as a Promise and play after it resolves', async () => {
    await expect(player.play(clipsAfter(50, 'p.mp3'))).resolves.toBe(
      AUDIO_STATUS_COMPLETED,
    );
  });

  it('preserves call order in QUEUE even if a later play resolves its clips first', async () => {
    const order: string[] = [];
    // 먼저 호출한 A 의 클립은 늦게, 나중 호출한 B 의 클립은 즉시 도착한다.
    const a = player
      .play(clipsAfter(150, 'A.mp3'), PLAY_MODE_QUEUE)
      .then(() => order.push('A'));
    const b = player
      .play(Promise.resolve([{ url: 'B.mp3' }]), PLAY_MODE_QUEUE)
      .then(() => order.push('B'));

    await Promise.all([a, b]);
    // 클립 도착은 B 가 빨랐지만 재생은 호출 순서(A→B)대로여야 한다.
    expect(order).toEqual(['A', 'B']);
  }, 10000);

  it('applies INTERRUPT at call time even if the interrupting clips resolve later', async () => {
    // A 는 즉시 클립, 뒤에 호출한 B(INTERRUPT)는 늦은 클립.
    // B 호출 순간 A 는 (클립을 기다리던 중이라도) 취소돼야 한다.
    const a = player.play(Promise.resolve([{ url: 'A.mp3' }]), PLAY_MODE_QUEUE);
    const b = player.play(clipsAfter(150, 'B.mp3'), PLAY_MODE_INTERRUPT);

    await expect(a).resolves.toBe(AUDIO_STATUS_INTERRUPTED);
    await expect(b).resolves.toBe(AUDIO_STATUS_COMPLETED);
  }, 10000);

  it('drops a fetching entry when stopped before its clips arrive', async () => {
    const pending = player.play(clipsAfter(150, 'X.mp3'), PLAY_MODE_QUEUE);
    player.stop(); // 클립 도착 전에 취소

    await expect(pending).resolves.toBe(AUDIO_STATUS_INTERRUPTED);
    // 늦게 도착한 클립이 재생을 일으키거나 다음 큐를 깨우지 않아야 한다.
    const next = player.play([{ url: 'after.mp3' }], PLAY_MODE_QUEUE);
    await expect(next).resolves.toBe(AUDIO_STATUS_COMPLETED);
  }, 10000);

  it('handles a rejected clips promise without hanging', async () => {
    await expect(
      player.play(Promise.reject(new Error('fetch failed'))),
    ).resolves.toBe(AUDIO_STATUS_COMPLETED);
  });
});
