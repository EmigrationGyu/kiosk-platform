import { mock } from 'bun:test';

// ⚠️ 지우지 말 것: mock.module 보다 먼저 gql 을 링크시켜 둔다. 없으면 Linux/bun 전체
// 스위트에서 gql 의 `export enum` named export 가 누락되어 테스트가 깨진다(단일 파일은 정상).

/**
 * 가짜 재생이 끝나기까지의 시간.
 *
 * **작고 결정적이어야 한다.** 예전에는 100~2100ms 난수였는데, 스위트가 그 평균에 테스트
 * 수를 곱한 만큼(≈24초) 그냥 기다렸다. 이 값이 검증하는 것은 "재생이 비동기로 끝난다"는
 * 사실뿐이고, 순서·경합 테스트는 각자 `clipsAfter(ms)` 로 자기 타이밍을 만든다.
 * 난수는 재현되지 않는 실패까지 덤으로 얹는다.
 */
const PLAYBACK_MS = 20;

// Socket Mocking
mock.module('../socket/Socket', () => {
  return {
    createSocket: () => ({
      on: () => {
        return;
      },
      off: () => {
        return;
      },
      emit: () => {
        return;
      },
      connect: () => {
        return;
      },
      disconnect: () => {
        return;
      },
    }),
  };
});

// Transport Mocking (both alias and relative path)
mock.module('transport/Transport', () => {
  return {
    Transport: class Transport {
      request() {
        return Promise.resolve({});
      }
    },
  };
});

mock.module('../transport/impl/socket', () => {
  return {
    Transport: class Transport {
      request() {
        return Promise.resolve({});
      }
    },
  };
});

// Log Transport Mocking
mock.module('../transport/Log', () => {
  return {
    Log: class Log {
      request() {
        return Promise.resolve({});
      }
    },
  };
});

// Logger Mocking
mock.module('../logger/Logger', () => {
  return {
    Logger: class Logger {
      error() {
        return Promise.resolve({});
      }
      warn() {
        return Promise.resolve({});
      }
      info() {
        return Promise.resolve({});
      }
      debug() {
        return Promise.resolve({});
      }
    },
  };
});

// Howler Mocking
mock.module('howler', () => {
  return {
    Howl: class Howl {
      config: any;
      state: string;

      constructor(config: any) {
        this.config = config;
        this.state = 'unloaded';
      }
      play() {
        this.state = 'loaded';
        // 에러 시뮬레이션: 파일명이 'error'를 포함하면 로드 에러 발생
        if (
          this.config.src &&
          this.config.src[0] &&
          this.config.src[0].includes('error')
        ) {
          if (this.config.onloaderror) {
            setTimeout(
              () => this.config.onloaderror(null, 'Load Error Simulated'),
              PLAYBACK_MS,
            );
          }
          return;
        }

        // 비동기 동작 시뮬레이션 (setTimeout)
        if (this.config.onend) {
          setTimeout(() => {
            if (this.state !== 'unloaded') this.config.onend();
          }, PLAYBACK_MS);
        }
      }
      stop() {
        this.state = 'unloaded';
        if (this.config.onstop) {
          this.config.onstop();
        }
      }
      unload() {
        this.state = 'unloaded';
      }
      on() {
        return;
      }
      off() {
        return;
      }
    },
  };
});
