import type { DeveloperReview, RepoHistoryEntry, RepoStatus } from "@colonova-design/protocol";
import { historyKindOf } from "./history-kind.ts";

/**
 * `이번 작업` 과 제출 확인의 순수 판정(PLAN-UI U2 · U3) — 데몬이 싣는 사실
 * (`cycleScreens` · `repo.history` · 제출한 요청의 코멘트)을 목록으로 접는다.
 * 시험이 src 에서 곧장 읽으므로 형제를 부르지 않는다(journey.ts 와 같은 규칙).
 *
 * 시각은 늘 수로 견준다 — 화면 목록과 작업 기록은 git 의 시각(`+09:00`), 제출
 * 기록과 코멘트는 UTC(`Z`)라 글자로 견주면 어긋난다.
 */
export type CycleScreen = NonNullable<RepoStatus["cycleScreens"]>[number];

const time = (iso: string): number => Date.parse(iso);
const synced = (entry: { message: string; kind?: RepoHistoryEntry["kind"] }) =>
  historyKindOf(entry.message, entry.kind, { restore: "\0", comment: "\0" }) === "merge";

/** `since` 뒤인가 — 기준이 없으면 모두 뒤다. */
function after(iso: string, since: string | null): boolean {
  return since === null || time(iso) > time(since);
}

/** 제출 기록의 한 줄 — 원장의 submitTrail 이 싣는 모양. */
type SubmitLogLine = NonNullable<RepoStatus["submit"]>["log"][number];

/**
 * 사이클 경계 뒤의 제출 기록, 최근 것부터 — 원장의 기록은 병합 뒤 새 draft
 * 사이클로 이월되므로 표시 계층이 경계를 가린다(2026-10-04 ux-plan PR 3,
 * 결함 6). draft 의 경계는 마지막 넘김이고, review · merged 의 경계는 마지막
 * 제출이다. 기준이 없으면 모두 지난 기록이다.
 */
export function submitLogLines(
  log: ReadonlyArray<SubmitLogLine>,
  boundary: string | null,
): SubmitLogLine[] {
  return [...log]
    .sort((a, b) => time(b.at) - time(a.at))
    .filter((line) => after(line.at, boundary));
}

/**
 * 보낼 화면 — 화면마다 한 줄, 그 화면을 만든 가장 최근의 말과 시각. 목록은
 * 최근 것부터 온다(데몬의 순서). 제목이 빈 화면(화면을 만지지 않은 차례)은
 * 빠지고, 열린 요청이 있으면 `since`(마지막 제출) 뒤의 것만 남는다.
 */
export function outgoingScreens(
  screens: CycleScreen[] | undefined,
  since: string | null,
): CycleScreen[] {
  const seen = new Set<string>();
  const out: CycleScreen[] = [];
  const newestFirst = [...(screens ?? [])].sort((a, b) => time(b.at) - time(a.at));
  for (const screen of newestFirst) {
    if (synced({ message: screen.note, kind: screen.kind })) continue;
    if (screen.title.trim() === "" || seen.has(screen.route)) continue;
    seen.add(screen.route);
    if (after(screen.at, since)) out.push(screen);
  }
  return out;
}

/**
 * 화면 밖 변경 — 작업 기록의 차례 중 화면 목록에 서지 않은 것의 수. 화면
 * 목록의 한 줄은 (차례 × 화면) 이고 그 시각이 차례의 시각이므로, 시각이 같은
 * 줄이 없는 차례가 화면 밖이다.
 */
export function outsideChanges(
  history: RepoHistoryEntry[] | null,
  screens: CycleScreen[] | undefined,
  since: string | null,
): number {
  if (!history) return 0;
  const onScreen = new Set(
    (screens ?? []).filter((screen) => screen.title.trim() !== "").map((screen) => time(screen.at)),
  );
  const onScreenSha = new Set(
    (screens ?? [])
      .filter((screen) => screen.title.trim() !== "" && screen.sha)
      .map((screen) => screen.sha),
  );
  return history.filter(
    (entry) =>
      !synced(entry) &&
      after(entry.at, since) &&
      !onScreenSha.has(entry.sha) &&
      !((screens ?? []).some((screen) => !screen.sha) && onScreen.has(time(entry.at))),
  ).length;
}

/**
 * 남은 최종 변경을 마지막 관련 요청별로 묶는다 — 활동 횟수가 아니라 파일 수다. 줄마다
 * 그 요청의 시각(`at`)을 함께 싣는다. 제출 전에 남아 있는 변경이 어느 말의 것인지
 * 보게 하는 몫이다(2026-10-25 베타 사용성 — 출처를 펼친 깊이에 숨겨 두지 않게).
 */
export function finalOutgoingChanges(
  history: RepoHistoryEntry[],
  screens: CycleScreen[] | undefined,
  finalFiles: string[],
): {
  screens: CycleScreen[];
  outside: Array<{ key: string; note: string | null; at: string | null; files: number }>;
} {
  const meaningful = history
    .filter((entry) => !synced(entry))
    .sort((a, b) => time(b.at) - time(a.at));
  const final = new Set(finalFiles);
  const currentScreens = outgoingScreens(
    (screens ?? []).filter((screen) =>
      meaningful.some(
        (entry) => entry.sha === screen.sha && entry.files.some((file) => final.has(file)),
      ),
    ),
    null,
  );
  const screenShas = new Set(
    (screens ?? [])
      .filter(
        (screen) => screen.title.trim() && !synced({ message: screen.note, kind: screen.kind }),
      )
      .map((screen) => screen.sha),
  );
  const outside = new Map<
    string,
    { key: string; note: string | null; at: string | null; files: number }
  >();
  for (const file of final) {
    const owner = meaningful.find((entry) => entry.files.includes(file));
    if (owner && screenShas.has(owner.sha)) continue;
    const key = owner?.sha ?? "unassociated";
    const row = outside.get(key) ?? {
      key,
      note: owner?.message ?? null,
      at: owner?.at ?? null,
      files: 0,
    };
    row.files++;
    outside.set(key, row);
  }
  return { screens: currentScreens, outside: [...outside.values()] };
}

export interface CommentRow {
  id: number;
  author: string;
  text: string;
  at: string;
  /** `done` 반영됨 · `fixing` AI 가 고치는 중 · `unknown` 작업 기록을 아직 못 읽어 모른다. */
  state: "done" | "fixing" | "unknown";
}

/** 2026-10-20 MVP: 의견은 도착 순으로 표시하고 기록·병합만으로 반영 여부를 추정하지 않는다. */
export function commentRows(
  reviews: DeveloperReview[],
  _history: RepoHistoryEntry[] | null,
  _options: { merged: boolean; reflectionPrefix: string },
): CommentRow[] {
  return reviews
    .filter((review) => review.body.trim() !== "")
    .sort((a, b) => time(b.at) - time(a.at))
    .map((review) => ({
      id: review.id,
      author: review.author,
      text: review.body.replace(/\s+/g, " ").trim(),
      at: review.at,
      // 사용자가 요청한 수정과 의견의 대응을 추정하지 않는다.
      state: "unknown" as const,
    }));
}

/** 장부 한 덩이를 읽는 일의 상태 — 팝이 `아직 없어요` 와 `읽는 중` · `읽지 못했어요` 를 가른다. */
export type LedgerRead = "loading" | "ready" | "failed";

/**
 * 코멘트를 읽는 일의 상태(2026-10-06 겹판 손질) — 옛 장부는 읽기 실패를 콘솔에만 남겨 팝이 `아직 없어요` 라는
 * 거짓 빈 상태를 말했다. 읽을 요청이 없으면 읽을 것이 없다(ready). 같은 요청을 한 번이라도 읽었으면 그 값을
 * 지킨다 — 다시 읽는 중이거나 다시 읽기가 실패해도 보이던 목록을 지우지 않는다(다음 읽기가 스스로 고친다).
 * 처음 읽는 중이면 loading, 처음 읽기가 실패했으면 failed.
 */
export function reviewsRead(input: {
  hasHandoff: boolean;
  /** 지금의 요청(프로젝트 · 번호)을 성공적으로 읽은 적이 있다. */
  loaded: boolean;
  /** 지금의 요청을 마지막으로 읽으려던 일이 실패했다. */
  failed: boolean;
}): LedgerRead {
  if (!input.hasHandoff || input.loaded) return "ready";
  return input.failed ? "failed" : "loading";
}

/** 여정 둘째 점의 코멘트 수 — 장부에 서는 줄(글이 있는 코멘트)의 수. */
export function commentCount(reviews: DeveloperReview[]): number {
  return reviews.filter((review) => review.body.trim() !== "").length;
}

/** 이번 작업이 시작된 때 — 기록과 화면 목록의 가장 이른 시각. 모르면 null. */
export function cycleStart(
  screens: CycleScreen[] | undefined,
  history: RepoHistoryEntry[] | null,
): string | null {
  let first: string | null = null;
  for (const at of [...(screens ?? []).map((s) => s.at), ...(history ?? []).map((e) => e.at)]) {
    if (Number.isNaN(time(at))) continue;
    if (first === null || time(at) < time(first)) first = at;
  }
  return first;
}

/** 시각 한 칸의 재료 — 문장은 부르는 쪽(`L.work.time`)이 짓는다. 읽을 수 없으면 null. */
export function clockParts(
  iso: string,
  now: Date,
): { today: boolean; hhmm: string; month: number; day: number } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const today =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return { today, hhmm, month: at.getMonth() + 1, day: at.getDate() };
}
