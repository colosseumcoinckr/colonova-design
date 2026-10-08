import assert from "node:assert/strict";
import { test } from "node:test";
// `../dist` 임포트인 이유: 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가 그 지정을 못 고친다.
import {
  GIT_WRITE_REFUSAL,
  gitGuardHookDecision,
  isShellTool,
  SHELL_TOOLS,
} from "../dist/git-guard.js";
import {
  OUTSIDE_COMMAND_REFUSAL,
  SHELL_MATCHER,
  sessionGuardHookDecision,
  type WriteScope,
} from "../dist/write-guard.js";

// PowerShell 도구(2026-10-08 검토 FIX1) — Windows 에서 Claude 는 `PowerShell` 도구로 명령을 돌릴 수 있다
// (번들 CLI 0.3.263 에서 도구 이름 `PowerShell` · 입력 칸 `command` 를 확인했다). Bash 만 가리키던 훅은 그
// 호출의 git 가드도 쓰기 가드도 못 봤다. 이제 같은 훅이 두 도구를 읽는다. 이 시험은 두 얼굴을 지킨다:
// 거절해야 하는 것, 그리고 Bash 문법의 훑개가 PowerShell 문장을 **과잉으로 막지 않는 것**.

const POSIX: WriteScope = {
  cwd: "/work/clone",
  home: "/work/home",
  tempRoots: ["/work/tmp"],
  platform: "linux",
  realpath: (p) => p,
};

const WINDOWS: WriteScope = {
  cwd: String.raw`C:\Users\김철수\.colonova-design\projects\p\repo`,
  home: String.raw`C:\Users\김철수`,
  platform: "win32",
  tempRoots: [String.raw`C:\Users\김철수\AppData\Local\Temp`],
  realpath: (p) => p,
};

const ps = (command: string, scope: WriteScope = POSIX) =>
  sessionGuardHookDecision("PowerShell", { command }, scope);

const denyReason = (output: ReturnType<typeof ps>) =>
  output.hookSpecificOutput?.permissionDecision === "deny"
    ? output.hookSpecificOutput.permissionDecisionReason
    : null;

test("셸 도구의 matcher — Bash 와 PowerShell 을 이름 목록으로 가리킨다", () => {
  assert.deepEqual([...SHELL_TOOLS], ["Bash", "PowerShell"]);
  assert.equal(SHELL_MATCHER, "Bash|PowerShell");
  assert.match(SHELL_MATCHER, /^[A-Za-z0-9_|]+$/, "CLI 가 정확히 맞추는 모양(글자 · 숫자 · _ · |)");
  assert.equal(isShellTool("Bash"), true);
  assert.equal(isShellTool("PowerShell"), true);
  for (const other of ["Write", "Edit", "Read", "BashOutput", "powershell", "pwsh", ""]) {
    assert.equal(isShellTool(other), false, other);
  }
});

test("PowerShell — git 쓰기는 Bash 와 같은 문장으로 거절하고, 읽기는 지난다", () => {
  for (const command of [
    "git commit -m x",
    "git push origin main",
    "git checkout -b feature",
    "git add .",
    "cd .\\src; git reset --hard",
    "pnpm build; git commit -am done",
    "& git push",
  ]) {
    assert.equal(denyReason(ps(command)), GIT_WRITE_REFUSAL, command);
    assert.deepEqual(
      gitGuardHookDecision("PowerShell", { command }),
      gitGuardHookDecision("Bash", { command }),
      `${command}: 두 도구의 git 판정이 같다`,
    );
  }
  for (const command of ["git status", "git log --oneline -5", "git diff", "git fetch"]) {
    assert.deepEqual(ps(command), {}, command);
  }
  // 읽는 쪽은 도구를 가리지 않는다.
  assert.deepEqual(gitGuardHookDecision("Read", { command: "git commit" }), {});
  assert.deepEqual(gitGuardHookDecision("PowerShell", {}), {});
});

test("PowerShell — 클론 밖으로 가는 리다이렉션 · rm 별칭 · sudo 는 거절한다", () => {
  for (const command of [
    "Write-Output x > ~/notes.txt",
    "Get-Content a.txt >> ~/.claude/settings.json",
    "rm -r -Force ~/Documents",
    "rm -Recurse -Force ~/x",
    "sudo notepad",
  ]) {
    assert.equal(denyReason(ps(command)), OUTSIDE_COMMAND_REFUSAL, command);
  }
  // Windows 모양(드라이브 문자 · 슬래시)에서도 같다.
  assert.equal(
    denyReason(ps("Write-Output x > C:/Users/김철수/notes.txt", WINDOWS)),
    OUTSIDE_COMMAND_REFUSAL,
  );
  assert.equal(
    denyReason(ps("Write-Output x > D:/data/out.txt", WINDOWS)),
    OUTSIDE_COMMAND_REFUSAL,
  );
});

test("PowerShell — 정상 문장은 과잉으로 막지 않는다(Bash 문법 규칙이 PowerShell 에 닿아도)", () => {
  const fine = [
    // 검토가 짚은 네 문장
    "Remove-Item -Recurse -Force node_modules",
    "git status",
    "Get-Content a | Select-String b",
    "$env:FOO='x'; pnpm build",
    // 그 밖의 흔한 PowerShell
    "Get-ChildItem -Path .\\src -Recurse | Where-Object { $_.Length -gt 100 } | Select-Object -First 5",
    "if ($env:CI -eq '1') { Write-Host 'ci' } else { Write-Host 'local' }",
    'Write-Output "a > b"', // 따옴표 안의 `>` 는 리다이렉션이 아니다
    "Write-Output 'git commit'", // 따옴표 안의 git 낱말은 명령이 아니다
    "Set-Content -Path .\\out.txt -Value 'x'",
    "Copy-Item .\\a.txt .\\b.txt",
    "New-Item -ItemType Directory -Force dist | Out-Null",
    "pnpm test 2>&1 | Out-String",
    "pnpm test *> test.log", // 클론 안의 파일로 가는 리다이렉션
    "pnpm build > build.log",
    "Write-Output x > $null",
    "Write-Output x > $env:TEMP\\x.log", // 풀 수 없는 변수는 판정하지 않는다
    "cd .\\packages\\web; pnpm typecheck",
    "Set-Location packages/web ; npm run build",
    "$ErrorActionPreference = 'Stop'; node scripts/check.mjs",
    "& node .\\scripts\\check.mjs --flag",
    "Get-Content package.json | ConvertFrom-Json | Select-Object -ExpandProperty name",
    "rm -r -Force node_modules", // 클론 안의 별칭 삭제
    "rm -Recurse -Force .\\dist",
    "@'\nline > not a redirect\n'@ | Set-Content a.txt", // here-string 안의 `>`
    "git status `\n  --short",
    "Write-Output x > NUL",
  ];
  for (const command of fine) {
    assert.deepEqual(ps(command), {}, `통과해야 한다: ${command}`);
    assert.deepEqual(ps(command, WINDOWS), {}, `Windows 모양에서도 통과해야 한다: ${command}`);
  }
});

test("셸 도구가 아닌 이름은 이 판정의 일이 아니다 — 명령 칸이 있어도 지난다", () => {
  for (const tool of ["Read", "Grep", "BashOutput", "mcp__x__run"]) {
    assert.deepEqual(
      sessionGuardHookDecision(tool, { command: "git commit -m x; echo x > ~/x" }, POSIX),
      {},
      tool,
    );
  }
});

test("Bash 의 판정은 그대로다 — PowerShell 이 더해져도 같은 입력에 같은 답", () => {
  for (const command of [
    "git commit -m x",
    "echo x > ~/.zshrc",
    "rm -rf node_modules",
    "git status",
  ]) {
    assert.deepEqual(
      sessionGuardHookDecision("Bash", { command }, POSIX),
      ps(command),
      `${command}: 두 도구가 같은 command 글을 같은 규칙으로 읽는다`,
    );
  }
});
