// CI-순수-제외 — 진짜 git 과 자식 프로세스(npm run check)를 쓴다. scripts/pure-tests.mjs 가 CI 에서 뺀다(2026-10-24).
// atomic 분할의 스냅샷 검사 — 임시 인덱스 + checkout-index 로 펼친 트리가
// 실제로 스냅샷의 내용으로 검사되는지, 지원하지 않는 레포는 unavailable 인지,
// 상한 초과가 실패로 보고되고 임시 폴더가 거둬지는지를 본다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateAtomicTree } from "../dist/atomic-check.js";
import { RepoCore } from "../dist/repo-core.js";

const gitAt = (cwd: string) => (args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

interface Scene {
  dir: string;
  repo: string;
  tmpRoot: string;
  core: RepoCore;
  git: (args: string[]) => string;
  validate: (
    tree: string,
    opts?: { timeoutMs?: number },
  ) => Promise<{ status: string; reason?: string }>;
  dispose: () => void;
}

/** 임시 저장소 + RepoCore — url 없는 로컬 클론. 스냅샷 폴더는 tmpRoot 아래. */
function scene(): Scene {
  const dir = mkdtempSync(join(tmpdir(), "colonova-atomic-check-"));
  const repo = join(dir, "repo");
  const tmpRoot = join(dir, "tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const git = gitAt(dir);
  git(["init", "-b", "main", repo]);
  const at = gitAt(repo);
  at(["config", "user.email", "test@colonova-design"]);
  at(["config", "user.name", "테스트"]);
  const core = new RepoCore({ root: repo, url: null, onStatus: () => {} });
  return {
    dir,
    repo,
    tmpRoot,
    core,
    git: at,
    validate: (tree, opts) =>
      core.lane.run("hygiene", () =>
        validateAtomicTree({ core, tree, tmpRoot, timeoutMs: opts?.timeoutMs }),
      ),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** package-lock.json 이 있으므로 매니저는 npm — `npm run check` 가 돈다. */
function writeCheckedRepo(s: Scene, checkJs: string): void {
  writeFileSync(
    join(s.repo, "package.json"),
    JSON.stringify({ name: "atomic-check-fixture", scripts: { check: "node check.js" } }),
  );
  writeFileSync(join(s.repo, "check.js"), checkJs);
  writeFileSync(join(s.repo, "package-lock.json"), "{}");
}

test("첫 커밋은 검사가 실패하고 마지막 커밋은 통과한다 — 스냅샷 내용으로 돈다", async () => {
  const s = scene();
  try {
    writeCheckedRepo(s, "process.exit(1);\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "깨진 커밋"]);
    const badTree = s.git(["rev-parse", "HEAD"]);

    writeCheckedRepo(s, "process.exit(0);\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "고친 커밋"]);
    const goodTree = s.git(["rev-parse", "HEAD"]);

    const first = await s.validate(badTree);
    assert.equal(first.status, "failed");
    assert.equal(first.reason, "check-failed");

    const last = await s.validate(goodTree);
    assert.equal(last.status, "passed");

    assert.equal(readdirSync(s.tmpRoot).length, 0);
  } finally {
    s.dispose();
  }
});

test("check/typecheck 스크립트가 없으면 unavailable — no-check-script", async () => {
  const s = scene();
  try {
    writeFileSync(
      join(s.repo, "package.json"),
      JSON.stringify({ name: "atomic-check-fixture", scripts: {} }),
    );
    writeFileSync(join(s.repo, "package-lock.json"), "{}");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "검사 없는 커밋"]);

    const result = await s.validate(s.git(["rev-parse", "HEAD"]));
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "no-check-script");
    assert.equal(readdirSync(s.tmpRoot).length, 0);
  } finally {
    s.dispose();
  }
});

test("잠금파일이 없으면 unavailable — no-dependency-lock", async () => {
  const s = scene();
  try {
    writeFileSync(
      join(s.repo, "package.json"),
      JSON.stringify({ name: "atomic-check-fixture", scripts: { check: "node check.js" } }),
    );
    writeFileSync(join(s.repo, "check.js"), "process.exit(0);\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "잠금 없는 커밋"]);

    const result = await s.validate(s.git(["rev-parse", "HEAD"]));
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "no-dependency-lock");
    assert.equal(readdirSync(s.tmpRoot).length, 0);
  } finally {
    s.dispose();
  }
});

test("상한을 넘기면 check-timeout 으로 실패하고 임시 폴더를 거둔다", async () => {
  const s = scene();
  try {
    // 벽시계 상한을 진짜로 넘기는 통합 시험 — 자식이 상한보다 오래 살아야
    // 하므로 타이머를 모의로 만들 수 없다.
    writeCheckedRepo(s, "setTimeout(() => {}, 30_000);\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "느린 검사"]);

    const result = await s.validate(s.git(["rev-parse", "HEAD"]), { timeoutMs: 300 });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "check-timeout");
    assert.equal(readdirSync(s.tmpRoot).length, 0);
  } finally {
    s.dispose();
  }
});

test("워크스페이스 링크가 live 소스를 가리키면 unavailable — workspace-links", async () => {
  const s = scene();
  try {
    writeCheckedRepo(s, "process.exit(0);\n");
    // 워크스페이스 패키지 + 그 패키지를 가리키는 node_modules 링크 — 링크를
    // 타면 검사가 중간 사본이 아니라 살아 있는 packages/dep 를 읽는다.
    // node_modules 는 실제 레포처럼 추적 밖에 둔다 — 추적 안에 있으면
    // 스냅샷의 파일이 되어 링크 재사용 단계에 오지 않는다.
    mkdirSync(join(s.repo, "packages", "dep"), { recursive: true });
    writeFileSync(join(s.repo, "packages", "dep", "package.json"), '{"name":"dep"}');
    mkdirSync(join(s.repo, "node_modules"), { recursive: true });
    symlinkSync(join("..", "packages", "dep"), join(s.repo, "node_modules", "dep"), "junction");
    writeFileSync(join(s.repo, ".gitignore"), "node_modules/\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "워크스페이스 커밋"]);

    const result = await s.validate(s.git(["rev-parse", "HEAD"]));
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "workspace-links");
    assert.equal(readdirSync(s.tmpRoot).length, 0);
  } finally {
    s.dispose();
  }
});
