// CI-순수-제외 — 진짜 git 과 자식 프로세스를 띄운다. scripts/pure-tests.mjs 가 CI 에서 뺀다(2026-10-24).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { bundledToolEnv } from "../dist/environment.js";
import { RepoWorkspace } from "../dist/repo.js";
import { RepoCore } from "../dist/repo-core.js";

const windows = process.platform === "win32";

// 사용자 Git 설정과 전역 파일을 건드리지 않는다(2026-10-19, Windows 호환성).
function isolatedGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: windows ? "NUL" : "/dev/null",
    GIT_CONFIG_SYSTEM: windows ? "NUL" : "/dev/null",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_PARAMETERS: undefined,
  };
}

function fixtureGit(args: string[], env = isolatedGitEnv()) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.longpaths=true",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Windows fixture",
      "-c",
      "user.email=fixture@example.invalid",
      ...args,
    ],
    { env, windowsHide: true, stdio: "pipe" },
  );
}

test("Windows: 긴 경로가 든 레포를 공백·한글 경로에 복제하고 작업 트리를 읽는다", {
  skip: !windows,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "colonova-windows-repo-"));
  const source = join(root, "원본 레포");
  const destination = join(root, "받은 레포");
  const relative = join(
    ...Array.from({ length: 9 }, (_, i) => `directory-${i}-abcdefghijklmnop`),
    "screen.txt",
  );
  const env = isolatedGitEnv();
  try {
    mkdirSync(source);
    fixtureGit(["init", "-q", "-b", "main", source], env);
    mkdirSync(dirname(join(source, relative)), { recursive: true });
    writeFileSync(join(source, relative), "Windows checkout\n");
    fixtureGit(["-C", source, "add", "."], env);
    fixtureGit(["-C", source, "commit", "-qm", "fixture"], env);
    assert.ok(join(destination, relative).length > 260);
    // 같은 fixture가 긴 경로 대응 없이는 체크아웃에 실패하는지 대조한다.
    assert.throws(
      () => fixtureGit(["-c", "core.longpaths=false", "clone", source, join(root, "control")], env),
      /Filename too long/,
    );
    const core = new RepoCore({ root: destination, url: source, onStatus: () => {} });
    await core.lane.run("hygiene", () => core.git(["clone", source, destination], root, env));
    assert.equal(readFileSync(join(destination, relative), "utf8"), "Windows checkout\n");
    assert.equal((await core.git(["status", "--porcelain"], destination, env)).trim(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows: 시스템 Git PATH 없이도 번들 환경의 자식 명령이 git을 실행한다", {
  skip: !windows,
}, () => {
  // 실기 Git 설치를 MinGit과 같은 cmd/git.exe 배치로 사용한다. 복사·설치하지 않는다.
  const candidates = execFileSync("where.exe", ["git.exe"], {
    encoding: "utf8",
    windowsHide: true,
  })
    .trim()
    .split(/\r?\n/);
  const git = candidates.find((path) => /[\\/]cmd[\\/]git\.exe$/i.test(path));
  assert.ok(git, "cmd/git.exe 배치의 Windows Git이 필요합니다");
  const bin = dirname(dirname(git));
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );
  const tools = bundledToolEnv(bin, "win32", base);
  const env = { ...base, ...tools.env, PATH: [...tools.pathPrefixes, bin].join(delimiter) };
  const result = spawnSync("git.exe", ["--version"], {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^git version /);
});

test("Windows: 임시 원격 레포 복제부터 pnpm 미리보기 HTTP 응답까지 준비한다", {
  skip: !windows,
  timeout: 45_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "colonova-windows-boot-"));
  const source = join(root, "원본 레포");
  const oldClaude = process.env.CLAUDE_CONFIG_DIR;
  const oldLogs = process.env.COLONOVA_DESIGN_LOG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
  process.env.COLONOVA_DESIGN_LOG_DIR = join(root, "logs");
  mkdirSync(process.env.CLAUDE_CONFIG_DIR);
  const workspace = new RepoWorkspace({
    root: join(root, "받은 레포"),
    url: source,
    onStatus: () => {},
    commandsApproved: true,
    active: true,
  });
  try {
    mkdirSync(source);
    fixtureGit(["init", "-q", "-b", "main", source]);
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({ private: true, scripts: { dev: "node preview.cjs" } }),
    );
    writeFileSync(
      join(source, "preview.cjs"),
      [
        "const http = require('node:http');",
        "const server = http.createServer((req, res) => {",
        "  res.setHeader('content-type', 'text/html');",
        "  res.end('<html>Windows preview</html>');",
        "});",
        "server.listen(0, '127.0.0.1', () => {",
        "  console.log('Local: http://127.0.0.1:' + server.address().port);",
        "});",
        "",
      ].join("\n"),
    );
    fixtureGit(["-C", source, "add", "."]);
    fixtureGit(["-C", source, "commit", "-qm", "preview fixture"]);
    const status = await workspace.sync();
    assert.equal(status.phase, "ready", status.detail ?? JSON.stringify(status));
    assert.ok(workspace.previewUrl);
    const response = await fetch(workspace.previewUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Windows preview/);
  } finally {
    try {
      await workspace.stop();
    } finally {
      if (oldClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = oldClaude;
      if (oldLogs === undefined) delete process.env.COLONOVA_DESIGN_LOG_DIR;
      else process.env.COLONOVA_DESIGN_LOG_DIR = oldLogs;
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
