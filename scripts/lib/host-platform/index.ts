// 번들 조립의 플랫폼 선택 지점 — frontend/backend Transport 의 impl/* 패턴과 동형.
// 지금은 win32 고정이고, 리눅스 지원 시 여기(또는 빌드타임 alias)에서 impl 만 치환한다.
// 소비처는 반드시 이 진입점만 import 한다(impl 직접 참조 금지).
export * from './impl/win32';
