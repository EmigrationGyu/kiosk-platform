import { describe, expect, test } from 'bun:test';
import { parseUpdateCommand } from './parseUpdateCommand';
import { APPLY_UPDATE_CONTROL, ROLLBACK_UPDATE_CONTROL } from './types';

const ID = '01KX094JBVKGTADB5JPRXH3D7J';
const packet = (payload: unknown) => JSON.stringify(payload);

describe('업데이트 지시 경계 파싱', () => {
  test('applyUpdate 지시를 정규화한다', () => {
    const raw = packet({
      controlType: APPLY_UPDATE_CONTROL,
      manifest: {
        manifestVersion: 1,
        components: { frontend: 'f5', 'token-dispenser': 'd2' },
      },
    });

    expect(parseUpdateCommand(ID, raw)).toEqual({
      commandId: ID,
      action: 'apply',
      deploymentIds: {},
      manifest: {
        manifestVersion: 1,
        components: { frontend: 'f5', 'token-dispenser': 'd2' },
      },
    });
  });

  test('rollbackUpdate 는 목적지 없이 온다 — 어디로 갈지는 키오스크가 안다', () => {
    expect(
      parseUpdateCommand(ID, packet({ controlType: ROLLBACK_UPDATE_CONTROL })),
    ).toEqual({ commandId: ID, action: 'rollback' });
  });

  test('롤백에 매니페스트가 실려 와도 무시한다 — 서버가 목적지를 정하게 두지 않는다', () => {
    expect(
      parseUpdateCommand(
        ID,
        packet({
          controlType: ROLLBACK_UPDATE_CONTROL,
          manifest: { manifestVersion: 1, components: { frontend: 'f1' } },
        }),
      ),
    ).toEqual({ commandId: ID, action: 'rollback' });
  });

  test('다른 controlType 은 이 어댑터 소관이 아니다', () => {
    const raw = packet({ controlType: 'issueKeyCard', roomId: 'room-1' });

    expect(parseUpdateCommand(ID, raw)).toBeNull();
  });

  test('JSON 이 아니어도 던지지 않는다 — onData 안의 throw 는 Apollo 로 샌다', () => {
    expect(parseUpdateCommand(ID, '{ 반쯤')).toBeNull();
    expect(parseUpdateCommand(ID, null)).toBeNull();
  });

  test('매니페스트가 없거나 형식이 틀리면 받는 자리에서 거른다 ★', () => {
    // 큐에 담아두면 안전한 화면을 기다렸다가 그때 실패한다.
    expect(
      parseUpdateCommand(ID, packet({ controlType: APPLY_UPDATE_CONTROL })),
    ).toBeNull();
    expect(
      parseUpdateCommand(
        ID,
        packet({
          controlType: APPLY_UPDATE_CONTROL,
          manifest: { manifestVersion: 1, components: { 없는것: 'x' } },
        }),
      ),
    ).toBeNull();
    expect(
      parseUpdateCommand(
        ID,
        packet({
          controlType: APPLY_UPDATE_CONTROL,
          manifest: { manifestVersion: 2, components: {} },
        }),
      ),
    ).toBeNull();
  });
});
