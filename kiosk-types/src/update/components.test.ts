import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { artifactPrefix, componentSegments } from './components';
import { UPDATABLE_COMPONENTS } from './generation';

/**
 * prefix 는 **진짜 출처와 대조해야** 한다.
 *
 * 이름 규칙으로 조립했다가 프론트(`-v3` 접미어)에서 어긋났고, 올라간 산출물을 키오스크가
 * 404 로 못 찾았다. 단위 테스트가 같은 규칙을 되풀이하면 그 오해를 박제할 뿐이라, 여기서는
 * 실제 `package.json` 을 읽는다 — 누가 패키지 이름을 바꾸면 이 테스트가 먼저 깨진다.
 */
const REPO_ROOT = path.resolve(import.meta.dir, '..', '..', '..');

const packageJsonOf = (component: string): string =>
  component === 'backend' || component === 'frontend'
    ? path.join(REPO_ROOT, `kiosk-${component}`, 'package.json')
    : path.join(
        REPO_ROOT,
        'kiosk-serialport',
        'packages',
        component,
        'package.json',
      );

describe('산출물 prefix 는 package.json name 과 같아야 한다', () => {
  for (const component of UPDATABLE_COMPONENTS) {
    test(`${component} ★`, () => {
      const file = packageJsonOf(component);
      // 워크스페이스가 불완전한 체크아웃에서는 건너뛴다 — CI 는 전원을 받아온다.
      if (!existsSync(file)) return;

      const { name } = JSON.parse(readFileSync(file, 'utf-8')) as {
        name: string;
      };
      expect(artifactPrefix(component)).toBe(name);
    });
  }
});

describe('디스크 레이아웃', () => {
  test('serialport 는 serialport/ 아래, 나머지는 루트 바로 아래', () => {
    expect(componentSegments('backend')).toEqual(['backend']);
    expect(componentSegments('token-dispenser')).toEqual([
      'serialport',
      'token-dispenser',
    ]);
  });
});
