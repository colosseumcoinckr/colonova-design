import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";
import { test } from "node:test";
// `../dist` 임포트인 이유: 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가
// 그 지정을 못 고친다(git-guard.test.ts 와 같은 길).
import { GIT_WRITE_REFUSAL } from "../dist/git-guard.js";
import { Session } from "../dist/session.js";
import { repoWritePolicy } from "../dist/workspaces.js";
import {
  autoMemoryRoots,
  bashCommandVerdict,
  FILE_WRITE_MATCHER,
  FILE_WRITE_TOOLS,
  fileWriteVerdict,
  OUTSIDE_COMMAND_REFUSAL,
  OUTSIDE_WRITE_REFUSAL,
  pathWritable,
  SHELL_MATCHER,
  sessionGuardHookDecision,
  type WriteScope,
} from "../dist/write-guard.js";

// 쓰기 울타리(베타 준비 분석 2026-10-07) — AI 의 Write · Edit 는 클론과 임시 폴더 안만, Bash 는 뻔한 파괴만
// 막는다. 이 시험은 두 얼굴을 함께 지킨다: 거절해야 하는 것, 그리고 **통과해야 하는 것** — 과잉 차단은
// 협조적인 AI 의 정상 작업을 "실패" 로 보이게 하므로 막는 쪽만큼 중요하다.

/** 파일 시스템 위의 한 장면 — 홈 아래 클론, 클론 밖 폴더, 클론 안의 심볼릭 링크 둘, 임시 폴더. */
function scene() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "write-guard-")));
  const home = join(root, "home");
  const clone = join(home, ".colonova-design", "projects", "p", "repo");
  const elsewhere = join(root, "elsewhere");
  const tmp = join(root, "scratch-tmp");
  for (const dir of [join(clone, "src"), elsewhere, tmp, join(home, ".claude")]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(elsewhere, "secret.txt"), "secret");
  symlinkSync(elsewhere, join(clone, "link-dir"));
  symlinkSync(join(elsewhere, "secret.txt"), join(clone, "link-file"));
  symlinkSync(join(clone, "src"), join(clone, "inner-link"));
  // 임시 폴더를 명시한다 — 장면 자신이 OS 임시 폴더 아래라 기본값이면 장면 전체가 "임시" 가 된다.
  const scope: WriteScope = { cwd: clone, home, tempRoots: [tmp] };
  return {
    root,
    home,
    clone,
    elsewhere,
    tmp,
    scope,
    dispose: () => rmSync(root, { recursive: true }),
  };
}

const writes = (scope: WriteScope, path: string, tool = "Write") =>
  fileWriteVerdict(tool, { file_path: path }, scope).allow;

// ---------------------------------------------------------------------------
// 파일 쓰기 도구
// ---------------------------------------------------------------------------

test("클론 안은 지난다 — 상대 · 절대 · 나갔다 들어옴 · 아직 없는 폴더 · 안쪽 링크", () => {
  const s = scene();
  try {
    for (const path of [
      "src/App.tsx",
      join(s.clone, "src", "App.tsx"),
      "./src/../src/App.tsx",
      "../repo/src/App.tsx", // 밖으로 나갔다 같은 클론으로 돌아온다
      "a/b/c/new.tsx", // 아직 없는 폴더 아래의 새 파일
      "inner-link/App.tsx", // 클론 안을 가리키는 링크
      s.clone, // 뿌리 자신
      join(s.clone, ".git", "info", "exclude"), // 클론 안이다 — .git 은 이 울타리의 일이 아니다
    ]) {
      assert.equal(writes(s.scope, path), true, `${path} 는 클론 안이라 지난다`);
    }
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      assert.equal(writes(s.scope, "src/App.tsx", tool), true, tool);
    }
    assert.equal(
      fileWriteVerdict("NotebookEdit", { notebook_path: "a.ipynb" }, s.scope).allow,
      true,
    );
  } finally {
    s.dispose();
  }
});

test("클론 밖은 거절한다 — 설정 · 홈 · 바깥 폴더 · 부모 · 글자만 닮은 이웃", () => {
  const s = scene();
  try {
    for (const path of [
      "/etc/hosts",
      join(s.elsewhere, "x.txt"),
      join(s.home, ".claude", "settings.json"),
      "~/.claude/settings.json",
      "~/.colonova-design/config/projects.json",
      "~/Desktop/a.txt",
      "~",
      "../sibling/x.txt",
      "../../x.txt",
      join(s.clone, "..", "other", "x.txt"),
      `${s.clone}-evil/x.txt`, // `/…/repo` 의 글자 접두사지만 다른 폴더다
      join(s.home, ".colonova-design", "projects", "p", "tsc.tsbuildinfo"), // 클론의 부모
    ]) {
      const verdict = fileWriteVerdict("Write", { file_path: path }, s.scope);
      assert.deepEqual(verdict, { allow: false, reason: OUTSIDE_WRITE_REFUSAL }, `${path} 는 거절`);
    }
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      assert.equal(writes(s.scope, join(s.elsewhere, "x"), tool), false, tool);
    }
    assert.equal(
      fileWriteVerdict("NotebookEdit", { notebook_path: "~/n.ipynb" }, s.scope).allow,
      false,
    );
  } finally {
    s.dispose();
  }
});

test("심볼릭 링크로 클론을 빠져나가는 길은 막는다 — 있는 파일 · 없는 파일 · 없는 폴더 아래", () => {
  const s = scene();
  try {
    for (const path of [
      "link-dir/x.txt", // 링크 너머의 새 파일
      "link-dir/sub/dir/new.txt", // 링크 너머의 없는 폴더 아래
      "link-file", // 링크가 가리키는 바깥의 있는 파일
      join(s.clone, "link-dir", "secret.txt"),
    ]) {
      assert.equal(writes(s.scope, path), false, `${path} 는 링크 너머 바깥이라 거절`);
    }
    assert.equal(writes(s.scope, "link-file", "Edit"), false);
  } finally {
    s.dispose();
  }
});

test("임시 폴더는 지난다 — 스크래치 파일, 그러나 글자만 닮은 이웃은 아니다", () => {
  const s = scene();
  try {
    assert.equal(writes(s.scope, join(s.tmp, "scratch.js")), true);
    assert.equal(writes(s.scope, join(s.tmp, "a", "b", "c.txt")), true);
    assert.equal(writes(s.scope, `${s.tmp}-other/x`), false);
    // 기본값(생략)은 OS 임시 폴더 · POSIX 의 /tmp — 홈이 그 안이 아닌 PC 의 모양.
    const elsewhereHome: WriteScope = { cwd: s.clone, home: join(parse(tmpdir()).root, "no-home") };
    assert.equal(writes(elsewhereHome, join(tmpdir(), "cnd-write-guard-probe.txt")), true);
    if (process.platform !== "win32") {
      assert.equal(writes(elsewhereHome, "/tmp/cnd-write-guard-probe.txt"), true);
      assert.equal(writes(elsewhereHome, "/var/tmp/cnd-write-guard-probe.txt"), true);
    }
    assert.equal(writes(elsewhereHome, "/etc/cnd-write-guard-probe"), false);
  } finally {
    s.dispose();
  }
});

test("홈을 품은 임시 폴더(TMPDIR=홈)는 임시로 치지 않는다 — 울타리를 지우지 못한다", () => {
  const s = scene();
  try {
    const sloppy: WriteScope = { cwd: s.clone, home: s.home, tempRoots: [s.home] };
    assert.equal(writes(sloppy, join(s.home, ".claude", "settings.json")), false);
    const rooted: WriteScope = { cwd: s.clone, home: s.home, tempRoots: [parse(s.home).root] };
    assert.equal(writes(rooted, "/etc/hosts"), false);
    assert.equal(writes(rooted, join(s.elsewhere, "x")), false);
  } finally {
    s.dispose();
  }
});

test("Write · Edit 가 아닌 도구와 경로 없는 호출은 이 울타리의 일이 아니다", () => {
  const s = scene();
  try {
    for (const tool of [
      "Read",
      "Glob",
      "Grep",
      "LS",
      "WebFetch",
      "mcp__colonova-browser__browser_click",
    ]) {
      assert.equal(fileWriteVerdict(tool, { file_path: "/etc/hosts" }, s.scope).allow, true, tool);
    }
    assert.equal(
      fileWriteVerdict("Write", {}, s.scope).allow,
      true,
      "경로 없는 호출은 도구가 거절한다",
    );
    assert.equal(fileWriteVerdict("Write", { file_path: "" }, s.scope).allow, true);
    assert.equal(fileWriteVerdict("Write", { file_path: 7 }, s.scope).allow, true);
    // 경로가 둘이면 하나라도 밖일 때 거절.
    assert.equal(
      fileWriteVerdict("Write", { file_path: "a.ts", path: "/etc/hosts" }, s.scope).allow,
      false,
    );
  } finally {
    s.dispose();
  }
});

test("작업 폴더(base) — cd 한 뒤의 상대 경로는 도구와 같은 곳을 본다", () => {
  const s = scene();
  try {
    mkdirSync(join(s.clone, "packages", "web"), { recursive: true });
    const inWeb: WriteScope = { ...s.scope, base: join(s.clone, "packages", "web") };
    // packages/web 에서 `../../README.md` 는 클론 뿌리의 파일 — 클론 뿌리 기준이면 밖으로 읽혀 과잉 차단이 된다.
    assert.equal(writes(inWeb, "../../README.md"), true);
    assert.equal(
      writes(s.scope, "../../README.md"),
      false,
      "base 가 없으면 클론 뿌리 기준 — 밖이다",
    );
    assert.equal(writes(inWeb, "../../../x.md"), false);
    // CLI 가 클론 밖의 작업 폴더를 알려 오면 상대 경로는 거기서 풀린다 — 도구도 그렇게 쓴다.
    const outsideBase: WriteScope = { ...s.scope, base: s.elsewhere };
    assert.equal(writes(outsideBase, "note.txt"), false);
    assert.equal(writes(outsideBase, join(s.clone, "src", "a.ts")), true);
  } finally {
    s.dispose();
  }
});

test("한글 폴더 이름 — 분해형(NFD)과 조합형(NFC)이 달라도 같은 폴더다", () => {
  const nfc = "한글-프로젝트".normalize("NFC");
  const nfd = nfc.normalize("NFD");
  assert.notEqual(nfc, nfd, "시험 자료가 정말 다른 두 모양이어야 한다");
  const scope: WriteScope = {
    cwd: `/home/u/projects/${nfd}/repo`,
    home: "/home/u",
    platform: "linux",
    tempRoots: [],
    realpath: (p) => p,
  };
  assert.equal(writes(scope, `/home/u/projects/${nfc}/repo/src/a.ts`), true);
  assert.equal(writes(scope, `/home/u/projects/${nfc}/repo-x/a.ts`), false);
  assert.equal(writes(scope, "/home/u/projects/다른-프로젝트/repo/a.ts"), false);
});

test("Windows 경로 모양 — 드라이브 · 대소문자 · 슬래시 · 확장 접두 · UNC (플랫폼 인자로 흉내)", () => {
  const home = String.raw`C:\Users\김철수`;
  const clone = String.raw`C:\Users\김철수\.colonova-design\projects\p\repo`;
  const temp = String.raw`C:\Users\김철수\AppData\Local\Temp`;
  const scope: WriteScope = {
    cwd: clone,
    home,
    platform: "win32",
    tempRoots: [temp],
    realpath: (p) => p,
  };
  for (const path of [
    String.raw`C:\Users\김철수\.colonova-design\projects\p\repo\src\a.ts`,
    String.raw`c:\users\김철수\.COLONOVA-design\projects\p\REPO\src\a.ts`, // 대소문자는 가리지 않는다
    "C:/Users/김철수/.colonova-design/projects/p/repo/src/a.ts", // 슬래시
    String.raw`src\a.ts`,
    String.raw`.\src\a.ts`,
    String.raw`..\repo\src\a.ts`,
    String.raw`\\?\C:\Users\김철수\.colonova-design\projects\p\repo\src\a.ts`, // 확장 접두
    String.raw`C:\Users\김철수\AppData\Local\Temp\scratch.txt`, // 임시 폴더
    "~/.colonova-design/projects/p/repo/src/a.ts", // `~` 는 홈
  ]) {
    assert.equal(writes(scope, path), true, `${path} 는 클론 안이라 지난다`);
  }
  for (const path of [
    String.raw`D:\x.txt`, // 다른 드라이브
    String.raw`C:\Windows\System32\drivers\etc\hosts`,
    String.raw`C:\Users\김철수\.claude\settings.json`,
    String.raw`~\.claude\settings.json`,
    "~/.claude/settings.json",
    String.raw`\\server\share\x.txt`, // UNC
    String.raw`C:\Users\김철수\.colonova-design\projects\p\repo-evil\x.txt`,
    String.raw`C:\Users\김철수\.colonova-design\projects\p\repo\..\..\other\x.txt`,
    String.raw`C:\Users\김철수\AppData\Local\Temp-evil\x.txt`,
    String.raw`..\..\x.txt`,
    "/c/Users/김철수/x.txt", // 도구는 이것을 `C:\c\Users…` 로 읽는다 — 클론 밖이다
  ]) {
    assert.equal(writes(scope, path), false, `${path} 는 클론 밖이라 거절`);
  }
});

test("Claude 자동 메모 폴더 — 이 프로젝트의 memory/ 만 열린다 (CLI 가 싣는 기록 경로에서 읽는다)", () => {
  assert.deepEqual(autoMemoryRoots("/home/u/.claude/projects/-home-u-p-repo/0a1b.jsonl", "linux"), [
    "/home/u/.claude/projects/-home-u-p-repo/memory",
  ]);
  assert.deepEqual(
    autoMemoryRoots(String.raw`C:\Users\u\.claude\projects\C--Users-u-p-repo\0a1b.jsonl`, "win32"),
    [String.raw`C:\Users\u\.claude\projects\C--Users-u-p-repo\memory`],
  );
  // 모양이 다르면 아무것도 열지 않는다 — 낯선 경로가 허용 뿌리가 되지 않는다.
  for (const odd of [undefined, null, 7, "", "/home/u/.claude/0a1b.jsonl", "relative.jsonl"]) {
    assert.deepEqual(autoMemoryRoots(odd, "linux"), [], String(odd));
  }
  const s = scene();
  try {
    const key = join(s.home, ".claude", "projects", "-p-repo");
    const scope: WriteScope = {
      ...s.scope,
      extraRoots: autoMemoryRoots(join(key, "0a1b.jsonl")),
    };
    assert.equal(writes(scope, join(key, "memory", "note.md")), true, "이 프로젝트의 메모는 쓴다");
    assert.equal(writes(scope, join(key, "memory", "deep", "x.md")), true);
    assert.equal(writes(scope, join(key, "0a1b.jsonl")), false, "대화 기록 자체는 아니다");
    assert.equal(
      writes(scope, join(s.home, ".claude", "projects", "-other-repo", "memory", "x.md")),
      false,
      "다른 프로젝트의 메모는 아니다",
    );
    assert.equal(writes(scope, join(s.home, ".claude", "settings.json")), false);
  } finally {
    s.dispose();
  }
});

// ---------------------------------------------------------------------------
// Bash — 뻔한 파괴만
// ---------------------------------------------------------------------------

const bash = (scope: WriteScope, command: string) => bashCommandVerdict(command, scope);

test("Bash — 통과해야 하는 것: 클론 안 정리 · 임시 폴더 · 풀 수 없는 변수 · 애매한 경계", () => {
  const s = scene();
  try {
    const passes: string[] = [
      // 클론 안의 정리
      "rm -rf node_modules",
      "rm -rf dist",
      "rm -rf .next",
      "rm -rf node_modules/.cache dist build",
      "rm -r src/old",
      "rm -rf ./out/*",
      "rm -rf packages/*/dist",
      "rm -rf -- ./-odd",
      "rm -rf .", // 클론 뿌리 자신은 안이다
      String.raw`\rm -rf dist`,
      "/bin/rm -rf dist",
      "FOO=1 rm -rf dist",
      "time rm -rf dist",
      "pnpm install && rm -rf node_modules/.vite",
      // 임시 폴더
      `rm -rf ${s.tmp}/work`,
      `rm -rf ${s.tmp}/*`,
      `cd ${s.tmp} && rm -rf *`,
      `pnpm test > ${s.tmp}/test.log 2>&1`,
      // 풀 수 없는 변수 · 명령 치환은 판정하지 않는다(애매하면 통과)
      "rm -rf $TMPDIR/work",
      'rm -rf "$BUILD_DIR"',
      'cd "$(mktemp -d)" && rm -rf *',
      'echo hi > "$OUT"',
      // 재귀가 아닌 삭제 · 권한 · 안의 링크
      "rm -f stale.lock",
      "rm ~/old-note.txt", // 애매한 경계 — 파일 하나 지우기는 재귀가 아니라 보지 않는다
      "rm -rf link-dir", // 링크 자신만 지운다(가리키는 폴더는 그대로)
      "chmod -R 755 scripts",
      "chmod +x run.sh",
      'chown -R "$USER" dist',
      // 리다이렉션
      "echo hi > out.txt",
      "echo hi >> notes/log.txt",
      "pnpm build 2>&1 | tee build.log",
      "cmd > /dev/null 2>&1",
      "cmd 2>/dev/null",
      "echo x >&2",
      "echo x 1>&2",
      "echo x > /dev/stderr",
      "cat < ~/input.txt", // 읽기는 쓰기가 아니다
      // 따옴표 · 주석 · 인자로 든 글은 명령이 아니다
      'grep ">" /etc/hosts',
      'echo "a > ~/x"',
      "echo 'rm -rf ~'",
      'node -e "console.log(1 > 0)"',
      "[[ $a > $b ]] && echo ok",
      "echo sudo",
      "command -v sudo", // 있는지 묻는 것이지 실행이 아니다
      "git log --grep=sudo",
      "npm run sudo-free",
      "echo ok # sudo rm -rf /",
      // heredoc 본문은 명령이 아니라 글이다
      "cat > src/a.tsx <<'EOF'\nrm -rf ~\nsudo rm -rf /\necho x > ~/.zshrc\nEOF\necho done",
      "cat <<-EOF > a.txt\n\trm -rf ~\n\tEOF\nls",
      // cd 는 거절하지 않는다 — 옮겨 간 곳 기준으로 이어서 본다
      "cd .. && ls",
      "cd src && rm -rf ../dist",
      "cd packages/web && rm -rf ../../dist",
      // 이 울타리가 보지 않는 것(애매한 경계 — 협조적인 AI 의 실수를 막는 장치지 샌드박스가 아니다)
      "tee ~/x < a.txt",
      "cp a.txt ~/a.txt",
      "mv a.txt ~/a.txt",
      "python3 -c \"open('/etc/x','w')\"",
      "xargs rm -rf < list.txt",
      "find . -name '*.log' -delete",
      // 안의 명령 글도 같은 잣대 — 클론 안이면 통과
      'bash -c "rm -rf dist"',
      'eval "rm -rf dist"',
      "sh -c 'cd src && rm -rf ../dist'",
    ];
    for (const command of passes) {
      assert.deepEqual(bash(s.scope, command), { allow: true }, `통과해야 한다: ${command}`);
    }
  } finally {
    s.dispose();
  }
});

test("Bash — 거절하는 것: sudo · 클론 밖을 지우는 rm -r · 클론 밖의 chmod/chown -R · 밖으로 가는 리다이렉션", () => {
  const s = scene();
  try {
    const denied: string[] = [
      // sudo
      "sudo ls",
      "sudo -n true",
      "env FOO=1 sudo make",
      "/usr/bin/sudo ls",
      "doas ls",
      "echo hi && sudo x",
      "true || sudo x",
      'bash -c "sudo ls"',
      "sh -lc 'sudo ls'",
      // 클론 밖을 지우는 rm -r
      "rm -rf /",
      "rm -rf /*",
      "rm -rf ~",
      "rm -rf ~/",
      "rm -rf ~/Documents",
      "rm -rf $HOME",
      'rm -rf "$HOME/x"',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 셸 변수의 모양 그대로 시험한다
      "rm -rf ${HOME}/x",
      "rm -rf ..",
      "rm -rf ../*",
      "rm -rf ../sibling",
      "rm -Rf ~/x",
      "rm --recursive --force ~/x",
      "rm -rf dist ~/x", // 하나라도 밖이면
      "rm -rf node_modules && rm -rf ~/x",
      "cd x; rm -rf /",
      "(rm -rf ~)",
      "echo $(rm -rf ~)",
      "echo `rm -rf ~`",
      "{ rm -rf ~; }",
      `rm -fr ${s.elsewhere}/x`,
      `rm -r ${s.home}`,
      `rm -rf ${s.tmp}/../elsewhere`, // 임시 폴더에서 `..` 로 나간다
      "rm -rf link-dir/*", // 링크 너머 폴더의 내용
      "rm -rf link-dir/sub",
      // 클론 밖의 chmod/chown/chgrp -R
      "chmod -R 777 /",
      "chmod -R 755 ~/projects",
      `chown -R me ${s.elsewhere}`,
      "chgrp -R staff ..",
      `chmod -R u+w ${s.home}`,
      "chown -R me link-dir", // 링크를 따라가면 바깥이다
      // 클론 밖 파일로 가는 리다이렉션
      "echo x > ~/.zshrc",
      "echo x >> ~/.bashrc",
      "echo x > /etc/hosts",
      "echo x>/etc/hosts",
      "echo x &> ~/x",
      "cat a 2> ~/err",
      "echo hi 1> ~/x",
      'echo x > "$HOME/.zshrc"',
      "echo x > $HOME/.zshrc",
      "echo x >| ~/x",
      "echo x > ../../outside",
      `echo x > ${s.elsewhere}/f`,
      "echo x > link-dir/f", // 링크 너머
      "cat <<EOF > ~/x\nbody\nEOF",
      "cat > ~/x <<'EOF'\nbody\nEOF",
      "echo ok\ncat > ~/x <<EOF\nbody\nEOF",
      // 안에 든 명령 글
      'eval "rm -rf ~"',
      "sh -c 'rm -rf /'",
      `bash -c "bash -c 'rm -rf ~/x'"`,
      // cd 로 클론 밖에 가서 지운다
      "cd / && rm -rf *",
      "cd ~ && rm -rf *",
      "cd .. && rm -rf foo",
      "cd; rm -rf *", // cd 만 쓰면 홈이다
      "pushd .. && rm -rf x",
      `cd ${s.tmp} && rm -rf ../elsewhere`,
    ];
    for (const command of denied) {
      assert.deepEqual(
        bash(s.scope, command),
        { allow: false, reason: OUTSIDE_COMMAND_REFUSAL },
        `거절해야 한다: ${command}`,
      );
    }
  } finally {
    s.dispose();
  }
});

test("Bash — Windows(Git Bash) 모양: /c/… 는 드라이브로, /tmp 는 임시 폴더로, NUL 은 버리는 곳", () => {
  const scope: WriteScope = {
    cwd: String.raw`C:\Users\김철수\.colonova-design\projects\p\repo`,
    home: String.raw`C:\Users\김철수`,
    platform: "win32",
    tempRoots: [String.raw`C:\Users\김철수\AppData\Local\Temp`],
    realpath: (p) => p,
  };
  const clonePosix = "/c/Users/김철수/.colonova-design/projects/p/repo";
  for (const command of [
    "rm -rf node_modules",
    `rm -rf ${clonePosix}/dist`,
    "rm -rf /tmp/work",
    "echo x > NUL",
    "echo x 2> nul",
    "echo x > /dev/null",
    `echo x > ${clonePosix}/out.txt`,
    "rm -rf C:/Users/김철수/.colonova-design/projects/p/repo/dist",
  ]) {
    assert.deepEqual(bash(scope, command), { allow: true }, `통과해야 한다: ${command}`);
  }
  for (const command of [
    "rm -rf /c/Users/김철수",
    "rm -rf ~",
    "rm -rf $HOME/x",
    "echo x > /c/Windows/x",
    "rm -rf D:/data",
    "echo x > ~/.bashrc",
    "sudo ls",
  ]) {
    assert.deepEqual(
      bash(scope, command),
      { allow: false, reason: OUTSIDE_COMMAND_REFUSAL },
      `거절해야 한다: ${command}`,
    );
  }
});

// ---------------------------------------------------------------------------
// PreToolUse 훅의 판정 — 훅이 읽는 함수
// ---------------------------------------------------------------------------

test("훅 판정 — 거절은 deny + 이유, 통과는 빈 객체, git 가드가 먼저다", () => {
  const s = scene();
  try {
    const deny = (reason: string) => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    });
    const hook = (tool: string, input: unknown) => sessionGuardHookDecision(tool, input, s.scope);
    assert.deepEqual(hook("Write", { file_path: "/etc/hosts" }), deny(OUTSIDE_WRITE_REFUSAL));
    assert.deepEqual(
      hook("Edit", { file_path: join(s.home, ".claude", "settings.json") }),
      deny(OUTSIDE_WRITE_REFUSAL),
    );
    assert.deepEqual(hook("Bash", { command: "rm -rf ~" }), deny(OUTSIDE_COMMAND_REFUSAL));
    // git 쓰기는 기존 문장 그대로 — 그 가드의 판정을 이 울타리가 바꾸지 않는다.
    assert.deepEqual(hook("Bash", { command: "git commit -m x" }), deny(GIT_WRITE_REFUSAL));
    assert.deepEqual(
      hook("Bash", { command: "git commit -m x && sudo ls" }),
      deny(GIT_WRITE_REFUSAL),
    );
    // 통과
    assert.deepEqual(hook("Write", { file_path: "src/a.ts", content: "x" }), {});
    assert.deepEqual(hook("Bash", { command: "rm -rf node_modules" }), {});
    assert.deepEqual(hook("Bash", { command: "git status" }), {});
    assert.deepEqual(hook("Read", { file_path: "/etc/hosts" }), {});
    assert.deepEqual(hook("Bash", {}), {});
    // 입력이 객체가 아니어도 던지지 않는다 — 훅이 던지면 도구 호출 자체가 막힌다.
    for (const odd of [null, undefined, "x", 7, []]) {
      assert.deepEqual(hook("Write", odd), {});
      assert.deepEqual(hook("Bash", odd), {});
    }
  } finally {
    s.dispose();
  }
});

test("거절 문장은 AI 가 답변에 옮겨도 사용자 어휘다 — 개발 어휘 없이 무엇을 하라는지 말한다", () => {
  for (const sentence of [OUTSIDE_WRITE_REFUSAL, OUTSIDE_COMMAND_REFUSAL]) {
    assert.ok(!/(?<![패리])턴|경로|git|커밋|브랜치|\bPR\b|데몬/i.test(sentence), sentence);
    assert.ok(sentence.includes("프로젝트 폴더"), "무엇의 밖인지 말한다");
    assert.ok(
      sentence.endsWith("프로젝트 안의 파일만 고쳐 주세요."),
      "대신 무엇을 하라는지 말한다",
    );
  }
  assert.ok(OUTSIDE_COMMAND_REFUSAL.includes("관리자 권한"), "sudo 이유가 들어 있다");
});

// ---------------------------------------------------------------------------
// 같은 함수를 읽는다 — 코어의 쓰기 정책 · 훅 배선
// ---------------------------------------------------------------------------

test("repoWritePolicy — 클론 · 임시 폴더는 allow, 그 밖은 deny(묻는 카드가 아니다)", () => {
  const s = scene();
  try {
    // 기본 임시 폴더(OS 의 것)를 쓰는 정책이라, 장면(임시 폴더 아래)이 아니라 실제 홈과 파일 시스템의
    // 뿌리로 밖을 가린다 — 판정만 하고 아무것도 쓰지 않는다.
    const policy = repoWritePolicy(s.clone);
    const rootEtc = join(parse(tmpdir()).root, "etc", "hosts");
    assert.equal(policy(join(s.clone, "src", "a.ts")), "allow");
    assert.equal(policy(rootEtc), "deny");
    // 홈이 임시 폴더 안인 PC(일부 CI)에서는 임시 폴더가 임시로 치이지 않는다 — 그 PC 에서는 건너뛴다.
    if (!homedir().startsWith(tmpdir())) {
      assert.equal(policy(join(tmpdir(), "cnd-policy-probe.txt")), "allow");
      assert.equal(policy(join(homedir(), ".claude", "settings.json")), "deny");
      assert.equal(policy(join(homedir(), "Desktop", "a.txt")), "deny");
    }
    // 정책이 읽는 것과 훅이 읽는 것은 같은 함수다.
    for (const path of [join(s.clone, "src", "a.ts"), rootEtc, join(tmpdir(), "probe.txt")]) {
      assert.equal(policy(path) === "allow", pathWritable(path, { cwd: s.clone }), path);
    }
  } finally {
    s.dispose();
  }
});

test("코어의 decidePermission 이 같은 판정을 낸다(행동) — 클론 밖 편집 · sudo · 클론 밖 삭제는 deny, 클론 안은 allow", async () => {
  // 홈이 임시 폴더 안인 PC(일부 CI)에서는 임시 폴더가 임시로 치이지 않는 판정이 달라 건너뛴다. 아무것도 쓰지 않는다 — 판정만.
  if (homedir().startsWith(tmpdir())) return;
  const cwd = join(homedir(), ".cnd-write-guard-probe", "repo");
  const asked: string[] = [];
  const session = new Session(
    { cwd, provider: "claude" },
    {
      onEvent: () => undefined,
      onState: () => undefined,
      onPermissionRequest: (request) => {
        asked.push(request.toolName);
      },
      onQuestionRequest: () => undefined,
    },
  );
  const decide = (tool: Parameters<typeof session.driverHooks.decidePermission>[0], input = {}) => {
    const controller = new AbortController();
    const verdict = session.driverHooks.decidePermission(tool, input, {
      signal: controller.signal,
    });
    return { verdict, cancel: () => controller.abort() };
  };
  const edit = (...paths: string[]) => ({ kind: "edit" as const, name: "Write", paths });
  const exec = (command: string) => ({ kind: "exec" as const, name: "Bash", command });

  assert.equal((await decide(edit(join(cwd, "src", "a.ts"))).verdict).behavior, "allow");
  assert.equal((await decide(edit("src/a.ts")).verdict).behavior, "allow", "상대 경로는 클론 기준");
  const outside = join(homedir(), ".claude", "settings.json");
  assert.deepEqual(await decide(edit(outside)).verdict, {
    behavior: "deny",
    message: OUTSIDE_WRITE_REFUSAL,
  });
  assert.deepEqual(await decide(edit("src/a.ts", outside)).verdict, {
    behavior: "deny",
    message: OUTSIDE_WRITE_REFUSAL,
  });
  for (const command of ["sudo ls", "rm -rf ~/x", "echo x > ~/.zshrc"]) {
    assert.deepEqual(await decide(exec(command)).verdict, {
      behavior: "deny",
      message: OUTSIDE_COMMAND_REFUSAL,
    });
  }
  assert.deepEqual(await decide(exec("git commit -m x")).verdict, {
    behavior: "deny",
    message: GIT_WRITE_REFUSAL,
  });
  // 거절하지 않는 명령은 옛 흐름 그대로 카드로 간다 — 이 판정은 거절만 더한다.
  assert.deepEqual(asked, []);
  const passing = decide(exec("rm -rf node_modules"));
  assert.deepEqual(asked, ["Bash"], "클론 안 정리는 거절되지 않고 카드 흐름으로 이어진다");
  passing.cancel();
  assert.equal((await passing.verdict).behavior, "deny", "카드를 취소하면 정산된다");
});

const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("훅 배선 — 셸 도구(Bash · PowerShell)와 파일 쓰기 도구가 같은 판정 함수를 읽고, matcher 가 도구를 다 가리킨다", () => {
  const claude = src("agent/drivers/claude/session.ts");
  // 두 matcher 가 같은 훅을 쓴다. 셸 도구의 matcher 는 `Bash|PowerShell` 이다(2026-10-08 검토 FIX1).
  assert.match(claude, /\{ matcher: SHELL_MATCHER, hooks: \[guardHook\] \}/);
  assert.match(claude, /\{ matcher: FILE_WRITE_MATCHER, hooks: \[guardHook\] \}/);
  assert.doesNotMatch(claude, /matcher: "Bash"/, "Bash 만 가리키는 옛 matcher 가 남았다");
  assert.equal(SHELL_MATCHER, "Bash|PowerShell");
  assert.match(SHELL_MATCHER, /^[A-Za-z0-9_|]+$/);
  // 훅은 write-guard 의 판정을 읽고, 작업 폴더와 자동 메모 폴더를 싣는다.
  assert.match(
    claude,
    /const guardHook: HookCallback = async \(input\) =>\s+sessionGuardHookDecision\(/,
  );
  assert.match(claude, /base: input\.cwd/);
  assert.match(claude, /extraRoots: autoMemoryRoots\(input\.transcript_path\)/);
  // git 가드의 훅 판정을 따로 부르는 옛 배선은 없다 — write-guard 가 먼저 불러 문장을 지킨다.
  assert.doesNotMatch(claude, /gitGuardHookDecision/);
  // matcher 는 이름 목록(`|`)이고 CLI 가 정확히 맞추는 모양(글자 · 숫자 · _ · |)이다.
  assert.equal(FILE_WRITE_MATCHER, "Write|Edit|MultiEdit|NotebookEdit");
  assert.match(FILE_WRITE_MATCHER, /^[A-Za-z0-9_|]+$/);
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assert.ok(FILE_WRITE_MATCHER.split("|").includes(tool), tool);
  }
  // 세션의 EDIT_TOOLS(도구 분류)와 울타리의 도구 목록은 같은 이름이다.
  const block = /const EDIT_TOOLS: Record<string, true> = \{([^}]*)\}/.exec(claude)?.[1] ?? "";
  const editTools = [...block.matchAll(/(\w+): true/g)].map((m) => m[1]);
  assert.deepEqual([...editTools].sort(), [...FILE_WRITE_TOOLS].sort());
});

test("코어의 쓰기 정책도 같은 함수를 읽는다 — 기본 정책 · decidePermission · repoWritePolicy", () => {
  const core = src("session.ts");
  assert.match(core, /pathWritable\(path, \{ cwd: this\.cwd \}\) \? "allow" : "deny"/);
  assert.match(core, /bashCommandVerdict\(command, \{ cwd: this\.cwd \}\)/);
  assert.match(core, /message: OUTSIDE_WRITE_REFUSAL/);
  assert.match(core, /message: OUTSIDE_COMMAND_REFUSAL/);
  assert.doesNotMatch(
    core,
    /containsPath/,
    "코어는 write-guard 의 판정만 읽는다 — 따로 containsPath 로 갈라 보지 않는다",
  );
  assert.match(
    src("workspaces.ts"),
    /pathWritable\(path, \{ cwd: repoRoot \}\) \? "allow" : "deny"/,
  );
});
