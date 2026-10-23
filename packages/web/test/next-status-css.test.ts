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

test("제출 확인: 한마디 칸은 공통 입력(nx-input)이고 초점은 테두리색만이 아니라 accent 고리다", () => {
  // 2026-10-23 화면 전면 재설계: 따로 선언하던 `.nx-note-input` 을 걷고 공통 부품으로 옮겼다 — 초점 고리는 그쪽이 지킨다.
  const popover = readFileSync(
    join(import.meta.dirname, "../src/next/status/SubmitPopover.tsx"),
    "utf8",
  );
  assert.match(popover, /className="nx-input"/);
  assert.doesNotMatch(css, /\.nx-note-input/, "옛 따로 선언이 돌아오지 않는다");
  const ui = readFileSync(join(import.meta.dirname, "../src/next/ui/ui.css"), "utf8");
  const focus = /\.nx \.nx-input:focus\s*\{([^}]*)\}/.exec(ui);
  assert.ok(focus);
  assert.match(focus[1] ?? "", /border-color:\s*var\(--accent\)/);
  assert.match(focus[1] ?? "", /box-shadow:\s*0 0 0 3px var\(--accent-soft\)/);
});

test("잠긴 제출은 공통 단추의 꺼짐 모양이다 — 칠을 걷은 테두리 상자도 `--muted` 글자도 아니다(2026-10-24 QA 7)", () => {
  const locked = /\.nx \.nx-submit--locked,\s*\.nx \.nx-submit--locked:hover\s*\{([^}]*)\}/.exec(
    css,
  );
  assert.ok(locked);
  const rule = locked[1] ?? "";
  // 따로 지은 꺼짐이 아니라 `.nx-btn:disabled` 와 같은 옅기 · 손이다 — 한쪽만 바뀌어 어긋나지 않게 값을 맞대 본다.
  const ui = readFileSync(join(import.meta.dirname, "../src/next/ui/ui.css"), "utf8");
  const disabled = /\.nx \.nx-btn:disabled\s*\{([^}]*)\}/.exec(ui)?.[1] ?? "";
  const fade = /opacity:\s*([\d.]+)/.exec(disabled)?.[1];
  assert.ok(fade, "공통 꺼짐의 옅기가 있다");
  assert.match(rule, new RegExp(`opacity:\\s*${fade.replace(".", "\\.")}\\s*;`));
  assert.match(rule, /cursor:\s*not-allowed/);
  // 올려도 칠이 오르지 않는다 — 공통 단추의 바탕(`--card`) 그대로.
  assert.match(rule, /background:\s*var\(--card\)/);
  assert.doesNotMatch(rule, /var\(--muted\)|transparent|panel-3|border/);
});

test("상태 줄 바탕은 기획서 머리 줄과 같은 `--bg` 다 — 자리를 바꿀 때 막대 색이 달라지지 않는다(2026-10-24 QA 6)", () => {
  const status = body(".nx-statusbar");
  assert.match(status, /background:\s*var\(--bg\)/);
  assert.doesNotMatch(status, /var\(--cmp\)/);
  // 높이 52 · 아래 선 1px 은 그대로다.
  assert.match(status, /height:\s*var\(--h-bar\)/);
  assert.match(status, /border-bottom:\s*1px solid var\(--line\)/);
  // 기획서 머리 줄(`.nx-topbar`, 공통 부품)의 바탕과 같은 토큰이다.
  const ui = readFileSync(join(import.meta.dirname, "../src/next/ui/ui.css"), "utf8");
  const topbar = /(?:^|\n)\.nx-topbar\s*\{([^}]*)\}/.exec(ui)?.[1] ?? "";
  assert.match(topbar, /background:\s*var\(--bg\)/);
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

// ── 2026-10-23 화면 전면 재설계 §4 G — 상태 줄 · 제출 · 문제 줄

const src = (name: string) =>
  readFileSync(join(import.meta.dirname, "../src/next/status", name), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const problemCss = strip(src("problem.css"));
const statusLine = src("StatusLine.tsx");
const problemLine = src("ProblemLine.tsx");

test("상태 줄: 머리 줄 52px(--h-bar) 하나의 틀이고 글자는 공통 크기다", () => {
  assert.match(body(".nx-statusbar"), /height:\s*var\(--h-bar\)/);
  assert.match(body(".nx .nx-conv-name"), /font-size:\s*var\(--fs-ui\)/);
  assert.match(body(".nx .nx-conv-name"), /font-weight:\s*var\(--fw-semi\)/);
  // 여정은 13px — 지금 점의 알 · 지난 점의 체크는 그대로다.
  assert.match(body(".nx .nx-journey"), /font-size:\s*var\(--fs-sm\)/);
  assert.match(body(".nx .nx-journey"), /height:\s*var\(--h-md\)/);
});

test("상태 줄: 프로젝트 이름만 선다 — `프로젝트 전체 작업` 은 풍선에만 있다", () => {
  assert.doesNotMatch(statusLine, /nx-work-scope-rest/);
  assert.doesNotMatch(css, /nx-work-scope-rest/);
  // 키는 지우지 않는다(다른 칸이 `journey` 를 읽는다) — 풍선(title)이 둘 다 부른다.
  assert.match(statusLine, /title=\{L\.journey\.projectWork\(scopeName\)\}/);
  assert.match(
    statusLine,
    /title=\{`\$\{L\.journey\.projectScope\} · \$\{L\.journey\.openWork\}`\}/,
  );
});

test("제출: 공통 단추 위에 서고 이 자리의 유일한 으뜸이다 — 잠기면 으뜸을 내려놓는다", () => {
  assert.match(
    statusLine,
    /className=\{`nx-btn\$\{submitLocked \? "" : " nx-btn--pri"\} nx-submit\$\{submitState\}`\}/,
  );
  // 잠긴 단추도 눌러서 이유를 읽는다 — `disabled` 가 아니라 `aria-disabled`.
  assert.match(statusLine, /aria-disabled=\{!submit\.enabled \|\| busy !== null\}/);
  assert.doesNotMatch(statusLine, /nx-submit"[^>]*\bdisabled=/);
  // 베이지 덩어리(`--panel-3` 칠)가 돌아오지 않는다 — 꺼짐은 공통 단추의 옅은 모양이다(위 시험).
  const locked = /\.nx \.nx-submit--locked,\s*\.nx \.nx-submit--locked:hover\s*\{([^}]*)\}/.exec(
    css,
  );
  assert.ok(locked);
  assert.doesNotMatch(locked[1] ?? "", /panel-3/);
  // 받아오기는 보통 단추다(으뜸이 아니다).
  assert.match(statusLine, /className="nx-btn nx-base-pull"/);
});

test("제출: 폭은 서 있는 얼굴의 글에 맞는다 — 서 있지 않은 얼굴은 폭 0 으로 접혀 가장 긴 얼굴이 폭을 묶지 않는다(2026-10-24 QA 7)", () => {
  // 공통 단추의 좌우 12px 그대로 — 이 규칙은 폭 · 안쪽 여백 · 최소 폭을 따로 정하지 않는다.
  const button = body(".nx .nx-submit");
  assert.match(button, /display:\s*flex/);
  assert.match(button, /gap:\s*0\s*;/, "접힌 얼굴 사이에 공통 단추의 간격(6px)이 남지 않는다");
  assert.doesNotMatch(button, /display:\s*grid/, "다섯 얼굴을 한 칸에 겹치던 옛 길");
  assert.doesNotMatch(button, /(?<![\w-])(?:width|min-width|padding|grid-area)\s*:/);
  // 얼굴은 한 줄로 나란히 놓이고 서 있지 않은 얼굴은 0fr 로 접힌다 — 갈릴 때 0fr ↔ 1fr 로 옮겨 간다(`.nx-making` 과 같은 길).
  const face = body(".nx-submit-face");
  assert.doesNotMatch(face, /grid-area/, "한 칸에 겹쳐 가장 긴 얼굴에 폭을 묶던 옛 길");
  assert.match(face, /display:\s*grid/);
  assert.match(face, /grid-template-columns:\s*0fr\s*;/);
  assert.match(face, /opacity:\s*0\s*;/);
  assert.match(body('.nx-submit-face[aria-hidden="false"]'), /grid-template-columns:\s*1fr\s*;/);
  const inner = body(".nx-submit-face-in");
  assert.match(inner, /min-width:\s*0\s*;/);
  assert.match(inner, /overflow:\s*hidden/);
  assert.match(inner, /white-space:\s*nowrap/);
  // 마크업: 다섯 얼굴이 모두 서 있고 서 있는 하나만 `aria-hidden=false` 다 — 읽는 글이 한 번만 읽힌다.
  assert.equal(statusLine.match(/className="nx-submit-face"/g)?.length, 5);
  for (const name of ["idle", "running", "retrying", "done", "failed"]) {
    assert.match(statusLine, new RegExp(`aria-hidden=\\{submitFace !== "${name}"\\}`));
  }
  assert.equal(statusLine.match(/className="nx-submit-face-in"/g)?.length, 5);
});

test("상태 줄 접힘: 받아오기가 서 있으면 기준 폭이 오르고, 접힘은 `.nx` 한 겹 더 써서 공통 단추를 이긴다", () => {
  assert.match(statusLine, /nx-project-work--base/);
  assert.match(css, /\.nx-project-work--base \.nx-work-scope/);
  assert.match(css, /\.nx-project-work--base \.nx-jstep:not\(\.nx-jstep--cur\)/);
  // `.nx .nx-btn { display: inline-flex }` 가 `.nx-base-pull { display: none }` 을 이겨 접힘이 먹지 않던 일.
  assert.match(
    css,
    /@container nxwork \(max-width: 395px\) \{\s*\.nx \.nx-base-pull \{\s*display: none;/,
  );
});

test("제출 확인 · 이번 작업: 알림 줄은 공통 띠(nx-banner)이고 한 판의 으뜸은 하나다", () => {
  const popover = src("SubmitPopover.tsx");
  const work = src("WorkPopover.tsx");
  assert.doesNotMatch(css, /\.nx-st-note(?!\w)/);
  for (const text of [popover, work]) {
    assert.doesNotMatch(text, /\bnx-st-note(?!\w)/);
    assert.match(text, /nx-banner nx-banner--(?:red|amber)/);
  }
  // 제출 확인의 으뜸은 `제출` 하나, 한마디 보내기(NoteBox)는 보통 단추다.
  assert.equal(popover.match(/nx-btn--pri/g)?.length, 1);
  assert.doesNotMatch(src("NoteBox.tsx"), /nx-btn--pri/);
  // 화면 줄은 공통 줄 해부(`nx-li`)다 — 제목 14 · 부제 13 · 시각 12.
  const parts = src("parts.tsx");
  assert.match(parts, /className="nx-li-title"/);
  assert.match(parts, /className="nx-li-sub"/);
  assert.match(parts, /className="nx-li-end"/);
});

test("문제 줄: 공통 띠(nx-banner)의 톤 — 고치는 중 호박 · 알렸어요 파랑 · 막힘 · 다시 연결 빨강, role 은 그대로", () => {
  assert.match(
    problemLine,
    /const tone = line\.kind === "fixing" \? "amber" : line\.kind === "notified" \? "blue" : "red";/,
  );
  assert.match(
    problemLine,
    /nx-problem nx-problem--\$\{line\.kind\} nx-banner nx-banner--\$\{tone\}/,
  );
  assert.match(
    problemLine,
    /role=\{line\.kind === "blocked" \|\| line\.kind === "reconnect" \? "alert" : "status"\}/,
  );
  // 색은 띠가 입힌다 — 이 파일이 종류별 바탕을 다시 칠하지 않는다. 폭을 다 쓰는 띠라 반경과 옆 테두리만 걷는다.
  assert.doesNotMatch(problemCss, /\.nx-problem--\w+\s*\{[^}]*background:/);
  const stripRule = /(?:^|\n)\.nx-problem\s*\{([^}]*)\}/.exec(problemCss)?.[1] ?? "";
  assert.match(stripRule, /border-radius:\s*0/);
  // 전폭 띠는 상자 띠의 변형 하나다(2026-10-24 QA 16): 모서리 0 · 아래 선만. 안쪽 여백(12px 16px) · 톤 · 글 크기는 따로 두지 않는다.
  assert.match(stripRule, /border-width:\s*0 0 1px/);
  assert.doesNotMatch(stripRule, /(?<![\w-])(?:padding|font-size|background)\s*:/);
  // 접힘의 길(그리드 줄 1fr → 0fr)은 그대로다.
  assert.match(problemCss, /\.nx-problem-wrap--closed\s*\{\s*grid-template-rows:\s*0fr;/);
});

test("상태 줄 CSS: 글자는 12px 이상이고 반 픽셀이 아니다 — 상태 줄 · 이번 작업 · 제출 확인 · 문제 줄", () => {
  for (const [name, text] of [
    ["status.css", strip(css)],
    ["problem.css", problemCss],
  ] as const) {
    const sizes = [...text.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    assert.deepEqual(
      sizes.filter((size) => size < 12 || size % 1 !== 0),
      [],
      name,
    );
    assert.deepEqual(text.match(/(?<![\w.-])\d*\.5px/g) ?? [], [], `${name} 반 픽셀 길이`);
  }
});

test("문제 줄 좁은 창: 제목은 한 줄 · 본문은 그 아래 두 줄 줄임표 — 말줄임은 본문 한 칸에만 걸고, 빈 단추 줄은 접는다", () => {
  // 제목 · 본문을 함께 담은 상자에 `-webkit-line-clamp` 를 걸면 낡은 엔진에서 둘이 따로 줄이 되어 본문이 한 줄밖에 못 산다.
  const bodyRule =
    /\.nx--narrow \.nx-problem \.nx-banner-body\s*\{([^}]*)\}/.exec(problemCss)?.[1] ?? "";
  assert.doesNotMatch(bodyRule, /line-clamp|-webkit-box/);
  const spanRule =
    /\.nx--narrow \.nx-problem \.nx-banner-body > span\s*\{([^}]*)\}/.exec(problemCss)?.[1] ?? "";
  assert.match(spanRule, /-webkit-line-clamp:\s*2/);
  assert.match(problemCss, /\.nx--narrow \.nx-problem b\s*\{[^}]*display:\s*block/);
  // 단추가 없는 문제 줄(고치는 중 · 알렸어요)의 빈 단추 줄이 줄 간격만 남기지 않는다.
  assert.match(problemCss, /\.nx-problem \.nx-banner-act:empty\s*\{\s*display:\s*none;/);
});
