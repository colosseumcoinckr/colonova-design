import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 모델 칩 팝 · 답 끝 줄 메뉴 · 질문 카드의 조용한 실패를 지킨다(2026-10-06 겹판 조사 C). 화면에는
 * 오류가 없는데 낭독과 키보드와 대비만 무너지는 것들이라 — 소스와 CSS 를 글자로 읽는다. 순수
 * 판정(화살표 걸음)은 `next-roving.test.ts` 가 따로 본다.
 */
const next = (file: string) => readFileSync(join(import.meta.dirname, "../src/next", file), "utf8");
const chip = next("chat/ModelChip.tsx");
const settle = next("chat/SettleLine.tsx");
const cards = next("chat/cards.tsx");
const css = next("chat/chat.css");

/** 규칙 하나 — 가장 안쪽의 `선택자 { 몸 }` 만 읽는다(at-규칙 안의 규칙도 잡힌다). */
function rules(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" });
  }
  return out;
}

test("모델 칩: AI · 모델 · 생각 시간이 같은 라디오 군이고 팝에 이름이 있다", () => {
  assert.equal(chip.match(/role="radiogroup"/g)?.length, 3, "라디오 군은 셋이다");
  for (const name of ["L.model.ai", "L.model.model", "L.model.think"]) {
    assert.ok(chip.includes(`aria-label={${name}}`), `${name} 이 군의 이름이다`);
  }
  assert.ok(chip.includes("label={L.model.popLabel}"), "이름 없는 dialog 를 만들지 않는다");
  assert.ok(!chip.includes("aria-pressed"), "고른 줄은 aria-checked 다 — 눌림 단추가 아니다");
  assert.ok(chip.includes("useRoving"), "화살표 걸음은 한 훅이 맡는다");
});

test("모델 칩: 읽는 중에는 바닥에 줄을 띄우지 않는다 — 머리의 도는 표시와 aria-busy 만", () => {
  // `L.model.loading` 은 칩의 라벨(모델 목록을 기다리는 동안)에만 남는다.
  assert.equal(chip.match(/L\.model\.loading/g)?.length, 1);
  assert.ok(chip.includes('aria-busy={planRead === "loading"}'));
  assert.ok(chip.includes("nx-mh-spin"));
});

test("모델 칩 CSS: 고른 칸의 알약은 토큰이고, 어두운 팔레트는 틀보다 밝은 알약을 입는다", () => {
  const all = rules();
  for (const selector of [".nx .nx-aipick::before", ".nx .nx-model-pop .nx-mseg::before"]) {
    const rule = all.find((one) => one.selector === selector);
    assert.ok(rule, `${selector} 규칙이 있다`);
    assert.match(rule.body, /background:\s*var\(--nx-pill\)/, selector);
  }
  const dark = all.find((one) => one.selector.includes('html[data-theme="dark"] .nx .nx-aipick'));
  assert.ok(dark, "dark 의 알약 · 틀 덮어쓰기");
  assert.ok(dark.selector.includes('html[data-theme="github"] .nx .nx-aipick'), "github 도 같다");
  assert.match(dark.body, /--nx-track:\s*var\(--bg\)/, "틀이 바탕보다 어둡다");
  assert.match(dark.body, /--nx-pill:\s*color-mix\(/, "알약은 잉크를 섞어 밝다");
});

test("모델 팝 · 답 끝 줄 메뉴 CSS: 새 11px 글자를 만들지 않는다", () => {
  for (const { selector, body } of rules()) {
    if (!/nx-model-pop|nx-settle-pop|nx-mh-state|nx-mh-retry|nx-mh-spin/.test(selector)) continue;
    assert.doesNotMatch(body, /font-size:\s*11(\.\d+)?px/, `${selector} 의 글자는 12px 이상`);
  }
});

test("답 끝 줄: `···` 는 이름 있는 메뉴이고, 못 하는 줄은 사라지지 않고 이유와 함께 남는다", () => {
  assert.ok(settle.includes('role="menu"'));
  assert.ok(settle.includes('aria-haspopup="menu"'));
  assert.ok(settle.includes("label={L.transcript.settleMenuTip}"));
  assert.ok(settle.includes('role="menuitem"'));
  // 꺼진 줄은 `disabled` 가 아니라 `aria-disabled` — 화살표 걸음에 남아 이유를 읽을 수 있다.
  assert.ok(settle.includes("aria-disabled"));
  assert.ok(!/\sdisabled=/.test(settle));
  assert.ok(settle.includes("L.transcript.forkOff"));
  assert.ok(settle.includes("aria-describedby"));
});

test("답 끝 줄: 복사했다는 말은 줄 한 곳이 한다 — 성공에 토스트가 없다", () => {
  // 토스트는 복사에 못 닿았을 때의 안내(`copyFailed`) 하나뿐이다.
  assert.equal(settle.match(/onToast\(/g)?.length, 1);
  assert.match(settle, /onToast\(L\.transcript\.copyFailed\)/);
  assert.ok(settle.includes("copied ? L.transcript.copied"), "낭독이 한 번 말한다");
});

test("질문 카드: 고른 상태는 aria-pressed 와 체크, 잠긴 보내기는 눈에 보이는 이유", () => {
  assert.ok(cards.includes("aria-pressed={on}"), "선택지가 눌림 상태를 말한다");
  assert.ok(cards.includes("<CheckIcon />"));
  assert.ok(cards.includes("L.cards.pickedCount(count)"));
  assert.ok(cards.includes("L.cards.needAll") && cards.includes("L.cards.needOne"));
  assert.ok(cards.includes("aria-describedby={complete ? undefined : needId}"));
});

test("질문 카드: 카드는 alert 가 아니다 — 공지는 마운트 한 번, 실패 줄만 alert", () => {
  // 카드 전체가 alert 면 안의 어떤 변화에도 카드가 통째로 다시 읽힌다.
  assert.doesNotMatch(cards, /className="nx-card nx-card--ask"[^>]*role="alert"/);
  assert.equal(cards.match(/<Announce /g)?.length, 2, "허락 카드와 질문 카드가 한 공지씩");
  // 보내지 못했다는 줄(두 카드)은 status 가 아니라 alert.
  const failures = cards.match(/role="(alert|status)">\s*\{L\.chat\.sendFailed\}/g) ?? [];
  assert.equal(failures.length, 2);
  for (const failure of failures) assert.ok(failure.includes('role="alert"'), failure);
});
