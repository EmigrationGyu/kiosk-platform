import { describe, expect, it } from 'bun:test';
import type { DeviceId } from 'src/constant/events/Hardware';
import { ExclusiveDevice } from './ExclusiveDevice';

const DEVICE = 'token_dispenser' as DeviceId;
const CASH = 'cash_dispenser' as DeviceId;

const tick = () => new Promise((r) => setTimeout(r, 1));

/**
 * 실장애 재현 — 시리얼 채널 위 다단계 시퀀스.
 *
 * 각 스텝은 개별 IPC 왕복이라 그 사이에 이벤트 루프가 열린다. 그 틈으로 다른 시퀀스의
 * 스텝이 끼어드는 것이 2026-07-09 사고의 물리적 정체다(writeCardData 사이로 collectToHopper).
 */
class Dispenser {
  readonly wire: string[] = [];

  @ExclusiveDevice(DEVICE)
  async issueCard(tag: string): Promise<void> {
    for (const step of ['dispense', 'write1', 'write2', 'present']) {
      this.wire.push(`${tag}:${step}`);
      await tick();
    }
  }

  @ExclusiveDevice(DEVICE)
  async collectCard(tag: string): Promise<void> {
    this.wire.push(`${tag}:collect`);
    await tick();
  }

  /** 폴링·취소는 배타 대상이 아니다 — 뮤텍스를 기다리면 안 된다. */
  async getStatus(tag: string): Promise<void> {
    this.wire.push(`${tag}:status`);
  }
}

/** 한 시퀀스의 스텝들이 연속으로 붙어 있는가(= 다른 tag 가 끼어들지 않았는가). */
const isContiguous = (wire: string[], tag: string): boolean => {
  const indices = wire
    .map((entry, i) => (entry.startsWith(`${tag}:`) ? i : -1))
    .filter((i) => i >= 0);
  return indices.every((v, i) => i === 0 || v === (indices[i - 1] ?? 0) + 1);
};

describe('ExclusiveDevice', () => {
  it('동시 매크로 연산 2건이 서로의 스텝 사이로 끼어들지 않는다', async () => {
    const d = new Dispenser();
    await Promise.all([d.issueCard('A'), d.issueCard('B')]);

    expect(d.wire).toHaveLength(8);
    expect(isContiguous(d.wire, 'A')).toBe(true);
    expect(isContiguous(d.wire, 'B')).toBe(true);
  });

  it('발급 도중 회수가 끼어들지 못한다 (2026-07-09 collectToHopper 시나리오)', async () => {
    const d = new Dispenser();
    const issuing = d.issueCard('issue');
    await tick(); // 발급이 첫 스텝을 넘긴 뒤 회수를 밀어넣는다
    await Promise.all([issuing, d.collectCard('recycle')]);

    expect(d.wire).toEqual([
      'issue:dispense',
      'issue:write1',
      'issue:write2',
      'issue:present',
      'recycle:collect',
    ]);
  });

  it('FIFO — 대기한 순서대로 채널을 넘겨받는다', async () => {
    const d = new Dispenser();
    const first = d.collectCard('1');
    const second = d.collectCard('2');
    const third = d.collectCard('3');
    await Promise.all([first, second, third]);

    expect(d.wire).toEqual(['1:collect', '2:collect', '3:collect']);
  });

  it('배타 대상이 아닌 메서드는 진행 중 연산을 기다리지 않는다', async () => {
    const d = new Dispenser();
    const issuing = d.issueCard('issue');
    await d.getStatus('poll'); // 뮤텍스가 잡혀 있어도 즉시 통과
    await issuing;

    expect(d.wire.indexOf('poll:status')).toBeLessThan(
      d.wire.indexOf('issue:present'),
    );
  });

  it('디바이스별로 뮤텍스가 분리된다 — 카드키가 현금을 막지 않는다', async () => {
    const order: string[] = [];

    class TwoDevices {
      @ExclusiveDevice(DEVICE)
      async slowCardkey(): Promise<void> {
        order.push('device:start');
        await tick();
        await tick();
        order.push('device:end');
      }

      @ExclusiveDevice(CASH)
      async fastCash(): Promise<void> {
        order.push('cash:start');
        order.push('cash:end');
      }
    }

    const t = new TwoDevices();
    await Promise.all([t.slowCardkey(), t.fastCash()]);

    // 현금이 카드키 완료 전에 끝났다 = 서로 다른 뮤텍스
    expect(order.indexOf('cash:end')).toBeLessThan(order.indexOf('device:end'));
  });

  it('연산이 throw 해도 채널을 반납한다', async () => {
    class Failing {
      @ExclusiveDevice(DEVICE)
      async boom(): Promise<void> {
        throw new Error('device error');
      }

      @ExclusiveDevice(DEVICE)
      async after(): Promise<string> {
        return 'ok';
      }
    }

    const f = new Failing();
    await expect(f.boom()).rejects.toThrow('device error');
    // 뮤텍스가 새면 여기서 영원히 매달린다
    await expect(f.after()).resolves.toBe('ok');
  });

  it('메서드 시그니처(인자·반환)를 보존한다', async () => {
    class Typed {
      @ExclusiveDevice(DEVICE)
      async echo(a: number, b: string): Promise<string> {
        return `${a}${b}`;
      }
    }
    expect(await new Typed().echo(1, 'x')).toBe('1x');
  });
});
