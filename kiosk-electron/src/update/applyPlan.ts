import {
  UPDATE_COMPONENT,
  type UpdateComponent,
} from 'kiosk-types/src/update/components';
/**
 * 무엇을 다시 띄워야 하는가 — 순수 판단.
 *
 * 매니페스트에 재기동 범위를 담지 않는 이유가 여기 있다: 컴포넌트 정체에서 **유도되는**
 * 사실이라, 서버가 지시하게 하면 서버가 그걸 틀릴 수 있다.
 */
export type RestartPlan = {
  backend: boolean;
  renderer: boolean;
  devices: UpdateComponent[];
};

export function planRestart(changed: readonly UpdateComponent[]): RestartPlan {
  return {
    backend: changed.includes(UPDATE_COMPONENT.BACKEND),
    renderer: changed.includes(UPDATE_COMPONENT.FRONTEND),
    // 장치는 죽이기만 하면 된다 — 백엔드의 멱등한 ensure 가 새 포인터로 다시 해석해 띄운다.
    devices: changed.filter(
      (c) => c !== UPDATE_COMPONENT.BACKEND && c !== UPDATE_COMPONENT.FRONTEND,
    ),
  };
}
