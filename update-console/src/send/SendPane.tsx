import { useState } from 'react';
import type { ManifestBody } from '../api';
import { scheduler } from '../schedule/scheduler';
import { summarizeTargets } from '../targets';
import type { HostKey, Kiosk } from '../types';
import { matchesConfirmPhrase } from './confirmPhrase';

/**
 * 보내기 열 — 행동 → 확인 → (결과는 ResultsPane).
 *
 * 세 탭(배포·롤백·예약)이 같은 틀을 쓴다: 무엇을 어디에 보내는지 요약하고, **확인을 거친
 * 뒤에만** 나간다. 확인 없이 보내는 경로는 없다 — 수백 대에 실수로 보내는 것을 막는
 * 유일한 장치가 이 단계다.
 */
export type SendTab = 'deploy' | 'rollback' | 'schedule';

export type SendPaneProps = {
  host: HostKey;
  /**
   * 관리자 조회가 통과했는가 — 업장 계정에는 롤백만 보인다. 배포는 버전을 고르는 일이라
   * 운영 팀 몫이고, 예약은 단계적 배포의 도구다. 롤백은 목적지가 그 키오스크에서 이미
   * 검증된 조합이라 업장이 골라서 망칠 게 없다. (UI 숨김이지 권한이 아니다 — 서버 게이트는 별건.)
   */
  scopeKind: 'admin' | 'member';
  kiosks: readonly Kiosk[];
  selected: ReadonlySet<string>;
  /** 이 토큰이 볼 수 있는 키오스크 수 — 전체 배포가 건드릴 대수. */
  totalKiosks: number;
  /** 고른 조합. 없으면 배포 탭이 잠긴다. */
  manifest: ManifestBody | null;
  busy: boolean;
  onDeploy: (kioskIds: readonly string[]) => void;
  /** 고른 대상을 무시하고 전부에 — 서버 이름 입력을 통과한 뒤에만 온다. */
  onDeployAll: () => void;
  onRollback: (kioskIds: readonly string[]) => void;
};

const TAB_LABEL: Record<SendTab, string> = {
  deploy: '배포',
  rollback: '롤백',
  schedule: '예약',
};

const TABS_BY_SCOPE: Record<SendPaneProps['scopeKind'], readonly SendTab[]> = {
  admin: ['deploy', 'rollback', 'schedule'],
  member: ['rollback'],
};

/** 매니페스트를 사람이 읽는 줄로 — 컴포넌트 조합이거나 앱 전체 설치다. */
const manifestRows = (manifest: ManifestBody): [string, string][] =>
  'base' in manifest
    ? [['앱 전체 (설치본)', manifest.base]]
    : Object.entries(manifest.components);

export function SendPane(props: SendPaneProps) {
  const { host, scopeKind, kiosks, selected, totalKiosks, manifest, busy } =
    props;
  const tabs = TABS_BY_SCOPE[scopeKind];
  const [tab, setTab] = useState<SendTab>(tabs[0] ?? 'rollback');
  /** 확인 단계가 열려 있는가. 탭을 바꾸면 닫힌다 — 다른 행동의 확인을 물려받지 않는다. */
  const [confirming, setConfirming] = useState(false);
  /** 전체 배포 관문이 열려 있는가 — 배포 탭 안의 별도 경로. */
  const [deployingAll, setDeployingAll] = useState(false);

  const switchTab = (next: SendTab) => {
    setTab(next);
    setConfirming(false);
    setDeployingAll(false);
  };

  const targets = summarizeTargets(kiosks, selected);
  const ids = [...selected];
  // 보고한 적 없는 기기 = 새 배포 채널을 모르는 옛 기기일 수 있다(같은 릴리스에 들어갔다).
  const unreported = kiosks.filter(
    (kiosk) => selected.has(kiosk.id) && kiosk.versions.length === 0,
  ).length;

  return (
    <>
      <div className="pane-head">
        <h2 className="pane-title">보내기</h2>
        <span className="spacer" />
        <div className="modes">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              className={tab === key ? 'mode is-on' : 'mode'}
              onClick={() => switchTab(key)}
            >
              {TAB_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="send">
        {tab === 'deploy' && deployingAll && (
          <FullDeployPanel
            host={host}
            manifest={manifest}
            totalKiosks={totalKiosks}
            busy={busy}
            onCancel={() => setDeployingAll(false)}
            onSend={() => {
              setDeployingAll(false);
              props.onDeployAll();
            }}
          />
        )}
        {tab === 'deploy' && !deployingAll && (
          <DeployPanel
            manifest={manifest}
            targets={targets}
            count={ids.length}
            unreported={unreported}
            busy={busy}
            confirming={confirming}
            onConfirm={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onSend={() => {
              setConfirming(false);
              props.onDeploy(ids);
            }}
            onDeployAll={() => {
              setConfirming(false);
              setDeployingAll(true);
            }}
          />
        )}
        {tab === 'rollback' && (
          <RollbackPanel
            targets={targets}
            count={ids.length}
            busy={busy}
            confirming={confirming}
            onConfirm={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onSend={() => {
              setConfirming(false);
              props.onRollback(ids);
            }}
          />
        )}
        {tab === 'schedule' && <SchedulePanel />}
      </div>
    </>
  );
}

type ConfirmFlow = {
  targets: ReturnType<typeof summarizeTargets>;
  count: number;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSend: () => void;
};

function TargetSummary({
  targets,
  count,
}: Pick<ConfirmFlow, 'targets' | 'count'>) {
  return (
    <div className="block">
      <span className="section-title">
        대상 · 업장 {targets.length} · 키오스크 {count}대
      </span>
      <div className="rows">
        {targets.map((group) => (
          <div key={group.name}>
            <span>{group.name}</span>
            <b>{group.count}대</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeployPanel(
  flow: ConfirmFlow & {
    manifest: ManifestBody | null;
    /**
     * 고른 대상 중 **한 번도 버전을 보고한 적 없는** 기기 수.
     *
     * 보고와 새 배포 채널 수신은 같은 릴리스에 들어갔다 — 보고한 적 없다는 것은 그 기기가
     * 새 채널을 못 알아듣는다는 뜻이고, 지시를 보내도 서버에 행만 생기고 아무 일도
     * 일어나지 않는다. 배포 전에 알아야 하는 사실이라 확인 화면에 세운다.
     */
    unreported: number;
    onDeployAll: () => void;
  },
) {
  const { manifest, targets, count, busy, confirming } = flow;
  const rows = manifest ? manifestRows(manifest) : [];
  const ready = manifest !== null && count > 0;

  if (!confirming) {
    return (
      <>
        <div className="manifest">
          <div className="title">manifest · {rows.length}</div>
          {rows.length === 0 && <div>고른 것이 없습니다</div>}
          {rows.map(([name, version]) => (
            <div key={name}>
              {name} <b>{version}</b>
            </div>
          ))}
        </div>
        <div className="send-bar">
          <span>
            대상 <b>{count}</b>대
          </span>
          {/* 전체 배포는 오직 이 경로로만 — 대상 열에 "전체" 선택은 없다. */}
          <button
            type="button"
            className="link"
            onClick={flow.onDeployAll}
            disabled={busy || manifest === null}
          >
            전체 배포…
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="primary"
            onClick={flow.onConfirm}
            disabled={busy || !ready}
          >
            배포 확인…
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="confirm">
      <div className="confirm-head">
        <b>배포 확인</b>
        <span className="note">
          고른 대상에 아래 조합을 보냅니다. 각 키오스크는 홈 화면에서 한가할 때
          적용합니다.
        </span>
      </div>
      <TargetSummary targets={targets} count={count} />
      {flow.unreported > 0 && (
        <p className="pane-note error">
          이 중 <b>{flow.unreported}대</b>는 버전을 보고한 적이 없습니다 — 새
          배포 채널을 모르는 옛 기기일 수 있고, 그러면 지시가 접수만 되고
          적용되지 않습니다(이력에 미결로 남습니다). 그 기기는{' '}
          <b>새 앱을 직접 설치</b>해야 원격 배포를 받기 시작합니다.
        </p>
      )}
      <div className="block">
        <span className="section-title">조합 · {rows.length}</span>
        <div className="rows mono">
          {rows.map(([name, version]) => (
            <div key={name}>
              <span>{name}</span>
              <b>{version}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="send-bar">
        <span className="spacer" />
        <button type="button" onClick={flow.onCancel} disabled={busy}>
          취소
        </button>
        <button
          type="button"
          className="primary"
          onClick={flow.onSend}
          disabled={busy || !ready}
        >
          배포 보내기
        </button>
      </div>
    </div>
  );
}

function RollbackPanel(flow: ConfirmFlow) {
  const { targets, count, busy, confirming } = flow;

  if (!confirming) {
    return (
      <div className="send-bar">
        <span className="note">
          고른 대상을 직전 조합으로 되돌립니다 — 버전을 고르지 않습니다.
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="danger"
          onClick={flow.onConfirm}
          disabled={busy || count === 0}
        >
          롤백 확인…
        </button>
      </div>
    );
  }

  return (
    <div className="confirm is-danger">
      <div className="confirm-head">
        <b>롤백 확인</b>
        <span className="note">
          각 키오스크가 자기 되돌림 스택의 직전 조합으로 돌아갑니다. 설치본이
          달랐다면 그 설치본을 먼저 깔고 컴포넌트를 이어서 놓습니다. 되돌릴
          조합이 없는 키오스크는 거절합니다.
        </span>
      </div>
      <TargetSummary targets={targets} count={count} />
      <div className="block">
        <span className="section-title">돌아갈 곳</span>
        <span className="note">
          버전을 고르지 않습니다. 키오스크마다 다르고, 키오스크가 압니다.
        </span>
      </div>
      <div className="send-bar">
        <span className="spacer" />
        <button type="button" onClick={flow.onCancel} disabled={busy}>
          취소
        </button>
        <button
          type="button"
          className="primary danger"
          onClick={flow.onSend}
          disabled={busy || count === 0}
        >
          롤백 보내기
        </button>
      </div>
    </div>
  );
}

/**
 * 전체 배포 — 고른 대상을 무시하고 이 서버의 모든 키오스크에.
 *
 * 서버 이름을 그대로 쳐야 버튼이 열린다. 티어가 생기면 이 자리는 "마지막 차수 열기"와
 * 겹치므로 그때 합친다.
 */
function FullDeployPanel(props: {
  host: HostKey;
  manifest: ManifestBody | null;
  totalKiosks: number;
  busy: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { host, manifest, totalKiosks, busy } = props;
  const [phrase, setPhrase] = useState('');
  const rows = manifest ? manifestRows(manifest) : [];
  const unlocked = matchesConfirmPhrase(phrase, host) && manifest !== null;

  return (
    <div className="confirm is-danger">
      <div className="confirm-head">
        <b className="danger-text">전체 배포</b>
        <span className="note">
          고른 대상을 무시하고 이 서버의 <b>모든 키오스크</b>에 보냅니다. 화면에
          불러온 목록이 아니라 서버를 끝까지 넘겨 대상을 잡습니다.
        </span>
      </div>
      <div className="send-bar">
        <span className="big">{totalKiosks}대</span>
        <span className="note">{host}</span>
      </div>
      <div className="block">
        <span className="section-title">조합 · {rows.length}</span>
        <div className="rows mono">
          {rows.map(([name, version]) => (
            <div key={name}>
              <span>{name}</span>
              <b>{version}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="block">
        <span className="section-title">확인 — 서버 이름을 그대로 입력</span>
        <input
          placeholder={host}
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          className={unlocked ? '' : 'is-locked'}
          autoComplete="off"
        />
        <span className="note">일치할 때만 아래 버튼이 열립니다.</span>
      </div>
      <div className="send-bar">
        <span className="spacer" />
        <button type="button" onClick={props.onCancel} disabled={busy}>
          취소
        </button>
        <button
          type="button"
          className="primary danger"
          onClick={props.onSend}
          disabled={busy || !unlocked}
        >
          {totalKiosks}대에 배포
        </button>
      </div>
    </div>
  );
}

/**
 * 예약 — 실행자가 정해지기 전에는 걸 수 없다. 화면은 `scheduler` 가 null 인지만 본다.
 *
 * 예약 시각은 지시가 도착하는 시각이다. 적용은 각 키오스크가 홈 화면에서 한가할 때 한다.
 */
function SchedulePanel() {
  const [runAt, setRunAt] = useState('');
  const wired = scheduler !== null;

  return (
    <div className="confirm">
      <div className="confirm-head">
        <b>예약 배포</b>
        <span className="note">
          예약 시각은 지시가 도착하는 시각입니다. 적용은 각 키오스크가 홈
          화면에서 한가할 때 합니다. 배포 탭에서 고른 대상·조합 그대로
          예약됩니다.
        </span>
      </div>
      <div className="block">
        <span className="section-title">언제 (KST)</span>
        <input
          type="datetime-local"
          value={runAt}
          onChange={(event) => setRunAt(event.target.value)}
          disabled={!wired}
        />
      </div>
      <div className="send-bar">
        {!wired && <span className="soon">실행자 미배선</span>}
        <span className="spacer" />
        <button type="button" className="primary" disabled={!wired || !runAt}>
          예약 걸기
        </button>
      </div>
      <p className="note">
        실행자(서버 또는 람다)가 정해지면 여기서 걸고, 아래에 대기 중인 예약과
        취소가 보입니다.
      </p>
    </div>
  );
}
