import { useEffect, useState } from 'react';
import { Caret, ZoomIcon } from './Icon';
import { loadVersions } from './s3';
import type { ArtifactDescriptor, HostKey, Target } from './types';
import {
  BASE_TARGET,
  bakedAtOf,
  labelOf,
  surfaceOf,
  UPDATE_COMPONENT,
} from './types';

const PAGE = 5;

type Loaded = {
  items: ArtifactDescriptor[];
  exhausted: boolean;
  loading: boolean;
  error?: string;
};

export type Picks = Readonly<Record<string, ArtifactDescriptor>>;

/** 확대해서 볼 것 — 형제 버전을 함께 넘겨야 확대한 채로 비교할 수 있다. */
export type Zoom = {
  target: Target;
  descriptor: ArtifactDescriptor;
  siblings: readonly ArtifactDescriptor[];
};

/**
 * 대상별로 배포 가능한 버전을 고른다.
 *
 * 접어두고 **펼칠 때 받는다** — 미리 전부 받으면 대상 8개 × (목록 1 + 서술자 5)
 * 요청이 로그인 직후에 몰린다. 한 번 받은 것은 접었다 펴도 다시 받지 않는다.
 *
 * 앱 전체는 대상이 하나뿐이라 처음부터 펼쳐 둔다 — 한 줄짜리 아코디언을 굳이 누르게
 * 할 이유가 없다.
 *
 * 여러 개를 동시에 펼 수 있다 — 조합을 고르는 일이라 나란히 놓고 비교해야 한다.
 *
 * 목록에 없는 것은 **배포할 수 없는 것**이다: `artifact.json` 이 없는 옛 산출물,
 * 이 서버 채널에 맞지 않는 빌드, 고른 백엔드와 표면이 안 맞는 버전.
 */
export function ComponentPicker({
  host,
  targets,
  picks,
  onPick,
  onZoom,
}: {
  host: HostKey;
  targets: readonly Target[];
  picks: Picks;
  onPick: (target: Target, chosen?: ArtifactDescriptor) => void;
  onZoom: (zoom: Zoom) => void;
}) {
  const single = targets.length === 1;
  const [open, setOpen] = useState<ReadonlySet<string>>(
    single ? new Set(targets) : new Set(),
  );
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});

  // 백엔드를 골랐으면 그 표면이 기준이 된다 — 말이 통하는 것만 보여준다. 기준은
  // 계약 전체가 아니라 **백엔드**다: 이해관계가 전부 백엔드를 허브로 지나므로,
  // 프론트를 먼저 골라도 장치 목록은 좁아지지 않는 것이 맞다.
  // 대상이 하나뿐이면 섞일 것이 없다(설치본 안에서 이미 맞아 있다).
  const reference = single
    ? undefined
    : picks[UPDATE_COMPONENT.BACKEND]?.surfaces;

  const load = async (component: Target, more = false) => {
    const current = loaded[component];
    const skip = more ? (current?.items.length ?? 0) : 0;
    setLoaded((prev) => ({
      ...prev,
      [component]: {
        items: more ? (current?.items ?? []) : [],
        exhausted: false,
        loading: true,
      },
    }));
    try {
      const { items, exhausted } = await loadVersions({
        target: component,
        host,
        reference,
        size: PAGE,
        skip,
      });
      setLoaded((prev) => ({
        ...prev,
        [component]: {
          items: [...(more ? (current?.items ?? []) : []), ...items],
          exhausted,
          loading: false,
        },
      }));
    } catch (cause) {
      setLoaded((prev) => ({
        ...prev,
        [component]: {
          items: current?.items ?? [],
          exhausted: true,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        },
      }));
    }
  };

  // 기준(백엔드 표면)이 갈리면 이미 받아둔 목록은 옛 기준으로 걸러진 것이다 —
  // 백엔드·앱 전체만 남기고 비워, 펼쳐져 있던 것은 다시 받는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load/open 은 이 효과의 트리거가 아니다 — 기준 변화만 무효화 사유다.
  useEffect(() => {
    setLoaded((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(
          ([target]) =>
            target === BASE_TARGET || target === UPDATE_COMPONENT.BACKEND,
        ),
      ),
    );
    for (const target of open as ReadonlySet<Target>) {
      if (target !== BASE_TARGET && target !== UPDATE_COMPONENT.BACKEND) {
        void load(target);
      }
    }
  }, [reference]);

  const toggle = (component: Target) => {
    const next = new Set(open);
    if (next.has(component)) {
      next.delete(component);
    } else {
      next.add(component);
      if (!loaded[component]) void load(component);
    }
    setOpen(next);
  };

  return (
    <div className="picker">
      {targets.map((component) => {
        const chosen = picks[component];
        const state = loaded[component];
        const expanded = open.has(component);
        const items = state?.items ?? [];

        return (
          <div
            className={expanded ? 'component is-open' : 'component'}
            key={component}
          >
            {/* 눌리는 곳은 줄 전체다 — 칸 사이 여백에서 헛클릭이 나면 안 된다.
                캐럿은 클릭을 삼키지 않고 흘려보낸다(키보드 초점만 받는다). */}
            <div className="component-head" onClick={() => toggle(component)}>
              <button
                type="button"
                className="caret-btn"
                aria-label={expanded ? '접기' : '펼치기'}
              >
                <Caret open={expanded} />
              </button>
              <span className="name">{labelOf(component)}</span>
              {/* 행은 한 줄로 접혀 잘린다 — 전문은 title 이 진다(여러 줄도 그대로). */}
              <span
                className={chosen?.description ? 'desc is-set' : 'desc'}
                title={chosen?.description}
              >
                {chosen ? (chosen.description ?? '설명 없음') : ''}
              </span>
              {/* 관계 표면의 지문 — 어느 표면인지 보이지 않으면, 백엔드를 고른 뒤 다른
                  컴포넌트 목록이 왜 좁아졌는지 알 수 없다. */}
              <span
                className="surface"
                title={chosen && surfaceOf(component, chosen)}
              >
                {chosen && surfaceOf(component, chosen)?.slice(0, 8)}
              </span>
              {chosen ? (
                <span className="chosen">{chosen.version}</span>
              ) : (
                <span className="unchosen">선택 안 함</span>
              )}
              {chosen ? (
                <button
                  type="button"
                  className="zoom"
                  aria-label="확대해서 보기"
                  onClick={(event) => {
                    event.stopPropagation();
                    onZoom({
                      target: component,
                      descriptor: chosen,
                      siblings: items.length > 0 ? items : [chosen],
                    });
                  }}
                >
                  <ZoomIcon />
                </button>
              ) : (
                <span />
              )}
            </div>

            {expanded && (
              <div className="versions">
                {state?.loading && items.length === 0 && (
                  <p className="note">불러오는 중…</p>
                )}
                {state?.error && <p className="error">{state.error}</p>}

                {items.map((descriptor) => {
                  const isChosen = chosen?.version === descriptor.version;
                  const pick = () =>
                    onPick(component, isChosen ? undefined : descriptor);
                  return (
                    // 고르는 곳은 줄 전체다. 라디오 클릭도 여기까지 올라와 한 번만
                    // 처리된다 — 이미 고른 것을 다시 누르면 조합에서 빠진다(change 는
                    // 나지 않으므로 click 으로 받는다).
                    <div
                      className={`version${isChosen ? ' is-chosen' : ''}`}
                      key={descriptor.version}
                      onClick={pick}
                    >
                      <input
                        type="radio"
                        name={`v-${component}`}
                        checked={isChosen}
                        onChange={() => undefined}
                        aria-label={descriptor.version}
                      />
                      <span className="v">{descriptor.version}</span>
                      <span
                        className="surface"
                        title={surfaceOf(component, descriptor)}
                      >
                        {surfaceOf(component, descriptor)?.slice(0, 8)}
                      </span>
                      <span className="when">{bakedAtOf(descriptor)}</span>
                      <span
                        className={
                          descriptor.description ? 'desc is-set' : 'desc'
                        }
                        title={descriptor.description}
                      >
                        {descriptor.description ?? '설명 없음'}
                      </span>
                      <button
                        type="button"
                        className="zoom"
                        aria-label="확대해서 보기"
                        onClick={(event) => {
                          event.stopPropagation();
                          onZoom({
                            target: component,
                            descriptor,
                            siblings: items,
                          });
                        }}
                      >
                        <ZoomIcon />
                      </button>
                    </div>
                  );
                })}

                {state && !state.loading && items.length === 0 && (
                  <p className="note">
                    배포 가능한 버전이 없습니다.
                    {reference && ' 고른 백엔드와 말이 통하는 것이 없습니다.'}
                  </p>
                )}

                <div className="actions">
                  {state && !state.exhausted && (
                    <button
                      type="button"
                      onClick={() => void load(component, true)}
                      disabled={state.loading}
                    >
                      {state.loading ? '불러오는 중…' : '더 보기'}
                    </button>
                  )}
                  {chosen && (
                    <button type="button" onClick={() => onPick(component)}>
                      선택 해제
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
