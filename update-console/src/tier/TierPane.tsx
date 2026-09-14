import { useEffect, useState } from 'react';
import type { Tier, TierDetail } from '../fleet';

/**
 * 티어 관리 — 업장을 묶어 차수를 만든다.
 *
 * **매는 단위는 업장이다.** 기기 단위 매핑도 서버는 받지만 쓰지 않는다: 그 업장에 새
 * 키오스크가 설치되면 자동으로 딸려와야 하는데, 기기로 매어두면 그때마다 사람이 다시
 * 손대야 한다.
 *
 * **순서(rank)가 없다.** 서버가 들지 않기로 했고 중복 소속도 허용한다 — 한 업장이 여러
 * 티어에 속할 수 있다. 차수 순서가 필요하면 이름으로 짠다("T0 카나리" 처럼).
 *
 * 고를 수 있는 업장이 **화면에 불러온 키오스크에서 나온다**는 한계가 있다. 검색·더 보기로
 * 좁혀져 있으면 그만큼만 보인다 — 다만 이미 매인 업장은 서버가 이름까지 주므로 다 보인다.
 */

type Named = { id: string; name: string };

export function TierPane({
  tiers,
  busy,
  accommodations,
  loadDetail,
  loadTargets,
  onCreate,
  onRename,
  onDelete,
  onAdd,
  onRemove,
  onDeploy,
  canDeploy,
  onClose,
}: {
  tiers: readonly Tier[];
  busy: boolean;
  /** 화면이 아는 업장 — 불러온 키오스크에서 나온다. */
  accommodations: readonly Named[];
  loadDetail: (tierId: string) => Promise<TierDetail>;
  loadTargets: (tierId: string) => Promise<readonly Named[]>;
  onCreate: (name: string) => void;
  onRename: (tierId: string, name: string) => void;
  onDelete: (tierId: string) => void;
  onAdd: (tierId: string, accommodationIds: readonly string[]) => void;
  onRemove: (tierId: string, accommodationIds: readonly string[]) => void;
  /** 이 티어로 배포 — 서버가 발송 시점에 펼친다. 조합을 안 골랐으면 잠긴다. */
  onDeploy: (tier: Tier, targetCount: number) => void;
  canDeploy: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(tiers[0]?.id ?? null);
  const [detail, setDetail] = useState<TierDetail | null>(null);
  const [targets, setTargets] = useState<readonly Named[]>([]);
  const [newName, setNewName] = useState('');

  // 티어를 고르거나 목록이 바뀌면 속살을 다시 읽는다 — 매고 푼 결과가 바로 보여야 한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tiers 는 갱신 신호로만 쓴다
  useEffect(() => {
    if (selected === null) {
      setDetail(null);
      setTargets([]);
      return;
    }
    let alive = true;
    void Promise.all([loadDetail(selected), loadTargets(selected)])
      .then(([one, expanded]) => {
        if (!alive) return;
        setDetail(one);
        setTargets(expanded);
      })
      .catch(() => {
        if (alive) setDetail(null);
      });
    return () => {
      alive = false;
    };
  }, [selected, tiers, loadDetail, loadTargets]);

  const memberIds = new Set(
    detail?.members.map((m) => m.accommodationId) ?? [],
  );
  const addable = accommodations.filter((a) => !memberIds.has(a.id));

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="detail matrix"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-head">
          <h2 className="pane-title">티어</h2>
          <span className="note">{tiers.length}개</span>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="detail-body tier-body">
          <div className="tier-list">
            {tiers.map((tier) => (
              <button
                key={tier.id}
                type="button"
                className={
                  tier.id === selected ? 'tier-item is-on' : 'tier-item'
                }
                onClick={() => setSelected(tier.id)}
              >
                {tier.name}
              </button>
            ))}
            <form
              className="tier-new"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newName.trim();
                if (!name) return;
                onCreate(name);
                setNewName('');
              }}
            >
              <input
                placeholder="새 티어 이름"
                value={newName}
                maxLength={64}
                onChange={(event) => setNewName(event.target.value)}
              />
              <button type="submit" disabled={busy || !newName.trim()}>
                만들기
              </button>
            </form>
          </div>

          {detail === null ? (
            <p className="pane-note">티어를 고르거나 새로 만드세요.</p>
          ) : (
            <div className="tier-detail">
              <div className="send-bar">
                <input
                  className="tier-name"
                  key={detail.id}
                  defaultValue={detail.name}
                  maxLength={64}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== detail.name) onRename(detail.id, name);
                  }}
                />
                <span className="spacer" />
                <span className="note">
                  업장 {detail.members.length} · 지금 {targets.length}대로
                  펼쳐짐
                </span>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !canDeploy || targets.length === 0}
                  title={
                    canDeploy
                      ? '이 티어로 배포합니다 — 대상은 보낼 때 펼쳐집니다'
                      : '먼저 조합을 고르세요'
                  }
                  onClick={() => onDeploy(detail, targets.length)}
                >
                  이 티어로 배포…
                </button>
                <button
                  type="button"
                  className="danger-text"
                  disabled={busy}
                  onClick={() => onDelete(detail.id)}
                >
                  삭제
                </button>
              </div>

              <div className="tier-cols">
                <div className="block">
                  <span className="section-title">
                    매인 업장 · {detail.members.length}
                  </span>
                  <div className="rows">
                    {detail.members.length === 0 && (
                      <div className="note">아직 없습니다.</div>
                    )}
                    {detail.members.map((member) => (
                      <div key={member.accommodationId} className="tier-row">
                        <span>{member.name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            onRemove(detail.id, [member.accommodationId])
                          }
                        >
                          빼기
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="block">
                  <span className="section-title">
                    더할 수 있는 업장 · {addable.length}
                  </span>
                  <div className="rows">
                    {addable.length === 0 && (
                      <div className="note">
                        불러온 업장이 모두 매여 있습니다.
                      </div>
                    )}
                    {addable.map((accommodation) => (
                      <div key={accommodation.id} className="tier-row">
                        <span>{accommodation.name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAdd(detail.id, [accommodation.id])}
                        >
                          더하기
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="detail-foot">
          <span className="note">
            한 업장이 여러 티어에 속할 수 있습니다. 배포 대상은 저장된 목록이
            아니라 보낼 때 펼쳐지므로, 그 사이 새로 설치된 키오스크도 함께
            갑니다.
          </span>
        </div>
      </div>
    </div>
  );
}
