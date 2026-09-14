import { LOCAL_DATA_DIR, LOCAL_UPDATE_DIR, RUNTIME_DIR } from 'kiosk-types';
import os from 'os';
import path from 'path';

/**
 * Kiosk 홈 디렉토리 — 이 단말의 로컬 데이터 루트(로그·auth·config 의 부모).
 * 하위 디렉토리 상수는 모두 이 base 에서 파생한다(경로 중복 방지).
 *
 * - Windows: C:\Users\<user>\.kiosk
 */
export const KIOSK_HOME_DIR = path.join(os.homedir(), LOCAL_DATA_DIR);

/** 로그 디렉토리(기존 LogService와 동일). */
export const KIOSK_LOG_DIR = path.join(KIOSK_HOME_DIR, 'logs');

/**
 * 인증 자료 루트 디렉토리 — 로그 디렉토리의 형제.
 * CX 가 logs 옆에서 바로 찾을 수 있고, 홈 디렉토리라 권한 문제도 없다.
 * 파일은 직접 두지 않고 용도별 하위 디렉토리(capture/signature)로 분리한다.
 */
export const KIOSK_AUTH_DIR = path.join(KIOSK_HOME_DIR, 'auth');

/** 인증 캡처(전면·신분증) 저장 디렉토리 — 인증 성공 건만. */
export const KIOSK_AUTH_CAPTURE_DIR = path.join(KIOSK_AUTH_DIR, 'capture');

/** 약관 서명 이미지 저장 디렉토리 (구 C:\AUTH\SIGNATURE 에서 이전). */
export const KIOSK_AUTH_SIGNATURE_DIR = path.join(KIOSK_AUTH_DIR, 'signature');

/**
 * 도어락/디바이스 로컬 설정 디렉토리 — 로그·auth 의 형제.
 * 서버가 아니라 이 단말에만 있는 하드웨어 설정(예: AT_GANGNAM magicSig·keyA·카드 블록)을
 * 수기 배치한다. 서버 상태가 아니므로 백엔드 무상태 원칙과 무관하다.
 */
export const KIOSK_CONFIG_DIR = path.join(KIOSK_HOME_DIR, 'config');

/** 원격 전체 업데이트의 작업 디렉토리 — 받아둔 설치본과 그 결과 기록(단일 출처는 types). */
export const KIOSK_UPDATE_DIR = path.join(KIOSK_HOME_DIR, LOCAL_UPDATE_DIR);

/**
 * 서브프로세스 실행 런타임 디렉토리 — 호스트 런타임에 못 얹히는 자식들이 쓴다.
 * **아키텍처 단위로 공유**하므로 하위는 디바이스가 아니라 `node-<arch>` 다
 * (경로 파생은 `processManager/runtime.ts`, 계약은 types `types/runtime.ts`).
 */
export const KIOSK_RUNTIME_DIR = path.join(KIOSK_HOME_DIR, RUNTIME_DIR);

export const formatLogDate = (d: Date = new Date()): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const getMainLogFilePath = (d: Date = new Date()): string => {
  const date = formatLogDate(d);
  return path.join(KIOSK_LOG_DIR, `${date}.log`);
};
