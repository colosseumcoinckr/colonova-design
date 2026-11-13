// CI-순수-제외 — 진짜 git, 실제 smudge 필터 자식(node), pgrep 을 쓴다.
// scripts/pure-tests.mjs 가 CI 에서 뺀다(2026-10-24).
// git materialize 의 벽시계 상한 — checkout-index 가 smudge 필터에서 멈추면
// 상한 뒤에 반환하고, 자식 트리가 죽고, 임시 폴더가 거둬지고, live
// HEAD/인덱스/워크트리가 그대로인지 본다. 좁은 시험 하나는 core.capture 의
// 여섯 번째 인자(hard timeout)를 자식 프로세스로 직접 친다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  dispose: () => void;
}

/** 임시 저장소 + RepoCore — url 없는 로컬 클론, 스냅샷 폴더는 tmpRoot 아래. */
function scene(): Scene {
  const dir = mkdtempSync(join(tmpdir(), "colonova-atomic-timeout-"));
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
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("capture 의 timeoutMs 는 멈춘 자식을 끝내고 stalled 로 돌린다", async () => {
  const s = scene();
  try {
    const started = Date.now();
    const result = await s.core.capture(
      "node",
      {
        // validateAtomicTree 가 git 에 주는 것과 같은 모양 — detached 로
        // 트리 킬이 그룹에 닿게 한다(POSIX).
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
      ["-e", "setTimeout(()=>{},30000)"],
      undefined,
      false,
      300,
    );
    assert.equal(result.stalled, true);
    assert.notEqual(result.code, 0);
    // kill 요청이 아니라 close 까지 확인하고 돌아와도 상한 근처다.
    assert.ok(Date.now() - started < 15_000, "상한 훨씬 뒤까지 붙잡히면 안 된다");
  } finally {
    s.dispose();
  }
});

test("smudge 에서 멈춘 checkout-index 도 상한 뒤 돌아오고 live 는 그대로다", async () => {
  const s = scene();
  try {
    // .gitattributes + smudge 필터 — checkout-index 가 이 파일을 쓸 때
    // 필터 자식(node -e setTimeout)이 영원히 자서 checkout 이 멈춘다.
    writeFileSync(join(s.repo, ".gitattributes"), "*.txt filter=sleep\n");
    writeFileSync(join(s.repo, "f.txt"), "본문\n");
    writeFileSync(
      join(s.repo, "package.json"),
      JSON.stringify({ name: "atomic-timeout-fixture", scripts: { check: "node check.js" } }),
    );
    writeFileSync(join(s.repo, "check.js"), "process.exit(0);\n");
    writeFileSync(join(s.repo, "package-lock.json"), "{}");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "필터 레포"]);
    // 필터 인자의 별명으로 자식을 pgrep 할 수 있게 한다.
    s.git([
      "config",
      "filter.sleep.smudge",
      'node -e "setTimeout(()=>{},30000)" atomic-timeout-marker',
    ]);
    const headBefore = s.git(["rev-parse", "HEAD"]);
    const indexBefore = s.git(["write-tree"]);
    const statusBefore = s.git(["status", "--porcelain"]);

    const started = Date.now();
    const result = await s.core.lane.run("hygiene", () =>
      validateAtomicTree({ core: s.core, tree: headBefore, tmpRoot: s.tmpRoot, timeoutMs: 400 }),
    );
    const elapsed = Date.now() - started;

    // 멈춘 채 붙잡히지 않고 돌아온다 — 통과로 읽히면 절대 안 된다. 멈춘
    // git 은 capture 가 상한에 죽이고, deadline 경과로 check-timeout 이다.
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "check-timeout");
    assert.ok(elapsed < 15_000, `상한 훨씬 뒤까지 붙잡혔다: ${elapsed}ms`);

    // 자식 트리가 죽었다 — 필터 node 가 살아 있으면 pgrep 이 잡는다(POSIX).
    if (process.platform !== "win32") {
      assert.throws(() => execFileSync("pgrep", ["-f", "atomic-timeout-marker"]));
    }

    // 임시 폴더는 거둬졌고 다시 생기지 않는다 — 죽은 checkout-index 가
    // 지워진 자리에 되살아나 쓰는 일이 없다.
    assert.equal(readdirSync(s.tmpRoot).length, 0);

    // live HEAD · 인덱스 · 워크트리는 그대로다.
    assert.equal(s.git(["rev-parse", "HEAD"]), headBefore);
    assert.equal(s.git(["write-tree"]), indexBefore);
    assert.equal(s.git(["status", "--porcelain"]), statusBefore);
  } finally {
    s.dispose();
  }
});
