import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// preview-claim 은 environment.js 를 부르는 형제라 src 직접 로드가 안 된다 — dist 를 본다.
import {
  descendantsOf,
  parseProcessTable,
  processTableCommand,
  treeKillPlan,
} from "../dist/preview-claim.js";

/**
 * 미리보기 서버 트리의 거둠과 읽기 — Windows 의 두 결함 (2026-10-07, 베타 준비 분석).
 * (a) 트리 킬: SIGTERM 경로가 `child.kill` 이라 셸(cmd)만 죽고 dev 서버가 포트를 쥐었다.
 * (b) 프로세스 표: `shell: true` 아래 PowerShell 의 `|` 를 cmd 가 가로채 답이 늘 빈 목록이었다.
 * 코드로 확실한 부분만 순수 함수로 떼어 어느 기계에서도 시험한다 — 실기 확인은 베타 Windows 세션이다.
 */

test("Windows 의 트리 킬은 신호와 무관하게 taskkill /T /F 다", () => {
  for (const signal of ["SIGTERM", "SIGKILL", "SIGINT"] as const) {
    assert.deepEqual(treeKillPlan("win32", 4242, signal), {
      via: "taskkill",
      command: "taskkill",
      args: ["/PID", "4242", "/T", "/F"],
    });
  }
});

test("POSIX 의 트리 킬은 프로세스 그룹에 그 신호를 보낸다", () => {
  assert.deepEqual(treeKillPlan("darwin", 4242, "SIGTERM"), {
    via: "group",
    pid: 4242,
    signal: "SIGTERM",
  });
  assert.deepEqual(treeKillPlan("linux", 4242, "SIGKILL"), {
    via: "group",
    pid: 4242,
    signal: "SIGKILL",
  });
});

test("pid 를 모르면 자식 핸들로 신호를 보낸다 — 어느 플랫폼이든", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    for (const pid of [undefined, 0, -1, Number.NaN, 1.5]) {
      assert.deepEqual(treeKillPlan(platform, pid, "SIGTERM"), {
        via: "child",
        signal: "SIGTERM",
      });
    }
  }
});

test("프로세스 표 명령: Windows 는 셸 없이 PowerShell 한 덩어리 + CSV, POSIX 는 ps", () => {
  const win = processTableCommand("win32");
  assert.equal(win.command, "powershell");
  assert.deepEqual(win.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  // 파이프는 PowerShell 이 읽는 한 낱말(명령 문자열) 안에 있다 — 인자로 흩어지면 안 된다.
  assert.equal(win.args.length, 4);
  const script = win.args[3] ?? "";
  assert.match(script, /^Get-CimInstance Win32_Process \| Select-Object ProcessId,ParentProcessId/);
  assert.match(script, /\| ConvertTo-Csv -NoTypeInformation$/);
  assert.deepEqual(Object.keys(win).sort(), ["args", "command"]); // shell 칸이 없다
  for (const platform of ["darwin", "linux"] as const) {
    assert.deepEqual(processTableCommand(platform), {
      command: "ps",
      args: ["-axo", "pid=,ppid="],
    });
  }
});

test("프로세스 표 읽기: PowerShell CSV(CRLF · 머리줄 · 따옴표)", () => {
  const csv = [
    '"ProcessId","ParentProcessId"',
    '"0","0"',
    '"4","0"',
    '"4120","1000"',
    '"4132","4120"',
    '"5001","4132"',
    "",
  ].join("\r\n");
  const table = parseProcessTable(csv);
  assert.deepEqual(table.get(4120), [4132]);
  assert.deepEqual(table.get(4132), [5001]);
  assert.deepEqual(table.get(1000), [4120]);
  assert.deepEqual(descendantsOf(table, 4120), [4132, 5001]);
});

test("프로세스 표 읽기: PowerShell 표(머리 · 구분선 · 오른쪽 정렬 · CRLF)", () => {
  const table = [
    "",
    "ProcessId ParentProcessId",
    "--------- ---------------",
    "        0               0",
    "        4               0",
    "     4120            1000",
    "     4132            4120",
    "    15001            4132",
    "",
    "",
  ].join("\r\n");
  assert.deepEqual(descendantsOf(parseProcessTable(table), 4120), [4132, 15001]);
});

test("프로세스 표 읽기: POSIX ps 와 BOM · 군더더기 줄", () => {
  const ps = "    1     0\n  311     1\n  312   311\n  313   312\n  900     1\n";
  assert.deepEqual(descendantsOf(parseProcessTable(ps), 311), [312, 313]);
  const noisy = '﻿"ProcessId","ParentProcessId"\r\nWARNING: something\r\n"7","3"\r\n\r\n';
  assert.deepEqual(descendantsOf(parseProcessTable(noisy), 3), [7]);
  // 읽을 수 없는 출력은 빈 표 — 빈 목록이 된다.
  assert.deepEqual(descendantsOf(parseProcessTable(""), 3), []);
  assert.deepEqual(descendantsOf(parseProcessTable("Get-CimInstance : 접근 거부"), 3), []);
});

test("트리 걷기: 손자까지, 자기 자신은 빼고, 순환에도 끝난다", () => {
  const table = new Map<number, number[]>([
    [100, [200, 300]],
    [200, [400]],
    [400, [500]],
    [900, [901]],
    [600, [700]],
    [700, [600]], // 순환 — 표가 어긋난 순간의 모양
  ]);
  assert.deepEqual(descendantsOf(table, 100), [200, 300, 400, 500]);
  assert.deepEqual(descendantsOf(table, 600), [700]);
  assert.deepEqual(descendantsOf(table, 12345), []);
});

test("옛 결함의 재발 방지: 프로세스 표와 포트 스캔은 셸을 거치지 않는다", () => {
  // 옛 판은 `execFile("powershell", […], { shell: windows })` 였다 — cmd 가 `|` 를 가로채 늘 빈 목록.
  const code = readFileSync(new URL("../src/preview-claim.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /shell:/);
});
