/**
 * 작업 기록 서랍(PLAN-UI U9)의 순수 판정 — 되돌리기 확인 문구의 수, 제출
 * 구분선의 자리, 차례마다의 화면. 형제 모듈을 부르지 않는다(시험이 src 에서
 * 곧장 읽는다) — 문장 조각(`코멘트 반영 — `)도 인자로 받는다.
 *
 * `entries` 는 `repo.history` 그대로 — 최신이 앞(0번이 지금 서 있는 곳)이다.
 */

/** 차례의 제목 — 보관의 첫 줄(=그 차례를 연 사용자의 말). */
export function entryTitle(message: string): string {
  return (message.split("\n")[0] ?? "").trim();
}

/**
 * `index` 의 차례 직후로 되돌리면 화면에서 사라지는 것 — 그보다 새로운 차례의
 * 수와, 그중 개발자 코멘트 반영(제목이 `commentPrefix` 로 시작)이 있는가.
 */
export function revertSummary(
  entries: ReadonlyArray<{ message: string }>,
  index: number,
  commentPrefix: string,
): { count: number; withComments: boolean } {
  const later = entries.slice(0, Math.max(0, Math.min(index, entries.length)));
  return {
    count: later.length,
    withComments: later.some((entry) => entryTitle(entry.message).startsWith(commentPrefix)),
  };
}

/**
 * `index` 의 차례 직후로 되돌리면 화면에서 바뀌는 곳 — 그보다 새로운 차례들이 만진 화면의 이름이다.
 * 같은 화면은 한 번만 센다(되돌리기 확인의 `화면 3곳` 칩과 이름 줄이 이 목록에서 나온다).
 * 화면 지도가 없는 데몬이면 빈 목록 — 부르는 쪽이 `알 수 없음` 문장을 고른다.
 */
export function affectedScreens(
  entries: ReadonlyArray<{ message: string; sha?: string }>,
  index: number,
  screens: ReadonlyArray<{ title: string; note: string; sha?: string }> | undefined,
): string[] {
  const later = entries.slice(0, Math.max(0, Math.min(index, entries.length)));
  return [...new Set(later.flatMap((entry) => entryScreens(entry, screens)))];
}

/** 시각을 말로 하는 길 — 1분 안은 방금, 한 시간 안은 N분 전, 그 밖은 시계(`14:05`). */
export type WhenKind = { kind: "now" } | { kind: "minutes"; minutes: number } | { kind: "clock" };

/** 시각 → 어떤 말로 할지. 읽을 수 없는 시각이나 앞선 시각(시계 어긋남)은 방금 · 시계로 물러난다. */
export function relativeTime(at: string, now: number): WhenKind {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return { kind: "clock" };
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return { kind: "now" };
  if (minutes < 60) return { kind: "minutes", minutes };
  return { kind: "clock" };
}

/** 서랍의 한 줄 — 차례 하나, 또는 그 사이의 제출 구분선. */
export type HistoryRow = { kind: "entry"; index: number } | { kind: "submit"; at: string };

/**
 * 차례들 사이에 제출의 순간을 끼운다. 제출은 그 시각보다 오래된 첫 차례 바로
 * 위에 선다(최신이 앞인 목록). 모든 차례보다 오래된 제출은 이번 사이클 밖이라
 * 긋지 않고, 같은 틈의 제출 여럿은 가장 늦은 것 하나로 접는다.
 */
export function historyRows(
  entries: ReadonlyArray<{ at: string }>,
  submits: readonly string[],
): HistoryRow[] {
  const times = submits
    .map((at) => ({ at, ms: Date.parse(at) }))
    .filter((submit) => Number.isFinite(submit.ms))
    .sort((a, b) => b.ms - a.ms);
  const rows: HistoryRow[] = [];
  let next = 0;
  entries.forEach((entry, index) => {
    const entryMs = Date.parse(entry.at);
    let divider: string | null = null;
    while (next < times.length && (times[next]?.ms ?? 0) >= entryMs) {
      divider ??= times[next]?.at ?? null;
      next += 1;
    }
    if (divider !== null) rows.push({ kind: "submit", at: divider });
    rows.push({ kind: "entry", index });
  });
  return rows;
}

/** 줄의 얼굴 — 사용자의 말(요청)과 앱이 만든 사건 셋. 타임라인의 마디 모양이 이것을 따른다. */
export type HistoryNode = "request" | "merge" | "restore" | "comment";

/** 한 날의 줄 — 차례(접힌 반영 차례 수를 달고) 또는 제출 구분선. */
export type HistoryItem =
  | { kind: "entry"; index: number; node: HistoryNode; folded: number }
  | { kind: "submit"; at: string };

/** 같은 날의 줄 묶음 — `id` 는 묶음의 열쇠(렌더가 쓴다), `date` 는 그 날, `at` 은 맨 위 줄의 시각. */
export interface HistoryDay {
  id: string;
  date: string;
  at: string;
  items: HistoryItem[];
}

/** 시각이 속한 날 — 이 컴퓨터의 시계 기준 `2026-10-06`. 읽을 수 없으면 빈 문자열. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 서랍의 줄을 날마다 묶는다. 줄은 최신이 앞이라 날도 그 차례로 서고, 제출 구분선은 제 시각의 날에
 * 선다(오늘 낮의 제출이 어제 밤 차례 위에 걸려 `어제` 로 읽히지 않게). 이어진 반영 차례
 * (`nodeOf` 가 `merge`)는 같은 날 바로 앞 줄도 반영 차례일 때만 그 줄에 접는다 — 요청 · 코멘트 ·
 * 되돌리기 · 제출 구분선은 접힘을 끊고 제 자리를 지킨다(되돌아갈 곳이 줄에서 사라지지 않게).
 */
export function historyDays(
  entries: ReadonlyArray<{ at: string }>,
  submits: readonly string[],
  nodeOf: (index: number) => HistoryNode,
): HistoryDay[] {
  const days: HistoryDay[] = [];
  const seen = new Map<string, number>();
  for (const row of historyRows(entries, submits)) {
    const at = row.kind === "entry" ? (entries[row.index]?.at ?? "") : row.at;
    const date = dayKey(at);
    let day = days[days.length - 1];
    if (day === undefined || day.date !== date) {
      const count = seen.get(date) ?? 0;
      seen.set(date, count + 1);
      day = { id: count === 0 ? date : `${date}#${count + 1}`, date, at, items: [] };
      days.push(day);
    }
    if (row.kind === "submit") {
      day.items.push(row);
      continue;
    }
    const node = nodeOf(row.index);
    const prev = day.items[day.items.length - 1];
    if (node === "merge" && prev?.kind === "entry" && prev.node === "merge") {
      prev.folded += 1;
      continue;
    }
    day.items.push({ kind: "entry", index: row.index, node, folded: 0 });
  }
  return days;
}

/**
 * 한 차례가 만진 화면의 제목 — `RepoStatus.cycleScreens` 에서 그 차례의 제목
 * (`note`)이나 sha 로 짝짓는다. 제목 없는 화면(화면을 만지지 않은 차례)은 뺀다.
 */
export function entryScreens(
  entry: { message: string; sha?: string },
  screens: ReadonlyArray<{ title: string; note: string; sha?: string }> | undefined,
): string[] {
  if (!screens) return [];
  const title = entryTitle(entry.message);
  const names: string[] = [];
  for (const screen of screens) {
    const match =
      entry.sha !== undefined && screen.sha !== undefined
        ? screen.sha === entry.sha
        : entryTitle(screen.note) === title;
    const name = screen.title.trim();
    if (match && name !== "" && !names.includes(name)) names.push(name);
  }
  return names;
}
