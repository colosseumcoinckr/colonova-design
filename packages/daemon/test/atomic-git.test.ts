// CI-순수-제외 — 진짜 git 임시 저장소를 쓴다. scripts/pure-tests.mjs 가 CI 에서 뺀다(2026-10-24).
// 의미 단위 보관 엔진(atomic-git) — 헝크 역순 묶음, 파일 단위 조각(바이너리 ·
// 모드 · 추가/삭제), 계획 거절(누락 · 중복), HEAD/인덱스/워크트리 경쟁 거절,
// 검증 실패 시 원본 유지, 성공 뒤 인덱스 상태를 실제 git 으로 본다.
// 호출자가 차선을 쥐는 계약이므로 모든 엔진 호출은 lane.run 안에서 돈다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type AtomicSnapshot,
  applyAtomicCommits,
  captureAtomicSnapshot,
  disposeAtomicSnapshot,
  prepareAtomicCommits,
} from "../dist/atomic-git.js";
import { RepoCore } from "../dist/repo-core.js";

const gitAt = (cwd: string) => (args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

interface Scene {
  dir: string;
  repo: string;
  core: RepoCore;
  git: (args: string[]) => string;
  run: <T>(job: () => Promise<T>) => Promise<T>;
  dispose: () => void;
}

/** 임시 저장소 + RepoCore — url 없는 로컬 클론, base 커밋이 main 에 있다. */
function scene(): Scene {
  const dir = mkdtempSync(join(tmpdir(), "colonova-atomic-git-"));
  const repo = join(dir, "repo");
  const git = gitAt(dir);
  git(["init", "-b", "main", repo]);
  const at = gitAt(repo);
  at(["config", "user.email", "test@colonova-design"]);
  at(["config", "user.name", "테스트"]);
  writeFileSync(join(repo, "README.md"), "# 하네스\n");
  at(["add", "-A"]);
  at(["commit", "-m", "첫 커밋"]);
  const core = new RepoCore({ root: repo, url: null, onStatus: () => {} });
  return {
    dir,
    repo,
    core,
    git: at,
    run: (job) => core.lane.run("hygiene", job),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const IDENTITY = ["-c", "user.name=테스트", "-c", "user.email=test@colonova-design"];

test("한 파일의 두 hunk 를 역순 묶음으로 커밋한다 — 삽입/삭제 위치 이동", async () => {
  const s = scene();
  let snapshot: AtomicSnapshot | null = null;
  try {
    writeFileSync(join(s.repo, "f.txt"), "A\nB\nD\nE\nG\nH\n");
    s.git(["add", "f.txt"]);
    s.git(["commit", "-m", "파일 추가"]);
    // 삽입(+C at 3)과 삭제(-G at 6) — 서로 다른 두 hunk.
    writeFileSync(join(s.repo, "f.txt"), "A\nB\nC\nD\nE\nH\n");
    const baseHead = s.git(["rev-parse", "HEAD"]);

    snapshot = await s.run(() => captureAtomicSnapshot(s.core, ["f.txt"]));
    const snap = snapshot;
    const hunks = snap.units.filter((u) => u.path === "f.txt");
    assert.equal(hunks.length, 2);
    assert.ok(hunks.every((u) => u.kind === "hunk"));
    const insert = hunks.find((u) => u.patch.includes("+C"));
    const del = hunks.find((u) => u.patch.includes("-G"));
    assert.ok(insert);
    assert.ok(del);

    // 역순: 삭제를 먼저, 삽입을 나중에 — 각각 독립 커밋이 된다.
    const plan = {
      groups: [
        { message: "지우기", unitIds: [del.id] },
        { message: "더하기", unitIds: [insert.id] },
      ],
    };
    const prepared = await s.run(() =>
      prepareAtomicCommits(s.core, snap, plan, { identityArgs: IDENTITY }),
    );
    assert.equal(prepared.commits.length, 2);
    assert.deepEqual(
      prepared.commits.map((c) => c.message),
      ["지우기", "더하기"],
    );

    await s.run(() => applyAtomicCommits(s.core, snap, prepared));

    // 커밋 사슬: 더하기 → 지우기 → base.
    const tip = s.git(["rev-parse", "HEAD"]);
    assert.equal(tip, prepared.commits.at(1)?.sha);
    assert.equal(s.git(["rev-parse", "HEAD^"]), prepared.commits.at(0)?.sha);
    assert.equal(s.git(["rev-parse", "HEAD^^"]), baseHead);
    assert.deepEqual(s.git(["log", "--format=%s", `${baseHead}..HEAD`]).split("\n"), [
      "더하기",
      "지우기",
    ]);
    // 최종 트리는 스냅샷의 목표와 같고 작업 파일 내용은 그대로다.
    assert.equal(s.git(["rev-parse", "HEAD^{tree}"]), snap.targetTree);
    assert.equal(s.git(["show", "HEAD:f.txt"]), "A\nB\nC\nD\nE\nH");
    // 중간 커밋의 내용 — 지우기 뒤에는 G 만 없고 C 는 아직 없다.
    assert.equal(s.git(["show", "HEAD^:f.txt"]), "A\nB\nD\nE\nH");
    // 성공 뒤 인덱스는 HEAD 와 일치 — 승인 범위의 변경이 남지 않는다.
    assert.equal(s.git(["diff", "--cached", "--name-only", "HEAD"]), "");
  } finally {
    if (snapshot) disposeAtomicSnapshot(snapshot);
    s.dispose();
  }
});

test("바이너리 · 모드 · 추가/삭제는 파일 단위 조각으로 둥근다", async () => {
  const s = scene();
  let snapshot: AtomicSnapshot | null = null;
  try {
    writeFileSync(join(s.repo, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]));
    writeFileSync(join(s.repo, "run.sh"), "#!/bin/sh\necho 구\n");
    writeFileSync(join(s.repo, "gone.txt"), "지울 파일\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "씨앗"]);

    writeFileSync(join(s.repo, "bin.dat"), Buffer.from([0x00, 0x03, 0x04, 0xfe, 0x00]));
    chmodSync(join(s.repo, "run.sh"), 0o755);
    rmSync(join(s.repo, "gone.txt"));
    writeFileSync(join(s.repo, "new.txt"), "새 파일\n");

    snapshot = await s.run(() =>
      captureAtomicSnapshot(s.core, ["bin.dat", "run.sh", "gone.txt", "new.txt"]),
    );
    const snap = snapshot;
    const kinds = new Map(snap.units.map((u) => [u.path, u.kind]));
    assert.equal(kinds.get("bin.dat"), "binary");
    assert.equal(kinds.get("run.sh"), "file");
    assert.equal(kinds.get("gone.txt"), "file");
    assert.equal(kinds.get("new.txt"), "file");

    const plan = {
      groups: [{ message: "파일 단위", unitIds: snap.units.map((u) => u.id) }],
    };
    const prepared = await s.run(() =>
      prepareAtomicCommits(s.core, snap, plan, { identityArgs: IDENTITY }),
    );
    await s.run(() => applyAtomicCommits(s.core, snap, prepared));

    assert.equal(s.git(["rev-parse", "HEAD^{tree}"]), snap.targetTree);
    // 바이너리는 바이트 그대로, 모드는 100755, 삭제는 없고 추가는 있다.
    const show = execFileSync("git", ["show", "HEAD:bin.dat"], { cwd: s.repo });
    assert.deepEqual([...show], [0x00, 0x03, 0x04, 0xfe, 0x00]);
    assert.match(s.git(["ls-tree", "HEAD", "run.sh"]), /^100755 /);
    assert.equal(s.git(["ls-tree", "--name-only", "HEAD", "gone.txt"]), "");
    assert.equal(s.git(["show", "HEAD:new.txt"]), "새 파일");
  } finally {
    if (snapshot) disposeAtomicSnapshot(snapshot);
    s.dispose();
  }
});

test("빠진 조각과 겹친 조각의 계획은 거절한다", async () => {
  const s = scene();
  let snapshot: AtomicSnapshot | null = null;
  try {
    writeFileSync(join(s.repo, "f.txt"), "A\nB\nD\nE\nG\nH\n");
    s.git(["add", "f.txt"]);
    s.git(["commit", "-m", "파일 추가"]);
    writeFileSync(join(s.repo, "f.txt"), "A\nB\nC\nD\nE\nH\n");
    snapshot = await s.run(() => captureAtomicSnapshot(s.core, ["f.txt"]));
    const snap = snapshot;
    assert.equal(snap.units.length, 2);
    const [u1, u2] = snap.units;
    assert.ok(u1);
    assert.ok(u2);

    await assert.rejects(
      s.run(() =>
        prepareAtomicCommits(
          s.core,
          snap,
          { groups: [{ message: "절반만", unitIds: [u1.id] }] },
          { identityArgs: IDENTITY },
        ),
      ),
      /빠진 조각/,
    );
    await assert.rejects(
      s.run(() =>
        prepareAtomicCommits(
          s.core,
          snap,
          {
            groups: [
              { message: "하나", unitIds: [u1.id] },
              { message: "둘", unitIds: [u1.id, u2.id] },
            ],
          },
          { identityArgs: IDENTITY },
        ),
      ),
      /겹치거나 알려지지 않/,
    );
    await assert.rejects(
      s.run(() =>
        prepareAtomicCommits(
          s.core,
          snap,
          {
            groups: [
              { message: "하나", unitIds: [u1.id] },
              { message: "둘", unitIds: [u2.id, "u999"] },
            ],
          },
          { identityArgs: IDENTITY },
        ),
      ),
      /겹치거나 알려지지 않/,
    );
    // 거절은 아무것도 쓰지 않는다 — HEAD 는 그대로.
    assert.equal(s.git(["rev-parse", "HEAD"]), snap.base);
  } finally {
    if (snapshot) disposeAtomicSnapshot(snapshot);
    s.dispose();
  }
});

test("HEAD · 인덱스 · 워크트리가 움직이면 적용을 거절한다", async () => {
  const s = scene();
  let snapshot: AtomicSnapshot | null = null;
  try {
    writeFileSync(join(s.repo, "f.txt"), "하나\n");
    writeFileSync(join(s.repo, "other.txt"), "밖\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "씨앗"]);
    const capture = () => s.run(() => captureAtomicSnapshot(s.core, ["f.txt"]));
    const all = (snap: AtomicSnapshot) => ({
      groups: [{ message: "전부", unitIds: snap.units.map((u) => u.id) }],
    });

    // 1) 워크트리가 움직인 경우 — 캡처 뒤 승인 파일을 고친다.
    writeFileSync(join(s.repo, "f.txt"), "둘\n");
    snapshot = await capture();
    const snap1 = snapshot;
    writeFileSync(join(s.repo, "f.txt"), "셋\n");
    const prepared1 = await s.run(() =>
      prepareAtomicCommits(s.core, snap1, all(snap1), { identityArgs: IDENTITY }),
    );
    await assert.rejects(
      s.run(() => applyAtomicCommits(s.core, snap1, prepared1)),
      /달라졌습니다/,
    );
    disposeAtomicSnapshot(snap1);
    snapshot = null;
    writeFileSync(join(s.repo, "f.txt"), "둘\n");

    // 2) 인덱스가 움직인 경우 — 승인 밖 파일을 캡처 뒤 고쳐 stage 한다.
    //    (내용이 같은 add 는 인덱스를 안 바꾼다 — 지문이 안 움직인다.)
    snapshot = await capture();
    const snap2 = snapshot;
    writeFileSync(join(s.repo, "other.txt"), "밖 변경\n");
    s.git(["add", "other.txt"]);
    const prepared2 = await s.run(() =>
      prepareAtomicCommits(s.core, snap2, all(snap2), { identityArgs: IDENTITY }),
    );
    await assert.rejects(
      s.run(() => applyAtomicCommits(s.core, snap2, prepared2)),
      /달라졌습니다/,
    );
    disposeAtomicSnapshot(snap2);
    snapshot = null;
    s.git(["reset"]);

    // 3) HEAD 가 움직인 경우 — 캡처 뒤에 커밋을 올린다. 경쟁 검사는
    //    prepare 가 아니라 apply 의 assertUnchanged 가 한다.
    snapshot = await capture();
    const snap3 = snapshot;
    writeFileSync(join(s.repo, "other.txt"), "밖 또 변경\n");
    s.git(["add", "other.txt"]);
    s.git(["commit", "-m", "경쟁 커밋"]);
    const prepared3 = await s.run(() =>
      prepareAtomicCommits(s.core, snap3, all(snap3), { identityArgs: IDENTITY }),
    );
    await assert.rejects(
      s.run(() => applyAtomicCommits(s.core, snap3, prepared3)),
      /달라졌습니다/,
    );
    // 거절해도 경쟁 커밋과 인덱스는 그대로다.
    assert.equal(s.git(["log", "-1", "--format=%s"]), "경쟁 커밋");
  } finally {
    if (snapshot) disposeAtomicSnapshot(snapshot);
    s.dispose();
  }
});

test("validateTree 가 던지면 HEAD 와 인덱스가 유지된다", async () => {
  const s = scene();
  let snapshot: AtomicSnapshot | null = null;
  try {
    writeFileSync(join(s.repo, "a.txt"), "가\n");
    writeFileSync(join(s.repo, "b.txt"), "나\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "씨앗"]);
    writeFileSync(join(s.repo, "a.txt"), "가 변경\n");
    writeFileSync(join(s.repo, "b.txt"), "나 변경\n");

    snapshot = await s.run(() => captureAtomicSnapshot(s.core, ["a.txt", "b.txt"]));
    const snap = snapshot;
    const baseHead = s.git(["rev-parse", "HEAD"]);
    const indexBefore = s.git(["write-tree"]);
    const [a, b] = snap.units;
    assert.ok(a);
    assert.ok(b);
    const calls: number[] = [];
    await assert.rejects(
      s.run(() =>
        prepareAtomicCommits(
          s.core,
          snap,
          {
            groups: [
              { message: "첫째", unitIds: [a.id] },
              { message: "둘째", unitIds: [b.id] },
            ],
          },
          {
            identityArgs: IDENTITY,
            validateTree: async (_tree, index) => {
              calls.push(index);
              if (index === 1) throw new Error("검사 실패");
            },
          },
        ),
      ),
      /검사 실패/,
    );
    assert.deepEqual(calls, [0, 1]);
    // 중간 커밋은 만들어졌어도 ref · 인덱스는 움직이지 않는다.
    assert.equal(s.git(["rev-parse", "HEAD"]), baseHead);
    assert.equal(s.git(["write-tree"]), indexBefore);
  } finally {
    if (snapshot) disposeAtomicSnapshot(snapshot);
    s.dispose();
  }
});

test("승인 범위 밖의 staged 내용은 성공 뒤에도 인덱스에 남는다", async () => {
  const s = scene();
  let snapshot: AtomicSnapshot | null = null;
  try {
    writeFileSync(join(s.repo, "f.txt"), "안\n");
    writeFileSync(join(s.repo, "other.txt"), "밖\n");
    s.git(["add", "-A"]);
    s.git(["commit", "-m", "씨앗"]);

    // 승인 밖 파일을 먼저 stage 하고 나서 캡처 — 지문에 같이 들어간다.
    writeFileSync(join(s.repo, "other.txt"), "밖 staged\n");
    s.git(["add", "other.txt"]);
    writeFileSync(join(s.repo, "f.txt"), "안 변경\n");

    snapshot = await s.run(() => captureAtomicSnapshot(s.core, ["f.txt"]));
    const snap = snapshot;
    const prepared = await s.run(() =>
      prepareAtomicCommits(
        s.core,
        snap,
        { groups: [{ message: "전부", unitIds: snap.units.map((u) => u.id) }] },
        { identityArgs: IDENTITY },
      ),
    );
    await s.run(() => applyAtomicCommits(s.core, snap, prepared));

    // 승인 파일은 커밋에 들어갔고, 승인 밖 stage 는 그대로 인덱스에 있다.
    assert.deepEqual(s.git(["diff", "--cached", "--name-only", "HEAD"]).split("\n"), ["other.txt"]);
    assert.equal(s.git(["show", ":other.txt"]), "밖 staged");
    assert.equal(s.git(["show", "HEAD:f.txt"]), "안 변경");
    assert.equal(s.git(["show", "HEAD:other.txt"]), "밖");
  } finally {
    if (snapshot) disposeAtomicSnapshot(snapshot);
    s.dispose();
  }
});
