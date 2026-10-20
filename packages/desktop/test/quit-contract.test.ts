import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { staysResidentWithoutWindows, wantsTray } from "../dist/tray.js";

/**
 * 창 닫기와 데몬의 계약. 데몬은 앱 안에서 돌아 앱과 함께 끝난다 — 2026-10-06(사용자 위임 · 판단)에는 비-mac 의 창
 * 닫기가 곧 종료였고, 2026-10-20 사용자 요청으로 Windows 는 창을 닫아도 트레이에 남아 데몬 · 미리보기 서버가 그대로
 * 산다(docs/DEVELOPERS.md 「창 닫기와 데몬」). Linux 와 트레이를 못 세운 Windows 는 옛 규칙이다. 첫 제출의 영수증
 * (`개발자 소식은 앱이 켜져 있으면 알림으로 오고…`)은 두 세계에서 다 참이다 — 트레이에 남은 앱은 켜져 있는 앱이다.
 * Electron 을 띄우지 않고 main.ts 의 글을 읽는다(앱의 시작은 부수 효과라 불러올 수 없다). 판정의 순수 부분은
 * dist/tray.js 로 곧장 부른다(`../dist` 임포트인 이유는 notices 시험과 같다).
 */
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("창이 다 닫혀도 남는 곳 — mac 은 늘, Windows 는 트레이가 섰을 때만, Linux 는 끝난다", () => {
  assert.equal(staysResidentWithoutWindows("darwin", false), true);
  assert.equal(staysResidentWithoutWindows("darwin", true), true);
  assert.equal(staysResidentWithoutWindows("win32", true), true);
  assert.equal(
    staysResidentWithoutWindows("win32", false),
    false,
    "트레이를 못 세운 Windows 는 옛 규칙(창 닫기=종료)이다 — 보이지 않는 앱을 만들지 않는다",
  );
  assert.equal(staysResidentWithoutWindows("linux", true), false);
  assert.equal(staysResidentWithoutWindows("linux", false), false);
});

test("트레이는 Windows 의 실제 실행에만 선다 — 시험 실행은 창 닫기=종료를 그대로 둔다", () => {
  assert.equal(wantsTray("win32", false), true);
  assert.equal(wantsTray("win32", true), false);
  assert.equal(wantsTray("darwin", false), false);
  assert.equal(wantsTray("linux", false), false);
  assert.match(
    main,
    /if \(wantsTray\(process\.platform, underTest\)\) \{\s*try \{\s*tray = await installTray\(\);/,
  );
});

test("창이 다 닫히면 — 남는 곳이 아닐 때만 종료다", () => {
  assert.match(
    main,
    /app\.on\("window-all-closed",\s*\(\)\s*=>\s*\{\s*if \(!staysResidentWithoutWindows\(process\.platform, tray !== null\)\) app\.quit\(\);\s*\}\);/,
  );
});

test("창 닫기의 가드는 닫기가 곧 종료인 곳에서만 묻고, 남는 곳은 종료 경로가 묻는다", () => {
  assert.match(
    main,
    /window\.on\("close", \(event\) => \{\s*if \(staysResidentWithoutWindows\(process\.platform, tray !== null\)\) return;\s*guardStopUnderTurn\(event, \(\) => window\.close\(\)\);/,
  );
  assert.match(
    main,
    /app\.on\("before-quit", \(event\) => \{\s*if \(guardStopUnderTurn\(event, \(\) => app\.quit\(\)\)\) quitting = true;/,
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
    /if \(stopUnderTurnAllowed \|\| !daemonServer\?\.anySessionBusy\(\)\) return true;/,
  );
});

test("첫 닫기의 안내는 설치마다 한 번이고, 종료로 닫히는 창에는 띄우지 않는다", () => {
  assert.match(
    main,
    /function offerTrayNotice\(\): void \{\s*if \(quitting \|\| tray === null\) return;/,
  );
  assert.match(
    main,
    /if \(loadTrayNoticeShown\(settingsPath\)\) return;\s*saveDesktopSettings\(settingsPath, \{ trayNoticeShown: true \}\);/,
  );
  assert.match(
    main,
    /notices\.show\(TRAY\.closedNotice\.title, TRAY\.closedNotice\.body, \(\) => host\.focusMain\(\)\)/,
  );
});

test("트레이의 열기 · 종료는 창 되살리기와 앱 종료다 — 종료 확인과 데몬 정리를 그대로 지난다", () => {
  assert.match(
    main,
    /const targets = \{ open: \(\) => host\.focusMain\(\), quit: \(\) => app\.quit\(\) \};/,
  );
  assert.match(main, /created\.on\("click", \(\) => targets\.open\(\)\);/);
});
