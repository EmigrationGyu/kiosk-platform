/**
 * 전 패키지 테스트 러너.
 *
 * 루트에서 `bun test` 를 그냥 돌리면 안 된다 — 두 가지가 깨진다.
 *
 *  1. `kiosk-frontend/bunfig.toml` 의 preload 가 루트 실행에서는 적용되지 않는다. 그러면
 *     AudioPlayer 가 목이 아닌 **실제 소켓**을 열고 응답을 기다려 스위트가 통째로 매달린다
 *     (실측: 10분 넘게 출력 한 줄 없이 행).
 *  2. `kiosk-supervisor` 는 워크스페이스가 아니라 자기 node_modules 를 쓴다. 루트에서 돌리면
 *     `Cannot find package 'zod'` 로 죽는다.
 *
 * 둘 다 원인이 같다 — **테스트는 자기 패키지 디렉터리를 cwd 로 가져야 한다.** 그래서 각
 * 패키지에서 따로 띄우고 결과만 합친다.
 */

const PACKAGES = [
  'kiosk-types',
  'kiosk-backend',
  'kiosk-frontend',
  'kiosk-serialport',
  'kiosk-electron',
  'kiosk-supervisor',
  'update-console',
] as const;

type Tally = { pass: number; fail: number; skip: number };

/** bun test 의 요약줄(` 204 pass`)에서 수치만 긁는다. */
const parse = (output: string): Tally => {
  const num = (label: string): number => {
    const m = output.match(new RegExp(`^\\s*(\\d+)\\s+${label}\\s*$`, 'm'));
    return m?.[1] ? Number(m[1]) : 0;
  };
  return { pass: num('pass'), fail: num('fail'), skip: num('skip') };
};

const results: Array<{ name: string; tally: Tally; code: number }> = [];

for (const name of PACKAGES) {
  const proc = Bun.spawn(['bun', 'test'], {
    cwd: new URL(`../${name}/`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const combined = `${out}\n${err}`;
  const tally = parse(combined);
  results.push({ name, tally, code });

  const mark = tally.fail > 0 || code !== 0 ? '✗' : '✓';
  console.log(
    `${mark} ${name.padEnd(18)} ${String(tally.pass).padStart(5)} pass` +
      (tally.fail ? `  ${tally.fail} fail` : '') +
      (tally.skip ? `  ${tally.skip} skip` : ''),
  );

  // 실패한 패키지만 전문을 남긴다 — 통과한 것까지 쏟으면 실패가 묻힌다.
  if (tally.fail > 0 || code !== 0) console.log(combined);
}

const total = results.reduce<Tally>(
  (acc, r) => ({
    pass: acc.pass + r.tally.pass,
    fail: acc.fail + r.tally.fail,
    skip: acc.skip + r.tally.skip,
  }),
  { pass: 0, fail: 0, skip: 0 },
);

console.log(
  `\n${total.pass} pass · ${total.fail} fail · ${total.skip} skip ` +
    `(${total.pass + total.fail + total.skip} cases, ${PACKAGES.length} packages)`,
);

process.exit(results.some((r) => r.tally.fail > 0 || r.code !== 0) ? 1 : 0);
