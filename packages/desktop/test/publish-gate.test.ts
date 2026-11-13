import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 발행 게이트의 앱 계약(2026-11-02 사용자 지시) — 데스크톱 앱이 데몬을 감싸 띄우며 실제 Confluence
 * 쓰기(발행 · 문서 관리 · 코멘트)의 게이트를 기본으로 연다. 미리 정한 값(예 "0")은 존중해 끌 수
 * 있다. 단독 데몬 · 시험의 기본은 여전히 꺼짐이다(docs/DEVELOPERS.md 환경 변수 표). 앱의 시작은
 * 부수 효과라 불러올 수 없어 main.ts 의 글을 읽는다(quit-contract.test.ts 와 같은 눈).
 */
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("앱은 게이트를 기본으로 연다 — 값을 미리 정해 두면 그 판정을 존중한다", () => {
  // ??= 이어야 한다: 없을 때만 "1" 을 놓는다. "=" 이면 밖에서 끈 값(예 "0")을 덮어써 강제로 켠다.
  assert.match(main, /process\.env\.COLONOVA_DESIGN_CONFLUENCE_PUBLISH \?\?= "1";/);
});
