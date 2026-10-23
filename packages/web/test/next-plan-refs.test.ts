import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DraftPlanRef, DraftRefEntry } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-run-plan.test.ts 와 같은 모양).
import {
  CHIPS_SHOWN,
  chipsShownAt,
  refChipText,
  refOpenTarget,
  stashPlanOpen,
  stripRows,
  TWO_CHIPS_MIN_WIDTH,
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

test("한 줄 — 칩 수는 줄의 폭을 읽는다: 모르면 위 한계, 둘째 칩이 읽힐 폭이면 둘, 더 좁으면 하나(2026-10-24 QA 12)", () => {
  assert.equal(chipsShownAt(null), CHIPS_SHOWN);
  assert.equal(chipsShownAt(1200), CHIPS_SHOWN);
  assert.equal(chipsShownAt(TWO_CHIPS_MIN_WIDTH), CHIPS_SHOWN);
  assert.equal(chipsShownAt(TWO_CHIPS_MIN_WIDTH - 1), 1);
  assert.equal(chipsShownAt(0), 1);
  // 위 한계를 넘기지 않는다 — 폭이 넓어도 접힌 줄의 칩은 둘까지다.
  assert.ok(chipsShownAt(99999) <= CHIPS_SHOWN);
});

/** 근거 줄의 마크업 · CSS — 칩이 넘쳐도 `+N` 이 가려지지 않는 틀(2026-10-24 QA 12). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripCss = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const refCss = stripCss(read("../src/next/chat/plan-ref-strip.css"));
const refTsx = read("../src/next/chat/PlanRefStrip.tsx");
const refRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(refCss);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
};

test("근거 줄 — `+N` 은 칩 상자 밖의 줄 자식이라 칩이 줄어들거나 굴러가도 늘 보인다", () => {
  // 마크업: 칩 상자(`nx-pref-chips`)가 닫힌 뒤에 `+N` 이 선다.
  assert.match(refTsx, /<\/div>\s*\{foldable > 0 && \(/);
  assert.match(refTsx, /<div className="nx-pref" ref=\{strip\}>/);
  assert.match(refTsx, /className=\{`nx-pref-chips\$\{open \? " nx-pref-chips--open" : ""\}`\}/);
  // 폭은 실제 줄을 읽어 센다 — 고정 수가 아니다.
  assert.match(refTsx, /new ResizeObserver\(read\)/);
  assert.match(refTsx, /chipsShownAt\(width\)/);
  // 풍선에는 전체 글이 있다 — 줄어든 칩을 손을 올려 읽는다.
  assert.match(refTsx, /title=\{refChipText\(entry\.ref\)\}/);
  // `+N` 자신은 줄어들지 않는다.
  assert.match(refRule(".nx .nx-pref-more"), /flex:\s*none/);
});

test("근거 줄 — 칩은 줄어든다: 칩 상자는 넘침을 가두고, 칩은 `min-width: 0` · 최대 폭 · 말줄임이다", () => {
  const chips = refRule(".nx-pref-chips");
  assert.match(chips, /min-width:\s*0\s*;/);
  assert.match(chips, /overflow:\s*hidden/);
  const chip = refRule(".nx .nx-pref-chip");
  // 칩의 글은 한 줄이라 안쪽 최소 폭이 글 전체다 — 이 둘이 없으면 줄어들지 못하고 오른쪽이 밀려 가려진다.
  assert.match(chip, /flex:\s*0 1 auto/);
  assert.match(chip, /min-width:\s*0\s*;/);
  assert.match(chip, /overflow:\s*hidden/);
  assert.match(chip, /max-width:\s*260px/);
  assert.match(refRule(".nx-pref-title"), /text-overflow:\s*ellipsis/);
  // 펼친 줄은 칩이 제 폭으로 서고 옆으로 굴러간다.
  assert.match(refRule(".nx-pref-chips--open .nx-pref-chip"), /flex:\s*none/);
  assert.match(refRule(".nx-pref-chips--open"), /overflow-x:\s*auto/);
});

test("근거 줄 — 줄의 폭을 이름 붙은 컨테이너(nxpref)가 읽고, 좁은 칸은 절의 글자만 접는다", () => {
  assert.match(refRule(".nx-pref"), /container:\s*nxpref\s*\/\s*inline-size/);
  const queries = refCss.match(/@container[^{]*\{/g) ?? [];
  assert.deepEqual(queries, ["@container nxpref (max-width: 460px) {"]);
  assert.match(
    refCss,
    /@container nxpref \(max-width: 460px\) \{\s*\.nx-pref-chips:not\(\.nx-pref-chips--open\) \.nx-pref-sec \{\s*display:\s*none;/,
  );
});
