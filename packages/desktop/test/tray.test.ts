import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TRAY } from "../dist/copy.js";
import { loadTrayNoticeShown, saveDesktopSettings } from "../dist/desktop-settings.js";
import { buildTrayMenuTemplate, trayIconPath } from "../dist/tray.js";

/**
 * Windows 트레이(2026-10-20 사용자 요청)의 순수 부분 — 아이콘 자리 · 메뉴 · 첫 닫기 안내의 기록. Tray 자체와 알림은
 * Electron 이라 이 시험이 닿지 못한다(창 닫기의 계약은 quit-contract.test.ts). `../dist` 임포트인 이유는 notices
 * 시험과 같다.
 */

test("트레이 아이콘은 설치본의 resources/tray.ico, 개발 실행의 build/icon.ico 다", () => {
  assert.equal(
    trayIconPath({
      packaged: true,
      resourcesPath: "/app/resources",
      appPath: "/app/resources/app.asar",
    }),
    join("/app/resources", "tray.ico"),
  );
  assert.equal(
    trayIconPath({
      packaged: false,
      resourcesPath: "/electron/resources",
      appPath: "/repo/packages/desktop",
    }),
    join("/repo/packages/desktop", "build", "icon.ico"),
  );
});

test("트레이 메뉴는 열기와 종료 둘뿐이고, 각 항목이 제 손을 부른다", () => {
  const calls: string[] = [];
  const items = buildTrayMenuTemplate({
    open: () => {
      calls.push("open");
    },
    quit: () => {
      calls.push("quit");
    },
  });
  const labels = items.filter((item) => item.type !== "separator").map((item) => item.label);
  assert.deepEqual(labels, [TRAY.open, TRAY.quit]);
  for (const item of items) (item.click as (() => void) | undefined)?.();
  assert.deepEqual(calls, ["open", "quit"]);
});

test("첫 닫기 안내의 기록 — true 만 믿고, 다른 키를 지우지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-tray-"));
  try {
    const path = join(dir, "desktop-settings.json");
    writeFileSync(path, JSON.stringify({ port: 4321 }));
    assert.equal(loadTrayNoticeShown(path), false);
    saveDesktopSettings(path, { trayNoticeShown: true });
    assert.equal(loadTrayNoticeShown(path), true);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).port, 4321);
    saveDesktopSettings(path, { trayNoticeShown: "yes" });
    assert.equal(loadTrayNoticeShown(path), false, "true 만 믿는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
