import type { DraftPlanRef, DraftRefEntry } from "@colonova-design/protocol";
import { L } from "../labels.ts";

/**
 * 대화의 기획 근거 줄(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 화면 작업에서 기획으로
 * 돌아가는 길의 순수 도우미. 칩의 글 · 돌아갈 곳 · 한 줄에 보일 칩을 센다.
 */

/** 기획서 칸이 듣는 창 이벤트 — 근거 칩이 그 문서 · 초안으로 돌아가 달라고 청한다. `detail` 에 pageId 나 docKey 를 싣는다. */
export const PLANS_OPEN_EVENT = "nx:plans:open";

/**
 * 칩이 돌아가는 곳 — 가져온 문서는 pageId, 초안은 docKey 다(초안이 앞선다). `newDoc` 은 홈의 기획서 묶음이 청하는
 * 새 문서 창이다(2026-10-23 기획자 화면 손질 D4).
 */
export type PlanOpenTarget = { pageId: string } | { docKey: string } | { newDoc: true };

/**
 * 마운트 전 기획서 칸에 맡겨 둔 열기 요청(2026-10-23 · R3 발견 4) — 근거 칩을 눌렀는데 듣는 칸이
 * 없으면(이벤트가 취소되지 않으면) 요청을 여기 맡겨 두고 칸을 연다. 칸은 마운트할 때 꺼낸다.
 */
let stashedPlanOpen: PlanOpenTarget | null = null;

/** 열기 요청을 맡긴다 — 한 개만이고, 나중 것이 먼저 것을 덮는다. */
export function stashPlanOpen(target: PlanOpenTarget): void {
  stashedPlanOpen = target;
}

/** 맡겨 둔 열기 요청을 꺼낸다 — 꺼내면 비워 한 번만 꺼내진다. 없으면 null. */
export function takePlanOpen(): PlanOpenTarget | null {
  const stashed = stashedPlanOpen;
  stashedPlanOpen = null;
  return stashed;
}

/** 칩의 글 — 제목 · 판(또는 미발행 초안의 개정) · 첫 절과 나머지 수. */
export function refChipText(ref: DraftPlanRef): string {
  const { title, stage, section } = refChipParts(ref);
  return [title, stage?.text ?? null, section]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * 칩의 세 토막 — 제목(길면 칩 안에서 말린다) · 판 · 고른 절(말리지 않는다). 발행본의 판은 옅은
 * 덧말로, 미발행 초안은 호박색 알약으로(`draft` — 눈에 남는 이유가 다르다). 제목이 길어도 판 ·
 * 초안 여부가 잘려 보이지 않게 나눠 그린다(2026-10-23 화면 확인 · 2026-10-23 화면 전면 재설계 §4 E).
 */
export function refChipParts(ref: DraftPlanRef): {
  title: string;
  stage: { text: string; draft: boolean } | null;
  section: string | null;
} {
  const stage = ref.published
    ? ref.version !== null
      ? { text: L.planRefs.version(ref.version), draft: false }
      : null
    : { text: L.planRefs.draftRevision(ref.revision ?? 0), draft: true };
  const first = ref.sections[0];
  const section =
    first === undefined
      ? null
      : ref.sections.length === 1
        ? first
        : `${first} ${L.planRefs.sectionsMore(ref.sections.length - 1)}`;
  return { title: ref.title, stage, section };
}

/** 칩이 돌아가는 곳 — 초안이면 그 초안의 편집기, 가져온 문서면 그 문서다(초안이 앞선다). */
export function refOpenTarget(ref: DraftPlanRef): PlanOpenTarget {
  if (ref.docKey !== null) return { docKey: ref.docKey };
  return { pageId: ref.pageId ?? "" };
}

/** 접힌 줄에 보이는 칩 수의 위 한계 — 나머지는 `+n` 이 펼친다. */
export const CHIPS_SHOWN = 2;

/**
 * 둘째 칩까지 읽히는 줄(`.nx-pref`)의 가장 좁은 폭 — 줄 이름(44) · `+N`(19) · 간격(12)을 빼고 남는 폭을 칩 둘이 나눠 각각 125px 안팎
 * (제목 네 글자 · 판이 말줄임으로 읽히는 폭)이 되는 폭이다(2026-10-24 QA 12). 그보다 좁은 칸에서는 칩 둘이 제목 두세 글자씩만 남아
 * 읽히지 않으므로 첫 칩 하나만 서고 나머지는 `+N` 이 센다. 기본 대화 칸(400px)의 줄이 368px 라 둘이 선다.
 */
export const TWO_CHIPS_MIN_WIDTH = 330;

/** 줄의 폭이 아는 만큼 서는 칩 수 — 폭을 아직 모르면(첫 그림 · 측정 전) 위 한계 그대로다. */
export function chipsShownAt(width: number | null): number {
  if (width === null) return CHIPS_SHOWN;
  return width < TWO_CHIPS_MIN_WIDTH ? 1 : CHIPS_SHOWN;
}

/** 한 줄에 보이는 칩과 남은 수 — `max` 까지 보이고 나머지는 펼침 단추가 센다. */
export function stripRows(
  entries: DraftRefEntry[],
  max: number,
): { shown: DraftRefEntry[]; more: number } {
  const cap = Math.max(0, max);
  const shown = entries.length > cap ? entries.slice(0, cap) : entries;
  return { shown, more: entries.length - shown.length };
}
