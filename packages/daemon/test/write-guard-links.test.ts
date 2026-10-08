import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { test } from "node:test";
// `../dist` 임포트인 이유: 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가 그 지정을 못 고친다.
import { containsPath, realpathBestEffort } from "../dist/paths.js";
import {
  bashCommandVerdict,
  fileWriteVerdict,
  OUTSIDE_COMMAND_REFUSAL,
  OUTSIDE_WRITE_REFUSAL,
  pathWritable,
  type WriteScope,
} from "../dist/write-guard.js";

// 끊어진 심볼릭 링크(2026-10-08 검토 FIX1) — 클론 안에 있지만 클론 **밖의 아직 없는 파일**을 가리키는
// 링크는 realpath 가 던져서 "없는 이름" 으로 읽혔고, 그 이름이 클론 안이라 쓰기가 통과했다
// (`Write <링크>` · `echo x > <링크>` 둘 다). 이 시험은 막아야 할 것과 함께 **통과해야 할 것**(클론 안을
// 가리키는 끊어진 링크 · 없는 파일 · 정상 링크)을 지킨다 — 과잉 차단은 정상 작업을 "실패" 로 보이게 한다.
// 파일 시스템은 진짜(임시 폴더)이고, 쓰기 울타리 쪽의 `scope.realpath` 주입은 쓰지 않는다(기본 경로 시험).

function scene() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "write-guard-links-")));
  const home = join(root, "home");
  const clone = join(home, ".colonova-design", "projects", "p", "repo");
  const elsewhere = join(root, "elsewhere");
  const tmp = join(root, "scratch-tmp");
  for (const dir of [join(clone, "src"), elsewhere, tmp]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(elsewhere, "secret.txt"), "secret");
  writeFileSync(join(clone, "src", "app.txt"), "app");
  // 임시 폴더를 명시한다 — 장면 자신이 OS 임시 폴더 아래라 기본값이면 장면 전체가 "임시" 가 된다.
  const scope: WriteScope = { cwd: clone, home, tempRoots: [tmp] };
  return { root, home, clone, elsewhere, scope, dispose: () => rmSync(root, { recursive: true }) };
}

type Scene = ReturnType<typeof scene>;

/** 클론 안에 링크를 만든다 — `to` 는 글 그대로(절대 · 상대 모두) 가리킨다. */
function link(s: Scene, name: string, to: string) {
  symlinkSync(to, join(s.clone, name));
}

function writeOk(s: Scene, file: string) {
  return fileWriteVerdict("Write", { file_path: file }, s.scope);
}

function redirectOk(s: Scene, file: string) {
  return bashCommandVerdict(`echo x > ${file}`, s.scope);
}

function assertBlocked(s: Scene, file: string, label: string) {
  assert.deepEqual(
    writeOk(s, file),
    { allow: false, reason: OUTSIDE_WRITE_REFUSAL },
    `${label}: Write`,
  );
  assert.deepEqual(
    redirectOk(s, file),
    { allow: false, reason: OUTSIDE_COMMAND_REFUSAL },
    `${label}: 리다이렉션`,
  );
  assert.equal(pathWritable(file, s.scope), false, `${label}: pathWritable`);
}

function assertAllowed(s: Scene, file: string, label: string) {
  assert.deepEqual(writeOk(s, file), { allow: true }, `${label}: Write`);
  assert.deepEqual(redirectOk(s, file), { allow: true }, `${label}: 리다이렉션`);
  assert.equal(pathWritable(file, s.scope), true, `${label}: pathWritable`);
}

test("끊어진 링크 — 클론 밖의 아직 없는 파일을 가리키면 Write · 리다이렉션 모두 막는다(절대 · 상대 링크)", () => {
  const s = scene();
  try {
    const target = join(s.elsewhere, "new.txt");
    link(s, "dangling-abs", target);
    link(s, "dangling-rel", relative(s.clone, target));
    for (const name of ["dangling-abs", "dangling-rel"]) {
      const file = join(s.clone, name);
      assert.equal(realpathBestEffort(file), target, `${name} 는 링크 대상으로 풀린다`);
      assertBlocked(s, file, name);
      // 클론 기준 상대 경로로 불러도 같다(`cd` 없이 `echo x > dangling-abs`).
      assert.deepEqual(
        redirectOk(s, name),
        { allow: false, reason: OUTSIDE_COMMAND_REFUSAL },
        name,
      );
    }
  } finally {
    s.dispose();
  }
});

test("끊어진 링크 — 클론 밖의 없는 폴더 아래 파일도 막는다(링크가 없는 폴더를 가리킨다)", () => {
  const s = scene();
  try {
    link(s, "dangling-dir", join(s.elsewhere, "newdir"));
    const file = join(s.clone, "dangling-dir", "deep", "new.txt");
    assert.equal(realpathBestEffort(file), join(s.elsewhere, "newdir", "deep", "new.txt"));
    assertBlocked(s, file, "없는 폴더 링크 아래");
  } finally {
    s.dispose();
  }
});

test("끊어진 링크 — 링크가 링크를 가리키는 사슬도 끝까지 따라간다", () => {
  const s = scene();
  try {
    const target = join(s.elsewhere, "chain.txt");
    link(s, "hop-3", target);
    link(s, "hop-2", "hop-3"); // 같은 폴더의 이웃을 상대로 가리킨다
    link(s, "hop-1", join(s.clone, "hop-2")); // 클론 안의 절대 경로
    assert.equal(realpathBestEffort(join(s.clone, "hop-1")), target);
    assertBlocked(s, join(s.clone, "hop-1"), "사슬 3단계");
    // 사슬이 클론 안에서 끝나면 통과한다.
    link(s, "in-3", join(s.clone, "src", "later.txt"));
    link(s, "in-2", "in-3");
    link(s, "in-1", "in-2");
    assert.equal(realpathBestEffort(join(s.clone, "in-1")), join(s.clone, "src", "later.txt"));
    assertAllowed(s, join(s.clone, "in-1"), "사슬이 안에서 끝남");
  } finally {
    s.dispose();
  }
});

test("끊어진 링크 — 순환 링크는 무한 루프 없이 끝나고 막는 쪽으로 풀린다", () => {
  const s = scene();
  try {
    link(s, "loop-a", "loop-b");
    link(s, "loop-b", "loop-a");
    link(s, "self", "self");
    const root = parse(s.clone).root;
    for (const name of ["loop-a", "loop-b", "self"]) {
      assert.equal(realpathBestEffort(join(s.clone, name)), root, `${name} 은 풀리지 않는다`);
      assertBlocked(s, join(s.clone, name), name);
    }
  } finally {
    s.dispose();
  }
});

test("끊어진 링크 — 8단계를 넘는 사슬은 풀지 않고 막는다(사슬을 길게 이어 빠져나갈 수 없다)", () => {
  const s = scene();
  try {
    const target = join(s.elsewhere, "far.txt");
    // hop-1 → hop-2 → … → hop-N → 클론 밖. hop-1 에서 N 번째 링크까지 N 번 따라간다.
    const chain = (count: number, prefix: string) => {
      link(s, `${prefix}-${count}`, target);
      for (let index = count - 1; index >= 1; index -= 1) {
        link(s, `${prefix}-${index}`, `${prefix}-${index + 1}`);
      }
      return join(s.clone, `${prefix}-1`);
    };
    const eight = chain(8, "eight");
    // 8 단계(링크 8개)는 대상에 닿는다 — 끊어진 마지막 링크의 대상은 따라가는 횟수에 들지 않는다.
    assert.equal(realpathBestEffort(eight), target);
    assertBlocked(s, eight, "8단계");
    const nine = chain(9, "nine");
    assert.equal(
      realpathBestEffort(nine),
      parse(s.clone).root,
      "9단계는 풀지 않고 뿌리로 돌려준다",
    );
    assertBlocked(s, nine, "9단계");
  } finally {
    s.dispose();
  }
});

test("끊어진 링크 — 클론 안을 가리키면 통과한다(과잉 차단 없음)", () => {
  const s = scene();
  try {
    const later = join(s.clone, "src", "later.txt");
    link(s, "in-abs", later);
    link(s, "in-rel", "src/later.txt");
    link(s, "in-up", "../repo/src/later.txt"); // 클론 밖으로 나갔다 들어오는 상대 경로
    link(s, "in-dir", join(s.clone, "src", "newdir")); // 없는 폴더(안)
    for (const name of ["in-abs", "in-rel", "in-up"]) {
      assert.equal(realpathBestEffort(join(s.clone, name)), later, name);
      assertAllowed(s, join(s.clone, name), name);
    }
    assertAllowed(s, join(s.clone, "in-dir", "new.txt"), "없는 폴더 링크(안) 아래");
    // 클론 기준 상대 경로로 불러도 통과한다.
    assert.deepEqual(redirectOk(s, "in-rel"), { allow: true });
    // 임시 폴더로 가는 끊어진 링크도 임시 폴더는 쓰게 둔다.
    link(s, "to-tmp", join(s.root, "scratch-tmp", "scratch.txt"));
    assertAllowed(s, join(s.clone, "to-tmp"), "임시 폴더로 가는 링크");
  } finally {
    s.dispose();
  }
});

test("링크가 아닌 것은 그대로다 — 없는 파일 · 있는 파일 · 정상 링크", () => {
  const s = scene();
  try {
    // 없는 파일(링크 아님) — 가장 가까운 부모에 꼬리를 붙인다.
    assert.equal(
      realpathBestEffort(join(s.clone, "no", "such", "file.txt")),
      join(s.clone, "no", "such", "file.txt"),
    );
    assertAllowed(s, join(s.clone, "no", "such", "file.txt"), "없는 파일");
    assertAllowed(s, join(s.clone, "src", "app.txt"), "있는 파일");
    // 정상 링크 — 가리키는 곳이 있으면 이전처럼 realpath 가 따라간다.
    link(s, "ok-out", join(s.elsewhere, "secret.txt"));
    link(s, "ok-in", join(s.clone, "src", "app.txt"));
    assert.equal(realpathBestEffort(join(s.clone, "ok-out")), join(s.elsewhere, "secret.txt"));
    assertBlocked(s, join(s.clone, "ok-out"), "정상 링크(밖)");
    assertAllowed(s, join(s.clone, "ok-in"), "정상 링크(안)");
    // 부모 폴더의 링크는 기존 규칙 그대로(링크 너머가 밖이면 막는다).
    link(s, "dir-out", s.elsewhere);
    assertBlocked(s, join(s.clone, "dir-out", "x.txt"), "폴더 링크 너머의 새 파일");
    // 같은 풀이를 쓰는 containsPath 도 그대로다(정적 파일 서버의 울타리).
    assert.equal(containsPath(s.clone, join("src", "app.txt")), true);
    assert.equal(containsPath(s.clone, s.elsewhere), false);
  } finally {
    s.dispose();
  }
});

test("링크 자신을 지우는 rm 은 따라가지 않는다 — 끊어진 링크도 지울 수 있다", () => {
  const s = scene();
  try {
    link(s, "dangling-abs", join(s.elsewhere, "new.txt"));
    for (const command of ["rm -rf dangling-abs", "rm -r dangling-abs", "rm dangling-abs"]) {
      assert.deepEqual(bashCommandVerdict(command, s.scope), { allow: true }, command);
    }
  } finally {
    s.dispose();
  }
});

test("scope.realpath 를 주입하면 기본 풀이를 쓰지 않는다 — 시험이 다른 플랫폼을 흉내 낼 때 그대로다", () => {
  const s = scene();
  try {
    link(s, "dangling-abs", join(s.elsewhere, "new.txt"));
    const injected: WriteScope = { ...s.scope, realpath: (absolute) => absolute };
    assert.equal(pathWritable(join(s.clone, "dangling-abs"), injected), true);
    assert.equal(pathWritable(join(s.clone, "dangling-abs"), s.scope), false);
  } finally {
    s.dispose();
  }
});
