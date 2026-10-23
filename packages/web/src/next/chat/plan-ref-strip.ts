import type { DraftPlanRef, DraftRefEntry } from "@colonova-design/protocol";
import { L } from "../labels.ts";

/**
 * 대화의 기획 근거 줄(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 화면 작업에서 기획으로
 * 돌아가는 길의 순수 도우미. 칩의 글 · 돌아갈 곳 · 한 줄에 보일 칩을 센다.
 */

/** 기획서 칸이 듣는 창 이벤트 — 근거 칩이 그 문서 · 초안으로 돌아가 달라고 청한다. `detail` 에 pageId 나 docKey 를 싣는다. */
export const PLANS_OPEN_EVENT = "nx:plans:open";

/** 칩이 돌아가는 곳 — 가져온 문서는 pageId, 초안은 docKey 다(초안이 앞선다). */
export type PlanOpenTarget = { pageId: string } | { docKey: string };

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
  const { title, meta } = refChipParts(ref);
  return meta === null ? title : `${title} · ${meta}`;
}

/**
 * 칩의 두 토막 — 제목(길면 칩 안에서 말린다)과 판 · 절(말리지 않는다). 제목이 길어도 판 · 초안 여부가 잘려 보이지
 * 않게 나눠 그린다(2026-10-23 화면 확인).
 */
export function refChipParts(ref: DraftPlanRef): { title: string; meta: string | null } {
  const stage = ref.published
    ? ref.version !== null
      ? L.planRefs.version(ref.version)
      : null
    : L.planRefs.draftRevision(ref.revision ?? 0);
  const first = ref.sections[0];
  const section =
    first === undefined
      ? null
      : ref.sections.length === 1
        ? first
        : `${first} ${L.planRefs.sectionsMore(ref.sections.length - 1)}`;
  const meta = [stage, section].filter((part): part is string => part !== null).join(" · ");
  return { title: ref.title, meta: meta === "" ? null : meta };
}

/** 칩이 돌아가는 곳 — 초안이면 그 초안의 편집기, 가져온 문서면 그 문서다(초안이 앞선다). */
export function refOpenTarget(ref: DraftPlanRef): PlanOpenTarget {
  if (ref.docKey !== null) return { docKey: ref.docKey };
  return { pageId: ref.pageId ?? "" };
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
