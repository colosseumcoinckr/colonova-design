import type { LandedWork } from "@colonova-design/protocol";

/**
 * 반영된 일(2026-10-08 베타 준비 분석 · A2b) — 제출한 일이 병합된 순간의 보상을 두 곳이 같은 눈으로 읽는다: 대화 안의 성취 카드와
 * `이번 작업` 팝의 아래 묶음(2026-10-31 홈 걷기로 홈의 묶음이 이곳으로 옮겨 왔다). 데몬이 사건(`cycle.merged`)과 원장(`RepoStatus.landed`)에 싣는 사실을
 * 줄로 접는 순수 함수만 산다 — 단위 시험이 src 에서 곧장 읽는다(형제를 부르지 않는다). 문장은 부르는 쪽(`labels.ts`)의 것이다.
 */

/** `반영된 일` 묶음에 서는 줄의 상한 — 데몬은 스무 건을 기억하고 팝은 최근 여덟만 보인다. */
export const LANDED_HOME_LIMIT = 8;

/** 한 줄 — 제목 · 며칠 · 화면 수는 모르면 null(그 말을 하지 않는다), `at` 은 병합된 때(ms). */
export interface LandedLine {
  pr: number;
  title: string | null;
  days: number | null;
  screens: number | null;
  at: number;
}

/**
 * 원장의 기억을 팝의 줄로 — 최신순, 같은 요청 번호는 한 번, 시각을 읽을 수 없는 줄은 뺀다(`n일 전` 을 말할 수 없다).
 * 0건이면 빈 목록이고 묶음은 서지 않는다(0건 숨김 규칙). 데몬이 최신순으로 내려 주지만 한 번 더 가른다 —
 * 같은 때의 줄은 받은 순서를 지킨다(안정 정렬).
 */
export function landedLines(
  landed: ReadonlyArray<LandedWork> | null | undefined,
  limit: number = LANDED_HOME_LIMIT,
): LandedLine[] {
  const seen = new Set<number>();
  const lines: LandedLine[] = [];
  for (const entry of landed ?? []) {
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || seen.has(entry.pr)) continue;
    seen.add(entry.pr);
    lines.push({
      pr: entry.pr,
      title: entry.title?.trim() ? entry.title.trim() : null,
      days: entry.days ?? null,
      screens: entry.screens !== undefined && entry.screens > 0 ? entry.screens : null,
      at,
    });
  }
  lines.sort((a, b) => b.at - a.at);
  return lines.slice(0, limit);
}

/** 사실 줄의 말 — 문장은 `L.landed` 가 정한다. */
export interface LandedFactWords {
  took: (days: number) => string;
  screens: (n: number) => string;
}

/**
 * `3일 만에 · 화면 2곳` — 아는 것만 이어 붙인다. 하나도 모르면 null(줄이 서지 않는다). 며칠은 0 도 말이다(같은 날).
 */
export function landedFacts(
  days: number | null | undefined,
  screens: number | null | undefined,
  words: LandedFactWords,
): string | null {
  const parts: string[] = [];
  if (days !== null && days !== undefined && days >= 0) parts.push(words.took(days));
  if (screens !== null && screens !== undefined && screens > 0) parts.push(words.screens(screens));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * 반영 사건이 성취 카드로 설 만큼 아는가 — 제목 · 며칠 · 화면 수 중 하나라도 있으면 카드다. 옛 사건(필드 없음)은 지금의
 * 얇은 한 줄 그대로 읽힌다.
 */
export function hasLandedFacts(block: {
  title?: string;
  days?: number;
  screens?: number;
}): boolean {
  return (
    Boolean(block.title?.trim()) ||
    (block.days !== undefined && block.days >= 0) ||
    (block.screens !== undefined && block.screens > 0)
  );
}

/** 막 도착한 반영으로 치는 시간 — 이보다 오래된 사건은 이미 끝난 일이라 체크를 다시 그리지 않는다. */
export const LANDED_FRESH_MS = 10 * 60 * 1000;

/**
 * 성취 카드의 체크를 그릴까 — 이번 창에서 막 도착한 사건일 때만이다. 대화를 다시 열어 읽는 카드는 조용히 선다. 부르는 쪽이
 * 「첫 그림에 없던 카드」 인지를 따로 보고(`Thread`), 이 함수는 사건의 나이가 그럴 만한지를 본다 — 기록을 늦게 불러온 창이
 * 오래된 카드를 모두 새것으로 치지 않게. 시각을 읽을 수 없으면 아니다.
 */
export function landedIsFresh(at: string, now: number): boolean {
  const when = Date.parse(at);
  return Number.isFinite(when) && now - when < LANDED_FRESH_MS;
}
