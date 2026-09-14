import { useEffect } from 'react';
import { CloseIcon } from './Icon';
import type { ArtifactDescriptor, Target } from './types';
import { bakedAtOf, labelOf, surfaceOf } from './types';

/**
 * 버전 하나를 확대해서 본다.
 *
 * 표에서는 설명을 **한 줄로 묶는다** — 컴포넌트가 스물까지 늘어날 목록에서 행 높이가
 * 들쭉날쭉하면 세로로 훑을 수 없다. 대신 전문은 여기서 통째로 읽는다.
 *
 * 왼쪽에 형제 버전을 남겨 두는 이유: 긴 설명을 비교하려고 열었는데 닫았다 다시 열어야
 * 하면 비교가 안 된다.
 */
export function VersionDetail({
  target,
  descriptor,
  siblings,
  chosen,
  onShow,
  onPick,
  onClose,
}: {
  target: Target;
  descriptor: ArtifactDescriptor;
  siblings: readonly ArtifactDescriptor[];
  chosen?: ArtifactDescriptor;
  onShow: (descriptor: ArtifactDescriptor) => void;
  onPick: (target: Target, chosen?: ArtifactDescriptor) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isChosen = chosen?.version === descriptor.version;
  const surface = surfaceOf(target, descriptor);

  return (
    // esc 가 같은 일을 키보드로 한다
    <div className="backdrop" onClick={onClose}>
      {/* 안쪽 클릭이 닫기로 새지 않게만 한다 */}
      <div
        className="detail"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="detail-head">
          <span className="what">{labelOf(target)}</span>
          <span className="v">{descriptor.version}</span>
          {surface && <span className="chip is-accent mono">{surface}</span>}
          <span className="spacer" />
          <span className="note">esc 로 닫기</span>
          <button type="button" className="zoom" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div style={{ display: 'flex', minHeight: 0, flexGrow: 1 }}>
          {/* 형제가 하나뿐이면 목록이 아니라 같은 말을 두 번 하는 것이다. */}
          {siblings.length > 1 && (
            <div
              className="pane"
              style={{ width: 250, flex: 'none', background: '#161619' }}
            >
              <div className="chips">
                <span className="pane-title">버전</span>
              </div>
              <div className="results" style={{ padding: '0 8px 8px' }}>
                {siblings.map((sibling) => (
                  <button
                    type="button"
                    key={sibling.version}
                    className="version-item"
                    onClick={() => onShow(sibling)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: 3,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      marginBottom: 2,
                      border: 'none',
                      borderRadius: 7,
                      background:
                        sibling.version === descriptor.version
                          ? 'var(--accent-bg)'
                          : 'transparent',
                      boxShadow:
                        sibling.version === descriptor.version
                          ? 'inset 2px 0 0 var(--accent)'
                          : undefined,
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'baseline',
                      }}
                    >
                      <b className="mono" style={{ fontSize: 12.5 }}>
                        {sibling.version}
                      </b>
                      <span className="spacer" />
                      <span className="when mono">{bakedAtOf(sibling)}</span>
                    </span>
                    <span className="desc" title={sibling.description}>
                      {sibling.description ?? '설명 없음'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="detail-body">
            <h3>설명</h3>
            <p>{descriptor.description ?? '설명이 없는 산출물입니다.'}</p>

            <h3>산출물</h3>
            <div className="detail-meta">
              <span>구운 시각</span>
              <b>{bakedAtOf(descriptor)}</b>
              <span>표면</span>
              <b>{surface ?? '없음 (옛 산출물)'}</b>
              <span>계약 total</span>
              <b>{descriptor.contractTotal ?? '없음'}</b>
              <span>sha256</span>
              <b>{descriptor.sha256}</b>
              <span>내려받는 곳</span>
              <b>{descriptor.url}</b>
            </div>
          </div>
        </div>

        <div className="detail-foot">
          <span className="note">
            {isChosen ? '이 조합에 들어 있습니다' : '아직 고르지 않았습니다'}
          </span>
          <span className="spacer" />
          {isChosen ? (
            <button type="button" onClick={() => onPick(target)}>
              선택 해제
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => onPick(target, descriptor)}
            >
              이 버전 고르기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
