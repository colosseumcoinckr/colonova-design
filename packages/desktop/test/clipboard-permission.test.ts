import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 사진 복사(2026-10-08 베타 준비 분석 · 겹판 점검 E)는 웹 창의 `navigator.clipboard.write` 로 PNG 를 클립보드에 넣는다.
 * Chromium 은 그 쓰기에 `clipboard-sanitized-write` 권한을 요구하는데, 이 데스크톱은 권한 핸들러를 따로 두지 않아
 * Electron 의 기본(요청을 허락)이 쓰인다 — 창은 데몬이 서빙하는 `http://127.0.0.1` 이라 보안 컨텍스트이기도 하다.
 * 그래서 이번에는 데스크톱을 고치지 않았다. 이 시험은 그 전제를 지킨다: 나중에 누가 권한 핸들러를 달면 사진 복사가
 * 조용히 죽지 않게, 같은 파일이 이 권한을 허락한다고 말해야 한다.
 */
const dir = new URL("../src/", import.meta.url);

test("권한 핸들러가 있다면 clipboard-sanitized-write 를 허락한다 — 없으면 Electron 기본(허락)이다", () => {
  const offenders: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const source = readFileSync(new URL(name, dir), "utf8");
    const installs = /setPermission(?:Request|Check)Handler/.test(source);
    if (installs && !source.includes("clipboard-sanitized-write")) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    "권한 핸들러를 달았다면 clipboard-sanitized-write 를 허락해 사진 복사가 죽지 않게 한다",
  );
});
