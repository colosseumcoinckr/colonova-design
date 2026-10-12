// 보관 계획의 집행(2026-10-11 피드백) — `describe_changes` 로 적힌 변경마다
// 저장이 실제로 커밋을 나눠 거는지를 진짜 git 으로 본다. 몸통은 PublishCycle,
// 원격 · 클론은 cycle-harness 의 그것이다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PublishCycle } from "../dist/repo-publish.js";
import { makeClone, makeCore, makeRemote } from "./helpers/cycle-harness.ts";

const BRANCH = "colonova-design/김기획/20261011-1";

/** 커밋들의 제목(오래된 것부터). */
function subjects(clonePath: string, ref: string): string[] {
  return execFileSync("git", ["log", "--reverse", "--format=%s", ref], {
    cwd: clonePath,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 제목 → 그 커밋이 담은 경로(가나다순). */
function pathsBySubject(clonePath: string, ref: string): Map<string, string[]> {
  const rows = execFileSync("git", ["log", "--reverse", "--format=%H%x09%s", ref], {
    cwd: clonePath,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("\t");
      return { sha: line.slice(0, at), subject: line.slice(at + 1) };
    });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const paths = execFileSync("git", ["show", "--name-only", "--format=", row.sha], {
      cwd: clonePath,
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
    map.set(row.subject, paths);
  }
  return map;
}

/** 사이클 브랜치와 지저분한 작업 트리 하나 — 화면 파일 둘 · 문서 하나 · 계획 밖 파일. */
async function setup() {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  const core = makeCore(clone, remote, { authorName: () => "김기획" });
  execFileSync("git", ["checkout", "-b", BRANCH], { cwd: clone.path });
  core.setCycle(BRANCH, null);
  mkdirSync(join(clone.path, "screens"), { recursive: true });
  mkdirSync(join(clone.path, "docs"), { recursive: true });
  writeFileSync(join(clone.path, "README.md"), "# 변경된 소개\n");
  writeFileSync(join(clone.path, "screens", "list.tsx"), "export const list = 1;\n");
  writeFileSync(join(clone.path, "screens", "detail.tsx"), "export const detail = 1;\n");
  writeFileSync(join(clone.path, "docs", "guide.md"), "# 검색 안내\n");
  writeFileSync(join(clone.path, "notes.txt"), "계획에 없던 메모\n");
  const publish = new PublishCycle(core, { machineMemo: async () => "회원 관리 화면을 고친다" });
  return { remote, clone, core, publish };
}

test("계획대로 변경마다 커밋하고 그 밖의 변경은 폴백 한 커밋에 담는다", async () => {
  const scene = await setup();
  try {
    const status = await scene.publish.runSave({
      plan: [
        {
          kind: "feat",
          subject: "회원 목록에 이름 검색 추가",
          body: "검색어는 이름에만 걸린다.",
          files: ["screens"],
        },
        { kind: "docs", subject: "검색 사용 안내 추가", files: ["docs/guide.md"] },
      ],
    });
    assert.equal(status.stage, "published");
    assert.equal(status.message, "feat: 회원 목록에 이름 검색 추가");
    assert.deepEqual(subjects(scene.clone.path, BRANCH), [
      "첫 커밋",
      "feat: 회원 목록에 이름 검색 추가",
      "docs: 검색 사용 안내 추가",
      "회원 관리 화면을 고친다",
    ]);
    const paths = pathsBySubject(scene.clone.path, BRANCH);
    assert.deepEqual(paths.get("feat: 회원 목록에 이름 검색 추가"), [
      "screens/detail.tsx",
      "screens/list.tsx",
    ]);
    assert.deepEqual(paths.get("docs: 검색 사용 안내 추가"), ["docs/guide.md"]);
    assert.deepEqual(paths.get("회원 관리 화면을 고친다"), ["README.md", "notes.txt"]);
    // 커밋 본문이 실린다.
    const body = execFileSync(
      "git",
      ["log", "--format=%b", "-1", "--grep=^feat: 회원 목록에 이름 검색 추가$"],
      { cwd: scene.clone.path, encoding: "utf8" },
    ).trim();
    assert.equal(body, "검색어는 이름에만 걸린다.");
    // 작업 트리는 깨끗하다 — 계획 밖의 파일도 버려지지 않았다.
    assert.equal(
      execFileSync("git", ["status", "--porcelain"], { cwd: scene.clone.path, encoding: "utf8" }),
      "",
    );
  } finally {
    scene.clone.dispose();
    scene.remote.dispose();
  }
});

test("계획이 없는 저장은 종전대로 메모 한 커밋이다", async () => {
  const scene = await setup();
  try {
    const status = await scene.publish.runSave({});
    assert.equal(status.stage, "published");
    assert.equal(status.message, "회원 관리 화면을 고친다");
    assert.deepEqual(subjects(scene.clone.path, BRANCH), ["첫 커밋", "회원 관리 화면을 고친다"]);
    assert.deepEqual(pathsBySubject(scene.clone.path, BRANCH).get("회원 관리 화면을 고친다"), [
      "README.md",
      "docs/guide.md",
      "notes.txt",
      "screens/detail.tsx",
      "screens/list.tsx",
    ]);
  } finally {
    scene.clone.dispose();
    scene.remote.dispose();
  }
});

test("계획이 어느 경로에도 못 미치면 한 커밋으로 흘러간다", async () => {
  const scene = await setup();
  try {
    const status = await scene.publish.runSave({
      plan: [{ kind: "fix", subject: "없는 폴더의 변경", files: ["nope"] }],
    });
    assert.equal(status.stage, "published");
    assert.equal(status.message, "회원 관리 화면을 고친다");
    assert.deepEqual(subjects(scene.clone.path, BRANCH), ["첫 커밋", "회원 관리 화면을 고친다"]);
  } finally {
    scene.clone.dispose();
    scene.remote.dispose();
  }
});
