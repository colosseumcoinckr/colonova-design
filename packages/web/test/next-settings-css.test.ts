import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 설정 CSS 의 조용한 실패를 지킨다(2026-10-06 설정 손질). 테마 카드의 줄 채움은 컨테이너 질의가 정하고,
 * 화면에는 오류가 없이 한 줄이 비거나 카드 한 장이 홀로 남는다 — 그래서 글자로 읽어 지킨다
 * (`next-status-css.test.ts` 와 같은 모양).
 */
const css = readFileSync(join(import.meta.dirname, "../src/next/settings/settings.css"), "utf8");

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다. */
function body(selector: string, source = css): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

/** 중괄호가 짝을 이루는 `@…` 블록의 안쪽 — 헤더가 정확히 일치하는 첫 블록. */
function atBlock(header: string): string {
  const at = css.indexOf(`${header} {`);
  assert.ok(at >= 0, `${header} 블록이 없다`);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf("{", at) + 1, i);
    }
  }
  return assert.fail(`${header} 블록이 닫히지 않는다`);
}

test("설정: 쪽이 질의의 컨테이너다 — 창이 아니라 쪽의 폭으로 줄을 채운다", () => {
  assert.match(body(".nx-set-page"), /container:\s*nx-page\s*\/\s*inline-size/);
  const queries = css.match(/@container[^{]*\{/g) ?? [];
  assert.ok(queries.length >= 2, `질의가 너무 적다: ${queries.length}`);
  for (const query of queries) {
    // 이름이 없으면 가장 가까운 조상 컨테이너가 무엇이든 거기에 걸린다.
    assert.match(query, /@container\s+nx-page\s*\(/, query);
  }
});

test("테마 격자: 넷 · 셋 · 둘씩 — 일곱 장이 어느 폭에서도 줄을 꽉 채운다", () => {
  assert.match(body(".nx-tgrid"), /grid-template-columns:\s*repeat\(4,/);
  assert.match(
    atBlock("@container nx-page (max-width: 470px)"),
    /grid-template-columns:\s*repeat\(3,/,
  );
  assert.match(
    atBlock("@container nx-page (max-width: 340px)"),
    /grid-template-columns:\s*repeat\(2,/,
  );
});

test("테마 격자: 시스템 카드는 넷씩이면 두 칸(2+1+1 · 4), 셋씩 · 둘씩이면 첫 줄 전폭", () => {
  // 넷씩: 시스템(2) + 둘 / 넷 — 여섯 장이 셋 · 둘씩 선 줄 사이에서 빈 칸이 생기지 않는다.
  assert.match(body(".nx-tgrid > .nx-tcard--sys"), /grid-column:\s*span 2\s*;/);
  // 셋씩: 전폭 + 3 + 3. 둘씩에서는 span 2 가 곧 전폭이라 규칙을 다시 쓰지 않는다.
  assert.match(
    atBlock("@container nx-page (max-width: 470px)"),
    /\.nx-tcard--sys\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*;/,
  );
});

test("테마 격자: 시스템 미리보기의 비율은 이웃 카드의 높이와 맞고, 질의가 기본 규칙 뒤에 선다", () => {
  assert.match(body(".nx .nx-tcard--sys .nx-tpeek"), /aspect-ratio:\s*16\s*\/\s*5\s*;/);
  // 같은 특이도의 기본 규칙이 질의보다 뒤에 서면 질의의 비율이 조용히 진다.
  const base = css.indexOf(".nx .nx-tcard--sys .nx-tpeek {");
  assert.ok(base < css.indexOf("@container nx-page (max-width: 470px)"));
  assert.match(atBlock("@container nx-page (max-width: 470px)"), /aspect-ratio:\s*24\s*\/\s*5/);
});

test("설정 머리: 닫기는 DOM 끝에서 머리 오른쪽에 얹히고, 머리는 그 자리를 비운다", () => {
  assert.match(body(".nx-set-x"), /position:\s*absolute\s*;/);
  assert.match(body(".nx-set-pane"), /position:\s*relative\s*;/);
  const padding = /padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s+(\d+)px/.exec(body(".nx-set-hd"));
  assert.ok(padding, "머리의 안쪽 여백이 네 값이 아니다");
  assert.ok(Number(padding[2]) >= 48, `✕ 자리가 모자란다: ${padding[2]}px`);
});

test("설정: 끝난 뒤에도 남는 애니메이션(forwards · both)을 쓰지 않는다", () => {
  // 쌓임 맥락이 남아 아래 형제의 팝이 깔린다 — 채움은 backwards 만(next/README 움직임).
  const fills = css.match(/animation:[^;]*\b(forwards|both)\b/g) ?? [];
  assert.deepEqual(fills, []);
});

test("설정: 글자는 12px 이상이다", () => {
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 10, `글자 크기 선언이 너무 적다: ${sizes.length}`);
  assert.deepEqual(
    sizes.filter((size) => size < 12),
    [],
  );
});
