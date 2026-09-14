import type { EventMap } from 'kiosk-types';
import {
  FILESYSTEM_EVENTS,
  type FileSystemEventMap,
} from 'src/constant/events/FileSystem';
import { IME_EVENTS, type ImeEventMap } from 'src/constant/events/Ime';
import { LOG_EVENTS, type LogEventMap } from 'src/constant/events/Log';
import {
  OUTBOX_EVENTS,
  type OutboxEventMap,
  OutboxSchemas,
} from 'src/constant/events/Outbox';
import {
  PERMISSION_EVENTS,
  type PermissionEventMap,
} from 'src/constant/events/Permission';
import {
  TOKEN_DISPENSER_EVENTS,
  type TokenDispenserEventMap,
} from 'src/constant/events/TokenDispenser';
import { UPDATE_EVENTS, type UpdateEventMap } from 'src/constant/events/Update';
import type { HardwareEventMap } from '../constant/events/Hardware';
import { HARDWARE_EVENTS } from '../constant/events/Hardware';
import { NAMESPACES, type Namespace } from '../constant/Namespaces';
// @gen:import

// 각 네임스페이스가 가지는 이벤트 맵을 타입 레벨에서 결합
export type NamespaceEventMap = {
  [NAMESPACES.HARDWARE]: HardwareEventMap;
  [NAMESPACES.LOG]: LogEventMap;
  [NAMESPACES.PERMISSION]: PermissionEventMap;
  [NAMESPACES.FILESYSTEM]: FileSystemEventMap;
  [NAMESPACES.IME]: ImeEventMap;
  [NAMESPACES.TOKEN_DISPENSER]: TokenDispenserEventMap;
  [NAMESPACES.OUTBOX]: OutboxEventMap;
  [NAMESPACES.UPDATE]: UpdateEventMap;
  // @gen:nsmap
};

// types 의 NAMESPACES 에 항목이 추가되면 NamespaceEventMap 에도 반드시 추가되어야
// 한다는 것을 컴파일 타임에 강제한다 — 누락 시 아래 줄에서 에러가 난다.
type AssertServesAllNamespaces<T extends Record<Namespace, EventMap>> = T;
type _NamespaceEventMapIsTotal = AssertServesAllNamespaces<NamespaceEventMap>;

// 네임스페이스별로 허용되는 이벤트 키 목록(런타임 검증용)
export const namespaceToEvents: Record<Namespace, ReadonlyArray<string>> = {
  [NAMESPACES.HARDWARE]: Object.values(HARDWARE_EVENTS),
  [NAMESPACES.LOG]: Object.values(LOG_EVENTS),
  [NAMESPACES.PERMISSION]: Object.values(PERMISSION_EVENTS),
  [NAMESPACES.FILESYSTEM]: Object.values(FILESYSTEM_EVENTS),
  [NAMESPACES.IME]: Object.values(IME_EVENTS),
  [NAMESPACES.TOKEN_DISPENSER]: Object.values(TOKEN_DISPENSER_EVENTS),
  // 렌더러에 여는 표면은 자격 주입을 뺀 부분집합이라 이벤트 전체가 아니라 클라이언트
  // 스키마의 키를 쓴다 — 두 목록이 어긋날 자리를 만들지 않는다.
  [NAMESPACES.OUTBOX]: Object.keys(OutboxSchemas),
  [NAMESPACES.UPDATE]: Object.values(UPDATE_EVENTS),
  // @gen:ns-events
};
