import { UPDATE_EVENTS } from '@/shared/constants/events/Update';
import { Update } from '@/shared/transport/Update';

/**
 * 렌더러 생존 선언 — 렌더러 준비 워치독의 해제 신호.
 *
 * 부팅 완주(bootDeclaration)와 **다른 신호**다: 완주는 터치·네트워크가 껴 있어 무인
 * 부팅에선 영영 오지 않을 수 있고, 워치독이 그걸 근거로 삼으면 멀쩡한 프론트를 되감는다
 * (실측: 무인 상태에서 바닥까지 내려가 리로드 루프에 갇혔다). 생존은 React 루트의 첫
 * 커밋 직후 자동으로 선언되므로, 부재는 곧 흰 화면(번들 평가·첫 렌더 실패)이다.
 *
 * **성공할 때까지 재시도한다** — 부재가 곧 판정 근거인 신호는 전달이 보장돼야 한다.
 * 페이지 수명당 한 번 성공하면 끝이다(워치독은 로드마다 무장되고 해제는 한 번이면 된다).
 */
const RETRY_DELAY_MS = 5_000;

let delivered = false;
let started = false;

export function declareRendererAlive(): void {
  if (started) return;
  started = true;

  const fire = (): void => {
    if (delivered) return;
    new Update()
      .request(UPDATE_EVENTS.RENDERER_ALIVE)
      .then(() => {
        delivered = true;
      })
      .catch(() => {
        setTimeout(fire, RETRY_DELAY_MS);
      });
  };
  fire();
}
