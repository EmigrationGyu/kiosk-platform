import koffi from 'koffi';

// librime 의 flat C API(rime_api_deprecated.h) 를 koffi 로 바인딩하는 얇은 레이어.
// Step 0 스파이크에서 검증한 struct 레이아웃(rime_api.h @ 33e7814) 그대로.
// rime.dll 은 deps 를 정적 링크한 자족 바이너리라 dll 하나만 로드하면 된다.

/** RimeContext 를 koffi.decode 로 읽은 원시 결과(엔진-중립 codec 이 소비). */
export interface RimeFfi {
  setup: (traits: unknown) => void;
  initialize: (traits: unknown) => void;
  startMaintenance: (fullCheck: number) => number;
  joinMaintenanceThread: () => void;
  createSession: () => number;
  destroySession: (sid: number) => number;
  selectSchema: (sid: number, schemaId: string) => number;
  setOption: (sid: number, name: string, value: number) => void;
  processKey: (sid: number, keycode: number, mask: number) => number;
  getContext: (sid: number, ctx: unknown) => number;
  freeContext: (ctx: unknown) => number;
  getCommit: (sid: number, commit: unknown) => number;
  freeCommit: (commit: unknown) => number;
  selectCandidate: (sid: number, index: number) => number;
  clearComposition: (sid: number) => number;
  finalize: () => void;
}

// koffi.struct 는 프로세스 전역 등록이라 HMR 재평가 시 중복 등록으로 throw 할 수 있다.
// 중복은 무시(이미 등록됨), 그 외 에러만 전파 — SdkClient 의 koffi.proto 중복 처리와 동일 idiom.
function defStruct(name: string, def: Record<string, string>): void {
  try {
    koffi.struct(name, def);
  } catch (e) {
    if (!String(e).toLowerCase().includes('duplicate')) throw e;
  }
}

function registerStructs(): void {
  // char* 문자열은 'str' 로 두면 decode 시 JS string 자동 변환. Bool = int.
  defStruct('RimeTraits', {
    data_size: 'int',
    shared_data_dir: 'str',
    user_data_dir: 'str',
    distribution_name: 'str',
    distribution_code_name: 'str',
    distribution_version: 'str',
    app_name: 'str',
    modules: 'void *',
    min_log_level: 'int',
    log_dir: 'str',
    prebuilt_data_dir: 'str',
    staging_dir: 'str',
  });
  defStruct('RimeComposition', {
    length: 'int',
    cursor_pos: 'int',
    sel_start: 'int',
    sel_end: 'int',
    preedit: 'str',
  });
  defStruct('RimeCandidate', {
    text: 'str',
    comment: 'str',
    reserved: 'void *',
  });
  defStruct('RimeMenu', {
    page_size: 'int',
    page_no: 'int',
    is_last_page: 'int',
    highlighted_candidate_index: 'int',
    num_candidates: 'int',
    candidates: 'RimeCandidate *',
    select_keys: 'str',
  });
  defStruct('RimeContext', {
    data_size: 'int',
    composition: 'RimeComposition',
    menu: 'RimeMenu',
    commit_text_preview: 'str',
    select_labels: 'void *',
  });
  defStruct('RimeCommit', { data_size: 'int', text: 'str' });
}

/**
 * rime.dll 을 로드하고 flat 심볼을 바인딩해 RimeFfi 를 반환.
 * 실패 시 throw(koffi 예외) — 호출자(RimeEngine.ensureReady)가 경계에서 잡아 준비 실패로 처리.
 */
export function loadRime(dllPath: string): RimeFfi {
  registerStructs();
  const lib = koffi.load(dllPath);
  const f = <T>(sig: string): T => lib.func(sig) as unknown as T;
  return {
    setup: f('void RimeSetup(RimeTraits *traits)'),
    initialize: f('void RimeInitialize(RimeTraits *traits)'),
    startMaintenance: f('int RimeStartMaintenance(int full_check)'),
    joinMaintenanceThread: f('void RimeJoinMaintenanceThread(void)'),
    createSession: f('uintptr_t RimeCreateSession(void)'),
    destroySession: f('int RimeDestroySession(uintptr_t session_id)'),
    selectSchema: f(
      'int RimeSelectSchema(uintptr_t session_id, str schema_id)',
    ),
    setOption: f(
      'void RimeSetOption(uintptr_t session_id, str option, int value)',
    ),
    processKey: f(
      'int RimeProcessKey(uintptr_t session_id, int keycode, int mask)',
    ),
    getContext: f(
      'int RimeGetContext(uintptr_t session_id, RimeContext *context)',
    ),
    freeContext: f('int RimeFreeContext(RimeContext *context)'),
    getCommit: f('int RimeGetCommit(uintptr_t session_id, RimeCommit *commit)'),
    freeCommit: f('int RimeFreeCommit(RimeCommit *commit)'),
    selectCandidate: f(
      'int RimeSelectCandidate(uintptr_t session_id, size_t index)',
    ),
    clearComposition: f('int RimeClearComposition(uintptr_t session_id)'),
    finalize: f('void RimeFinalize(void)'),
  };
}
