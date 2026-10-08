/**
 * 진단 한 덩어리(2026-10-07 베타 준비 분석) — 데몬이 모아 `diagnostics.summary` 의 답으로 건넨다.
 * 베타 테스터가 담당자에게 붙여 넣는 글의 재료이므로 **종류 · 숫자 · 버전만** 담는다: 사용자의 말 ·
 * 파일 경로 · 이메일 · 조직 이름 · 프로젝트 이름과 주소 · 토큰은 어느 칸에도 없다. 만드는 쪽
 * (`daemon/src/diagnostics.ts` 의 `buildDiagnosticsSummary`)이 칸마다 걸러서 싣고, 시험이 독이 든
 * 입력(이메일 · 경로 · 프로젝트 이름)을 먹여 그 약속을 지킨다.
 *
 * 선로에는 선택 요청 하나로 더했다 — 프로토콜 버전은 올리지 않는다(앱과 데몬이 함께 배포된다).
 */

/**
 * 실패한 턴의 갈래 — 턴 통계(`failure` 칸)와 진단 요약이 함께 쓰는 한 사전이다. 데몬의
 * `classifyFailure`(turn-retry)가 이 말들 가운데 하나를 고른다.
 */
export type TurnFailureStage = "length" | "auth" | "account" | "limit" | "stream" | "other";

/** 도구 하나의 있음 · 버전. 버전은 숫자와 점만 싣는다(자식 프로세스의 날 출력은 싣지 않는다). */
export interface DiagnosticsTool {
  present: boolean;
  version: string | null;
}

/** 분위수 한 줄 — `n` 은 값이 있는 턴의 수, 값이 하나도 없으면 p50 · p90 은 null. */
export interface DiagnosticsPercentiles {
  n: number;
  p50: number | null;
  p90: number | null;
}

/**
 * 최근 7일 턴 통계의 요약 — `~/.colonova-design/logs/turn-stats-*.jsonl`(종류와 숫자만 남는 파일)을
 * 한 번 더 접은 것이다. 프로젝트 · 세션 · 경로는 요약에 오지 않는다.
 */
export interface DiagnosticsTurnStats {
  /** 요약한 창(일). */
  days: number;
  /** 요약에 든 턴 수 — 게이트 행과 읽을 수 없는 줄은 세지 않는다. */
  turns: number;
  /** 턴의 출처별 수 — 사람이 보낸 말(`user`) · 핀 묶음(`comments`) · 도구가 연 턴(`brief` · `gate`). */
  byKind: { user: number; comments: number; brief: number; gate: number };
  /** 실패한 턴 수와, 단계별 수(0 인 단계는 칸에서 뺀다). */
  failed: number;
  failures: Partial<Record<TurnFailureStage, number>>;
  /** 핀을 쓴 턴 수(`pins > 0`). */
  pinTurns: number;
  /** 턴당 평균 도구 호출 수(소수 첫째 자리) — 읽을 수 있는 턴이 없으면 null. */
  avgToolCalls: number | null;
  /**
   * 첫 편집까지 · 첫 글자까지 · 턴 길이(ms)의 p50 · p90 — **사람이 보낸 턴 가운데 끝까지 답한 것**만
   * 센다(중지한 턴 · 실패한 턴 · 도구가 연 턴은 시간의 뜻이 다르다). 턴 길이에는 사람이 카드 앞에서
   * 기다린 시간이 섞여 있다.
   */
  firstEditMs: DiagnosticsPercentiles;
  firstDeltaMs: DiagnosticsPercentiles;
  durationMs: DiagnosticsPercentiles;
}

/** 데몬 로그에서 읽은 최근 오류의 종류 한 줄 — 메시지의 머리(정화 · 경로 걷어냄)와 횟수. */
export interface DiagnosticsErrorKind {
  /** 로그의 단계 — 오류(`error`)가 경고(`warn`)보다 앞에 선다. */
  level: "error" | "warn";
  kind: string;
  count: number;
  /** 마지막으로 본 시각(ISO). */
  lastAt: string;
}

export interface DiagnosticsSummary {
  /** 모은 시각(ISO). */
  at: string;
  /** 앱 버전 — 데스크톱이 데몬에 넘긴 값. 개발 실행 등 모르면 null. */
  appVersion: string | null;
  os: {
    /** node 의 `process.platform`. */
    platform: string;
    /** `os.release()` — 커널 · NT 빌드 번호(숫자와 점). 모르면 null. */
    release: string | null;
    /** node 의 `process.arch`. */
    arch: string;
  };
  protocolVersion: number;
  /** 데몬 안의 Node 버전(번들 런타임). */
  nodeVersion: string | null;
  /** 번들 도구와 이 기계의 도구 — 이 도구가 쓰는 node · git · pnpm · bash. */
  tools: {
    node: DiagnosticsTool;
    git: DiagnosticsTool;
    pnpm: DiagnosticsTool;
    bash: DiagnosticsTool;
  };
  /** AI 프로그램들의 있음 · 버전 · 로그인. 로그인을 모르는 AI 는 null. */
  ai: Array<{ id: string; present: boolean; version: string | null; loggedIn: boolean | null }>;
  /**
   * Claude 계정의 **종류** — 어떤 방식으로 연결됐는가(`claude.ai` · `api_key` …)와 요금제의 종류
   * (`pro` · `max` · `team` · `enterprise`). 이메일 · 조직 이름은 없다. 모르는 칸은 null.
   */
  account: { method: string | null; plan: string | null };
  /** 최근 7일 턴 통계 — 읽다가 예외가 나면 null(턴이 없으면 턴 0 의 요약이다). */
  turnStats: DiagnosticsTurnStats | null;
  /** 최근 오류의 종류(최대 5개 — 오류가 먼저, 그다음 경고, 각각 최근 순) — 로그가 없으면 빈 배열. */
  errors: DiagnosticsErrorKind[];
}
