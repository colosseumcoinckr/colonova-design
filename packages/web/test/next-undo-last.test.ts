import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { undoTargetFor } from "../src/next/lib/undo-last.ts";

/**
 * `방금 한 것 되돌리기`(2026-10-06 UX 점검)의 되돌아갈 곳. 작업 기록의 되돌리기는 「그 시점 이후를 전부」 되돌리므로,
 * 단추는 마지막 결과에만 — 그 요청의 보관이 프로젝트 기록의 맨 위일 때만, 그래서 되돌리면 정확히 그 요청만 사라질 때만
 * 선다. `entries` 는 최신이 앞이다.
 */
const entries = (...shas: string[]) => shas.map((sha) => ({ sha }));
const screens = (requestId: string, ...shas: string[]) => shas.map((sha) => ({ sha, requestId }));

test("undoTargetFor: 맨 위가 그 요청의 보관이면 바로 아래 차례가 돌아갈 곳이다", () => {
  assert.deepEqual(undoTargetFor(entries("c", "b", "a"), screens("r1", "c"), "r1"), {
    sha: "b",
    count: 1,
  });
});

test("undoTargetFor: 한 요청이 보관을 여럿 남겼으면(고침 턴) 이어진 것을 모두 지나친 곳이다", () => {
  assert.deepEqual(undoTargetFor(entries("d", "c", "b", "a"), screens("r1", "d", "c"), "r1"), {
    sha: "b",
    count: 2,
  });
});

test("undoTargetFor: 맨 위가 그 요청의 것이 아니면 단추를 세우지 않는다 — 뒤에 다른 일이 쌓였다", () => {
  const rows = [...screens("r1", "b"), ...screens("r2", "c")];
  assert.equal(undoTargetFor(entries("c", "b", "a"), rows, "r1"), null);
  // 같은 요청의 보관이라도 맨 위부터 이어지지 않으면(사이에 남의 보관) 거기서 끊긴다.
  assert.deepEqual(undoTargetFor(entries("c", "x", "b", "a"), screens("r1", "c", "b"), "r1"), {
    sha: "x",
    count: 1,
  });
});

test("undoTargetFor: 요청의 보관을 모르거나 돌아갈 차례가 없으면 null", () => {
  assert.equal(undoTargetFor(entries("c", "b"), undefined, "r1"), null);
  assert.equal(undoTargetFor(entries("c", "b"), screens("other", "c"), "r1"), null);
  assert.equal(undoTargetFor(entries("c", "b"), [{ requestId: "r1" }], "r1"), null, "sha 없는 줄");
  assert.equal(undoTargetFor([], screens("r1", "c"), "r1"), null);
  // 이 요청이 기록의 전부다 — 돌아갈 곳이 없다(작업 기록도 첫 보관 앞으로는 못 간다).
  assert.equal(undoTargetFor(entries("c", "b"), screens("r1", "c", "b"), "r1"), null);
});

// 이음매 — 카드 → 이벤트 → 서랍 → 되돌린 뒤의 신호. 한 곳만 어긋나도 단추는 서랍을 열기만 하고 확인은 열리지 않는다.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("카드는 `restoreTo` · `count` 를 서랍은 같은 이름으로 읽는다", () => {
  const chat = read("../src/next/chat/ChatColumn.tsx");
  const column = read("../src/next/preview/PreviewColumn.tsx");
  const drawer = read("../src/next/preview/HistoryDrawer.tsx");
  assert.match(chat, /detail: \{ restoreTo: undoTarget\.sha, count: undoTarget\.count \}/);
  assert.match(column, /typeof detail\?\.restoreTo === "string"/);
  assert.match(column, /typeof detail\.count === "number"/);
  assert.match(drawer, /export const HISTORY_OPEN_EVENT = "nx:history:open";/);
});

test("되돌리기가 끝나면 서랍이 `nx:history:changed` 를 보내고 대화 칸이 그것을 듣는다", () => {
  const chat = read("../src/next/chat/ChatColumn.tsx");
  const drawer = read("../src/next/preview/HistoryDrawer.tsx");
  assert.match(drawer, /export const HISTORY_CHANGED_EVENT = "nx:history:changed";/);
  assert.match(drawer, /window\.dispatchEvent\(new CustomEvent\(HISTORY_CHANGED_EVENT\)\);/);
  assert.match(chat, /addEventListener\("nx:history:changed", bump\)/);
});
