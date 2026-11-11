import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 기획서 칸의 좁은 폭 탭 · 사이드바 몫 나누기 CSS 를 지킨다(2026-11-11 화면 평가 수리).
 * 되돌아가면 보이는 결함이다 — 탭이 세로 기둥으로 서 대화 칸과 `보내기` 가 창 밖으로 밀리고,
 * 낮은 창의 문서 트리가 대화 목록에 눌려 네 줄만 남는다.
 * 파일을 글자로 읽는다(`next-sidebar-css.test.ts` 와 같은 모양).
 */
const plans = readFileSync(
  join(import.meta.dirname, "../src/next/plans/plans.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** 쿼리 이름으로 묶음을 꺼낸다 — 중첩된 선택자의 중괄호를 헤아려 끝을 찾는다. */
const block = (query: string): string => {
  const at = plans.indexOf(query);
  assert.notEqual(at, -1, `${query} 묶음이 없다`);
  const open = plans.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < plans.length; i += 1) {
    if (plans[i] === "{") depth += 1;
    else if (plans[i] === "}") {
      depth -= 1;
      if (depth === 0) return plans.slice(open, i);
    }
  }
  assert.fail(`${query} 묶음이 닫히지 않는다`);
};

test("좁은 칸의 두 탭은 위쪽 가로 띠로 서고 고른 쪽이 칸을 다 쓴다(2026-11-11)", () => {
  const narrow = block("@container nxpl (max-width: 1100px)");
  // 묶음이 세로 줄이어야 탭이 가로 띠로 선다 — 가로 줄의 자식이던 탭은 세로 기둥으로 서서
  // 대화 칸을 창 밖으로 밀었다.
  assert.match(narrow, /\.nx-pl-view\[data-chat="on"\]\s*\{[^}]*flex-direction:\s*column/);
  assert.match(narrow, /\.nx-pl-tabs\s*\{[^}]*display:\s*flex/);
  // 대화 탭은 대화가 칸 폭 전체·남은 높이를 쓴다 — 좁은 칸에서는 칸 끌개가 숨는다.
  assert.match(narrow, /\.nx-pl-split\s*\{[^}]*display:\s*none/);
  assert.match(
    narrow,
    /\[data-tab="chat"\]\s*\.nx-pl-chat\s*\{[^}]*flex:\s*1[^}]*width:\s*auto[^}]*min-width:\s*0/s,
  );
  // 기본(넓은 칸)에서는 탭이 숨는다 — 나란한 두 칸과 끌어 정한 대화 폭은 그대로다.
  // 가장 왼쪽의 `.nx-pl-tabs { … display: none }` 가 기본 규칙이다(좁은 칸의 `display: flex` 는
  // `data-chat="on"` 한정의 뒤쪽 규칙이다).
  assert.match(plans, /\.nx-pl-tabs\s*\{[^}]*display:\s*none/);
});

test("낮은 창의 사이드바는 문서 트리가 넉넉히 받는다(2026-11-11)", () => {
  // 대화 목록 상한은 30% — 1280×720 에서 트리가 목록의 1.5배를 넘으려면 필요하다.
  const short = block("@media (max-height: 780px)");
  assert.match(short, /\.nx-pl-conv\s*\{[^}]*max-height:\s*30%/);
  // 부가 줄(날짜 머리 · 문서 이름)을 걷어 대화 줄 자체는 더 보인다.
  assert.match(short, /\.nx-pl-conv-g\s*,\s*\.nx-pl-conv-m\s*\{[^}]*display:\s*none/);
  // 평소 상한 40% 는 그대로다.
  assert.match(plans, /\.nx-pl-conv\s*\{[^}]*max-height:\s*40%/);
});
