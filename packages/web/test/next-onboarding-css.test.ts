import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 처음 한 번 CSS 의 조용한 실패를 지킨다(2026-10-06 온보딩 손질). 화면에 오류는 없고 모양만 어긋나는
 * 것들이다 — 끝 화면이 불투명해지고, 통과한 카드가 다른 카드가 지날 때 깜빡이고, 움직임을 끈 창에서
 * 물결이 멈춘 채 남는다.
 */
const css = readFileSync(
  join(import.meta.dirname, "../src/next/onboarding/onboarding.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selectors: string[];
  body: string;
}

/** 중첩이 없는 규칙을 전부 — `@media` 안쪽의 규칙도 잡힌다(바깥 `@media` 줄은 중첩이라 건너뛴다). */
const rules: Rule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: (match[1] ?? "").split(",").map((part) => part.trim()),
  body: match[2] ?? "",
}));

/** 이 선택자가 선택자 목록에 든 모든 규칙의 몸을 이어 붙인다 — 공용 규칙과 자기 규칙이 함께 읽힌다. */
function body(selector: string): string {
  const found = rules.filter((rule) => rule.selectors.includes(selector));
  assert.ok(found.length > 0, `${selector} 규칙이 없다`);
  return found.map((rule) => rule.body).join("\n");
}

/** `@media (prefers-reduced-motion: reduce) { … }` 블록의 안쪽 — 중괄호를 세어 닫는 곳을 찾는다. */
function reduceBlocks(): string[] {
  const head = "@media (prefers-reduced-motion: reduce) {";
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(head, from);
    if (start === -1) return blocks;
    let depth = 1;
    let i = start + head.length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(css.slice(start + head.length, i - 1));
    from = i;
  }
}

test("처음 한 번: 뿌리와 끝 화면의 바탕은 `.nx` 의 바탕을 이기는 두 클래스로 쓴다", () => {
  // `.nx`(next.css)가 var(--bg) 를 같은 특이성으로 깔고 더 나중에 읽힌다 — `.nx-ob` 한 클래스로는
  // 번짐 바탕도 `transparent` 도 이기지 못한다. 끝 화면이 불투명하면 작업 틀의 페이드 인이 가려진다.
  assert.match(body(".nx.nx-ob"), /background:/);
  assert.match(body(".nx.nx-ob--done"), /background:\s*transparent/);
});

test("처음 한 번: 통과의 번쩍임은 카드의 animation 이름을 바꾸지 않고, 쉬는 동안은 보이지 않는다", () => {
  // 카드의 `animation` 이름이 등장(nx-ob-rise)과 번쩍임 사이에서 바뀌면, 클래스가 벗겨질 때 끝난
  // 등장이 처음부터 다시 돈다 — 통과한 카드가 다른 카드가 지날 때마다 깜빡인다.
  const cardRules = rules.filter((rule) => rule.selectors.includes(".nx-ob-step--passed"));
  assert.deepEqual(
    cardRules.filter((rule) => /animation/.test(rule.body)),
    [],
  );
  // 겹친 선은 쉴 때 투명하다 — 움직임을 끈 창에서 `animation: none` 이 되어도 초록 선이 남지 않는다.
  assert.match(body(".nx-ob-step--passed::after"), /opacity:\s*0\s*;/);
});

test("처음 한 번: 끝없이 도는 것은 모두 움직임을 끈 창에서 멈춘다", () => {
  const reduced = reduceBlocks().join("\n");
  assert.ok(reduced.length > 0, "움직임을 끈 창의 블록이 없다");
  const looping = rules.filter((rule) => /animation:[^;]*\binfinite\b/.test(rule.body));
  assert.ok(looping.length >= 4, `끝없는 움직임을 못 찾았다: ${looping.length}`);
  const missing = looping
    .flatMap((rule) => rule.selectors)
    // 움직임을 끈 블록 안에 같은 선택자가 있어야 한다.
    .filter((selector) => !reduced.includes(selector));
  assert.deepEqual(missing, []);
});

test("처음 한 번: 링의 찬 조각은 꺼진 동안 투명하다(둥근 끝의 점이 남지 않게)", () => {
  assert.match(body(".nx-ring-fill"), /opacity:\s*0\s*;/);
  assert.match(body(".nx-ring-fill--on"), /opacity:\s*1\s*;/);
});
