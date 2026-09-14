import { Howl } from 'howler';
import { Logger } from '../logger/Logger';

export const PLAY_MODE_INTERRUPT = 'interrupt';
export const PLAY_MODE_QUEUE = 'queue';

export type PlayMode = typeof PLAY_MODE_INTERRUPT | typeof PLAY_MODE_QUEUE;

export const AUDIO_STATUS_COMPLETED = 'completed';
export const AUDIO_STATUS_INTERRUPTED = 'interrupted';
export type AudioPlayStatus =
  | typeof AUDIO_STATUS_COMPLETED
  | typeof AUDIO_STATUS_INTERRUPTED;

const logger = new Logger();

export interface AudioClip {
  url: string;
  /** 이 클립을 재생하기 전에 대기할 시간(ms) */
  delay?: number;
}

/**
 * 클립 URL 들을 해제한다. `resolveAudioClip` 이 만든 Blob URL 은 캐시되지 않으므로(1회용)
 * 재생을 마치거나 버려질 때 여기서 revoke 해 렌더러 Blob 저장소 누수를 막는다.
 * 가드: 우리가 만든 `blob:` URL 만 대상으로 한다 (테스트의 가짜 url 은 건너뜀).
 */
function revokeClips(clips: AudioClip[]): void {
  for (const clip of clips) {
    if (clip.url.startsWith('blob:')) URL.revokeObjectURL(clip.url);
  }
}

/**
 * 준비된 클립 시퀀스를 순서대로 재생하는 단위. 비동기/취소는 알지 못한다 —
 * 클립 fetch 대기와 취소 판정은 AudioPlayer 가 담당하고, 여기는 "재생"만 한다.
 * 완료/취소 시 `resolve` 를 정확히 1회 호출한다.
 */
class AudioTask {
  private currentHowl: Howl | null = null;
  private currentIndex = 0;
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private isFinished = false;
  private readonly clips: AudioClip[];
  private readonly resolve: (status: AudioPlayStatus) => void;

  constructor(clips: AudioClip[], resolve: (status: AudioPlayStatus) => void) {
    this.clips = clips;
    this.resolve = resolve;
  }

  public play(): void {
    this.playNext();
  }

  private playNext(): void {
    if (this.isFinished) return;

    if (this.currentIndex >= this.clips.length) {
      this.finish(AUDIO_STATUS_COMPLETED);
      return;
    }

    const clip = this.clips[this.currentIndex];
    const delay = clip.delay ?? 0;

    if (delay > 0) {
      this.delayTimer = setTimeout(() => {
        this.delayTimer = null;
        this.playClip(clip);
      }, delay);
    } else {
      this.playClip(clip);
    }
  }

  private playClip(clip: AudioClip): void {
    const { url } = clip;

    this.unloadCurrent();

    this.currentHowl = new Howl({
      src: [url],
      format: ['mp3'],
      autoplay: false,
      html5: true,
      onend: () => {
        this.currentIndex++;
        this.playNext();
      },
      onloaderror: (_, error) => {
        if (error instanceof Error) {
          logger.error(`Load error for url: ${url}`, error);
        } else if (typeof error === 'string') {
          logger.error(`Load error for url: ${url}`, new Error(error));
        } else {
          logger.error(
            `Load error for url: ${url}`,
            new Error('Unknown error while loading audio'),
          );
        }
        this.currentIndex++;
        this.playNext();
      },
      onplayerror: (_, error) => {
        if (error instanceof Error) {
          logger.error(`Play error for url: ${url}`, error);
        } else if (typeof error === 'string') {
          logger.error(`Play error for url: ${url}`, new Error(error));
        } else {
          logger.error(
            `Play error for url: ${url}`,
            new Error('Unknown error while playing audio'),
          );
        }
        this.currentIndex++;
        this.playNext();
      },
    });

    this.currentHowl.play();
  }

  private unloadCurrent(): void {
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.currentHowl) {
      this.currentHowl.off();
      this.currentHowl.stop();
      this.currentHowl.unload();
      this.currentHowl = null;
    }
  }

  private finish(status: AudioPlayStatus): void {
    if (this.isFinished) return;
    this.isFinished = true;
    this.unloadCurrent();
    // 재생한 클립이든 (취소로) 못 다다른 클립이든, 이 task 가 받은 모든 URL 을 여기서 해제한다.
    revokeClips(this.clips);
    this.resolve(status);
  }

  /** 재생 중이면 Howl 을 멈추고 INTERRUPTED 로 종료한다. */
  public cancel(): void {
    this.finish(AUDIO_STATUS_INTERRUPTED);
  }
}

/** 큐에 쌓이는 한 건의 재생 요청. clips 는 아직 fetch 중(Promise)일 수 있다. */
interface QueuedClips {
  clips: AudioClip[] | Promise<AudioClip[]>;
  resolve: (status: AudioPlayStatus) => void;
}

export class AudioPlayer {
  static instance: AudioPlayer | null = null;
  private queue: QueuedClips[] = [];
  /** 현재 처리 중인 요청(클립 대기 ~ 재생). 이 identity 가 곧 "활성" 여부다. */
  private currentEntry: QueuedClips | null = null;
  /** currentEntry 가 실제 재생에 들어갔으면 그 task. (클립 대기 중이면 null) */
  private currentTask: AudioTask | null = null;

  public static getInstance(): AudioPlayer {
    if (!AudioPlayer.instance) {
      AudioPlayer.instance = new AudioPlayer();
    }
    return AudioPlayer.instance;
  }

  public play(
    clips: AudioClip[] | Promise<AudioClip[]>,
    mode: PlayMode = PLAY_MODE_INTERRUPT,
  ): Promise<AudioPlayStatus> {
    return new Promise((resolve) => {
      // 모드 적용·enqueue 는 호출 즉시(동기) 확정한다 — clips 가 Promise 여도 마찬가지.
      // 호출 순서 = 큐 순서가 되어, S3 fetch 가 늦거나 뒤바뀌어도 INTERRUPT·QUEUE 가
      // "논리적 호출 순서대로" 적용된다(클립 도착 순서가 순서를 흔들지 않는다).
      if (mode === PLAY_MODE_INTERRUPT) {
        this.stop();
      }
      this.queue.push({ clips, resolve });
      this.consume();
    });
  }

  private consume(): void {
    if (this.currentEntry) return;

    const entry = this.queue.shift();
    if (!entry) return;
    this.currentEntry = entry;

    if (Array.isArray(entry.clips)) {
      this.startPlayback(entry, entry.clips);
      return;
    }

    // 클립 fetch 를 "자기 차례에" 기다린다. 대기 중 stop/INTERRUPT 로 currentEntry 가
    // 교체되면 이 요청은 큐에서 밀려난 것이므로(=취소), 도착한 클립을 버린다(identity 체크).
    entry.clips.then(
      (clips) => {
        // 대기 중 교체됐으면(취소) 도착한 클립을 버린다 — 만들어진 URL 도 함께 해제한다.
        if (this.currentEntry !== entry) {
          revokeClips(clips);
          return;
        }
        this.startPlayback(entry, clips);
      },
      (error) => {
        logger.error(error instanceof Error ? error : new Error(String(error)));
        if (this.currentEntry === entry)
          this.advance(entry, AUDIO_STATUS_COMPLETED);
      },
    );
  }

  private startPlayback(entry: QueuedClips, clips: AudioClip[]): void {
    this.currentTask = new AudioTask(clips, (status) => {
      // task 가 완료/취소로 끝났을 때. 아직 활성이면 다음으로 넘어가고,
      // 이미 stop 으로 비워진 경우(취소)엔 resolve 만 흘려보낸다. resolve 는 task 가 1회 보장.
      if (this.currentEntry === entry) this.advance(entry, status);
      else entry.resolve(status);
    });
    this.currentTask.play();
  }

  /** 현재 요청을 종료 처리하고(resolve) 다음 큐로 넘어간다. */
  private advance(entry: QueuedClips, status: AudioPlayStatus): void {
    this.currentEntry = null;
    this.currentTask = null;
    entry.resolve(status);
    this.consume();
  }

  public stop(): void {
    // 대기 큐를 비운다 — 각 요청은 INTERRUPTED 로 종료하고, (도착했거나 도착할) 클립 URL 도 해제한다.
    for (const entry of this.queue) {
      entry.resolve(AUDIO_STATUS_INTERRUPTED);
      Promise.resolve(entry.clips).then(revokeClips, () => undefined);
    }
    this.queue = [];

    const entry = this.currentEntry;
    if (!entry) return;
    // identity 무효화: 클립 대기 중이던 then 콜백은 이 시점부터 버려진다(거기서 클립을 revoke 한다).
    this.currentEntry = null;
    const task = this.currentTask;
    this.currentTask = null;
    if (task) {
      task.cancel(); // 재생 중: Howl 정지 + resolve(INTERRUPTED)
    } else {
      entry.resolve(AUDIO_STATUS_INTERRUPTED); // 아직 클립 대기 중: 직접 resolve
    }
  }
}
