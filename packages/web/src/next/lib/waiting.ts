import type { Attention, HandoffStatus } from "@colonova-design/protocol";
import { type CiLineWords, ciLine } from "./ci-line.ts";
import { startOfDay } from "./thread-groups.ts";

/**
 * 기다림이 보이게(2026-10-07 UX 점검 3단계) — 개발자 확인을 기다리는 요청이 며칠째인지. 상태 줄의 둘째 점(`개발자 확인을
 * 기다려요 · 2일째`)과 홈의 한 줄이 같은 계산을 쓴다. 달력으로 센다 — 어제 낸 것은 오늘 2일째이고, 자정이 지나면
 * 부르는 쪽(`useToday`)이 `today` 를 갈아 끼워 숫자가 저절로 는다.
 *
 * 순수 함수만 산다 — 단위 시험이 src 에서 곧장 읽는다. 문장은 부르는 쪽(`labels.ts`)의 것이다.
 */

const DAY_MS = 86_400_000;

/**
 * 요청이 열린 때(`since`, ISO)로부터 달력으로 며칠이 지났나 — 오늘 연 것은 0. `today` 는 오늘 자정(ms)이다. 모르거나
 * 읽을 수 없는 시각은 null(말하지 않는다). 시계가 어긋나 미래인 때는 0.
 */
export function daysSince(since: string | null | undefined, today: number): number | null {
  if (!since) return null;
  const at = Date.parse(since);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((today - startOfDay(at)) / DAY_MS));
}

/**
 * 개발자의 확인을 기다리는 요청인가 — `open` 뿐이다. 개발자가 변경을 청한 요청(`changes_requested`)은 공이 우리 쪽에 있고
 * (AI 가 반영한다), 끝난 요청(`merged` · `closed`)은 기다릴 것이 없다.
 */
export function waitingForDeveloper(handoff: { state: string } | null | undefined): boolean {
  return handoff?.state === "open";
}

/** 한 줄의 부제를 가르는 신호 — 활성 프로젝트의 상태(`daemon.repo`)에만 있다. 비활성 프로젝트는 값이 없다. */
export interface WaitingSignals {
  slug: string;
  handoff: HandoffStatus;
  attention: Attention | null | undefined;
}

/**
 * 개발자 확인을 기다리는 요청의 한 줄 부제(2026-10-08 베타 준비 분석 · A2b) — 개발자가 확인했거나(`승인`) 자동 검사가 통과하지
 * 못한 요청만 기본 문장(`개발자 확인을 기다려요`) 대신 그 사실을 말한다. 통과했거나 도는 검사는 기본 문장을 바꾸지 않는다.
 * 검사 문장은 이번 작업 팝오버의 줄(`ciLine`)과 같은 판정을 쓴다 — 누가 맡았는지는 화면의 문제 문장(주의)이 이미 정했다.
 * 말할 것이 없으면 null.
 */
export function waitingNote(
  handoff: HandoffStatus | null | undefined,
  attention: Attention | null | undefined,
  words: CiLineWords,
): string | null {
  if (handoff?.state !== "open") return null;
  const A = words.afterSubmit;
  if (handoff.approved) return `${A.approved} — ${A.approvedWaiting}`;
  const line = ciLine(handoff, attention, words);
  if (line && (line.tone === "fixing" || line.tone === "notified" || line.tone === "failing")) {
    return line.text;
  }
  return null;
}

export interface WaitingRow {
  slug: string;
  name: string;
  /** 달력으로 며칠째(0 = 오늘 제출) — 요청이 열린 때를 모르면 null. */
  days: number | null;
  /** 승인 · 자동 검사의 한 줄 — 말할 것이 없으면 키가 없고 기본 문장이 선다. */
  note?: string;
}

/**
 * 홈의 한 줄들 — 개발자 확인을 기다리는 요청이 있는 프로젝트. 오래 기다린 것이 먼저이고, 때를 모르는 것은 맨 뒤다.
 * 같은 날은 등록 순서를 지킨다(안정 정렬).
 */
export function waitingRows(
  projects: ReadonlyArray<{
    slug: string;
    name: string;
    handoff: { state: string; since?: string; number?: number } | null;
  }>,
  today: number,
  signals?: { active: WaitingSignals | null; words: CiLineWords },
): WaitingRow[] {
  return projects
    .filter((project) => waitingForDeveloper(project.handoff))
    .map((project) => {
      // 승인 · 검사의 신호는 활성 프로젝트의 상태에만 있고, 같은 요청일 때만 부제가 된다(요청 번호를 둘 다 알면 맞춘다).
      const active = signals?.active;
      const same =
        active?.slug === project.slug &&
        (project.handoff?.number === undefined || project.handoff.number === active.handoff.number);
      const note =
        same && active && signals
          ? waitingNote(active.handoff, active.attention, signals.words)
          : null;
      return {
        slug: project.slug,
        name: project.name,
        days: daysSince(project.handoff?.since, today),
        ...(note === null ? {} : { note }),
      };
    })
    .map((row, order) => ({ row, order }))
    .sort((a, b) => {
      const left = a.row.days ?? -1;
      const right = b.row.days ?? -1;
      return right - left || a.order - b.order;
    })
    .map(({ row }) => row);
}
