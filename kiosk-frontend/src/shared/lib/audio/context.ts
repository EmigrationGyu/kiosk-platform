/**
 * Web Audio 합성음(알림음·타건음)이 공유하는 `AudioContext`.
 *
 * 브라우저가 개수를 제한하므로 하나만 만들어 돌려쓴다. 공유해도 소리끼리 간섭하지
 * 않는다 — 인터럽트가 걸리는 "단일 슬롯"은 안내 음성 `AudioPlayer` 쪽 이야기다.
 *
 * 모듈 로드만으로 오디오 장치를 잡지 않도록 첫 사용 시점에 만든다.
 */
let sharedContext: AudioContext | null = null;

/** `interactive` — 타건음처럼 누른 즉시 나야 하는 소리가 있어 지연을 최소로 요청한다. */
export const getAudioContext = (): AudioContext => {
  sharedContext ??= new AudioContext({ latencyHint: 'interactive' });
  return sharedContext;
};
