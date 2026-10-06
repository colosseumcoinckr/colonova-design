import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 상태 줄 CSS 의 조용한 실패를 지킨다(2026-10-06). 컨테이너 질의는 컨테이너가 제 폭을 가질 때만
 * 뜻이 있다 — `container-type: inline-size` 는 내용이 정하는 폭을 0 으로 만들므로, 내용에 맡긴
 * flex 항목에 걸면 폭이 0 이 되어 모든 질의가 늘 `가장 좁음` 으로 읽힌다. 화면에는 오류가 없고
 * `만드는 중` 과 앞으로 올 점의 글자만 사라진다(2026-10-04 ux-review 가 이렇게 나갔다).
 */
const css = readFileSync(join(import.meta.dirname, "../src/next/status/status.css"), "utf8");

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다. */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

test("상태 줄: 질의의 컨테이너는 내용이 아니라 남은 자리로 폭을 갖는다", () => {
  const rule = body(".nx-project-work");
  assert.match(rule, /container:\s*nxwork\s*\/\s*inline-size/);
  // `flex: 0 1 auto` 처럼 내용에 맡기면 폭이 0 이 된다 — 남은 자리를 모두 갖는 `1 1 0`.
  assert.match(rule, /flex:\s*1\s+1\s+0(?:px|%)?\s*;/);
  assert.match(rule, /min-width:\s*0\s*;/);
});

test("상태 줄: 컨테이너 질의는 이름 붙은 컨테이너(nxwork)만 부른다", () => {
  const queries = css.match(/@container[^{]*\{/g) ?? [];
  assert.ok(queries.length >= 5, `질의가 너무 적다: ${queries.length}`);
  for (const query of queries) {
    // 이름이 없으면 가장 가까운 조상 컨테이너가 무엇이든 거기에 걸린다.
    assert.match(query, /@container\s+nxwork\s*\(/, query);
  }
});

test("상태 줄: 접힘의 기준 폭은 질의마다 한 번씩만 선다", () => {
  // 같은 폭에 질의가 둘이면 어느 규칙이 이기는지 소스 순서에 맡기게 된다 — 폭마다 한 질의씩 두고,
  // 만드는 중 · 좁은 창의 규칙은 같은 질의 안에서 선택자로 가른다.
  const widths = [...css.matchAll(/@container nxwork \(max-width: (\d+)px\)/g)].map((m) =>
    Number(m[1]),
  );
  assert.deepEqual(widths, [...new Set(widths)], `같은 폭의 질의가 둘이다: ${widths.join(", ")}`);
});

/**
 * 제출 확인 · 이번 작업 팝의 조용한 실패를 지킨다(2026-10-06 겹판 손질). 겹판의 옷(스크림 · 반경 · 그림자 ·
 * 들어옴/나감)은 ui/overlay.css 한 곳이 입히는데, 이 파일이 같은 것을 다시 선언하면 나중 파일이 이겨 통일이
 * 깨진다 — 옛 `.nx-submit-review-back` 은 잉크색 스크림(`color-mix(var(--ink) 26%)`)과 z-index 60 으로 겹판의
 * `--scrim` · 70 을 덮었고, `--ink` 가 밝은 다크 테마에서는 어둡히지 않고 뿌옇게 칠했다.
 */
test("제출 확인: 스크림 · 판의 옷은 overlay.css 의 것이다 — 여기서 다시 선언하지 않는다", () => {
  assert.doesNotMatch(css, /\.nx-submit-review-back\s*[,{]/, "스크림은 겹판 뼈대가 입힌다");
  const panel = /\.nx-modal\.nx-submit-review\s*\{([^}]*)\}/.exec(css);
  assert.ok(panel, "제출 확인 판의 배치 규칙이 있다");
  for (const forbidden of ["box-shadow", "border-radius", "background", "animation", "z-index"]) {
    assert.doesNotMatch(
      panel[1] ?? "",
      new RegExp(`${forbidden}\\s*:`),
      `${forbidden} 은 overlay.css 의 몫`,
    );
  }
  // 고정 그림자(`#0003`)도 되살아나지 않는다.
  assert.doesNotMatch(css, /box-shadow:\s*0 24px 80px/);
});

test("제출 확인: 한마디 칸의 초점은 테두리색만이 아니라 accent 고리다", () => {
  const focus = /\.nx \.nx-note-input:focus\s*\{([^}]*)\}/.exec(css);
  assert.ok(focus);
  assert.match(focus[1] ?? "", /border-color:\s*var\(--accent\)/);
  assert.match(focus[1] ?? "", /box-shadow:\s*0 0 0 3px var\(--accent-soft\)/);
});

test("잠긴 제출 글자는 `--muted` 가 아니다 — 눌러서 이유를 읽는 단추라 대비가 모자라면 안 된다", () => {
  const locked = /\.nx \.nx-submit--locked,\s*\.nx \.nx-submit--locked:hover\s*\{([^}]*)\}/.exec(
    css,
  );
  assert.ok(locked);
  assert.match(locked[1] ?? "", /color:\s*var\(--ink2\)/);
  assert.doesNotMatch(locked[1] ?? "", /var\(--muted\)/);
});

test("이번 작업 팝: 틀은 flex 열이고 몸(`.nx-wp-body`)만 굴러간다 — 머리 · 여정 · 바닥은 선다", () => {
  assert.match(body(".nx-work-pop"), /display:\s*flex/);
  assert.match(body(".nx-work-pop"), /flex-direction:\s*column/);
  assert.match(body(".nx-work-pop"), /overflow:\s*hidden/);
  assert.match(body(".nx-wp-body"), /overflow-y:\s*auto/);
  assert.match(body(".nx-wp-body"), /min-height:\s*0/);
  for (const fixed of [".nx-wp-h", ".nx-wp-journey", ".nx-wp-foot"]) {
    assert.match(body(fixed), /flex:\s*none/, `${fixed} 는 굴러가지 않는다`);
  }
});

test("잠긴 이유 말풍선: 앱의 팝과 같은 말투 — 반경 14 · 팝 그림자 · 꼬리 한 칸", () => {
  const bubble = body(".nx-why");
  assert.match(bubble, /border-radius:\s*14px/);
  assert.match(bubble, /box-shadow:\s*var\(--pop\)/);
  assert.match(css, /\.nx-why::before\s*\{/, "꼬리");
});
