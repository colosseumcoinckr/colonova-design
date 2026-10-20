import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runningOutsideInstall, shouldOfferMove } from "../dist/app-location.js";
import {
  KEYCHAIN_ANSWER,
  MOVE_ANSWER,
  moveToApplicationsOptions,
  unreadableCredentialsOptions,
} from "../dist/copy.js";
import { loadMoveDeclined, saveDesktopSettings } from "../dist/desktop-settings.js";
import { SafeStorageCredentialStore } from "../dist/safe-storage-store.js";

/**
 * 설치 자리 · 키체인(2026-10-20 비개발자 mac · Windows 설치 검토). 네이티브 상자와 옮기기 자체는 이 시험이
 * 닿지 못한다 — 판정 · 문장 · 저장소의 셈만 본다.
 */

test("설치 자리: DMG 와 Gatekeeper 의 임시 자리는 설치 밖이다", () => {
  assert.equal(
    runningOutsideInstall(
      "/Volumes/ColoNova Design/ColoNova Design.app/Contents/MacOS/ColoNova Design",
    ),
    true,
  );
  assert.equal(
    runningOutsideInstall(
      "/private/var/folders/xy/abc/T/AppTranslocation/1234-ABCD/d/ColoNova Design.app/Contents/MacOS/ColoNova Design",
    ),
    true,
  );
  assert.equal(
    runningOutsideInstall("/Applications/ColoNova Design.app/Contents/MacOS/ColoNova Design"),
    false,
  );
  assert.equal(
    runningOutsideInstall(
      "/Users/kim/Applications/ColoNova Design.app/Contents/MacOS/ColoNova Design",
    ),
    false,
  );
});

test("옮기기 질문: 설치된 mac 앱이 응용 프로그램 폴더 밖일 때만 묻는다", () => {
  const base = {
    platform: "darwin",
    packaged: true,
    underTest: false,
    inApplications: false,
    declined: false,
    pendingInvite: false,
  };
  assert.equal(shouldOfferMove(base), true);
  assert.equal(shouldOfferMove({ ...base, platform: "win32" }), false);
  assert.equal(shouldOfferMove({ ...base, packaged: false }), false, "개발 실행은 묻지 않는다");
  assert.equal(shouldOfferMove({ ...base, underTest: true }), false);
  assert.equal(shouldOfferMove({ ...base, inApplications: true }), false);
  assert.equal(shouldOfferMove({ ...base, declined: true }), false, "다시 묻지 않기");
  assert.equal(
    shouldOfferMove({ ...base, pendingInvite: true }),
    false,
    "더블클릭한 초대 파일을 다시 켜기로 잃지 않는다",
  );
});

test("옮기기 질문: 권하는 단추가 첫 단추 · 기본이고, 다시 묻지 않기가 있다", () => {
  const options = moveToApplicationsOptions();
  assert.equal(options.defaultId, MOVE_ANSWER.move);
  assert.equal(options.cancelId, MOVE_ANSWER.later);
  assert.match(String(options.buttons?.[MOVE_ANSWER.move]), /응용 프로그램 폴더/);
  assert.ok(options.checkboxLabel);
});

test("다시 묻지 않기: desktop-settings 에 남고 다른 키를 지우지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-move-"));
  try {
    const path = join(dir, "desktop-settings.json");
    writeFileSync(path, JSON.stringify({ port: 4321 }));
    assert.equal(loadMoveDeclined(path), false);
    saveDesktopSettings(path, { moveDeclined: true });
    assert.equal(loadMoveDeclined(path), true);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).port, 4321);
    saveDesktopSettings(path, { moveDeclined: "yes" });
    assert.equal(loadMoveDeclined(path), false, "true 만 믿는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("키체인: 저장돼 있는데 풀지 못한 항목만 세고, 다시 저장하면 지운다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-keychain-"));
  try {
    let denied = false;
    const fake = {
      encryptString: (text: string) => Buffer.from(`enc:${text}`),
      decryptString: (blob: Buffer) => {
        if (denied) throw new Error("Error while decrypting the ciphertext");
        return blob.toString().replace(/^enc:/, "");
      },
    };
    const store = new SafeStorageCredentialStore(fake, join(dir, "credentials.json"));
    assert.equal(await store.load("repo-pat"), null);
    assert.equal(store.unreadable, 0, "없는 항목은 세지 않는다");

    await store.save("repo-pat", "secret");
    denied = true;
    assert.equal(await store.load("repo-pat"), null);
    assert.equal(store.unreadable, 1);

    denied = false;
    assert.equal(await store.load("repo-pat"), "secret");
    assert.equal(store.unreadable, 0, "다시 읽히면 지운다");

    denied = true;
    await store.load("repo-pat");
    await store.save("repo-pat", "fresh");
    assert.equal(store.unreadable, 0, "새로 저장하면 지운다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("키체인 상자: mac 은 항상 허용 · 다시 켜기, Windows 는 초대 파일을 다시 연다", () => {
  const mac = unreadableCredentialsOptions("darwin");
  assert.equal(mac.defaultId, KEYCHAIN_ANSWER.relaunch);
  assert.match(String(mac.detail), /ColoNova Design Safe Storage/);
  assert.match(String(mac.detail), /항상 허용/);
  assert.match(String(mac.detail), /초대 파일을 다시 받을 필요는 없어요/);
  const win = unreadableCredentialsOptions("win32");
  assert.equal(win.buttons?.length, 1);
  assert.doesNotMatch(String(win.detail), /키체인/);
  assert.match(String(win.detail), /초대 파일/);
});

test("NSIS include: 설치 범위를 늘 현재 사용자로 고정하고, 제거 프로그램은 건드리지 않는다", () => {
  const nsh = readFileSync(join(import.meta.dirname, "../build/installer.nsh"), "utf8");
  const macro = /!macro customInstallMode([\s\S]*?)!macroend/.exec(nsh)?.[1] ?? "";
  assert.match(macro, /StrCpy \$isForceCurrentInstall "1"/);
  assert.match(macro, /!ifndef BUILD_UNINSTALLER/);
  assert.doesNotMatch(macro, /isForceMachineInstall/);
});
