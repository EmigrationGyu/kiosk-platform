import type { EntityVersion } from './fleet/types';
import {
  type Accommodation,
  HOSTS,
  type HostKey,
  type Kiosk,
  ROLLBACK_UPDATE_CONTROL,
  type Scope,
} from './types';

/** 관리자 조회에서 한 번에 가져올 상한. 잘렸는지는 totalCount 로 드러낸다. */
const ADMIN_PAGE_SIZE = 200;

/**
 * GraphQL 한 방.
 *
 * 토큰은 **메모리에만** 둔다 — 이 페이지는 URL 만 알면 누구나 열 수 있어서, 새로고침에
 * 살아남는 곳(localStorage)에 두면 남의 브라우저에 관리자 토큰이 남는다. 대신 새로고침
 * 하면 다시 로그인해야 한다.
 */
export async function gql<T>(
  host: HostKey,
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const res = await fetch(`${HOSTS[host]}/graphql`, {
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

export async function signIn(
  host: HostKey,
  identity: string,
  password: string,
): Promise<string> {
  const data = await gql<{ signIn: { token: { accessToken: string } } }>(
    host,
    `mutation SignIn($input: SignInInput!) {
       signIn(input: $input) { token { accessToken } }
     }`,
    { input: { identity, password } },
  );
  return data.signIn.token.accessToken;
}

/**
 * 이 토큰으로 볼 수 있는 키오스크.
 *
 * 관리자면 전부, 아니면 자기 업장 것만. **서버가 판정한다** - `searchKiosks` 는
 * userTypes.ADMIN 에게만 열려 있으므로 통과 여부가 곧 답이다. 역할을 따로 묻지 않는 이유:
 * 권한의 진실은 서버에 있고 클라이언트가 다시 판정하면 두 곳이 어긋날 수 있다.
 */
export async function fetchScope(
  host: HostKey,
  token: string,
  keyword?: string,
): Promise<Scope> {
  try {
    return await searchAllKiosks(host, token, keyword);
  } catch {
    // 관리자가 아니거나 검색이 막혔다 - 자기 업장으로 떨어진다.
    return {
      kind: 'member',
      accommodations: await fetchAccommodations(host, token),
    };
  }
}

async function searchAllKiosks(
  host: HostKey,
  token: string,
  keyword?: string,
  after: string | null = null,
): Promise<Extract<Scope, { kind: 'admin' }>> {
  const { searchKiosks } = await gql<{
    searchKiosks: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: {
        node: {
          id: string;
          name: string;
          connectionState: string;
          accommodationId: string | null;
          accommodation: { name: string } | null;
          versions: EntityVersion[];
        } | null;
      }[];
    };
  }>(
    host,
    `query ($keyword: String, $first: Int, $after: String) {
       searchKiosks(keyword: $keyword, first: $first, after: $after) {
         totalCount
         pageInfo { hasNextPage endCursor }
         edges {
           node {
             id name connectionState accommodationId accommodation { name }
             # 실재는 여기서만 배치로 온다 — 따로 물으면 대수만큼 왕복이 생긴다.
             versions { domain version previousVersion reportedAt removedAt }
           }
         }
       }
     }`,
    { keyword: keyword?.trim() || null, first: ADMIN_PAGE_SIZE, after },
    token,
  );

  const kiosks: Kiosk[] = searchKiosks.edges
    .map((edge) => edge.node)
    .filter((node): node is NonNullable<typeof node> => node !== null)
    .map((node) => ({
      id: node.id,
      name: node.name,
      connectionState: node.connectionState,
      accommodationName: node.accommodation?.name,
      accommodationId: node.accommodationId ?? undefined,
      versions: node.versions ?? [],
    }));

  return {
    kind: 'admin',
    kiosks,
    total: searchKiosks.totalCount,
    after: searchKiosks.pageInfo.hasNextPage
      ? searchKiosks.pageInfo.endCursor
      : null,
  };
}

/** 다음 한 페이지 — 관리자 조회에서만 뜻이 있다. */
export async function fetchMoreKiosks(
  host: HostKey,
  token: string,
  keyword: string | undefined,
  after: string,
): Promise<{ kiosks: Kiosk[]; after: string | null }> {
  const page = await searchAllKiosks(host, token, keyword, after);
  return { kiosks: page.kiosks, after: page.after };
}

/**
 * 이 토큰이 볼 수 있는 키오스크 **전부** — 전체 배포의 대상.
 *
 * 화면에 불러온 목록이 아니라 서버를 끝까지 넘긴다. 화면은 검색·페이징으로 좁혀져 있어
 * "전체"가 아니다. 관리자가 아니면 자기 업장 것이 곧 전부다.
 */
export async function fetchAllKiosks(
  host: HostKey,
  token: string,
): Promise<Kiosk[]> {
  try {
    const all: Kiosk[] = [];
    let after: string | null = null;
    do {
      const page: Extract<Scope, { kind: 'admin' }> = await searchAllKiosks(
        host,
        token,
        undefined,
        after,
      );
      all.push(...page.kiosks);
      after = page.after;
    } while (after !== null);
    return all;
  } catch {
    const accommodations = await fetchAccommodations(host, token);
    return accommodations.flatMap((accommodation) =>
      accommodation.kiosks.map((kiosk) => ({
        ...kiosk,
        accommodationName: accommodation.name,
        accommodationId: accommodation.id,
      })),
    );
  }
}

async function fetchAccommodations(
  host: HostKey,
  token: string,
): Promise<Accommodation[]> {
  const { getMyAccommodations } = await gql<{
    getMyAccommodations: { id: string; name: string }[];
  }>(host, `query { getMyAccommodations { id name } }`, {}, token);

  return Promise.all(
    getMyAccommodations.map(async (accommodation) => {
      const { getAccommodationKiosks } = await gql<{
        getAccommodationKiosks: {
          id: string;
          name: string;
          connectionState: string;
          versions: EntityVersion[];
        }[];
      }>(
        host,
        `query ($id: ID!) {
           getAccommodationKiosks(id: $id) {
             id name connectionState
             versions { domain version previousVersion reportedAt removedAt }
           }
         }`,
        { id: accommodation.id },
        token,
      );
      return {
        ...accommodation,
        kiosks: getAccommodationKiosks.map((kiosk) => ({
          ...kiosk,
          accommodationId: accommodation.id,
          versions: kiosk.versions ?? [],
        })),
      };
    }),
  );
}

/**
 * 적용 지시를 보낸다.
 *
 * 원격 키 발급과 **같은 뮤테이션**을 탄다 — `data` 는 불투명한 JSON 이고 controlType 으로
 * 갈리므로 서버에 새로 만든 것이 없다. 감사 로그에는 controlType 이 command 로 남는다.
 */
/**
 * 고른 조합 — 확인 화면이 보여주고, 발송 때 서버 컴포넌트 목록으로 편다.
 *
 * **둘 중 하나**다: 컴포넌트 조합이거나 앱 전체 설치다. 키오스크 스키마가 둘을 함께 받지
 * 않으므로(설치가 세대를 전부 새로 놓는다) 여기서도 섞어 만들지 않는다.
 */
export type ManifestBody =
  | { components: Record<string, string> }
  | { base: string };

/**
 * 롤백 지시를 한 대에 보낸다 — 적용과 같은 채널, 목적지 없음.
 *
 * 콘솔은 어디로 돌아갈지 모르고 알 필요도 없다. 키오스크가 자기 되돌림 스택의 top 으로
 * 가고, 설치본이 다르면 그 설치본을 먼저 깐 뒤 다시 떠서 컴포넌트를 이어서 놓는다.
 */
export async function sendRollbackCommand(
  host: HostKey,
  token: string,
  kioskId: string,
): Promise<void> {
  await gql(
    host,
    `mutation ($kioskId: ID!, $data: String!) {
       sendKioskControlPacket(kioskId: $kioskId, data: $data)
     }`,
    {
      kioskId,
      data: JSON.stringify({ controlType: ROLLBACK_UPDATE_CONTROL }),
    },
    token,
  );
}
