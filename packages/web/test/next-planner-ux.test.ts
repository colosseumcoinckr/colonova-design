import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftSummary } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-plans.test.ts 와 같은 모양).
import { takePlanOpen } from "../src/next/chat/plan-ref-strip.ts";
import { L } from "../src/next/labels.ts";
import { draftRowStatus, draftsInProgress } from "../src/next/plans/home-drafts.ts";
import { openPlanTarget } from "../src/next/plans/open-plan.ts";

/**
 * 기획자 화면 손질(2026-10-23 · docs/planner-ux-2026-10-23.md)의 순수 판정 — 홈 · 사이드바가 세는 「작성 중인 초안」,
 * 홈 줄의 한 줄 상태, 초안 머리의 상태 줄, 그리고 기획서 칸의 한 자리를 여는 길(받든 맡기든 칸을 세운다).
 */

const MIN = 60_000;
const at = (min: number) => new Date(Date.UTC(2026, 9, 23, 9, 0) - min * MIN).toISOString();

const draft = (
  docKey: string,
  pageId: string | null,
  changedBlocks: number,
  state: DraftSummary["state"],
  min: number,
): DraftSummary => ({
  docKey,
  pageId,
  title: docKey,
  revision: changedBlocks + 1,
  state,
  changedBlocks,
  baseVersion: pageId === null ? null : 4,
  observedVersion: null,
  updatedAt: at(min),
});

test("작성 중인 초안 — 손이 더 갈 초안만, 새것부터(발행을 마친 · 열기만 한 초안은 뺀다)", () => {
  const rows = draftsInProgress([
    draft("p-1", "1", 0, "editing", 1), // 열기만 했다 — 뺀다
    draft("p-2", "2", 3, "editing", 30),
    draft("n-3", null, 0, "editing", 60), // 새 문서 초안은 비어 있어도 쓰는 중이다
    draft("p-4", "4", 0, "published", 2), // 발행을 마쳤다 — 뺀다
    draft("p-5", "5", 0, "result-unknown", 10), // 손이 필요한 처지 — 센다
    draft("p-6", "6", 1, "conflict", 5),
    draft("p-7", "7", 0, "closed-unconfirmed", 90), // 결과를 두고 종료 — 다시 고칠 수 있는 초안이다
  ]);
  assert.deepEqual(
    rows.map((row) => row.docKey),
    ["p-6", "p-5", "p-2", "n-3", "p-7"],
  );
  // 받은 목록은 건드리지 않는다.
  const input = [draft("p-2", "2", 3, "editing", 30), draft("p-9", "9", 1, "editing", 1)];
  draftsInProgress(input);
  assert.deepEqual(
    input.map((row) => row.docKey),
    ["p-2", "p-9"],
  );
});

test("홈 줄의 한 줄 상태 — 손이 필요한 처지는 warn 이고 글로도 말한다", () => {
  assert.deepEqual(draftRowStatus(draft("p-5", "5", 0, "result-unknown", 1)), {
    text: L.drafts.resultUnknownTitle,
    warn: true,
  });
  assert.deepEqual(draftRowStatus(draft("p-6", "6", 1, "conflict", 1)), {
    text: L.home.draftConflict,
    warn: true,
  });
  assert.deepEqual(draftRowStatus(draft("p-8", "8", 2, "publishing", 1)), {
    text: L.drafts.publishing,
    warn: false,
  });
  assert.deepEqual(draftRowStatus(draft("p-2", "2", 3, "editing", 1)), {
    text: `${L.home.draftChanged(3)} · ${L.drafts.unpublished}`,
    warn: false,
  });
  assert.deepEqual(draftRowStatus(draft("n-3", null, 0, "editing", 1)), {
    text: `${L.home.draftNewDoc} · ${L.drafts.unpublished}`,
    warn: false,
  });
});

test("초안 머리의 상태 줄 — 어디서 시작했고 무엇이 바뀌었는지(기계의 개정 번호 대신)", () => {
  assert.equal(L.drafts.metaLine(11, 2, 1), "Confluence 판 11 에서 시작 · 고침 2 · 새로 1");
  assert.equal(L.drafts.metaLine(11, 0, 0), "Confluence 판 11 에서 시작");
  assert.equal(L.drafts.metaLine(null, 0, 3), "새 문서 초안 · 새로 3");
  // 개정 번호는 툴팁(`meta`)에 남는다 — 기획 근거 칩의 `개정 N` 과 맞춰 볼 때 쓴다.
  assert.match(L.drafts.meta(5, 11), /개정 5/);
});

/** 창 대신 — 이벤트를 받는 손 하나를 꽂을 수 있는 과녁. */
function withWindow(listener: ((event: Event) => void) | null, run: () => void): void {
  const target = new EventTarget();
  if (listener !== null) target.addEventListener("nx:plans:open", listener);
  const holder = globalThis as unknown as { window?: EventTarget };
  const before = holder.window;
  holder.window = target;
  try {
    run();
  } finally {
    holder.window = before;
  }
}

test("기획서 칸의 한 자리 열기 — 칸이 받으면 맡기지 않고, 받든 맡기든 칸을 앞에 세운다", () => {
  takePlanOpen();
  let opened = 0;
  const nav = { openPlans: () => (opened += 1) };

  // 칸이 아직 마운트 전 — 아무도 받지 않으니 맡겨 두고 칸을 연다(마운트하며 꺼낸다).
  withWindow(null, () => openPlanTarget({ docKey: "p-2001" }, nav));
  assert.equal(opened, 1);
  assert.deepEqual(takePlanOpen(), { docKey: "p-2001" });

  // 칸이 숨은 채 마운트돼 있다 — 받는다(preventDefault). 맡기지 않지만 칸은 앞에 세운다(2026-10-23 화면 손질에서 찾은
  // 틈: 예전에는 받으면 칸을 세우지 않고 돌아가 누른 손에 아무 일도 없어 보였다).
  let seen: unknown = null;
  withWindow(
    (event) => {
      seen = (event as CustomEvent).detail;
      event.preventDefault();
    },
    () => openPlanTarget({ newDoc: true }, nav),
  );
  assert.equal(opened, 2);
  assert.deepEqual(seen, { newDoc: true });
  assert.equal(takePlanOpen(), null);
});
