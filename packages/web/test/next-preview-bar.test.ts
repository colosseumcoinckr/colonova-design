import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { APP_SHORTCUTS } from "@colonova-design/protocol";

/**
 * 미리보기 막대의 조용한 실패를 지킨다(2026-10-06 막대 개편). 둘 다 화면에 오류가 나지 않는다:
 * 풍선의 단축키 열쇠가 표에서 사라지면 힌트만 빠지고, 질의 안의 선택자가 위 규칙보다 얇으면
 * 좁은 창에서 접힘이 안 일어난다(옛 `.nx-seg { display: none }` 이 `.nx .nx-seg` 에 져 한 번도
 * 먹지 않았다).
 */
const dir = join(import.meta.dirname, "../src/next/preview");
// 주석을 걷는다 — 주석 안의 중괄호와 문장이 선택자로 읽히지 않게.
const css = readFileSync(join(dir, "preview.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const bar = readFileSync(join(dir, "PreviewBar.tsx"), "utf8");

/**
 * `@container …{ … }` 의 머리와 몸 — 중첩은 규칙 한 겹뿐이다. 이 칸의 질의는 둘로 갈린다: 막대의 폭 질의
 * (`nxpv`)와 작업 기록 서랍의 날 머리가 위에 붙었는지 묻는 스크롤 상태 질의(`hday`).
 */
function allQueries(): Array<{ head: string; body: string }> {
  const out: Array<{ head: string; body: string }> = [];
  let at = css.indexOf("@container");
  while (at !== -1) {
    const open = css.indexOf("{", at);
    let depth = 1;
    let close = open + 1;
    while (depth > 0 && close < css.length) {
      if (css[close] === "{") depth += 1;
      if (css[close] === "}") depth -= 1;
      close += 1;
    }
    out.push({ head: css.slice(at, open).trim(), body: css.slice(open + 1, close - 1) });
    at = css.indexOf("@container", close);
  }
  return out;
}

/** 막대의 폭 질의만 — 폭 · 두께 · 순서의 시험이 읽는다. */
const queries = () => allQueries().filter(({ head }) => /^@container\s+nxpv\s*\(/.test(head));

test("막대: 풍선에 쓰는 단축키의 열쇠는 모두 단축키 표에 있다", () => {
  const ids = [...bar.matchAll(/keysOf\("([a-z-]+)"\)|tipWith\([^,]+,\s*"([a-z-]+)"\)/g)].map(
    (match) => match[1] ?? match[2],
  );
  // 하나도 못 읽으면 이 검사가 비어 통과한다 — 뒤로 · 앞으로 · 새로 고침 · 주소는 늘 있다.
  assert.ok(ids.length >= 4, `열쇠를 ${ids.length}개만 읽었다`);
  const known = new Set(APP_SHORTCUTS.map((entry) => entry.id));
  assert.deepEqual(
    ids.filter((id) => !known.has(id)),
    [],
  );
});

test("막대 CSS: 컨테이너 질의는 이름 붙은 컨테이너(nxpv · hday)만 부른다", () => {
  const found = allQueries();
  assert.ok(queries().length >= 5, `막대의 질의가 너무 적다: ${queries().length}`);
  for (const { head } of found) {
    // 이름이 없으면 가장 가까운 조상 컨테이너가 무엇이든 거기에 걸린다. 이름은 둘뿐이다 — 막대의 폭 질의,
    // 서랍의 날 머리(스크롤 상태) 질의.
    assert.match(head, /^@container\s+(?:nxpv\s*\(|hday\s+scroll-state\()/, head);
  }
  assert.match(css, /\.nx-hday\s*\{[^}]*container:\s*hday\s*\/\s*scroll-state\s*;/);
  assert.match(css, /\.nx-preview\s*\{[^}]*container-name:\s*nxpv\s*;/);
  assert.match(css, /\.nx-preview\s*\{[^}]*container-type:\s*inline-size\s*;/);
});

test("막대 CSS: 질의 안의 선택자는 `.nx ` 로 시작한다 — 위 규칙보다 얇으면 조용히 진다", () => {
  for (const { head, body } of allQueries()) {
    const selectors = [...body.matchAll(/([^{}]+)\{[^}]*\}/g)].flatMap((rule) =>
      (rule[1] ?? "").split(",").map((selector) => selector.trim()),
    );
    assert.ok(selectors.length > 0, `${head} 에 규칙이 없다`);
    for (const selector of selectors) {
      assert.ok(selector.startsWith(".nx "), `${head}: ${selector}`);
    }
  }
});

test("막대 CSS: 질의의 기준 폭은 한 번씩만 서고 소스에서 위로 갈수록 넓다", () => {
  // 좁은 질의가 뒤에 와야 같은 두께의 규칙끼리 좁은 쪽이 이긴다(480 의 26px 을 400 의 24px 이 덮는다).
  const widths = queries().map(({ head }) => Number(/max-width:\s*(\d+)px/.exec(head)?.[1]));
  assert.ok(
    widths.every((width) => Number.isFinite(width)),
    widths.join(", "),
  );
  assert.deepEqual(widths, [...new Set(widths)], `같은 폭의 질의가 둘이다: ${widths.join(", ")}`);
  assert.deepEqual(
    widths,
    [...widths].sort((a, b) => b - a),
    `질의가 넓은 폭부터 서지 않았다: ${widths.join(", ")}`,
  );
});

test("막대: 작업 기록 단추는 서랍을 여닫는 단추다 — aria-expanded 와 aria-controls, aria-pressed 가 아니다", () => {
  // 눌림 단추(aria-pressed)는 켜고 끄는 값이고, 서랍은 펼침이다 — 낭독기가 `펼침 · 접힘` 으로 읽고 서랍을 가리킨다.
  const button = /<button[^>]*nx-hist-t[^>]*>/.exec(bar)?.[0] ?? "";
  assert.match(button, /aria-expanded=\{historyOpen\}/);
  assert.match(button, /aria-controls=\{drawerId\}/);
  assert.doesNotMatch(button, /aria-pressed/);
  // 이름은 열림 여부에 따라 바뀌지 않는다(낭독기가 같은 단추로 안다) — 풍선만 열려 있으면 `닫기` 로 바뀐다.
  assert.match(button, /aria-label=\{L\.preview\.history\}/);
});

// ── 2026-10-23 화면 전면 재설계 §4 F — 조절 세 묶음 · 32px · 공통 부품

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다(주석을 걷은 CSS). */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

test("막대: 조절이 세 묶음으로 서고 묶음 사이 12px · 안 4px 이다", () => {
  // 이동 묶음(뒤로 · 앞으로 · 새로 고침)과 보기 도구 묶음 둘이 `nx-pvg` 이고, 가운데는 주소 칸이다.
  assert.equal(bar.match(/className="nx-pvg"/g)?.length, 1, "이동 묶음");
  assert.equal(bar.match(/className="nx-pvg nx-pvg--tools"/g)?.length, 1, "보기 도구 묶음");
  assert.match(bar, /className="nx-anchor nx-addrwrap"/);
  assert.match(body(".nx-pvbar"), /gap:\s*var\(--sp-3\)/, "묶음 사이 12px");
  assert.match(body(".nx-pvg"), /gap:\s*var\(--sp-1\)/, "묶음 안 4px");
  // 보기 도구는 오른쪽 끝에 붙는다 — 주소 칸이 남는 폭을 쓴다.
  assert.match(body(".nx-pvg--tools"), /margin-left:\s*auto/);
});

test("막대: 모든 조절은 32px 이고 좁아져도 줄이지 않는다 — 줄이는 것은 간격과 글자다", () => {
  // 크기는 공통 부품(`nx-btn` · `nx-ibtn` 32px)이 정한다 — 이 파일이 따로 선언하지 않는다.
  assert.doesNotMatch(css, /\.nx-pvbar \.nx-ibtn\s*\{[^}]*(?:width|height):/);
  assert.match(body(".nx .nx-addr"), /height:\s*var\(--h-md\)/);
  // 기기 칸(마디 단추)은 바깥 틀이 32px(안쪽 28px + 2px 두 겹)이다.
  assert.match(body(".nx .nx-seg"), /padding:\s*var\(--sp-0_5\)/);
  assert.match(body(".nx .nx-seg button"), /height:\s*var\(--h-sm\)/);
  // 질의 안에서 조절을 30px 이하로 줄이는 규칙이 돌아오지 않는다(예전 480px 질의의 30px).
  for (const { body: inner } of queries()) {
    assert.doesNotMatch(inner, /(?:^|[;\s{])height:\s*(?:2\d|30)px/);
    assert.doesNotMatch(inner, /\.nx-ibtn/);
  }
});

test("막대: 단추는 공통 부품이다 — 포인트 바탕은 찍기가 켜졌을 때뿐이고 `nx-tbtn` 은 더 쓰지 않는다", () => {
  assert.doesNotMatch(bar, /nx-tbtn/);
  // 찍기 — 보통 단추(`nx-btn`)이고 켜짐에서만 `nx-btn--accent`.
  assert.match(bar, /nx-btn nx-pin-t\$\{pinOn \? " nx-btn--accent" : ""\}/);
  // 기록 — 서랍을 여닫는 단추라 고스트다. 열려 있는 동안의 진하기는 aria-expanded 가 칠한다.
  assert.match(bar, /className="nx-btn nx-btn--ghost nx-hist-t"/);
  assert.match(css, /\.nx \.nx-hist-t\[aria-expanded="true"\]\s*\{/);
  // 입력창 칩(chat.css 의 `nx-tbtn`)이 기대던 `flex: none` 한 줄만 특이도 0 으로 남는다 — chat.css 의 값이 늘 이긴다.
  assert.match(css, /:where\(\.nx\) \.nx-tbtn\s*\{\s*flex:\s*none;\s*\}/);
  assert.doesNotMatch(css, /\.nx \.nx-tbtn/);
});

test("막대 CSS: 글자는 12px 이상이고 반 픽셀이 아니다(키캡 제외)", () => {
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.deepEqual(
    sizes.filter((size) => size < 12 || size % 1 !== 0),
    [],
  );
  // 반 픽셀 길이(12.5px · 13.5px …)도 새로 쓰지 않는다 — 스피너 두께까지.
  assert.deepEqual(css.match(/(?<![\w.-])\d*\.5px/g) ?? [], []);
});
