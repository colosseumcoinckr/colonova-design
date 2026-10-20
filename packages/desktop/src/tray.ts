import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { TRAY } from "./copy.js";

/**
 * Windows 의 트레이 상주(2026-10-20 사용자 요청) — 창을 닫아도 앱이 트레이에 남아 데몬과 미리보기 서버가 그대로
 * 살고, 다시 열면 그 자리로 돌아온다. 2026-10-06 의 「창 닫기=종료」 결정을 Windows 에 한해 뒤집은 것이다
 * (docs/DEVELOPERS.md 「창 닫기와 데몬」). 이 파일은 electron 을 부르지 않는 순수 부분이라 시험이 곧장 읽는다
 * (`tray.test.ts` · `quit-contract.test.ts`) — Tray 를 실제로 세우는 일은 main.ts 의 `installTray` 다. 한글
 * 리터럴은 copy.ts 의 `TRAY` 다.
 */

export interface TrayTargets {
  /** 창을 앞으로 — 창이 없으면 다시 연다(`host.focusMain`). */
  open(): void;
  /** 앱을 끝낸다 — `app.quit()` 이라 종료 확인(`before-quit`)과 데몬 정리(`will-quit`)를 그대로 지난다. */
  quit(): void;
}

/**
 * 트레이가 서는 조건 — Windows 의 실제 실행뿐이다. 시험 실행(단위 임포트 · 스모크)은 창 닫기=종료를 그대로 두어
 * 하네스가 창을 닫으면 앱이 끝난다. mac 은 Dock 이 그 자리고, Linux 는 트레이를 믿을 수 없어 두지 않는다.
 */
export function wantsTray(platform: NodeJS.Platform, underTest: boolean): boolean {
  return platform === "win32" && !underTest;
}

/**
 * 창이 하나도 없어도 앱이 남는가 — mac 은 늘(Dock), Windows 는 트레이가 섰을 때만. 트레이를 못 세운 Windows 와
 * Linux 는 옛 규칙(창 닫기=종료)이다 — 보이지 않는 앱을 만들지 않는다.
 */
export function staysResidentWithoutWindows(
  platform: NodeJS.Platform,
  trayInstalled: boolean,
): boolean {
  return platform === "darwin" || (platform === "win32" && trayInstalled);
}

/**
 * 트레이 아이콘 파일 — 설치본은 `resources/tray.ico`(electron-builder.yml 의 `extraResources`, asar 밖), 개발
 * 실행은 패키지의 `build/icon.ico`. 없으면 호출자가 실행 파일의 아이콘으로 물러난다.
 */
export function trayIconPath(input: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  return input.packaged
    ? join(input.resourcesPath, "tray.ico")
    : join(input.appPath, "build", "icon.ico");
}

/** 트레이 메뉴 — 열기와 종료 둘뿐이다. 아이콘 클릭 · 더블클릭도 열기다(main.ts). */
export function buildTrayMenuTemplate(targets: TrayTargets): MenuItemConstructorOptions[] {
  return [
    { label: TRAY.open, click: () => targets.open() },
    { type: "separator" },
    { label: TRAY.quit, click: () => targets.quit() },
  ];
}
