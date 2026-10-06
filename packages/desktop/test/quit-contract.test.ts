import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 창 닫기와 데몬의 계약(2026-10-06 사용자 위임 · 판단). 데몬은 앱 안에서 돌아 앱과 함께 끝난다 — 비-mac 은 창을
 * 닫으면 앱이 끝나고, 트레이 · 백그라운드 상주는 두지 않는다. 그 대신 사용자에게 한 줄을 말한다(첫 제출의
 * 영수증 `개발자 소식은 앱이 켜져 있으면 알림으로 오고…`) — 이 문장이 거짓이 되지 않게 코드의 모양을 못박는다.
 * 백그라운드 상주를 넣을 때는 이 시험과 `docs/DEVELOPERS.md` 의 「창 닫기와 데몬」, 그 영수증 문장을 함께 고친다.
 * Electron 을 띄우지 않고 main.ts 의 글을 읽는다(앱의 시작은 부수 효과라 불러올 수 없다).
 */
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("비-mac 의 창 닫기는 앱 종료다 — mac 만 창이 닫혀도 앱이 남는다", () => {
  assert.match(
    main,
    /app\.on\("window-all-closed",\s*\(\)\s*=>\s*\{\s*if \(process\.platform !== "darwin"\) app\.quit\(\);\s*\}\);/,
  );
});

test("종료는 데몬을 데리고 나간다 — will-quit 이 데몬이 내려갈 때까지 기다린다", () => {
  assert.match(main, /app\.on\("will-quit",/);
  assert.match(main, /event\.preventDefault\(\);\s*void daemonServer\.stop\(\)\.finally\(/);
});

test("종료 확인은 AI 가 도는 동안만 묻는다 — 기다리는 요청 때문에 묻지 않는다", () => {
  // 묻는 조건은 도는 AI 일 하나다 — 닫을 때마다 뜨는 상자는 며칠 기다리는 요청 앞에서 매번 눌러 넘기는 상자가 된다.
  assert.match(
    main,
    /if \(stopUnderTurnAllowed \|\| !daemonServer\?\.anySessionBusy\(\)\) return;/,
  );
});

test("백그라운드 상주(트레이)는 아직 없다 — 영수증 문장이 말하는 것이 이것이다", () => {
  assert.doesNotMatch(main, /new Tray\(|\bTray\b/);
});
