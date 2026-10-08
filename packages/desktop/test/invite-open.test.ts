// 초대 파일 더블클릭으로 열기의 시험(2026-10-08 베타 준비 분석) — Electron 을 띄우지 않는다. 경로 판정 · 시작 인자 거르기 ·
// 줄 · 한 파일 읽기는 순수 모듈(`invite-open.ts`)을 곧장 부르고, 메인 · 다리 · preload 의 배선과 electron-builder 의 파일 연결은
// 소스의 글을 읽어 못박는다(앱의 시작은 부수 효과라 불러올 수 없다). 실기(진짜 더블클릭)는 베타 세션의 몫이다 —
// docs/DEVELOPERS.md 「초대 파일 더블클릭으로 열기」와 beta-windows-session.md.
// `../dist` 임포트인 이유는 notices 시험과 같다(시험 전에 `tsc -p packages/desktop/tsconfig.json` 이 dist 를 만든다).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { test } from "node:test";
import { INVITE_SUFFIX, inviteDiscardRefusal, invitePathProblem } from "../dist/invite-discard.js";
import {
  INVITE_OPEN_MAX_BYTES,
  INVITE_OPEN_QUEUE_MAX,
  InviteOpenQueue,
  inviteArgvPaths,
  readOpenedInvite,
} from "../dist/invite-open.js";

const SRC = join(import.meta.dirname, "../src");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

// ---------------------------------------------------------------------------
// 경로 판정 — 지우기와 열기가 같은 잣대다.
// ---------------------------------------------------------------------------

test("invitePathProblem: 문자열 · NUL 없음 · 절대 경로 · 초대 파일의 끝 — 이 OS 의 규칙으로", () => {
  assert.equal(invitePathProblem("/Users/me/Downloads/회원 관리.colonova-invite", posix), null);
  assert.equal(invitePathProblem("회원.colonova-invite", posix), "missing", "상대 경로");
  assert.equal(invitePathProblem("/tmp/a.png", posix), "not-invite");
  assert.equal(invitePathProblem("/tmp/a.colonova-invite.txt", posix), "not-invite");
  assert.equal(invitePathProblem("/tmp/a.COLONOVA-INVITE", posix), "not-invite", "대소문자 구분");
  assert.equal(invitePathProblem("", posix), "missing");
  assert.equal(invitePathProblem("   ", posix), "missing");
  assert.equal(invitePathProblem("/tmp/a\0.colonova-invite", posix), "missing", "NUL");
  for (const value of [null, undefined, 3, {}, ["/tmp/a.colonova-invite"]]) {
    assert.equal(invitePathProblem(value, posix), "missing", String(value));
  }
});

test("invitePathProblem: Windows 의 드라이브 · UNC 경로 — 한글 · 공백 계정 폴더도", () => {
  assert.equal(
    invitePathProblem("C:\\Users\\홍 길동\\Downloads\\회원 관리.colonova-invite", win32),
    null,
  );
  assert.equal(invitePathProblem("\\\\서버\\공유\\a.colonova-invite", win32), null);
  assert.equal(invitePathProblem("Downloads\\a.colonova-invite", win32), "missing");
  // 같은 글을 posix 의 눈으로 보면 절대 경로가 아니다 — 판정이 이 OS 의 규칙을 따른다는 증거.
  assert.equal(invitePathProblem("C:\\Users\\me\\a.colonova-invite", posix), "missing");
});

test("지우기와 열기가 한 잣대 — inviteDiscardRefusal 은 같은 판정의 문장일 뿐이다", () => {
  assert.equal(INVITE_SUFFIX, ".colonova-invite");
  assert.equal(inviteDiscardRefusal("/tmp/a.colonova-invite"), null);
  assert.match(inviteDiscardRefusal("a.colonova-invite") ?? "", /찾지 못했어요/);
  assert.match(inviteDiscardRefusal("/tmp/a.png") ?? "", /초대 파일만/);
  assert.match(inviteDiscardRefusal(undefined) ?? "", /찾지 못했어요/);
  // 웹의 isInviteFile 과 같은 끝이다 — 한쪽만 바뀌면 열기와 가져오기가 갈린다.
  assert.ok(
    readFileSync(join(SRC, "../../web/src/lib/invite-bus.ts"), "utf8").includes(
      `endsWith("${INVITE_SUFFIX}")`,
    ),
  );
});

// ---------------------------------------------------------------------------
// 시작 인자 거르기 — Windows 의 더블클릭 · 두 번째 실행 · 개발 실행.
// ---------------------------------------------------------------------------

test("inviteArgvPaths: Windows 의 더블클릭 — 실행 파일 뒤의 초대 파일 경로 하나", () => {
  const exe = "C:\\Users\\홍 길동\\AppData\\Local\\Programs\\ColoNova Design\\ColoNova Design.exe";
  const file = "C:\\Users\\홍 길동\\Downloads\\회원 관리.colonova-invite";
  assert.deepEqual(inviteArgvPaths([exe, file], "C:\\Windows\\System32", win32), [file]);
  assert.deepEqual(inviteArgvPaths([exe], "C:\\Windows\\System32", win32), [], "인자 없는 실행");
});

test("inviteArgvPaths: 개발 실행의 `.` · 크롬 플래그 · 다른 파일은 버린다", () => {
  const argv = [
    "/x/node_modules/electron/dist/Electron",
    ".",
    "--remote-debugging-port=9222",
    "--inspect=9229",
    "/tmp/사진.png",
    "/tmp/a.colonova-invite",
    "--file=/tmp/b.colonova-invite",
    "/tmp/c.colonova-invite.txt",
  ];
  assert.deepEqual(inviteArgvPaths(argv, "/repo", posix), ["/tmp/a.colonova-invite"]);
});

test("inviteArgvPaths: 상대 경로는 그 실행의 작업 폴더로 풀어 절대 경로로 만든다", () => {
  assert.deepEqual(inviteArgvPaths(["app", "a.colonova-invite"], "/Users/me/Downloads", posix), [
    "/Users/me/Downloads/a.colonova-invite",
  ]);
  assert.deepEqual(
    inviteArgvPaths(["app", "..\\a.colonova-invite"], "C:\\Users\\me\\Docs", win32),
    ["C:\\Users\\me\\a.colonova-invite"],
  );
});

test("inviteArgvPaths: 같은 경로는 한 번 · 모양이 어긋난 인자(문자열이 아님 · NUL)는 버린다", () => {
  const same = "/tmp/a.colonova-invite";
  assert.deepEqual(inviteArgvPaths([same, same, "/tmp/b.colonova-invite"], "/", posix), [
    same,
    "/tmp/b.colonova-invite",
  ]);
  assert.deepEqual(
    inviteArgvPaths([undefined, null, 7, {}, "/tmp/a\0.colonova-invite"], "/", posix),
    [],
  );
  assert.deepEqual(inviteArgvPaths([], "/", posix), []);
});

// ---------------------------------------------------------------------------
// 줄 — 앱이 뜨기 전에 온 것도 렌더러가 마운트될 때까지 쥔다.
// ---------------------------------------------------------------------------

test("InviteOpenQueue: 판정을 통과한 경로만 세우고, take 가 순서대로 비운다", () => {
  const queue = new InviteOpenQueue();
  assert.equal(queue.offer("/tmp/a.colonova-invite", posix), true);
  assert.equal(queue.offer("/tmp/b.colonova-invite", posix), true);
  assert.equal(queue.offer("/tmp/a.colonova-invite", posix), false, "같은 경로는 한 번");
  assert.equal(queue.offer("relative.colonova-invite", posix), false, "상대 경로");
  assert.equal(queue.offer("/tmp/c.png", posix), false, "다른 확장자");
  assert.equal(queue.offer(undefined, posix), false);
  assert.equal(queue.size, 2);
  assert.deepEqual(queue.take(), ["/tmp/a.colonova-invite", "/tmp/b.colonova-invite"]);
  assert.equal(queue.size, 0);
  assert.deepEqual(queue.take(), [], "두 번째 take 는 빈 줄");
  // 비운 뒤에는 같은 경로를 다시 세울 수 있다(사용자가 같은 파일을 또 더블클릭했다).
  assert.equal(queue.offer("/tmp/a.colonova-invite", posix), true);
});

test("InviteOpenQueue: 상한이 차면 더 세우지 않는다 — 메모리가 자라지 않는다", () => {
  const queue = new InviteOpenQueue();
  for (let n = 0; n < INVITE_OPEN_QUEUE_MAX; n += 1) {
    assert.equal(queue.offer(`/tmp/${n}.colonova-invite`, posix), true);
  }
  assert.equal(queue.offer("/tmp/extra.colonova-invite", posix), false);
  assert.equal(queue.size, INVITE_OPEN_QUEUE_MAX);
});

// ---------------------------------------------------------------------------
// 한 파일 읽기 — 메인이 읽어 바이트만 건넨다.
// ---------------------------------------------------------------------------

const fileStat = (size: number) => ({ isFile: () => true, size });

test("readOpenedInvite: 일반 파일의 이름 · 경로 · 바이트를 건넨다 (가짜 파일 시스템)", () => {
  const path = "/Users/me/Downloads/회원 관리.colonova-invite";
  const opened = readOpenedInvite(
    path,
    { lstat: () => fileStat(5), read: () => Buffer.from("hello") },
    posix,
  );
  assert.equal(opened.name, "회원 관리.colonova-invite");
  assert.equal(opened.path, path);
  assert.deepEqual([...(opened.bytes ?? [])], [...Buffer.from("hello")]);
  assert.ok(
    opened.bytes instanceof Uint8Array && !Buffer.isBuffer(opened.bytes),
    "순수 Uint8Array",
  );
});

test("readOpenedInvite: 읽지 못하면 던지지 않고 bytes 가 null — 일반 파일이 아님 · 너무 큼 · 사라짐 · 판정 탈락", () => {
  const never = {
    lstat: () => {
      throw new Error("판정에서 떨어진 경로는 디스크에 닿지 않는다");
    },
    read: () => new Uint8Array(),
  };
  const ok = "/tmp/a.colonova-invite";
  const notFile = { lstat: () => ({ isFile: () => false, size: 0 }), read: () => new Uint8Array() };
  const tooBig = {
    lstat: () => fileStat(INVITE_OPEN_MAX_BYTES + 1),
    read: () => {
      throw new Error("너무 큰 파일은 읽지 않는다");
    },
  };
  const vanished = {
    lstat: () => {
      throw new Error("ENOENT");
    },
    read: () => new Uint8Array(),
  };
  assert.equal(readOpenedInvite(ok, notFile, posix).bytes, null);
  assert.equal(readOpenedInvite(ok, tooBig, posix).bytes, null);
  assert.equal(readOpenedInvite(ok, vanished, posix).bytes, null);
  assert.equal(readOpenedInvite("/tmp/a.png", never, posix).bytes, null);
  assert.equal(readOpenedInvite("a.colonova-invite", never, posix).bytes, null);
  // 상한 그대로는 읽는다.
  const edge = readOpenedInvite(
    ok,
    { lstat: () => fileStat(INVITE_OPEN_MAX_BYTES), read: () => new Uint8Array(3) },
    posix,
  );
  assert.equal(edge.bytes?.length, 3);
});

test("readOpenedInvite: 진짜 파일 — 일반 파일은 읽고, 폴더 · 심볼릭 링크는 읽지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-invite-open-"));
  try {
    const file = join(dir, "회원 관리.colonova-invite");
    writeFileSync(file, '{"v":1}');
    const opened = readOpenedInvite(file);
    assert.equal(opened.name, "회원 관리.colonova-invite");
    assert.equal(Buffer.from(opened.bytes ?? []).toString("utf8"), '{"v":1}');

    const folder = join(dir, "폴더.colonova-invite");
    mkdirSync(folder);
    assert.equal(readOpenedInvite(folder).bytes, null, "폴더");

    const link = join(dir, "링크.colonova-invite");
    try {
      symlinkSync(file, link);
      assert.equal(readOpenedInvite(link).bytes, null, "심볼릭 링크는 따라가지 않는다");
    } catch (error) {
      // 링크를 만들 권한이 없는 환경(Windows 의 일반 계정)은 이 줄만 건너뛴다.
      assert.match(String((error as NodeJS.ErrnoException).code), /EPERM|EACCES/);
    }
    assert.equal(readOpenedInvite(join(dir, "없는.colonova-invite")).bytes, null, "없는 파일");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 배선 — 메인 · 다리 · preload 의 글을 읽어 못박는다.
// ---------------------------------------------------------------------------

test("main.ts: open-file 은 모듈을 읽을 때 달고 preventDefault 로 처리한다고 알린다 (mac)", () => {
  const main = read("main.ts");
  assert.match(
    main,
    /app\.on\("open-file",\s*\(event, path\)\s*=>\s*\{\s*event\.preventDefault\(\);\s*offerInviteFiles\("open-file", \[path\]\);/,
  );
  // ready 를 기다리는 `.then` 보다 앞이다 — mac 의 open-file 은 ready 보다 먼저 올 수 있다.
  assert.ok(main.indexOf('app.on("open-file"') < main.indexOf(".whenReady()"));
});

test("main.ts: 첫 실행의 인자와 두 번째 실행의 인자(작업 폴더와 함께)가 같은 줄로 간다 (Windows)", () => {
  const main = read("main.ts");
  assert.match(
    main,
    /offerInviteFiles\("argv", inviteArgvPaths\(process\.argv, process\.cwd\(\)\)\);/,
  );
  assert.match(
    main,
    /app\.on\("second-instance",\s*\(_event, argv, workingDirectory\)\s*=>\s*\{\s*offerInviteFiles\("second-instance", inviteArgvPaths\(argv, workingDirectory\)\);\s*host\.focusMain\(\);/,
  );
  // 둘 다 모듈을 읽을 때 단 줄이 쥔다 — 렌더러가 마운트될 때 가져간다(bridge 의 desktop:invite-take).
  assert.match(main, /const inviteOpen = new InviteOpenQueue\(\);/);
  assert.match(main, /inviteOpen,\s*\n\s*log: \(message, fields\)/);
});

test("신호와 가져가기: preload · 다리 · 메인이 같은 채널 이름을 쓰고, 렌더러는 경로를 건네지 않는다", () => {
  const preload = read("preload.ts");
  const bridge = read("bridge.ts");
  const main = read("main.ts");
  assert.match(preload, /takeOpened:[^=]*=>\s*ipcRenderer\.invoke\("desktop:invite-take"\)/);
  assert.match(preload, /onOpenFile: subscribe<void>\("colonovadesign:invite-open"\)/);
  assert.match(main, /const INVITE_OPEN_CHANNEL = "colonovadesign:invite-open";/);
  assert.match(main, /webContents\.send\(INVITE_OPEN_CHANNEL\)/);
  assert.match(bridge, /ipcMain\.handle\("desktop:invite-take",\s*\(event\)\s*=>/);
  // 인자를 받지 않는다(렌더러가 읽을 파일을 고르지 못한다) · 앱의 최상위 렌더러만 줄을 비운다.
  assert.doesNotMatch(bridge, /"desktop:invite-take",\s*\((_?event), \w+/);
  assert.match(bridge, /event\.senderFrame !== event\.sender\.mainFrame\) return \[\]/);
  // preload 는 샌드박스라 로컬 모듈을 부를 수 없다 — 타입도 끌어오지 않는다(CommonJS 로 다시 나가 dist 를 덮는다).
  assert.doesNotMatch(preload, /from "\.\/invite-open/);
});

test("electron-builder: mac · Windows 가 같은 확장자의 파일 연결을 건다 — mac 은 보기 역할", () => {
  const yml = readFileSync(join(import.meta.dirname, "../electron-builder.yml"), "utf8");
  const macBlock = yml.slice(yml.indexOf("\nmac:"), yml.indexOf("\nwin:"));
  const winBlock = yml.slice(yml.indexOf("\nwin:"), yml.indexOf("\nnsis:"));
  assert.match(
    macBlock,
    /fileAssociations:\s*\n\s*- ext: colonova-invite\s*\n\s*name: [^\n]*초대 파일\s*\n\s*role: Viewer/,
  );
  assert.match(
    winBlock,
    /fileAssociations:\s*\n\s*- ext: colonova-invite\s*\n\s*name: ColoNovaDesign\.Invite\s*\n\s*description: [^\n]*초대 파일/,
  );
  // 확장자는 코드의 INVITE_SUFFIX 와 같다(점 없이).
  assert.equal(INVITE_SUFFIX, ".colonova-invite");
});
