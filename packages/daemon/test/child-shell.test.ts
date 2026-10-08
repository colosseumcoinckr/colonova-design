import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteForCmd, shellPlan } from "../dist/child.js";

/**
 * Windows 에서 셸(cmd)을 거치는 호출의 따옴표 (2026-10-07, 베타 준비 분석).
 * Node 의 `shell: true` 는 낱말을 공백으로 이어 붙일 뿐 따옴표를 달지 않는다 — 한글 · 공백이 든
 * 계정 경로(`C:\Users\홍 길동\…\claude.exe`)가 `C:\Users\홍` 에서 갈라졌다. 순수 함수라 어느
 * 기계에서도 시험한다. 실기(진짜 cmd 와 .cmd 셔임) 확인은 베타 Windows 세션 5번이다.
 */

test("공백 · & · 괄호가 든 낱말은 큰따옴표로 감싼다", () => {
  assert.equal(
    quoteForCmd("C:\\Users\\홍 길동\\.local\\bin\\claude.cmd"),
    '"C:\\Users\\홍 길동\\.local\\bin\\claude.cmd"',
  );
  assert.equal(quoteForCmd("a b"), '"a b"');
  assert.equal(quoteForCmd("a&b"), '"a&b"');
  assert.equal(quoteForCmd("a|b"), '"a|b"');
  assert.equal(quoteForCmd("a<b>c"), '"a<b>c"');
  assert.equal(quoteForCmd("C:\\Program Files (x86)\\x.cmd"), '"C:\\Program Files (x86)\\x.cmd"');
  assert.equal(quoteForCmd("a^b"), '"a^b"');
  assert.equal(quoteForCmd("a,b;c=d"), '"a,b;c=d"');
});

test("그대로 읽히는 낱말은 감싸지 않는다 — 한글 경로도 따옴표가 필요 없다", () => {
  assert.equal(quoteForCmd("auth"), "auth");
  assert.equal(quoteForCmd("@scope/pkg"), "@scope/pkg");
  assert.equal(quoteForCmd("C:\\Users\\홍길동\\claude.cmd"), "C:\\Users\\홍길동\\claude.cmd");
  assert.equal(quoteForCmd("--version"), "--version");
});

test("빈 낱말은 빈 따옴표로 남는다 — 사라지면 뒤 인자가 당겨진다", () => {
  assert.equal(quoteForCmd(""), '""');
});

test("끝의 백슬래시는 두 번 적는다 — 닫는 따옴표를 가리지 않게", () => {
  assert.equal(quoteForCmd("C:\\dir with space\\"), '"C:\\dir with space\\\\"');
  assert.equal(quoteForCmd("C:\\dir with space\\\\"), '"C:\\dir with space\\\\\\\\"');
  // 가운데의 백슬래시는 그대로다.
  assert.equal(quoteForCmd("C:\\a b\\c"), '"C:\\a b\\c"');
});

test("따옴표 · 줄바꿈 · NUL 은 안전하게 이스케이프할 길이 없어 던진다", () => {
  assert.throws(() => quoteForCmd('say "hi"'), /실을 수 없는 글자/);
  assert.throws(() => quoteForCmd("a\nb"), /실을 수 없는 글자/);
  assert.throws(() => quoteForCmd("a\rb"), /실을 수 없는 글자/);
  assert.throws(() => quoteForCmd("a\0b"), /실을 수 없는 글자/);
  // 따옴표로 줄을 닫고 명령을 잇는 시도도 같은 길에서 막힌다.
  assert.throws(() => quoteForCmd('x" & calc & "'), /실을 수 없는 글자/);
});

test("Windows 의 .exe 는 셸 없이 직접 — 경로의 공백이 문제가 되지 않는다", () => {
  const exe = "C:\\Users\\홍 길동\\.local\\bin\\claude.exe";
  assert.deepEqual(shellPlan("win32", exe, ["auth", "login"]), {
    command: exe,
    args: ["auth", "login"],
    shell: false,
  });
  // 확장자는 대소문자를 가리지 않는다.
  assert.equal(shellPlan("win32", "C:\\x\\CLAUDE.EXE", []).shell, false);
});

test("Windows 의 .cmd 셔임은 셸을 거치고 명령과 인자를 모두 감싼다", () => {
  const cmd = "C:\\Users\\홍 길동\\AppData\\Local\\pnpm\\pnpm.cmd";
  assert.deepEqual(shellPlan("win32", cmd, ["view", "@scope/pkg", "version"]), {
    command: `"${cmd}"`,
    args: ["view", "@scope/pkg", "version"],
    shell: true,
  });
  assert.deepEqual(shellPlan("win32", "C:\\t\\x.CMD", ["a b", "c&d", ""]), {
    command: "C:\\t\\x.CMD",
    args: ['"a b"', '"c&d"', '""'],
    shell: true,
  });
  assert.equal(shellPlan("win32", "x.bat", []).shell, true);
});

test("확장자 없는 이름과 맨 이름 .cmd 는 셸이 찾게 맡긴다 — 따옴표는 필요한 때만", () => {
  assert.deepEqual(shellPlan("win32", "corepack.cmd", ["enable"]), {
    command: "corepack.cmd",
    args: ["enable"],
    shell: true,
  });
  assert.deepEqual(shellPlan("win32", "claude", ["--version"]), {
    command: "claude",
    args: ["--version"],
    shell: true,
  });
});

test("Windows 가 아니면 있는 그대로다 — 셸도 따옴표도 없다", () => {
  for (const platform of ["darwin", "linux"]) {
    assert.deepEqual(shellPlan(platform, "/Users/hong gil/bin/claude", ["auth", "login"]), {
      command: "/Users/hong gil/bin/claude",
      args: ["auth", "login"],
      shell: false,
    });
    assert.equal(shellPlan(platform, "C:\\x\\pnpm.cmd", ["a b"]).args[0], "a b");
  }
});

test("셸에 실을 수 없는 인자는 계획 단계에서 던진다 — 조용히 깨진 줄을 만들지 않는다", () => {
  assert.throws(() => shellPlan("win32", "x.cmd", ['a"b']), /실을 수 없는 글자/);
  assert.throws(() => shellPlan("win32", 'x".cmd', []), /실을 수 없는 글자/);
  // 직접 띄우는 .exe 는 따옴표가 든 인자도 Node 가 알아서 감싼다 — 던지지 않는다.
  assert.deepEqual(shellPlan("win32", "x.exe", ['a"b']).args, ['a"b']);
});
