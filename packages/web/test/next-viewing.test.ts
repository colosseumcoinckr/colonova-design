import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * `viewing`(2026-10-06) — 보낸 순간 미리보기가 보여 주던 경로가 수정 전 사진의 재료로 데몬까지 간다. 길이 네
 * 군데(미리보기 칸 → 훅 → 선로 클라이언트 → 데몬)를 지나서, 한 곳만 빠져도 조용히 예전으로 돌아간다 — 받는
 * 쪽이 비어 있던 `onOpenProject` 와 같은 모양의 구멍이라 글의 모양으로 이음매를 못박는다. 데몬 쪽의 판정은
 * daemon/test/screen-comparisons.test.ts 가 돌린다.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("미리보기 칸이 보던 경로를 훅에 알린다 — 쿼리와 해시는 뗀다", () => {
  const column = read("../src/next/preview/PreviewColumn.tsx");
  assert.match(column, /herePath\.split\(\/\[\?#\]\/, 1\)\[0\] \|\| "\/"/);
  assert.match(column, /setViewing\(viewingPath\)/);
  assert.match(column, /return \(\) => setViewing\(null\)/, "칸이 사라지면 비운다");
});

test("훅은 보내기마다 보던 경로를 싣는다", () => {
  const hook = read("../src/hooks/useSessions.ts");
  assert.match(hook, /viewingRef\.current \?\? undefined,\s*\);/);
});

test("선로 클라이언트는 `viewing: { path }` 로 싣고, 없으면 싣지 않는다", () => {
  const client = read("../src/lib/daemon-client.ts");
  assert.match(client, /\.\.\.\(viewing \? \{ viewing: \{ path: viewing \} \} : \{\}\)/);
});
