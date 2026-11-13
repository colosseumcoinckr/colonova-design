/**
 * 프로젝트별 마지막 자리(2026-10-31 홈 걷기 §2) — 앱을 열거나 프로젝트를 옮길 때 그 프로젝트가
 * 마지막으로 있던 자리(기획서 · 화면)로 돌아간다. 기억은 이 앱의 localStorage 에 산다
 * (`draft-pick` 과 같은 방식) — 프로젝트 하나당 한 줄이고, 기억이 없으면 화면 자리다.
 *
 * 순수 모듈 — 단위 시험이 src 에서 곧장 읽는다. 저장소는 인자로 받는다(시험이 가짜 저장소를 쓴다).
 */

/** 프로젝트가 마지막으로 있던 자리 — 화면(미리보기 칸) · 기획서. */
export type PanePlace = "preview" | "plans";

/** 기억의 저장소 열쇠 앞부분 — 뒤에 프로젝트 slug 가 붙는다. */
export const PANE_MEMORY_PREFIX = "colonova-design.pane.";

const keyOf = (slug: string) => `${PANE_MEMORY_PREFIX}${slug}`;

/** 기억을 읽는다 — 없거나 모르는 값이면 null(기억 없음 · 화면 자리). */
export function readPaneMemory(storage: Storage, slug: string): PanePlace | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(keyOf(slug));
  } catch {
    return null;
  }
  return raw === "plans" || raw === "preview" ? raw : null;
}

/** 기억을 남긴다 — 저장이 막혀도 이번 실행의 자리는 살아 있다(다음 시작이 화면 자리일 뿐이다). */
export function writePaneMemory(storage: Storage, slug: string, pane: PanePlace): void {
  try {
    storage.setItem(keyOf(slug), pane);
  } catch {
    /* 비공개 모드 — 이번 실행에서만 산다 */
  }
}

/** 프로젝트에 들어설 자리 — 기억이 있으면 그 자리, 없으면 화면 자리다(2026-10-31 홈 걷기 §2). */
export function entryPane(storage: Storage, slug: string | null | undefined): PanePlace {
  const remembered = slug === null || slug === undefined ? null : readPaneMemory(storage, slug);
  return remembered ?? "preview";
}
