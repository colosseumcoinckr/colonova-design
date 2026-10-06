import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-key-hint.test.ts 와 같은 모양).
import { renamedTitle } from "../src/next/lib/conv-title.ts";

test("renamedTitle: 흰칸을 다듬은 새 이름을 돌려준다", () => {
  assert.equal(renamedTitle("옛 이름", "  새 이름  "), "새 이름");
  assert.equal(renamedTitle("옛 이름", "새 이름"), "새 이름");
});

test("renamedTitle: 비었거나 지금 제목과 같으면 바꿀 것이 없다", () => {
  assert.equal(renamedTitle("옛 이름", ""), null);
  assert.equal(renamedTitle("옛 이름", "   "), null);
  // 흰칸만 다른 같은 제목은 다시 쓰지 않는다 — 사이드바의 이름 바꾸기와 같은 규칙.
  assert.equal(renamedTitle("옛 이름", " 옛 이름 "), null);
});
