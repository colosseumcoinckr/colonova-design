import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 문제 띠의 틀은 하나다(2026-10-24 QA 16) — 앱의 문제 · 알림 띠는 공통 부품 `nx-banner`(톤 · 아이콘 · 글 · 단추 한 상자)이고,
 * 전폭으로 서는 자리(상태 줄 아래)만 모서리 0 · 옆 선 없음의 변형이다(`next-status-css.test.ts`). 여기서는 기획서 초안의
 * `결과 확인 필요` 띠(띠와 손이 한 상자)와 작업 기록 서랍의 두 줄이 같은 틀을 쓰는지 지킨다. CSS · 마크업을 글로 읽는다.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
};

const ui = strip(read("../src/next/ui/ui.css"));
const draftCss = strip(read("../src/next/plans/draft/draft.css"));
const draftTsx = read("../src/next/plans/draft/DraftEditor.tsx");
const previewCss = strip(read("../src/next/preview/preview.css"));
const historyTsx = read("../src/next/preview/HistoryDrawer.tsx");

test("결과 확인 필요: 띠와 손이 한 상자다 — 손 줄이 띠의 톤 · 테두리 · 반경으로 이어 닫는다", () => {
  // 마크업은 그대로다: 띠(role="status")와 손은 띠 밖 같은 자리 아래의 형제라서 CSS 가 한 틀로 잇는다.
  assert.match(draftTsx, /<div className="nx-dr-bandwrap">/);
  assert.match(
    draftTsx,
    /<div className="nx-banner nx-banner--amber nx-dr-band--warn" role="status">/,
  );
  assert.match(draftTsx, /<div className="nx-dr-band-act">/);

  // 둘 사이에 간격이 없다 — 간격이 있으면 상자 둘로 읽힌다.
  assert.match(rule(draftCss, ".nx-dr-bandwrap"), /gap:\s*0\s*;/);

  // 띠는 아래 선 · 아래 모서리를 손 줄에 넘긴다.
  const band = rule(draftCss, ".nx-dr-bandwrap > .nx-dr-band--warn");
  assert.match(band, /border-bottom-width:\s*0/);
  assert.match(band, /border-bottom-left-radius:\s*0/);
  assert.match(band, /border-bottom-right-radius:\s*0/);

  // 손 줄은 공통 띠(호박)의 바탕 · 테두리색 · 반경을 그대로 입는다 — 한쪽만 바뀌어 이음매가 보이지 않게 값을 맞대 본다.
  const amber = rule(ui, ".nx-banner--amber");
  const banner = rule(ui, ".nx-banner");
  const tone = (text: string, prop: string) => new RegExp(`${prop}:\\s*([^;]+);`).exec(text)?.[1];
  const act = rule(draftCss, ".nx-dr-bandwrap > .nx-dr-band-act");
  assert.equal(tone(act, "background"), tone(amber, "background"));
  assert.equal(tone(act, "border"), `1px solid ${tone(amber, "border-color")}`);
  assert.match(act, /border-top-width:\s*0/);
  const radius = tone(banner, "border-radius");
  assert.ok(radius, "공통 띠의 반경");
  assert.equal(tone(act, "border-radius"), `0 0 ${radius} ${radius}`);

  // 단추는 글과 같은 왼쪽 끝에서 시작한다 — 좌우는 띠의 안쪽 여백(16px), 왼쪽은 앞 그림 + 사이를 더한다. 바닥은 띠의 아래 여백(12px).
  assert.match(
    act,
    /padding:\s*0 var\(--sp-4\) var\(--sp-3\) calc\(var\(--sp-4\) \+ 15px \+ var\(--sp-3\)\)/,
  );
  assert.match(banner, /padding:\s*var\(--sp-3\) var\(--sp-4\)/);

  // 확인판(`재전송 없이 종료`)은 상자 밖 아래의 제 카드 — 한 칸 떨어져 선다.
  assert.match(rule(draftCss, ".nx-dr-bandwrap > .nx-dr-confirm"), /margin-top:\s*var\(--sp-2\)/);
});

test("작업 기록 서랍의 잠김 · 실패 줄은 공통 띠(nx-banner--amber)다 — 틀을 따로 선언하지 않는다", () => {
  // 마크업: 잠김 한 줄 · 읽기 실패(단추 있음) · 되돌리기 실패 모두 공통 띠 + 아이콘(점 · 느낌표).
  assert.match(historyTsx, /className="nx-banner nx-banner--amber nx-hist-lock"/);
  assert.equal(
    historyTsx.match(/className="nx-banner nx-banner--amber nx-hist-error"/g)?.length,
    2,
  );
  assert.equal(historyTsx.match(/<div className="nx-banner-body">/g)?.length, 2);
  assert.equal(historyTsx.match(/<div className="nx-banner-act">/g)?.length, 1);
  // CSS: 자리(바깥 여백) · 맞춤만 두고 바탕 · 반경 · 안쪽 여백 · 글 크기 · 색은 띠가 입힌다.
  for (const selector of [".nx-hist-lock", ".nx-hist-error"]) {
    assert.doesNotMatch(
      rule(previewCss, selector),
      /background|border-radius|padding|font-size|(?<!-)color:/,
    );
  }
  // 숨 쉬는 점은 앞 그림 자리 — 톤색(호박)을 직접 입는다(띠의 글색은 잉크라 `currentColor` 가 아니다).
  assert.match(rule(previewCss, ".nx-hist-lockdot"), /background:\s*var\(--amber\)/);
});
