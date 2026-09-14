import {
  A11Y_KEYS,
  CONTRACT_TOTAL,
  NAMESPACES,
  namespaceContractHash,
  shortHash,
} from 'kiosk-types';
import { A11yNode } from '@/shared/a11y';

/**
 * 이 번들이 어느 계약으로 빌드됐는지 보여준다.
 *
 * 네임스페이스별로 따로 찍는 것이 요점이다. 전체 합산 해시 하나로 판정하면 장치 하나가
 * 바뀌어도 프론트까지 갈아야 하는 것처럼 보인다 — 각자 자기 표면만 보면 된다.
 */
const UpdateStatus = () => (
  <A11yNode a11yKey={A11Y_KEYS.DEMO_UPDATE_PAGE}>
    <div className="flex h-full flex-col gap-space-4 overflow-y-auto px-space-10 py-space-10">
      <p className="typo-t1-b text-glyph-gray-heading">계약 지문</p>
      <p className="typo-b3-r text-glyph-gray-description">
        total {shortHash(CONTRACT_TOTAL)} — 참고용. 판정은 아래 표면 단위로
        한다.
      </p>
      <ul className="mt-space-4 flex flex-col gap-space-2">
        {Object.values(NAMESPACES).map((ns) => (
          <li
            key={ns}
            className="flex justify-between rounded-[8px] bg-background-base-elevate px-space-6 py-space-4"
          >
            <span className="typo-b2-m text-glyph-gray-body">{ns}</span>
            <span className="typo-b3-r text-glyph-gray-description font-mono">
              {shortHash(namespaceContractHash(ns))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  </A11yNode>
);

export default UpdateStatus;
