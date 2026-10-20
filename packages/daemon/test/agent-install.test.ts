import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeDriver } from "../dist/agent/drivers/claude/driver.js";
import {
  AgentInstall,
  classifyInstallFailure,
  meaningfulInstallLine,
  windowsScriptCommand,
} from "../dist/agent-install.js";

/** Windows 의 설치 대체 명령은 PowerShell 이 돈다(제품의 win32 길) — sh 문법은 그 때만 갈아 끼운다. */
const WIN = process.platform === "win32";

/** 실제 설치 스크립트처럼 한 청크가 한 줄로 흐르는 시험용 설치 명령. */
function emitSteps(winGapMs = 50): string {
  const lines = [
    "\\033[1mSetting up Claude Code...\\033[0m",
    "Installing Claude Code native build latest...",
    "~/.local/bin is not in your PATH",
    'export PATH="$HOME/.local/bin:$PATH"',
    "Installing Claude Code native build latest...",
    "✔ Claude Code successfully installed!",
  ];
  if (WIN) {
    // PowerShell 5.1 에는 printf 가 없다(Git Bash 의 printf.exe 를 빌려 줄마다 프로세스를 띄우면
    // 6 줄이 1 초를 넘겨 스로틀 시험이 흔들렸다). 한 프로세스가 줄마다 바로 쓴다. 파이프 출력은
    // 콘솔 코드 페이지라 `✔` 가 `?` 가 되므로 UTF-8 로 맞추고, ESC 는 [char]27 로 쓴다(2026-10-19).
    const writes = lines.map((line) => {
      const quoted = `'${line.replaceAll("'", "''").replaceAll("\\033", "' + $e + '")}'`;
      return `[Console]::Out.WriteLine(${quoted})`;
    });
    return [
      "$e = [string][char]27",
      "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
      writes.join(winGapMs > 0 ? `; Start-Sleep -Milliseconds ${winGapMs}; ` : "; "),
    ].join("; ");
  }
  return lines.map((line) => `printf '${line}\\n'`).join("; sleep 0.05; ");
}

/** 설치 한 바퀴를 기다린다 — 진행 줄은 순서 그대로 모은다. */
function runInstall(
  deps: ConstructorParameters<typeof AgentInstall>[0],
  kind: "install-claude" | "update-claude" = "install-claude",
): Promise<{
  started: boolean;
  guidance: string;
  ok: boolean;
  detail: string;
  lines: string[];
  executable: string | null | undefined;
}> {
  const { promise, resolve } = Promise.withResolvers<{
    ok: boolean;
    detail: string;
    lines: string[];
    executable: string | null | undefined;
  }>();
  const lines: string[] = [];
  const installer = new AgentInstall(deps);
  const started = installer.start(kind, {
    onProgress: (line) => lines.push(line),
    onDone: (ok, detail, executable) => resolve({ ok, detail, lines, executable }),
  });
  if (!started.started) resolve({ ok: false, detail: started.guidance, lines, executable: null });
  return promise.then((result) => ({ ...started, ...result }));
}

// ---------------------------------------------------------------------------
// 실패 분류 — 네 가지 이유의 표본 (mac · Windows 문장 섞어서)
// ---------------------------------------------------------------------------

test("실패 분류: 네트워크 — mac curl 문장과 Windows PowerShell 문장", () => {
  const mac = classifyInstallFailure("curl: (6) Could not resolve host: claude.ai\n", 6, "darwin");
  assert.equal(mac.reason, "network");
  assert.equal(mac.detail, "인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
  const win = classifyInstallFailure(
    "irm : The remote name could not be resolved 'claude.ai'",
    1,
    "win32",
  );
  assert.equal(win.reason, "network");
  // 문장 없이 curl 의 종료 코드만으로도 분류된다(7 = 연결 실패).
  const bare = classifyInstallFailure("", 7, "darwin");
  assert.equal(bare.reason, "network");
});

test("실패 분류: 회사 PC 정책 — 안내 문장과 복사용 한 줄이 함께", () => {
  const ps = classifyInstallFailure(
    "install.ps1 cannot be loaded because running scripts is disabled on this system.",
    1,
    "win32",
  );
  assert.equal(ps.reason, "policy");
  assert.ok(ps.detail.includes("IT 담당자에게 보내 주세요"));
  assert.ok(ps.detail.includes("ColoNova Design 이 Claude Code 를 사용자 폴더에"));
  const denied = classifyInstallFailure(
    "cp: /Users/x/.local/bin/claude: Access is denied",
    1,
    "darwin",
  );
  assert.equal(denied.reason, "policy");
  const forbidden = classifyInstallFailure("HTTP 403 Forbidden", 1, "win32");
  assert.equal(forbidden.reason, "policy");
});

test("실패 분류: 디스크 공간", () => {
  const mac = classifyInstallFailure("cp: write error: No space left on device", 1, "darwin");
  assert.equal(mac.reason, "disk");
  const win = classifyInstallFailure(
    "Expand-Archive : There is not enough space on the disk.",
    1,
    "win32",
  );
  assert.equal(win.reason, "disk");
});

test("실패 분류: 그 밖의 실패 — 마지막 의미 있는 줄이 딸린다", () => {
  const withLine = classifyInstallFailure(
    "stdbuf failed\nclaude-installer: unknown flag --x",
    2,
    "darwin",
  );
  assert.equal(withLine.reason, "other");
  assert.ok(withLine.detail.includes("claude-installer: unknown flag --x"));
  const bare = classifyInstallFailure("", 1, "win32");
  assert.equal(bare.reason, "other");
  assert.equal(bare.detail, "설치가 실패했어요 — 다시 시도해 주세요.");
});

// ---------------------------------------------------------------------------
// 진행 줄 다듬기
// ---------------------------------------------------------------------------

test("진행 줄: ANSI 색 코드를 지우고 마지막 의미 있는 줄을 내놓는다", () => {
  const colored = "\u001b[1mSetting up Claude Code...\u001b[0m";
  assert.equal(meaningfulInstallLine(colored), "Setting up Claude Code...");
});

test("진행 줄: PATH 안내 문단을 버린다 — 머리 줄 `⚠ Setup notes:` 부터", () => {
  const output = [
    "Installing Claude Code native build latest...",
    "⚠ Setup notes:",
    "~/.local/bin is not in your PATH",
    "You should update your shell config to include it",
    'export PATH="$HOME/.local/bin:$PATH"',
    "✔ Claude Code successfully installed!",
    "",
  ].join("\n");
  assert.equal(meaningfulInstallLine(output), "✔ Claude Code successfully installed!");
});

test("진행 줄: 미완의 마지막 줄은 완결된 것만 본다", () => {
  assert.equal(meaningfulInstallLine("first line\npartial wi", false), "first line");
  assert.equal(meaningfulInstallLine("first line\npartial wi", true), "partial wi");
});

test("진행 방송: ANSI 제거 · PATH 문단 버림 · 같은 줄 반복 억제가 한 자리에서", async () => {
  // 줄마다 끊어 출력 — 실제 설치 스크립트처럼 한 청크가 한 줄이다. 간격 0 을
  // 주어 스로틀을 끄고 거름·억제만 본다(스로틀은 아래 테스트의 몫).
  const result = await runInstall({
    env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: emitSteps() },
    resolveClaude: async () => "/usr/local/bin/claude",
    progressIntervalMs: 0,
  });
  assert.deepEqual(result.lines, [
    "Setting up Claude Code...",
    "Installing Claude Code native build latest...",
    "✔ Claude Code successfully installed!",
  ]);
  assert.equal(result.ok, true);
});

test("진행 방송: 기본 간격(1초)에서는 1초에 한 번 이하 — 끝의 flush 가 마지막 줄을 내보낸다", async () => {
  // Windows 는 간격 없이 한꺼번에 쓴다. 부하가 큰 PC 에서는 PowerShell 의 50ms 쉼이 1초를 넘겨
  // 가운데 줄이 정당하게 나갔다(2026-10-19 전체 시험). 1초 안에 온 줄을 접는지는 그대로 본다.
  const result = await runInstall({
    env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: emitSteps(0) },
    resolveClaude: async () => "/usr/local/bin/claude",
  });
  // 6 줄이 0.05 초 간격으로 흐르면 즉시 나가는 것은 첫 줄뿐이고, 나머지는
  // 스로틀에 붙들렸다가 끝(finish 의 flush)에서 마지막 것만 나간다.
  assert.deepEqual(result.lines, [
    "Setting up Claude Code...",
    "✔ Claude Code successfully installed!",
  ]);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// 성공 판정 — 종료 코드와 실행 파일의 실존이 함께 판정한다
// ---------------------------------------------------------------------------

test("성공 판정: exit 0 + 실행 파일 있음 → ok", async () => {
  const result = await runInstall({
    env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: "exit 0" },
    resolveClaude: async () => "/opt/homebrew/bin/claude",
  });
  assert.equal(result.ok, true);
  assert.equal(result.detail, "Claude Code 설치가 끝났어요.");
});

test("성공 판정: exit 0 인데 실행 파일이 없으면 실패 문장", async () => {
  const result = await runInstall({
    env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: "exit 0" },
    resolveClaude: async () => null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.detail, "설치가 끝났지만 실행 파일을 찾지 못했어요 — 다시 시도해 주세요.");
});

test("성공 판정: exit 7 은 네트워크 실패로 분류된다", async () => {
  const result = await runInstall({
    env: {
      ...process.env,
      COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: WIN
        ? "[Console]::Error.WriteLine('curl: (7) Failed to connect'); exit 7"
        : "echo 'curl: (7) Failed to connect' >&2; exit 7",
    },
    resolveClaude: async () => "/opt/homebrew/bin/claude",
  });
  assert.equal(result.ok, false);
  assert.equal(result.detail, "인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
});

test("시간 상한: 넘으면 자식을 끊고 실패 문장으로 끝난다", async () => {
  const result = await runInstall({
    env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: "sleep 5" },
    resolveClaude: async () => "/opt/homebrew/bin/claude",
    timeoutMs: 400,
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.detail,
    "설치가 너무 오래 걸려 멈췄어요 — 네트워크를 확인하고 다시 시도해 주세요.",
  );
});

test("종류마다 하나씩: 도는 중의 두 번째 시작은 거절된다", () => {
  const installer = new AgentInstall({
    env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: "sleep 5" },
    timeoutMs: 5_000,
  });
  const first = installer.start("install-claude", { onProgress: () => {}, onDone: () => {} });
  const second = installer.start("install-claude", { onProgress: () => {}, onDone: () => {} });
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(second.guidance, "설치가 이미 진행 중이에요 — 잠시만 기다려 주세요.");
  installer.stop();
});

test("실행 파일 자리는 주입된 해석 함수가 정한다 — 임시 폴더로", async () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-agent-install-test-"));
  try {
    const fake = join(dir, "claude");
    writeFileSync(fake, "#!/bin/sh\n", { mode: 0o755 });
    const result = await runInstall({
      env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: "exit 0" },
      resolveClaude: async () => fake,
    });
    assert.equal(result.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("설치 성공 뒤 loginCommand 가 살아난다 — 처음엔 없음, 성공 판정의 경로가 데몬의 자리를 갈아끼운다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-agent-install-test-"));
  try {
    const fake = join(dir, "claude");
    writeFileSync(fake, "#!/bin/sh\n", { mode: 0o755 });
    // 데몬이 시작 때 한 번 푼 자리 — 설치 전엔 비어 있다(2026-09-24 버그의 현장).
    let resolved: string | null = null;
    const driver = new ClaudeDriver(() => resolved);
    assert.equal(driver.loginCommand(), null);
    const result = await runInstall({
      env: { ...process.env, COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: "exit 0" },
      resolveClaude: async () => fake,
    });
    assert.equal(result.ok, true);
    assert.equal(result.executable, fake);
    // dispatch 의 몫: 성공 판정에 쓴 경로를 방송 전에 데몬의 자리에 심는다.
    resolved = result.executable ?? null;
    const command = driver.loginCommand();
    assert.ok(command);
    assert.equal(command.command, fake);
    assert.deepEqual(command.args, ["auth", "login"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 업데이트(PLAN-UI U12) — 같은 진행기, 같은 구멍으로
// ---------------------------------------------------------------------------

test("update-claude: 스크립트에 latest 를 건네고, 자식은 자기 업데이트가 꺼진 채로 돈다", async () => {
  const installer = new AgentInstall({
    env: {
      ...process.env,
      DISABLE_AUTOUPDATER: "",
      COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: WIN
        ? "if ($args[0] -ne 'latest') { exit 3 }; if ($env:DISABLE_AUTOUPDATER -ne '1') { exit 4 }; Write-Output \"target $($args[0])\""
        : 'test "$1" = latest || exit 3; test "$DISABLE_AUTOUPDATER" = 1 || exit 4; echo "target $1"',
    },
    resolveClaude: async () => "/home/u/.local/share/claude/versions/2.2.0",
    progressIntervalMs: 0,
  });
  const { promise, resolve } = Promise.withResolvers<{
    ok: boolean;
    detail: string;
    executable: string | null | undefined;
  }>();
  const lines: string[] = [];
  const started = installer.start("update-claude", {
    onProgress: (line) => lines.push(line),
    onDone: (ok, detail, executable) => resolve({ ok, detail, executable }),
  });
  assert.equal(started.started, true);
  assert.equal(started.guidance, "Claude Code 업데이트를 시작했어요 — 진행 상황을 보여 드릴게요.");
  const result = await promise;
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.detail, "Claude Code 를 새 버전으로 바꿨어요.");
  assert.equal(result.executable, "/home/u/.local/share/claude/versions/2.2.0");
  assert.deepEqual(lines, ["target latest"]);
});

test("install-claude: 설치는 대상을 건네지 않는다 — 스크립트의 기본 그대로", async () => {
  const result = await runInstall({
    env: {
      ...process.env,
      COLONOVA_DESIGN_CLAUDE_INSTALL_CMD: WIN
        ? "if ($args.Count -ne 0) { exit 3 }; if ($env:DISABLE_AUTOUPDATER -ne '1') { exit 4 }"
        : 'test -z "$1" || exit 3; test "$DISABLE_AUTOUPDATER" = 1',
    },
    resolveClaude: async () => "/usr/local/bin/claude",
  });
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.detail, "Claude Code 설치가 끝났어요.");
});

test("Windows 설치 스크립트는 UTF-8 출력으로 부르고 스크립트의 종료 코드를 그대로 돌려준다(2026-10-19)", (t) => {
  assert.equal(
    windowsScriptCommand("C:\\Temp\\it's 설치.ps1", ["-Target", "latest"]),
    [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "& 'C:\\Temp\\it''s 설치.ps1' -Target 'latest'",
      "exit $LASTEXITCODE",
    ].join("\n"),
  );
  if (process.platform !== "win32") {
    t.skip("PowerShell 실행은 Windows 에서만 본다");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "설치 it's-"));
  try {
    const script = join(dir, "install.ps1");
    // install.ps1 처럼 param 블록으로 시작한다 — 앞에 줄을 넣으면 깨지는 모양.
    writeFileSync(
      script,
      '\uFEFFparam([string]$Target = "stable")\nWrite-Output "대상 $Target ✔"\n' +
        'if ($Target -eq "latest") { exit 7 }\n',
      "utf8",
    );
    const run = (args: string[]) =>
      spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          windowsScriptCommand(script, args),
        ],
        { encoding: "utf8", windowsHide: true },
      );
    const latest = run(["-Target", "latest"]);
    assert.equal(latest.status, 7, latest.stderr);
    assert.equal(latest.stdout.trim(), "대상 latest ✔");
    const plain = run([]);
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout.trim(), "대상 stable ✔");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
