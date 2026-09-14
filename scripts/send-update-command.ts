/**
 * 서버에서 업데이트 지시를 쏜다 — **업데이트 페이지 대역**.
 *
 * 하네스가 파일로 대신하던 도착 경로를 진짜로 태운다: 서버 뮤테이션 →
 * kioskSystemSubscription → 렌더러 큐 → 안전한 화면 드레인 → 백엔드.
 *
 * 원격 키 발급과 **같은 뮤테이션**을 쓴다(`sendKioskControlPacket`) — data 는 불투명한
 * JSON 문자열이고 controlType 으로 갈리므로 서버에 새로 만들 것이 없다.
 *
 *   bun scripts/send-update-command.ts --id <계정> --pw <비밀번호> [--kiosk <id>] \
 *     --host <서버 주소> <컴포넌트>=<버전>...
 *
 * 자격증명과 서버 주소는 인자 또는 env(KIOSK_ID · KIOSK_PW · KIOSK_HOST)로 받는다 —
 * 파일에 적지 않는다.
 * `--kiosk` 없이 부르면 키오스크 목록만 보여주고 끝난다.
 */
import { APPLY_UPDATE_CONTROL } from '../kiosk-frontend/src/flows/update/types';
import { ManifestSchema } from '../kiosk-types/src/update/generation';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const HOST = flag('host') ?? process.env.KIOSK_HOST;
const IDENTITY = flag('id') ?? process.env.KIOSK_ID;
const PASSWORD = flag('pw') ?? process.env.KIOSK_PW;
const KIOSK_ID = flag('kiosk');

if (!HOST) {
  console.error('서버 주소가 필요합니다: --host <주소> 또는 env KIOSK_HOST');
  process.exit(1);
}

if (!IDENTITY || !PASSWORD) {
  console.error('자격증명이 필요합니다: --id <계정> --pw <비밀번호>');
  process.exit(1);
}

/** GraphQL 한 방 — 에러는 그 자리에서 드러낸다. */
async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const res = await fetch(`${HOST}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join(' / '));
  }
  if (!body.data) throw new Error(`빈 응답 (HTTP ${res.status})`);
  return body.data;
}

const signIn = await gql<{ signIn: { token: { accessToken: string } } }>(
  `mutation SignIn($input: SignInInput!) {
     signIn(input: $input) { token { accessToken } }
   }`,
  { input: { identity: IDENTITY, password: PASSWORD } },
);
const token = signIn.signIn.token.accessToken;
console.log(`${C.green}✓${C.reset} 로그인 ${C.dim}${HOST}${C.reset}`);

if (!KIOSK_ID) {
  const { getMyAccommodations } = await gql<{
    getMyAccommodations: { id: string; name: string }[];
  }>(`query { getMyAccommodations { id name } }`, {}, token);

  for (const accommodation of getMyAccommodations) {
    console.log(
      `\n${C.cyan}${accommodation.name}${C.reset} ${C.dim}${accommodation.id}${C.reset}`,
    );
    const { getAccommodationKiosks } = await gql<{
      getAccommodationKiosks: {
        id: string;
        name: string;
        connectionState: string;
      }[];
    }>(
      `query ($id: ID!) { getAccommodationKiosks(id: $id) { id name connectionState } }`,
      { id: accommodation.id },
      token,
    );
    for (const kiosk of getAccommodationKiosks) {
      console.log(
        `  ${kiosk.id}  ${kiosk.name} ${C.dim}(${kiosk.connectionState})${C.reset}`,
      );
    }
  }
  console.log(
    `\n${C.dim}--kiosk <id> 로 다시 부르면 지시를 보냅니다.${C.reset}`,
  );
  process.exit(0);
}

// 매니페스트는 **보내기 전에** 검증한다 — 키오스크가 조용히 무시하는 것보다 낫다.
const components: Record<string, string> = {};
for (const spec of args.filter((a) => a.includes('='))) {
  const [name, version] = spec.split('=');
  if (name && version) components[name] = version;
}
const manifest = ManifestSchema.parse({ manifestVersion: 1, components });

await gql(
  `mutation ($kioskId: ID!, $data: String!) {
     sendKioskControlPacket(kioskId: $kioskId, data: $data)
   }`,
  {
    kioskId: KIOSK_ID,
    data: JSON.stringify({ controlType: APPLY_UPDATE_CONTROL, manifest }),
  },
  token,
);

console.log(
  `${C.green}✓${C.reset} 지시 전송 → ${KIOSK_ID}\n` +
    Object.entries(manifest.components)
      .map(([c, v]) => `    ${c} = ${v}`)
      .join('\n'),
);
console.log(
  `${C.yellow}!${C.reset} 적용은 키오스크가 ${C.dim}안전한 화면(배너·언어선택·홈)${C.reset} 에 있을 때 일어납니다.`,
);
