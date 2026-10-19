import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// preview-claim 은 environment.js 를 부르는 형제라 src 직접 로드가 안 된다 — dist 를 본다.
import {
  commandLineMentions,
  commandLinesCommand,
  descendantsOf,
  parseCommandLines,
  parseProcessSnapshot,
  parseProcessTable,
  pidCommandLines,
  processSnapshotCommand,
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

/**
 * 좀비 미리보기 거둠의 앵커 — Windows 도 명령줄을 읽는다(2026-10-19 실측). 앱이 강제로 꺼진 뒤
 * 남은 next dev 가 `.next/dev/lock` 과 포트를 쥐어 새 서버가 매번 곧장 끝났는데, 옛 코드는 Windows 를 건너뛰었다.
 */
test("명령줄 명령: 셸 없이 PowerShell, UTF-8 출력, 큰따옴표 없이 pid 필터", () => {
  const { command, args } = commandLinesCommand([12, 345, -1, 1.5]);
  assert.equal(command, "powershell");
  const script = args.at(-1) ?? "";
  assert.match(script, /OutputEncoding=\[Text\.Encoding\]::UTF8/);
  assert.match(script, /-Filter 'ProcessId=12 OR ProcessId=345'/);
  // execFile 이 실은 큰따옴표는 PowerShell 이 다시 읽으며 깨진다.
  assert.doesNotMatch(script, /"/);
});

test("명령줄 읽기: BOM · CRLF · 빈 명령줄(권한 밖)을 견딘다", () => {
  const text =
    "\uFEFF101\tC:\\Users\\홍 길동\\repo\\node next dev\r\n202\t\r\n\r\n303\tcmd.exe /d /s /c next dev\r\n";
  const lines = parseCommandLines(text);
  assert.equal(lines.get(101), "C:\\Users\\홍 길동\\repo\\node next dev");
  assert.equal(lines.has(202), false);
  assert.equal(lines.get(303), "cmd.exe /d /s /c next dev");
});

/**
 * 거둠의 표 한 장(2026-10-20, Windows 실측) — 표와 명령줄을 PowerShell 한 번으로 읽는다.
 * 두 번 띄우면 시작마다 미리보기 기동이 약 4.5초 늦었다.
 */
test("표 한 장 명령: pid · 부모 · 명령줄을 UTF-8 탭 구분으로, 큰따옴표 없이", () => {
  const { command, args } = processSnapshotCommand();
  assert.equal(command, "powershell");
  const script = args.at(-1) ?? "";
  assert.match(script, /OutputEncoding=\[Text\.Encoding\]::UTF8/);
  assert.match(script, /ProcessId[\s\S]*ParentProcessId[\s\S]*CommandLine/);
  assert.doesNotMatch(script, /-Filter/);
  assert.doesNotMatch(script, /"/);
});

test("표 한 장 읽기: 트리와 명령줄을 함께, BOM · CRLF · 빈 명령줄 · 끝 탭 없음을 견딘다", () => {
  const text =
    "\uFEFF10\t1\tcmd.exe /d /s /c pnpm run dev\r\n" +
    "11\t10\tC:\\Users\\홍 길동\\repo\\node next dev\r\n" +
    "12\t11\t\r\n" +
    "13\t11\r\n" +
    "garbage line\r\n\r\n" +
    "99\t98\tother.exe\r\n";
  const { children, commandLines } = parseProcessSnapshot(text);
  assert.deepEqual(descendantsOf(children, 10), [11, 12, 13]);
  assert.equal(commandLines.get(10), "cmd.exe /d /s /c pnpm run dev");
  assert.equal(commandLines.get(11), "C:\\Users\\홍 길동\\repo\\node next dev");
  assert.equal(commandLines.has(12), false);
  assert.equal(commandLines.has(13), false);
  assert.equal(commandLines.get(99), "other.exe");
});

test("표 한 장 읽기: 빈 출력(PowerShell 실패)은 빈 표다", () => {
  const { children, commandLines } = parseProcessSnapshot("");
  assert.equal(children.size, 0);
  assert.equal(commandLines.size, 0);
});

test("클론 경로 앵커: Windows 는 대소문자를 가리지 않고 POSIX 는 가린다", () => {
  assert.equal(
    commandLineMentions("node C:\\USERS\\a\\Repo\\x", "c:\\users\\a\\repo", "win32"),
    true,
  );
  assert.equal(commandLineMentions("node /Users/a/Repo/x", "/users/a/repo", "darwin"), false);
  assert.equal(commandLineMentions("node /Users/a/repo/x", "/Users/a/repo", "darwin"), true);
});

test("실제 프로세스의 명령줄을 읽는다 — 한글 · 공백 경로가 깨지지 않는다", {
  timeout: 30_000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "명령줄 앵커-"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", join(dir, "클론")], {
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    assert.ok(child.pid);
    const lines = await pidCommandLines([child.pid, 999_999_999]);
    const line = lines.get(child.pid);
    assert.ok(line, "명령줄을 읽지 못했다");
    assert.ok(
      commandLineMentions(line, dir, process.platform === "win32" ? "win32" : "darwin"),
      line,
    );
    assert.equal(lines.has(999_999_999), false);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
