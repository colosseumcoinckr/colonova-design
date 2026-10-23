import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftPlanRef, DraftRefEntry } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-run-plan.test.ts 와 같은 모양).
import {
  refChipText,
  refOpenTarget,
  stashPlanOpen,
  stripRows,
  takePlanOpen,
} from "../src/next/chat/plan-ref-strip.ts";

/**
 * 대화의 기획 근거 줄(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 칩의 글 · 돌아갈 곳 ·
 * 한 줄에 보일 칩을 세는 도우미의 시험. 합성 제목만 쓴다.
 */

/** 합성 근거 — 실제 문서를 흉내 내지 않는다. */
function ref(over: Partial<DraftPlanRef> = {}): DraftPlanRef {
  return {
    title: "로그인 화면",
    pageId: "123",
    docKey: null,
    url: null,
    version: 4,
    revision: null,
    published: true,
    sections: [],
    ...over,
  };
}

const entry = (one: DraftPlanRef): DraftRefEntry => ({ at: "2026-10-23T01:00:00Z", ref: one });

test("칩의 글 — 발행본은 제목과 판으로 선다", () => {
  assert.equal(refChipText(ref()), "로그인 화면 · 판 4");
});

test("칩의 글 — 미발행 새 초안은 개정과 함께 미발행임을 말한다", () => {
  assert.equal(
    refChipText(
      ref({
        title: "새 문서",
        pageId: null,
        docKey: "n-00112233445566778899aabbccddeeff",
        version: null,
        revision: 2,
        published: false,
      }),
    ),
    "새 문서 · 미발행 초안 · 개정 2",
  );
});

test("칩의 글 — 기존 문서의 초안도 미발행 개정으로 선다", () => {
  assert.equal(
    refChipText(ref({ docKey: "p-123", version: 30, revision: 1, published: false })),
    "로그인 화면 · 미발행 초안 · 개정 1",
  );
});

test("칩의 글 — 판을 모르는 발행본은 제목과 절만으로 선다", () => {
  assert.equal(refChipText(ref({ version: null })), "로그인 화면");
});

test("칩의 글 — 절이 없으면 말하지 않고, 하나면 그 절, 여럿이면 첫 절과 나머지 수", () => {
  assert.equal(refChipText(ref({ sections: [] })), "로그인 화면 · 판 4");
  assert.equal(refChipText(ref({ sections: ["배경"] })), "로그인 화면 · 판 4 · 배경");
  assert.equal(
    refChipText(ref({ sections: ["배경", "목표", "결론"] })),
    "로그인 화면 · 판 4 · 배경 외 2",
  );
});

test("돌아갈 곳 — 초안이면 초안의 편집기가 앞선다", () => {
  assert.deepEqual(refOpenTarget(ref()), { pageId: "123" });
  assert.deepEqual(
    refOpenTarget(
      ref({
        docKey: "n-00112233445566778899aabbccddeeff",
        version: null,
        revision: 1,
        published: false,
      }),
    ),
    { docKey: "n-00112233445566778899aabbccddeeff" },
  );
  assert.deepEqual(refOpenTarget(ref({ docKey: "p-123", revision: 1, published: false })), {
    docKey: "p-123",
  });
});

test("한 줄 — max 까지 보이고 나머지 수를 센다", () => {
  const entries = [entry(ref()), entry(ref({ title: "둘" })), entry(ref({ title: "셋" }))];
  assert.deepEqual(stripRows([], 2), { shown: [], more: 0 });
  assert.deepEqual(stripRows(entries, 0), { shown: [], more: 3 });
  const two = stripRows(entries, 2);
  assert.equal(two.shown.length, 2);
  assert.equal(two.more, 1);
  const all = stripRows(entries, 5);
  assert.deepEqual(all, { shown: entries, more: 0 });
});

test("맡겨 둔 열기 요청 — 꺼내면 비고, 나중 것이 먼저 것을 덮는다", () => {
  // 다른 시험이 남긴 요청이 없게 — 비우고 시작한다(마운트 전 칸이 아직 못 꺼낸 것도 지운다).
  takePlanOpen();
  assert.equal(takePlanOpen(), null);
  // 칩을 눌렀는데 듣는 칸이 없으면 맡긴다(2026-10-23 · R3 발견 4) — 칸이 마운트하며 한 번 꺼낸다.
  stashPlanOpen({ pageId: "123" });
  stashPlanOpen({ docKey: "n-00112233445566778899aabbccddeeff" });
  assert.deepEqual(takePlanOpen(), { docKey: "n-00112233445566778899aabbccddeeff" });
  // 꺼내면 비었다 — 같은 요청이 두 번 열리지 않는다.
  assert.equal(takePlanOpen(), null);
});
