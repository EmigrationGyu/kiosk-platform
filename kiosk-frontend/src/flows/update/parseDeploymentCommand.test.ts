import { describe, expect, test } from 'bun:test';
import { parseDeploymentCommand } from './parseDeploymentCommand';

const payload = (deployments: unknown[], batchId = 'b1') =>
  JSON.stringify({ batchId, deployments });

describe('parseDeploymentCommand', () => {
  test('행 묶음을 매니페스트 하나로 접는다', () => {
    const parsed = parseDeploymentCommand(
      payload([
        { id: 'd1', domain: 'backend', version: '0.30.0-7' },
        { id: 'd2', domain: 'frontend', version: '0.30.0-7' },
      ]),
    );
    expect(parsed?.kind).toBe('command');
    if (parsed?.kind !== 'command') return;
    expect(parsed.command.commandId).toBe('b1');
    expect(parsed.command).toMatchObject({
      action: 'apply',
      deploymentIds: { backend: 'd1', frontend: 'd2' },
    });
  });

  test('batchId 가 지시의 id 가 된다 — 결과 기록이 이걸로 맞댄다', () => {
    const parsed = parseDeploymentCommand(
      payload(
        [{ id: 'd1', domain: 'backend', version: '0.30.0-7' }],
        'batch-9',
      ),
    );
    expect(parsed?.kind === 'command' && parsed.command.commandId).toBe(
      'batch-9',
    );
  });

  test('설치본과 컴포넌트가 섞이면 거절 — 좌표를 들고 나온다 ★', () => {
    const parsed = parseDeploymentCommand(
      payload([
        { id: 'd1', domain: 'backend', version: '0.30.0-7' },
        { id: 'd9', domain: 'base', version: '1.28.0-alpha.7' },
      ]),
    );
    expect(parsed?.kind).toBe('rejected');
    if (parsed?.kind !== 'rejected') return;
    expect(parsed.ids).toEqual({ backend: 'd1', base: 'd9' });
    expect(parsed.reason).toContain('함께 받을 수 없습니다');
  });

  test('payload 가 말이 안 되면 null — 보고할 좌표조차 없다', () => {
    expect(parseDeploymentCommand('not json')).toBeNull();
    expect(parseDeploymentCommand(null)).toBeNull();
    expect(
      parseDeploymentCommand(JSON.stringify({ batchId: 'b1' })),
    ).toBeNull();
    expect(
      parseDeploymentCommand(payload([{ id: 'd1', domain: 'backend' }])),
    ).toBeNull();
  });
});
