/** 의미 단위 Git 보관. 호출자는 프로젝트 git-lane을 잡는다. 작업 파일은 쓰지 않는다. */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  AtomicPlan,
  AtomicSnapshot,
  AtomicUnit,
  PreparedAtomicCommits,
} from "./atomic-types.js";
import type { RepoCore } from "./repo-core.js";

/** 필터나 훅이 멈춰도 보관 차선을 영원히 붙잡지 않는다. */
function git(
  core: RepoCore,
  args: string[],
  cwd = core.root,
  env: NodeJS.ProcessEnv = {},
  binary = false,
): Promise<string> {
  return core.git(args, cwd, env, binary, 30_000);
}

const JOURNAL = "colonova-atomic-save.json";
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const indexHash = (path: string) => (existsSync(path) ? hash(readFileSync(path)) : "absent");

/** RepoCore의 텍스트 출력 상한으로 패치가 잘리지 않게 바이트 경로를 쓴다. */
async function full(core: RepoCore, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return Buffer.from(await git(core, args, core.root, env, true), "base64").toString("utf8");
}
async function indexPathOf(core: RepoCore): Promise<string> {
  return resolve(core.root, (await git(core, ["rev-parse", "--git-path", "index"])).trim());
}

/** 우리 표식이 있고 소유 프로세스가 끝난 임시 인덱스만 거둔다. */
function cleanAbandonedSnapshots(parent: string): void {
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("colonova-atomic-")) continue;
    const directory = join(parent, entry.name);
    try {
      const owner = JSON.parse(readFileSync(join(directory, "owner.json"), "utf8"));
      if (owner.kind !== "colonova-atomic" || !Number.isSafeInteger(owner.pid) || owner.pid < 1)
        continue;
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH")
          rmSync(directory, { recursive: true, force: true });
      }
    } catch {
      /* 소유자를 확인하지 못하면 그대로 둔다. */
    }
  }
}

/** 마지막 ref 이동 뒤 죽은 경우만 우리 소유의 index 전환을 마친다. 남의 lock은 만지지 않는다. */
export async function recoverAtomicSave(core: RepoCore): Promise<void> {
  const indexPath = await indexPathOf(core);
  cleanAbandonedSnapshots(dirname(indexPath));
  const journalPath = join(dirname(indexPath), JOURNAL);
  if (!existsSync(journalPath)) return;
  const record = JSON.parse(readFileSync(journalPath, "utf8")) as {
    pid: number;
    base: string;
    tip: string;
    ref: string;
    lockHash: string;
  };
  if (
    !Number.isSafeInteger(record.pid) ||
    record.pid < 1 ||
    !/^[a-f0-9]{40,64}$/.test(record.base) ||
    !/^[a-f0-9]{40,64}$/.test(record.tip) ||
    typeof record.ref !== "string" ||
    !record.ref.startsWith("refs/heads/") ||
    !/^[a-f0-9]{64}$/.test(record.lockHash)
  ) {
    throw new Error("보관 복구 기록을 읽지 못했습니다.");
  }
  if (record.pid !== process.pid) {
    try {
      process.kill(record.pid, 0);
      throw new Error("다른 보관이 진행 중입니다.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const lock = `${indexPath}.lock`;
  const head = (await git(core, ["rev-parse", "HEAD"])).trim();
  const ref = (await git(core, ["symbolic-ref", "HEAD"])).trim();
  if (ref !== record.ref || (head !== record.base && head !== record.tip)) {
    throw new Error("보관 복구 전에 작업 위치가 달라졌습니다.");
  }
  if (existsSync(lock)) {
    if (indexHash(lock) !== record.lockHash)
      throw new Error("다른 작업의 잠금은 복구할 수 없습니다.");
    if (head === record.tip) renameSync(lock, indexPath);
    else rmSync(lock);
  } else if (head === record.tip && indexHash(indexPath) !== record.lockHash) {
    throw new Error("보관된 내용과 작업 목록이 달라 복구하지 않았습니다.");
  }
  rmSync(journalPath);
}

async function captureTree(
  core: RepoCore,
  base: string,
  paths: string[],
  index: string,
): Promise<string> {
  const env = { GIT_INDEX_FILE: index };
  await git(core, ["read-tree", base], core.root, env);
  await git(core, ["add", "-A", "--", ...paths.map((path) => `:(literal)${path}`)], core.root, env);
  return (await git(core, ["write-tree"], core.root, env)).trim();
}

/** 한 파일의 독립 hunk를 나눈다. 복잡한 메타 변경은 전체 파일 단위다. */
function unitsOf(path: string, patch: string, nextId: () => string): AtomicUnit[] {
  const binary = patch.includes("GIT binary patch") || patch.includes("Binary files ");
  const hunks = [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@.*$/gm)];
  const whole =
    binary ||
    /^(?:new file|deleted file|old mode|new mode|rename |copy )/m.test(patch) ||
    hunks.length <= 1 ||
    hunks.length > 32;
  if (whole)
    return [
      {
        id: nextId(),
        path,
        patch,
        kind: binary ? "binary" : "file",
        summary: `${path} (${Buffer.byteLength(patch)} bytes)`,
      },
    ];
  const header = patch.slice(0, hunks[0]?.index);
  return hunks.map((match, i) => ({
    id: nextId(),
    path,
    kind: "hunk",
    patch: header + patch.slice(match.index, hunks[i + 1]?.index ?? patch.length),
    summary: match[0],
  }));
}

export async function captureAtomicSnapshot(
  core: RepoCore,
  paths: string[],
): Promise<AtomicSnapshot> {
  await recoverAtomicSave(core);
  if (
    paths.length === 0 ||
    paths.some(
      (p) =>
        !p ||
        p.startsWith("/") ||
        p.split(/[\\/]/).some((s) => s === ".." || s === ".git") ||
        /[\0\r\n]/.test(p),
    )
  ) {
    throw new Error("보관할 파일 범위를 확인하지 못했습니다.");
  }
  const indexPath = await indexPathOf(core);
  const fingerprint = indexHash(indexPath);
  const base = (await git(core, ["rev-parse", "HEAD"])).trim();
  const ref = (await git(core, ["symbolic-ref", "HEAD"])).trim();
  const baseTree = (await git(core, ["rev-parse", `${base}^{tree}`])).trim();
  const directory = mkdtempSync(join(dirname(indexPath), "colonova-atomic-"));
  try {
    writeFileSync(
      join(directory, "owner.json"),
      JSON.stringify({ kind: "colonova-atomic", pid: process.pid }),
    );
    const targetIndex = join(directory, "target-index");
    const targetTree = await captureTree(core, base, paths, targetIndex);
    const changed = (
      await full(core, ["diff", "--no-renames", "--name-only", "-z", baseTree, targetTree])
    )
      .split("\0")
      .filter(Boolean);
    const units: AtomicUnit[] = [];
    let id = 0;
    for (const path of changed) {
      const patch = await full(core, [
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--binary",
        "--full-index",
        "--unified=0",
        baseTree,
        targetTree,
        "--",
        `:(literal)${path}`,
      ]);
      units.push(...unitsOf(path, patch, () => `u${++id}`));
    }
    const snapshot = {
      base,
      baseTree,
      targetTree,
      ref,
      paths,
      units,
      directory,
      indexPath,
      indexHash: fingerprint,
      targetIndex,
    };
    await assertUnchanged(core, snapshot);
    return snapshot;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** 누적 조각을 원래 순서의 파일별 패치로 만든다. 새 줄번호도 선택한 구간만 반영한다. */
function cumulativePatch(units: AtomicUnit[], chosen: Set<string>): string {
  const files = new Map<string, AtomicUnit[]>();
  for (const unit of units)
    if (chosen.has(unit.id)) {
      const list = files.get(unit.path) ?? [];
      list.push(unit);
      files.set(unit.path, list);
    }
  let output = "";
  for (const selected of files.values()) {
    const firstUnit = selected[0];
    if (!firstUnit) continue;
    if (firstUnit.kind !== "hunk") {
      output += firstUnit.patch;
      continue;
    }
    const first = firstUnit.patch.indexOf("\n@@") + 1;
    output += firstUnit.patch.slice(0, first);
    let delta = 0;
    for (const unit of selected) {
      const at = unit.patch.indexOf("\n@@") + 1;
      const body = unit.patch
        .slice(at)
        .replace(
          /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
          (_line, old, oldCount, _new, newCount) => {
            const a = Number(oldCount ?? 1),
              b = Number(newCount ?? 1);
            const newStart = Number(old) + delta + (a === 0 ? 1 : 0) - (b === 0 ? 1 : 0);
            delta += b - a;
            return `@@ -${old},${a} +${newStart},${b} @@`;
          },
        );
      output += body;
    }
  }
  return output;
}

export async function prepareAtomicCommits(
  core: RepoCore,
  snapshot: AtomicSnapshot,
  plan: AtomicPlan,
  options: {
    identityArgs: string[];
    validateTree?: (tree: string, index: number, total: number) => Promise<void>;
  },
): Promise<PreparedAtomicCommits> {
  const ids = new Set(snapshot.units.map((unit) => unit.id));
  const chosen = new Set<string>();
  if (!plan.groups.length) throw new Error("보관 묶음이 없습니다.");
  for (const group of plan.groups) {
    if (!group.unitIds.length || !group.message.trim() || /[\r\n\0]/.test(group.message))
      throw new Error("보관 묶음의 제목이나 내용이 비었습니다.");
    for (const id of group.unitIds) {
      if (!ids.has(id) || chosen.has(id))
        throw new Error("보관 조각이 겹치거나 알려지지 않았습니다.");
      chosen.add(id);
    }
  }
  if (chosen.size !== ids.size) throw new Error("보관에서 빠진 조각이 있습니다.");
  chosen.clear();
  const commits: PreparedAtomicCommits["commits"] = [];
  const trees: string[] = [];
  let parent = snapshot.base;
  for (const [i, group] of plan.groups.entries()) {
    for (const id of group.unitIds) chosen.add(id);
    const index = join(snapshot.directory, `group-${i}.index`);
    const patch = join(snapshot.directory, `group-${i}.patch`);
    writeFileSync(patch, cumulativePatch(snapshot.units, chosen));
    const env = { GIT_INDEX_FILE: index };
    await git(core, ["read-tree", snapshot.baseTree], core.root, env);
    await git(
      core,
      ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", patch],
      core.root,
      env,
    );
    const tree = (await git(core, ["write-tree"], core.root, env)).trim();
    if (tree === (trees.at(-1) ?? snapshot.baseTree)) throw new Error("빈 보관 묶음입니다.");
    if (i === plan.groups.length - 1 && tree !== snapshot.targetTree)
      throw new Error("나눈 변경이 원래 변경과 다릅니다.");
    await options.validateTree?.(tree, i, plan.groups.length);
    const sha = (
      await git(core, [
        ...options.identityArgs,
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        group.message,
      ])
    ).trim();
    commits.push({
      sha,
      message: group.message,
      files: [
        ...new Set(
          snapshot.units.filter((unit) => group.unitIds.includes(unit.id)).map((unit) => unit.path),
        ),
      ],
    });
    trees.push(tree);
    parent = sha;
  }
  return { commits, trees };
}

async function assertUnchanged(core: RepoCore, snapshot: AtomicSnapshot): Promise<void> {
  const head = (await git(core, ["rev-parse", "HEAD"])).trim();
  const ref = (await git(core, ["symbolic-ref", "HEAD"])).trim();
  if (
    head !== snapshot.base ||
    ref !== snapshot.ref ||
    indexHash(snapshot.indexPath) !== snapshot.indexHash
  )
    throw new Error("보관 중 작업 위치나 목록이 달라졌습니다. 다시 보관해 주세요.");
  const now = await captureTree(
    core,
    snapshot.base,
    snapshot.paths,
    join(snapshot.directory, "verify-index"),
  );
  if (now !== snapshot.targetTree)
    throw new Error("보관 중 파일 내용이 달라졌습니다. 다시 보관해 주세요.");
}

/** 모든 중간 객체를 만든 뒤 ref를 한 번만 옮긴다. 기존 작업 파일은 그대로 둔다. */
export async function applyAtomicCommits(
  core: RepoCore,
  snapshot: AtomicSnapshot,
  prepared: PreparedAtomicCommits,
): Promise<void> {
  const tip = prepared.commits.at(-1)?.sha;
  if (!tip || prepared.trees.at(-1) !== snapshot.targetTree)
    throw new Error("보관 준비 결과가 없습니다.");
  await assertUnchanged(core, snapshot);
  const lockPath = `${snapshot.indexPath}.lock`;
  const journalPath = join(dirname(snapshot.indexPath), JOURNAL);
  const fd = openSync(lockPath, "wx");
  let open = true;
  let moved = false;
  let journalWritten = false;
  try {
    // 승인 범위 밖에서 stage된 내용은 보존한다.
    const finalIndex = join(snapshot.directory, "final-index");
    if (existsSync(snapshot.indexPath)) writeFileSync(finalIndex, readFileSync(snapshot.indexPath));
    else await git(core, ["read-tree", snapshot.base], core.root, { GIT_INDEX_FILE: finalIndex });
    await git(
      core,
      ["reset", snapshot.targetTree, "--", ...snapshot.paths.map((p) => `:(literal)${p}`)],
      core.root,
      { GIT_INDEX_FILE: finalIndex },
    );
    const bytes = readFileSync(finalIndex);
    writeFileSync(fd, bytes);
    closeSync(fd);
    open = false;
    await assertUnchanged(core, snapshot);
    writeFileSync(
      journalPath,
      JSON.stringify({
        pid: process.pid,
        base: snapshot.base,
        tip,
        ref: snapshot.ref,
        lockHash: hash(bytes),
      }),
      { flag: "wx" },
    );
    journalWritten = true;
    await git(core, ["update-ref", "-m", "colonova atomic save", snapshot.ref, tip, snapshot.base]);
    moved = true;
    renameSync(lockPath, snapshot.indexPath);
    rmSync(journalPath);
  } catch (error) {
    if (open) closeSync(fd);
    // update-ref가 적용된 직후 상한에 걸릴 수도 있다. 결과를 모르면 복구 기록을 보존한다.
    const stillAtBase =
      !journalWritten ||
      (await git(core, ["rev-parse", snapshot.ref]).catch(() => "")).trim() === snapshot.base;
    if (!moved && stillAtBase) {
      rmSync(lockPath, { force: true });
      if (journalWritten) rmSync(journalPath, { force: true });
    }
    // ref 이동 후에는 journal과 lock을 남겨 다음 저장이 index 전환을 마친다.
    throw error;
  }
}

export function disposeAtomicSnapshot(snapshot: AtomicSnapshot): void {
  rmSync(snapshot.directory, { recursive: true, force: true });
}
