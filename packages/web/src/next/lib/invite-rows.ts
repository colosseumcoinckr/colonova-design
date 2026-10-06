import type { InviteRow, InviteRowTarget } from "@colonova-design/protocol";
import type { InviteImportState } from "../../hooks/use-invite-import";
import type { L } from "../labels";

/**
 * 다시 받은 초대장의 확인판 문장(U11) — `planInviteRows` 의 판정(add · update · keep)을 확인 창에 줄
 * 설 한국어로 바꾸고, 판의 제목이 **단계의 시제를 따르게** 한다(2026-10-06 겹판 손질). 문장은
 * `labels.ts` 에서 오지만 이 파일은 그것을 부르지 않고 인자로 받는다 — 단위 시험이 src 에서 곧장
 * 읽는 순수 모듈은 형제를 부르지 않는다(journey.ts 와 같은 규칙). 타입만 가져온 것은 지워진다.
 */
export type InviteRowWords = Pick<typeof L, "invite" | "inviteChange" | "settings">;

/** 확인 창에 줄 설 행 하나 — 칩 · 이름 · (바뀜의) 무엇이 · (새로의) 안내 한 줄. */
export interface InviteRowLine {
  action: "add" | "update" | "keep";
  /** 행의 이름 — update 행은 사용자가 지은 이름(currentName)이 이긴다. */
  name: string;
  /** 행 앞의 칩 — `새로` · `바뀜` · `그대로`. */
  chip: string;
  /** 바뀜 행의 무엇이 바뀌는가(` · ` 로 이음). 바뀜이 아니거나 짚을 값이 없으면 null. */
  detail: string | null;
  /** 행 아래의 한 줄 — add 행의 "처음 열 때 준비에 몇 분 걸려요". 없으면 null. */
  sub: string | null;
  /** `가져와서 열기` 로 열 프로젝트를 찾는 짝의 연결 주소. */
  repoUrl: string;
}

export interface InviteRowsCopy {
  /** 새로 → 바뀜 → 그대로 순서 — 영향이 큰 것이 먼저 읽힌다. 같은 종류 안에서는 초대장의 순서. */
  rows: InviteRowLine[];
  /** add 도 update 도 없다 — "연결 코드만 새로 받았어요" 의 판정. */
  nothingChanged: boolean;
}

/** 값이 있는 키만 세는 얕은 비교 — undefined 인 키와 없는 키를 같게 본다. */
function sameRecord(a: object | undefined, b: object | undefined): boolean {
  const left = Object.entries(a ?? {}).filter(([, value]) => value !== undefined);
  const right = new Map(Object.entries(b ?? {}).filter(([, value]) => value !== undefined));
  return left.length === right.size && left.every(([key, value]) => right.get(key) === value);
}

/**
 * 바뀜 행의 "무엇이 바뀌었는가" — 초대장의 값과 짝의 지금 값을 비교해 만든
 * 문장의 목록. 초대장이 정하는 값만 본다(이름 · 지켜 줄 것은 사용자의 몫).
 */
export function inviteUpdateChanges(
  row: Extract<InviteRow, { action: "update" }>,
  words: Pick<InviteRowWords, "inviteChange">,
  target: InviteRowTarget | undefined,
): string[] {
  const changes: string[] = [];
  if (target && target.baseBranch !== undefined && target.baseBranch !== row.project.baseBranch) {
    changes.push(words.inviteChange.baseBranch(target.baseBranch, row.project.baseBranch));
  }
  const want = row.project.reviewers ?? [];
  const have = target?.reviewers ?? [];
  if (want.length !== have.length || want.some((login, i) => login !== have[i])) {
    changes.push(words.inviteChange.reviewers);
  }
  if (row.project.approveCommands === true && target?.commandsApproved !== true) {
    changes.push(words.inviteChange.approve);
  }
  if (!sameRecord(row.project.defaults, target?.defaults)) {
    changes.push(words.inviteChange.defaults);
  }
  if (!sameRecord(row.project.lifecycle, target?.lifecycle)) {
    changes.push(words.inviteChange.lifecycle);
  }
  return changes;
}

/** 행이 사람에게 불리는 이름 — 바뀜 · 그대로는 사용자가 지은 이름이 이긴다. */
export function inviteRowName(row: InviteRow): string {
  return row.action === "add" ? row.project.name : row.currentName || row.project.name;
}

const ORDER = { add: 0, update: 1, keep: 2 } as const;

export function inviteRowsCopy(
  rows: InviteRow[],
  words: InviteRowWords,
  targets: InviteRowTarget[] = [],
): InviteRowsCopy {
  const lines = rows.map((row): InviteRowLine => {
    const name = inviteRowName(row);
    if (row.action === "add") {
      return {
        action: "add",
        name,
        chip: words.invite.rowNew,
        detail: null,
        sub: words.invite.addedNote,
        repoUrl: row.project.repoUrl,
      };
    }
    if (row.action === "update") {
      const what = inviteUpdateChanges(
        row,
        words,
        "slug" in row ? targets.find((target) => target.slug === row.slug) : undefined,
      ).join(" · ");
      return {
        action: "update",
        name,
        chip: words.invite.rowUpdate,
        detail: what || null,
        sub: null,
        repoUrl: row.project.repoUrl,
      };
    }
    return {
      action: "keep",
      name,
      chip: words.invite.rowKeep,
      detail: null,
      sub: null,
      repoUrl: row.project.repoUrl,
    };
  });
  return {
    // 안정 정렬 — 같은 종류 안에서는 초대장이 정한 순서를 지킨다.
    rows: lines
      .map((line, index) => ({ line, index }))
      .sort((a, b) => ORDER[a.line.action] - ORDER[b.line.action] || a.index - b.index)
      .map(({ line }) => line),
    nothingChanged: rows.length > 0 && rows.every((row) => row.action === "keep"),
  };
}

/** 적용이 끝난 결과의 모양 — 제목 · 본문 · 단추가 이 하나로 갈린다. */
export type InviteOutcome = "ok" | "partial" | "failed" | "token";

/** 적용 결과의 최소 모양 — 컨트롤러의 `ApplyResult` 가 구조적으로 만족한다. */
export interface InviteResultLike {
  tokenError?: string;
  results: ReadonlyArray<{ ok: boolean }>;
}

/**
 * 결과가 어느 끝인가 — 연결 코드가 거절되면 프로젝트는 하나도 건드리지 않았고(`token`), 행이 모두
 * 실패하면 `failed`, 일부만 실패하면 `partial`, 모두 됐으면 `ok` 다. 일부만 실패한 것을
 * 「가져왔어요」라고 말하지 않는 것이 이 판정의 이유다.
 */
export function inviteOutcome(result: InviteResultLike): InviteOutcome {
  if (result.tokenError !== undefined) return "token";
  const failed = result.results.filter((entry) => !entry.ok).length;
  if (failed === 0) return "ok";
  return failed === result.results.length ? "failed" : "partial";
}

/** 판의 머리가 입는 기운 — 머리의 그림과 색이 이것을 따른다(색만으로 말하지 않는다: 제목이 함께 말한다). */
export type InviteTone = "info" | "ok" | "warn" | "bad";

export interface InviteHead {
  title: string;
  /** 제목 아래 한 줄 — 없는 단계도 있다. */
  sub: string | null;
  tone: InviteTone;
}

/** 머리의 문장에 필요한 바깥 값 — 상태만으로는 알 수 없는 것들. */
export interface InviteHeadContext {
  /** 이 초대로 이어질 프로젝트 수 — 확인 단계는 지금 있는 것 + 새로 오는 것, 결과 단계는 지금 있는 것. */
  reach: number;
  /** 만료된 연결을 다시 잇는 초대인가 — 「새 것으로 바뀌어요」 대신 「다시 이어져요」. */
  reconnected: boolean;
}

/**
 * 판의 제목 — **단계의 시제를 따른다**. 확인 단계가 「가져왔어요」라고 먼저 말하면 안내로 읽고
 * `그만두기` 를 눌러도 아무것도 안 바뀐다(거짓 시제). 확인은 질문(`가져올까요?`)과 영향의 크기,
 * 끝난 뒤에야 과거형이고, 실패 위에는 성공의 말을 걸지 않는다(코드 거절 `연결하지 못했어요` ·
 * 일부 `일부만 가져왔어요` · 모두 `가져오지 못했어요`).
 */
export function inviteTitle(
  state: InviteImportState,
  words: InviteRowWords,
  ctx: InviteHeadContext,
): InviteHead {
  const I = words.invite;
  switch (state.phase) {
    case "idle":
      return { title: "", sub: null, tone: "info" };
    case "reading":
      return { title: I.readingTitle, sub: null, tone: "info" };
    case "error":
      return { title: I.errorTitle, sub: null, tone: "bad" };
    case "confirm":
      return {
        title: I.confirmTitle,
        sub: `${ctx.reconnected ? I.confirmSubReconnect : I.confirmSub} · ${I.reaches(ctx.reach)}`,
        tone: "info",
      };
    case "applying":
      return { title: I.applyingTitle, sub: I.applyingSub, tone: "info" };
    case "done": {
      const outcome = inviteOutcome(state.result);
      if (outcome === "token") return { title: I.tokenTitle, sub: null, tone: "bad" };
      if (outcome === "failed") return { title: I.failedTitle, sub: null, tone: "bad" };
      if (outcome === "partial") {
        const total = state.result.results.length;
        const ok = state.result.results.filter((entry) => entry.ok).length;
        return { title: I.partialTitle, sub: I.partialSub(ok, total), tone: "warn" };
      }
      return {
        title: I.title,
        sub: `${ctx.reconnected ? I.reconnected : I.renewed} · ${I.reaches(ctx.reach)}`,
        tone: "ok",
      };
    }
  }
}

/** 적용 중의 한 줄 — 지금 하는 행의 이름을 말한다(`rows[done]`). 행 수에 닿았으면 일반 문장. */
export function applyingLine(rows: InviteRow[], done: number, words: InviteRowWords): string {
  const row = rows[done];
  return row
    ? words.invite.applyingName(inviteRowName(row))
    : words.invite.progressing(done, rows.length);
}

/**
 * 결과 머리의 「연결은 N월 N일까지예요」 — 데몬이 이미 아는 만료 예정(`status.githubTokenExpiresAt`)을
 * 다시 쓴다. 모르거나 이미 지난 날짜(막 바꾼 코드가 아직 상태에 안 실린 때의 옛 값)는 말하지 않는다.
 */
export function inviteUntil(
  expiresAt: string | null | undefined,
  now: number,
  words: InviteRowWords,
): string | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now) return null;
  return words.invite.until(words.settings.connectionUntil(end.getMonth() + 1, end.getDate()));
}

/** 적용 결과의 한 줄 — 실패한 행의 이름과, 접어 둘 날것의 이유. */
export interface InviteFailure {
  repoUrl: string;
  name: string;
  /** 선로가 남긴 문장 그대로 — 화면은 「자세히」 안에서만 보인다. */
  detail: string | null;
}

export function inviteFailures(
  results: ReadonlyArray<{ row: InviteRow; ok: boolean; error?: string }>,
): InviteFailure[] {
  return results
    .filter((entry) => !entry.ok)
    .map((entry) => ({
      repoUrl: entry.row.project.repoUrl,
      name: inviteRowName(entry.row),
      detail: entry.error?.trim() ? entry.error : null,
    }));
}

/**
 * 연결 코드가 거절된 이유의 사람 말 — 연결이 끊겨 있으면 끊겼다고, 아니면 코드를 못 받았다고 한다.
 * `lock` 은 `connectionLock` 의 답(끊김의 이유 · 열려 있으면 null)이다.
 */
export function tokenFailureText(lock: string | null, words: InviteRowWords): string {
  return lock === null ? words.invite.tokenRefused : words.invite.tokenOffline;
}

/** 가져오기를 잠그는 줄 — 연결의 이유 뒤에 이 판이 약속하는 말을 붙인다. 열려 있으면 잠그지 않는다(null). */
export function inviteLockLine(lock: string | null, words: InviteRowWords): string | null {
  return lock === null ? null : `${lock} — ${words.invite.lockNote}`;
}

/** 초대 파일을 읽지 못한 이유의 갈래 — 파서의 이유(`sealed` · `json` · `version` …)를 사람 말의 갈래로 묶는다. */
export type InviteReadFailure =
  | "not-invite"
  | "sealed"
  | "unreadable"
  | "version"
  | "token"
  | "content"
  | "file";

/**
 * 읽기 오류의 사람 말 — 해요체 한 줄이다. 파서 · 선로가 남긴 날것은 문장에 섞지 않는다(화면이
 * 「자세히」 안에 접는다). 문장을 고르는 일이 이 파일에 있어야 `next/` 의 죽은 문장 시험이 센다.
 */
export function inviteReadError(kind: InviteReadFailure, words: InviteRowWords): string {
  const I = words.invite;
  switch (kind) {
    case "not-invite":
      return I.errNotInvite;
    case "sealed":
      return I.errSealed;
    case "unreadable":
      return I.errUnreadable;
    case "version":
      return I.errVersion;
    case "token":
      return I.errNoToken;
    case "content":
      return I.errContent;
    case "file":
      return I.errFile;
  }
}

/** 도달 검사의 경고 — 새 연결 코드로 이 프로젝트를 제출할 수 없다(개발자에게 알려야 한다). */
export function inviteReachWarning(name: string, words: InviteRowWords): string {
  return words.invite.reachWarn(name);
}
