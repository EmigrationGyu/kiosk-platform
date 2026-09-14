// 네임스페이스의 단일 진실 공급원(SSOT)은 kiosk-types/src/namespaces.ts 다.
// 백엔드는 재-export 만 한다 — 새 네임스페이스는 `bun gen` 이 types 쪽에 주입하고,
// 백엔드에서 서빙하려면 types/Namespaces.ts(NamespaceEventMap·namespaceToEvents)에
// 엔트리를 추가해야 하며, 누락 시 컴파일 에러가 난다.
export { NAMESPACES, type Namespace } from 'kiosk-types';
