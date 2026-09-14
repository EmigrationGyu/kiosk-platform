import fs from 'node:fs';
import type { TolgeeLanguage } from 'kiosk-types';
import koffi from 'koffi';
import { Logger } from '@/shared/Logger';
import {
  EMPTY_ENGINE_RESULT,
  type EngineResult,
  type ImeEngine,
  type RawImeContext,
} from '../ImeEngine';
import { charToKeysym } from './keysym';
import { type RimePaths, resolveRimePaths } from './paths';
import { loadRime, type RimeFfi } from './rimeFfi';
import { languageToRimeProfile } from './schema';

// HMR(vite-node --watch) 을 넘어 살아남아야 하는 프로세스 스코프 싱글턴 슬롯.
// rime.dll 핸들 + init/deploy 상태 + 세션을 소유하므로 재평가마다 재로드/재배포하면 안 된다.
const SHARED_KEY = '__RIME_ENGINE__';

// 스키마 배포가 실제 사용 가능한지 확인하는 health probe 용(항상 배포되는 스키마 = 기능 probe).
const HEALTH_PROBE_SCHEMA = 'luna_pinyin';

type DecodedCandidate = { text: string | null };
type DecodedContext = {
  composition: { preedit: string | null };
  menu: {
    num_candidates: number;
    highlighted_candidate_index: number;
    candidates: unknown;
  };
};

/**
 * librime 기반 ImeEngine 구현(impure shell). koffi 네이티브 호출·세션 상태를 여기 격리한다.
 * rime 고유 입력규약(keysym 매핑, luna_pinyin/zh_hans 스키마 옵션)도 이 impl 내부에만 존재한다.
 * 세션 1개(키오스크 활성 입력 1개) + 현재 스키마/간체옵션을 프로세스 스코프로 보유한다.
 */
export class RimeEngine implements ImeEngine {
  private readonly logger = Logger.getInstance();
  private ffi: RimeFfi | null = null;
  private ready = false;
  private session = 0;
  private currentSchema: string | null = null;
  private currentZhHans: boolean | null = null;

  static shared(factory: () => RimeEngine): RimeEngine {
    const registry = globalThis as unknown as Record<
      string,
      RimeEngine | undefined
    >;
    return (registry[SHARED_KEY] ??= factory());
  }

  /** 준비된 FFI 접근자 — 준비 전 호출은 프로그래밍 오류. */
  private get api(): RimeFfi {
    if (!this.ffi)
      throw new Error('[Ime] engine not ready — ensureReady() 먼저');
    return this.ffi;
  }

  supports(language: TolgeeLanguage): boolean {
    return languageToRimeProfile(language) !== null;
  }

  private buildTraits(paths: RimePaths): Record<string, unknown> {
    const INT = koffi.sizeof('int');
    return {
      data_size: koffi.sizeof('RimeTraits') - INT,
      shared_data_dir: paths.sharedDataDir,
      user_data_dir: paths.userDataDir,
      distribution_name: 'Kiosk',
      distribution_code_name: 'Kiosk',
      distribution_version: '3.0',
      app_name: 'rime.kiosk',
      modules: null,
      min_log_level: 2, // ERROR 이상만
      log_dir: '', // stderr only
      prebuilt_data_dir: null,
      staging_dir: null,
    };
  }

  ensureReady(): boolean {
    if (this.ready) return true;

    const paths = resolveRimePaths();
    // 어떤 경로를 보고 있는지 먼저 남긴다 — "데이터가 딴 홈에 있는" 케이스를 즉시 구분.
    this.logger.info('[Ime] ensureReady 시작', {
      unmasked: {
        base: paths.sharedDataDir,
        dll: paths.dllPath,
        user: paths.userDataDir,
      },
    });
    if (!fs.existsSync(paths.dllPath)) {
      this.logger.error('[Ime] rime.dll 없음', undefined, {
        unmasked: {
          path: paths.dllPath,
        },
      });
      return false;
    }
    if (!fs.existsSync(paths.sharedDataDir)) {
      this.logger.error('[Ime] shared_data_dir 없음', undefined, {
        unmasked: {
          path: paths.sharedDataDir,
        },
      });
      return false;
    }

    try {
      fs.mkdirSync(paths.userDataDir, { recursive: true });
      this.logger.info('[Ime] rime.dll 로드 시도');
      const ffi = loadRime(paths.dllPath);
      const traits = this.buildTraits(paths);
      this.logger.info('[Ime] setup/initialize 호출');
      ffi.setup(traits);
      ffi.initialize(traits);
      this.logger.info(
        '[Ime] startMaintenance(full_check) — 스키마 배포 시작(블록)',
      );
      ffi.startMaintenance(1); // full_check — 스키마 컴파일(.bin) 배포
      ffi.joinMaintenanceThread(); // 배포 완료까지 블록
      this.ffi = ffi;
      this.ready = true;
      this.logger.info('[Ime] rime engine ready (deploy 완료)');
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error('[Ime] rime 엔진 init 실패', e, {
        unmasked: { error: msg },
      });
      this.ffi = null;
      this.ready = false;
      return false;
    }
  }

  health(): boolean {
    if (!this.ensureReady()) return false;
    const sid = this.api.createSession();
    if (!sid) {
      this.logger.error('[Ime] health: createSession 실패');
      return false;
    }
    try {
      return this.api.selectSchema(sid, HEALTH_PROBE_SCHEMA) !== 0;
    } finally {
      this.api.destroySession(sid);
    }
  }

  processKey(language: TolgeeLanguage, key: string): EngineResult {
    const profile = languageToRimeProfile(language);
    if (!profile) return EMPTY_ENGINE_RESULT; // service 가 supports() 로 이미 가드
    const sid = this.ensureSession(profile.schemaId, profile.zhHans);
    if (!sid) return EMPTY_ENGINE_RESULT; // 세션 생성 실패 → 안전하게 빈 결과
    this.api.processKey(sid, charToKeysym(key), 0);
    return this.readState(sid);
  }

  selectCandidate(index: number): EngineResult {
    if (!this.session) return EMPTY_ENGINE_RESULT;
    this.api.selectCandidate(this.session, index);
    return this.readState(this.session);
  }

  clear(): void {
    if (this.session) this.api.clearComposition(this.session);
  }

  /**
   * 활성 세션 보장 + 요청 스키마·간체옵션 정렬. 바뀌면 반영 후 조합 초기화.
   * (zh_hans = luna_pinyin 의 simplifier@zh_hans 스위치 — on=간체 t2s, off=번체)
   */
  private ensureSession(schemaId: string, zhHans: boolean): number {
    if (!this.session) {
      this.session = this.api.createSession();
      // 세션 생성 실패(0) — 유효하지 않은 세션으로 selectSchema/setOption 등을 호출하지 않는다.
      if (!this.session) {
        this.logger.error('[Ime] createSession 실패');
        return 0;
      }
    }
    let changed = false;
    if (this.currentSchema !== schemaId) {
      this.api.selectSchema(this.session, schemaId);
      this.currentSchema = schemaId;
      this.currentZhHans = null; // 스키마 변경 시 옵션 재적용 강제
      changed = true;
    }
    if (this.currentZhHans !== zhHans) {
      this.api.setOption(this.session, 'zh_hans', zhHans ? 1 : 0);
      this.currentZhHans = zhHans;
      changed = true;
    }
    if (changed) this.api.clearComposition(this.session);
    return this.session;
  }

  // 상태 읽기 (koffi.alloc/encode/decode)
  private readState(sid: number): EngineResult {
    const commit = this.readCommit(sid); // commit 을 먼저 소비
    const ctx = this.readContext(sid);
    return { ctx, commit };
  }

  private readCommit(sid: number): string | null {
    const INT = koffi.sizeof('int');
    const buf = koffi.alloc('RimeCommit', 1);
    koffi.encode(buf, 'RimeCommit', {
      data_size: koffi.sizeof('RimeCommit') - INT,
    });
    if (!this.api.getCommit(sid, buf)) return null;
    const text = (koffi.decode(buf, 'RimeCommit') as { text: string | null })
      .text;
    this.api.freeCommit(buf);
    return text || null;
  }

  private readContext(sid: number): RawImeContext {
    const INT = koffi.sizeof('int');
    const buf = koffi.alloc('RimeContext', 1);
    koffi.encode(buf, 'RimeContext', {
      data_size: koffi.sizeof('RimeContext') - INT,
    });
    if (!this.api.getContext(sid, buf)) {
      return { preedit: null, candidates: [], highlightedIndex: -1 };
    }
    const ctx = koffi.decode(buf, 'RimeContext') as DecodedContext;
    const n = ctx.menu.num_candidates;
    const candidates =
      n > 0
        ? (
            koffi.decode(
              ctx.menu.candidates,
              'RimeCandidate',
              n,
            ) as DecodedCandidate[]
          ).map((c) => c.text ?? '')
        : [];
    const result: RawImeContext = {
      preedit: ctx.composition.preedit ?? null,
      candidates,
      highlightedIndex: ctx.menu.highlighted_candidate_index,
    };
    this.api.freeContext(buf);
    return result;
  }
}
