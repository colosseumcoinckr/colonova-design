// 애플리케이션 메뉴의 시험(2026-10-08 베타 준비 분석) — `buildMenuTemplate` 은 순수 함수라 Electron 없이 곧장 부른다.
// 도움말 메뉴가 막혔을 때 앱 안에서 도움을 찾는 입구인지(사용 설명서 · 진단 복사 · 기록 폴더), 사용 설명서 주소가
// 열리는 https 한 주소인지, 개발 실행에서만 서는 항목이 사용자의 메뉴에 새지 않는지를 지킨다.
// `../dist` 임포트인 이유는 notices 시험과 같다.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { MenuItemConstructorOptions } from "electron";
import { MENU } from "../dist/copy.js";
import { GUIDE_URL } from "../dist/links.js";
import { buildMenuTemplate, type MenuTargets } from "../dist/menu.js";

/** 어떤 손이 불렸는지 적어 두는 가짜 목표. */
function targets(overrides: Partial<MenuTargets> = {}): { calls: string[]; value: MenuTargets } {
  const calls: string[] = [];
  const note = (name: string) => () => {
    calls.push(name);
  };
  const value: MenuTargets = {
    preview: { reload: note("reload"), history: note("history") },
    app: { zoomIn: note("zoomIn"), zoomOut: note("zoomOut"), zoomReset: note("zoomReset") },
    gotoAddress: note("gotoAddress"),
    openSettings: note("openSettings"),
    newSession: note("newSession"),
    packaged: true,
    openLogs: note("openLogs"),
    openGuide: note("openGuide"),
    copyReport: note("copyReport"),
    platform: "darwin",
    ...overrides,
  };
  return { calls, value };
}

function submenu(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  assert.ok(Array.isArray(item?.submenu), `${item?.label} 에 하위 메뉴가 있다`);
  return item.submenu as MenuItemConstructorOptions[];
}

const labelsOf = (items: MenuItemConstructorOptions[]) =>
  items.filter((item) => item.type !== "separator").map((item) => item.label);

test("도움말 메뉴: 사용 설명서 · 진단 복사 · 기록 폴더 — 이 순서로, 하나씩 제 손을 부른다", () => {
  const { calls, value } = targets();
  const help = buildMenuTemplate(value).find((item) => item.label === MENU.help);
  assert.equal(help?.role, "help");
  const items = submenu(help);
  assert.deepEqual(labelsOf(items), [
    "사용 설명서 열기",
    "문제가 생겼어요 — 진단 복사",
    "기록 폴더 열기",
  ]);
  const click = (label: string) => {
    const item = items.find((entry) => entry.label === label);
    assert.ok(item?.click, label);
    (item.click as () => void)();
  };
  click(MENU.helpGuide);
  assert.deepEqual(calls, ["openGuide"]);
  click(MENU.helpReport);
  assert.deepEqual(calls, ["openGuide", "copyReport"]);
  click(MENU.helpLogs);
  assert.deepEqual(calls, ["openGuide", "copyReport", "openLogs"]);
});

test("메뉴의 최상위: 앱 · 편집 · 보기 · 창 · 도움말 — 플랫폼마다 같다", () => {
  for (const platform of ["darwin", "win32", "linux"] as const) {
    const menu = buildMenuTemplate(targets({ platform }).value);
    assert.deepEqual(
      menu.map((item) => item.label),
      ["ColoNova Design", MENU.edit, MENU.view, MENU.window, MENU.help],
      platform,
    );
  }
});

test("개발자 도구는 개발 실행에서만 서고, 기본 새로 고침 · 배율 역할은 없다 (사용자의 메뉴)", () => {
  const roles = (packaged: boolean) => {
    const menu = buildMenuTemplate(targets({ packaged }).value);
    return menu.flatMap((top) =>
      Array.isArray(top.submenu) ? (top.submenu as MenuItemConstructorOptions[]) : [],
    );
  };
  const packagedItems = roles(true);
  assert.ok(!packagedItems.some((item) => item.label === MENU.devTools), "배포판에는 없다");
  assert.ok(!packagedItems.some((item) => item.role === "toggleDevTools"));
  const devItems = roles(false);
  assert.ok(
    devItems.some((item) => item.label === MENU.devTools && item.role === "toggleDevTools"),
  );
  // 새로 고침 · 배율은 미리보기 · 앱 전체를 겨누는 우리 항목이 맡는다 — 기본 역할이 끼면 도구 UI 만 움직인다.
  for (const item of [...packagedItems, ...devItems]) {
    assert.ok(
      !["reload", "forceReload", "zoomIn", "zoomOut", "resetZoom"].includes(String(item.role)),
      `기본 역할이 끼었다: ${item.role}`,
    );
  }
});

test("mac 전용 역할(about · hide · windowMenu)은 다른 OS 의 메뉴에 죽은 항목으로 서지 않는다", () => {
  const roleSet = (platform: NodeJS.Platform) =>
    new Set(
      buildMenuTemplate(targets({ platform }).value).flatMap((top) =>
        [
          top,
          ...(Array.isArray(top.submenu) ? (top.submenu as MenuItemConstructorOptions[]) : []),
        ].map((item) => item.role),
      ),
    );
  const mac = roleSet("darwin");
  for (const role of ["about", "hide", "hideOthers", "unhide", "windowMenu"] as const) {
    assert.ok(mac.has(role), `mac 에는 ${role}`);
    assert.ok(!roleSet("win32").has(role), `Windows 에는 ${role} 없음`);
  }
});

test("GUIDE_URL: 레포의 docs/GUIDE.md 를 가리키는 https 한 주소이고, 그 파일이 실제로 있다", () => {
  const url = new URL(GUIDE_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "github.com");
  assert.match(url.pathname, /^\/[^/]+\/[^/]+\/blob\/main\/docs\/GUIDE\.md$/);
  // 릴리스 피드가 쓰는 레포 이름과 같은 한 곳에서 온다 — 레포가 옮겨 가면 같이 간다.
  assert.ok(
    existsSync(join(import.meta.dirname, "../../..", "docs/GUIDE.md")),
    "주소가 가리키는 파일이 레포에 있다",
  );
});

test("메뉴 문장은 menu.ts 가 아니라 copy.ts 에 있다 — 도움말 세 항목의 말투", () => {
  for (const text of [MENU.helpGuide, MENU.helpReport, MENU.helpLogs]) {
    assert.doesNotMatch(text, /니다(?![가-힣])/, `해요체로: ${text}`);
    assert.doesNotMatch(text, /로그 폴더|문제 해결|상태 확인/, `앱에 없는 말: ${text}`);
  }
  // 기록 폴더는 시작 실패 상자와 같은 이름이다.
  assert.equal(MENU.helpLogs, "기록 폴더 열기");
});
