import { gql } from '../api';
import type { HostKey } from '../types';
import type {
  Deployment,
  DeploymentBatch,
  DeploymentPage,
  DeploymentStatus,
  FleetSource,
  Tier,
  TierAssignment,
} from './types';

/**
 * 서버(PMS) 어댑터 — GraphQL 응답을 콘솔의 모양으로 옮기는 유일한 자리.
 *
 * 화면은 `FleetSource` 만 알고 응답을 직접 읽지 않는다. 서버가 필드 이름을 바꾸면 여기서
 * 끝난다.
 */

/** 손댈 것이 있는 배포만 — 끝난 것은 판정에 쓰이지 않는다. 이력은 따로 묻는다. */
const OPEN_STATUSES: DeploymentStatus[] = ['SENT', 'FAILED'];

/**
 * 한 번에 가져올 상한. 정상 운영에서 미결·실패가 이보다 많으면 그 자체가 사고이고,
 * 화면이 개별 행을 다 세는 것보다 "많다"를 보여주는 편이 낫다.
 */
const OPEN_PAGE_SIZE = 100;

/**
 * 한 발송의 행 상한. 서버가 100 을 넘겨받지 않으므로(스키마 constraint) 그보다 큰
 * 발송은 진행이 잘려 보인다 — 그때는 대상 열의 판정이 진실이다.
 */
const BATCH_PAGE_SIZE = 100;

/** 이력 한 쪽. 서버 상한이 100 이고, 발송 하나가 여러 행이라 쪽수가 금방 는다. */
const HISTORY_PAGE_SIZE = 100;

type DeploymentBatchNode = {
  batchId: string;
  deployments: DeploymentNode[];
};

type DeploymentNode = {
  id: string;
  batchId: string;
  entityId: string;
  domain: string;
  version: string;
  previousVersion: string | null;
  status: DeploymentStatus;
  errorMessage: string | null;
  createdBy: { value: string | null; user: { name: string } | null } | null;
  // 서버 `Date` 스칼라는 epoch ms 로 온다(`value.getTime()`).
  createdAt: number;
  updatedAt: number;
};

/** 티어 매핑의 단위는 업장이다 — 기기 단위 매핑은 서버가 받지만 우리는 쓰지 않는다. */
const toTargets = (accommodationIds: readonly string[]) =>
  accommodationIds.map((entityId) => ({
    entityType: 'ACCOMMODATION',
    entityId,
  }));

/** 한 행 몫의 선택 — 조회와 발송이 같은 모양을 돌려받아야 화면이 갈리지 않는다. */
const DEPLOYMENT_FIELDS = `
  id batchId entityId domain version previousVersion
  status errorMessage createdAt updatedAt
  createdBy { value user { name } }
`;

const toDeployment = (node: DeploymentNode): Deployment => ({
  id: node.id,
  batchId: node.batchId,
  // 서버는 (entityType, entityId) 로 부르지만 실제 배포 단위는 키오스크뿐이다.
  kioskId: node.entityId,
  domain: node.domain,
  version: node.version,
  previousVersion: node.previousVersion,
  status: node.status,
  errorMessage: node.errorMessage,
  // 이름이 있으면 이름, 없으면 식별자. 둘 다 없으면 시스템이 누른 것이다.
  createdBy: node.createdBy?.user?.name ?? node.createdBy?.value ?? null,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
});

export function createFleet(host: HostKey, token: string): FleetSource {
  const listDeployments = async (
    filter: Record<string, unknown>,
    first: number,
  ): Promise<DeploymentPage> => {
    const data = await gql<{
      deployments: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: DeploymentNode }[];
      };
    }>(
      host,
      `query ($filter: DeploymentFilterInput, $first: Int) {
         deployments(filter: $filter, first: $first) {
           totalCount
           pageInfo { hasNextPage endCursor }
           edges { node { ${DEPLOYMENT_FIELDS} } }
         }
       }`,
      { filter, first },
      token,
    );
    return {
      rows: data.deployments.edges.map(({ node }) => toDeployment(node)),
      cursor: data.deployments.pageInfo.hasNextPage
        ? data.deployments.pageInfo.endCursor
        : null,
      total: data.deployments.totalCount,
    };
  };

  return {
    openDeployments: async () =>
      (await listDeployments({ status: OPEN_STATUSES }, OPEN_PAGE_SIZE)).rows,

    /**
     * 한 발송의 행 전부 — 끝난 것도 포함한다. 진행률이 곧 "몇 개가 끝났나"라서
     * 열린 것만 보면 분모가 사라진다.
     */
    batch: (batchId) => listDeployments({ batchId }, BATCH_PAGE_SIZE),

    async history(cursor) {
      const data = await gql<{
        deployments: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: { node: DeploymentNode }[];
        };
      }>(
        host,
        `query ($first: Int, $after: String) {
           deployments(first: $first, after: $after) {
             totalCount
             pageInfo { hasNextPage endCursor }
             edges { node { ${DEPLOYMENT_FIELDS} } }
           }
         }`,
        { first: HISTORY_PAGE_SIZE, after: cursor ?? null },
        token,
      );

      return {
        rows: data.deployments.edges.map(({ node }) => toDeployment(node)),
        cursor: data.deployments.pageInfo.hasNextPage
          ? data.deployments.pageInfo.endCursor
          : null,
        total: data.deployments.totalCount,
      };
    },

    async cancel(deploymentId) {
      await gql(
        host,
        `mutation ($id: ID!) { cancelDeployment(id: $id) { id status } }`,
        { id: deploymentId },
        token,
      );
    },

    async tierDetail(tierId) {
      const data = await gql<{
        deploymentGroup: {
          id: string;
          name: string;
          mappings: {
            entityType: string;
            entityId: string;
            accommodation: { name: string } | null;
          }[];
        } | null;
      }>(
        host,
        `query ($id: ID!) {
           deploymentGroup(id: $id) {
             id name
             mappings { entityType entityId accommodation { name } }
           }
         }`,
        { id: tierId },
        token,
      );

      const group = data.deploymentGroup;
      if (!group) throw new Error('없는 티어입니다');
      return {
        id: group.id,
        name: group.name,
        // 업장 매핑만 든다 — 티어의 단위는 업장이라고 정했다.
        members: group.mappings
          .filter((mapping) => mapping.entityType === 'ACCOMMODATION')
          .map((mapping) => ({
            accommodationId: mapping.entityId,
            name: mapping.accommodation?.name ?? mapping.entityId,
          })),
      };
    },

    async tierTargets(tierId) {
      const data = await gql<{
        deploymentGroupTargets: { id: string; name: string }[];
      }>(
        host,
        `query ($id: ID!) { deploymentGroupTargets(id: $id) { id name } }`,
        { id: tierId },
        token,
      );
      return data.deploymentGroupTargets;
    },

    async createTier(name) {
      const data = await gql<{ createDeploymentGroup: Tier }>(
        host,
        `mutation ($input: CreateDeploymentGroupInput!) {
           createDeploymentGroup(input: $input) { id name }
         }`,
        { input: { name } },
        token,
      );
      return data.createDeploymentGroup;
    },

    async renameTier(tierId, name) {
      await gql(
        host,
        `mutation ($input: UpdateDeploymentGroupInput!) {
           updateDeploymentGroup(input: $input) { id name }
         }`,
        { input: { id: tierId, name } },
        token,
      );
    },

    async deleteTier(tierId) {
      await gql(
        host,
        `mutation ($id: ID!) { deleteDeploymentGroup(id: $id) { result } }`,
        { id: tierId },
        token,
      );
    },

    async addTierMembers(tierId, accommodationIds) {
      await gql(
        host,
        `mutation ($input: AddDeploymentGroupMappingsInput!) {
           addDeploymentGroupMappings(input: $input) { id }
         }`,
        {
          input: {
            deploymentGroupId: tierId,
            targets: toTargets(accommodationIds),
          },
        },
        token,
      );
    },

    async removeTierMembers(tierId, accommodationIds) {
      await gql(
        host,
        `mutation ($input: RemoveDeploymentGroupMappingsInput!) {
           removeDeploymentGroupMappings(input: $input) { id }
         }`,
        {
          input: {
            deploymentGroupId: tierId,
            targets: toTargets(accommodationIds),
          },
        },
        token,
      );
    },

    async requestDeployment({ kioskIds, tierId, components }) {
      const data = await gql<{ requestDeployment: DeploymentBatchNode }>(
        host,
        `mutation ($input: RequestDeploymentInput!) {
           requestDeployment(input: $input) {
             batchId
             deployments { ${DEPLOYMENT_FIELDS} }
           }
         }`,
        {
          input: {
            // 티어로 보내면 서버가 발송 시점에 펼친다 — 그 사이 새로 설치된 기기가
            // 자동으로 포함되려면 여기서 미리 펼치면 안 된다.
            ...(tierId ? { deploymentGroupId: tierId } : {}),
            ...(kioskIds
              ? {
                  targets: kioskIds.map((entityId) => ({
                    entityType: 'KIOSK',
                    entityId,
                  })),
                }
              : {}),
            components,
          },
        },
        token,
      );

      return {
        batchId: data.requestDeployment.batchId,
        deployments: data.requestDeployment.deployments.map(toDeployment),
      } satisfies DeploymentBatch;
    },

    async tiers() {
      const data = await gql<{
        deploymentGroups: {
          id: string;
          name: string;
          mappings: { entityType: string; entityId: string }[];
        }[];
      }>(
        host,
        `query {
           deploymentGroups {
             id
             name
             mappings { entityType entityId }
           }
         }`,
        {},
        token,
      );

      const tiers: Tier[] = data.deploymentGroups.map(({ id, name }) => ({
        id,
        name,
      }));

      // 한 업장이 여러 티어에 속할 수 있다 — 서버가 UNIQUE 를 걸지 않는다.
      const assignment: Record<string, string[]> = {};
      for (const group of data.deploymentGroups) {
        for (const mapping of group.mappings) {
          if (mapping.entityType !== 'ACCOMMODATION') continue;
          (assignment[mapping.entityId] ??= []).push(group.id);
        }
      }

      return { tiers, assignment: assignment as TierAssignment };
    },
  };
}
