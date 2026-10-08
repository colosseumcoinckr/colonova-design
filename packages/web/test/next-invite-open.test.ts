import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(invite-file-name.test.ts 와 같은 모양).
import { readInviteFile } from "../src/lib/invite-import.ts";
import { nextOpenedInvite, openedInviteFile, openedInviteFiles } from "../src/lib/invite-open.ts";
import { L } from "../src/next/labels.ts";

/**
 * 파일을 더블클릭해 연 초대 파일(2026-10-08 베타 준비 분석) — 데스크톱의 메인이 판정을 통과시킨 파일의 이름 · 경로 · 바이트가
 * 오면 웹은 그것을 `File` 로 만들어 끌어 놓은 파일과 같은 길(`takeFile`)로 보낸다. 이 시험은 그 순수 부분(모양 판정 ·
 * `File` 만들기 · 줄)과 컨트롤러의 배선(소스의 글)을 지킨다. 진짜 더블클릭은 베타 세션의 몫이다.
 */

const bytes = (text: string) => new TextEncoder().encode(text);

test("openedInviteFile: 이름 · 경로 · 바이트가 File 한 장이 된다 — 한글 · 공백 이름도", async () => {
  const opened = openedInviteFile({
    name: "회원 관리.colonova-invite",
    path: "/Users/me/Downloads/회원 관리.colonova-invite",
    bytes: bytes('{"hello":1}'),
  });
  assert.ok(opened);
  assert.equal(opened.file.name, "회원 관리.colonova-invite");
  assert.equal(opened.path, "/Users/me/Downloads/회원 관리.colonova-invite");
  assert.equal(await opened.file.text(), '{"hello":1}');
  // ArrayBuffer 로 와도 같다.
  const buffer = bytes("abc").buffer as ArrayBuffer;
  const fromBuffer = openedInviteFile({ name: "a.colonova-invite", path: "/a", bytes: buffer });
  assert.equal(await fromBuffer?.file.text(), "abc");
});

test("openedInviteFile: 메인이 읽지 못한 파일(bytes null)은 빈 파일이 되어 같은 오류 카드로 말한다", async () => {
  const opened = openedInviteFile({
    name: "회원.colonova-invite",
    path: "/tmp/회원.colonova-invite",
    bytes: null,
  });
  assert.ok(opened);
  assert.equal(opened.file.size, 0);
  const read = await readInviteFile(opened.file);
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.error, L.invite.errUnreadable, "끌어 놓은 빈 파일과 같은 문장");
});

test("openedInviteFile: 확장자가 다른 이름은 이름 문이 그대로 막는다 — 끌어 놓기와 같은 문장", async () => {
  const opened = openedInviteFile({ name: "사진.png", path: "/tmp/사진.png", bytes: bytes("x") });
  assert.ok(opened);
  const read = await readInviteFile(opened.file);
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.error, L.invite.errNotInvite);
});

test("openedInviteFile: 모양이 어긋난 건은 버린다 — 이름 · 경로가 없거나 문자열이 아니거나 이름이 너무 길 때", () => {
  const good = { name: "a.colonova-invite", path: "/a.colonova-invite", bytes: bytes("x") };
  assert.ok(openedInviteFile(good));
  for (const bad of [
    null,
    undefined,
    "a.colonova-invite",
    42,
    [],
    { ...good, name: "" },
    { ...good, name: 3 },
    { ...good, name: "x".repeat(256) },
    { ...good, path: "" },
    { ...good, path: undefined },
  ]) {
    assert.equal(openedInviteFile(bad), null, JSON.stringify(bad));
  }
  // 바이트의 모양이 이상하면(문자열 · 숫자) 빈 파일로 — 내용 문이 말한다.
  assert.equal(openedInviteFile({ ...good, bytes: "문자열" })?.file.size, 0);
});

test("openedInviteFiles: 배열이 아니면 빈손, 어긋난 건만 빼고 순서를 지킨다", () => {
  assert.deepEqual(openedInviteFiles(undefined), []);
  assert.deepEqual(openedInviteFiles({}), []);
  const list = openedInviteFiles([
    { name: "a.colonova-invite", path: "/a.colonova-invite", bytes: null },
    { name: "", path: "/x", bytes: null },
    { name: "b.colonova-invite", path: "/b.colonova-invite", bytes: null },
  ]);
  assert.deepEqual(
    list.map((entry) => entry.file.name),
    ["a.colonova-invite", "b.colonova-invite"],
  );
});

test("nextOpenedInvite: 카드가 닫혀 있고 첫 상태가 온 뒤에만 앞의 한 장을 꺼낸다", () => {
  const queue = ["A", "B", "C"];
  assert.deepEqual(nextOpenedInvite(queue, "idle", true), { next: "A", rest: ["B", "C"] });
  // 카드가 열려 있는 동안은 줄을 선다 — 읽는 중 · 확인 · 적용 중 · 끝남 · 오류 모두.
  for (const phase of ["reading", "confirm", "applying", "done", "error"]) {
    assert.deepEqual(nextOpenedInvite(queue, phase, true), { next: null, rest: queue }, phase);
  }
  // 첫 상태가 오기 전의 프로젝트 목록은 비어 있다 — 그때 읽으면 프로젝트가 있는 기계도 첫 실행으로 판정한다.
  assert.deepEqual(nextOpenedInvite(queue, "idle", false), { next: null, rest: queue });
  assert.deepEqual(nextOpenedInvite([], "idle", true), { next: null, rest: [] });
});

test("nextOpenedInvite: 줄은 원본을 바꾸지 않고, 비워질 때까지 하나씩 나온다", () => {
  const queue = Object.freeze(["A", "B"]);
  const first = nextOpenedInvite(queue, "idle", true);
  assert.equal(first.next, "A");
  const second = nextOpenedInvite(first.rest, "idle", true);
  assert.equal(second.next, "B");
  assert.deepEqual(nextOpenedInvite(second.rest, "idle", true), { next: null, rest: [] });
});

// ---------------------------------------------------------------------------
// 배선 — 컨트롤러가 위의 순수 부분을 쓰고, 끌어 놓기와 같은 길로 들어간다.
// ---------------------------------------------------------------------------

const hook = readFileSync(join(import.meta.dirname, "../src/hooks/use-invite-import.ts"), "utf8");

test("컨트롤러: 마운트 때 줄을 가져가고(takeOpened) 신호마다(onOpenFile) 다시 가져간다", () => {
  assert.match(hook, /window\.colonovaDesignDesktop\?\.invite;/);
  assert.match(hook, /bridge\.takeOpened\?\.\(\)/);
  assert.match(hook, /bridge\.onOpenFile\?\.\(drain\)/);
  // 마운트 때 한 번 부른다 — 앱이 뜨기 전에 온 더블클릭은 신호가 없다.
  assert.match(hook, /const off = bridge\.onOpenFile\?\.\(drain\);\s*drain\(\);/);
});

test("컨트롤러: 건너온 파일은 takeFile 로 들어가며 경로를 함께 넘긴다(파일 지우기가 이어진다)", () => {
  assert.match(hook, /takeFileRef\.current\(next\.file, next\.path\)/);
  assert.match(hook, /\(file: File, diskPath\?: string\)/);
  assert.match(hook, /diskPath \?\? window\.colonovaDesignDesktop\?\.invite\?\.pathOf\?\.\(file\)/);
});

test("컨트롤러: 줄은 카드가 닫히고(idle) 첫 상태가 온 순간에 이어서 꺼낸다", () => {
  assert.match(
    hook,
    /nextOpenedInvite\(\s*openedRef\.current,\s*stateRef\.current\.phase,\s*loadedRef\.current/,
  );
  assert.match(hook, /if \(state\.phase === "idle" && statusLoaded\) pumpOpened\(\);/);
  assert.match(hook, /const statusLoaded = daemon\.status !== null;/);
});

test("진단 복사: 메뉴의 신호를 받아 설정의 개발자용 쪽과 같은 글을 복사하고 토스트로 알린다 — 셸이 받는다", () => {
  const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
  const copy = read("../src/next/lib/use-report-copy.ts");
  assert.match(copy, /bridge\.onCopyReport\(/);
  assert.match(copy, /useDiagnosticsText\(daemon\)/);
  assert.match(copy, /navigator\.clipboard\.writeText\(await build\.current\(\)\)/);
  assert.match(copy, /say\(L\.help\.reportCopied\)/);
  assert.match(copy, /say\(L\.help\.reportFailed\)/);
  const shell = read("../src/next/NextShell.tsx");
  assert.match(shell, /const report = useReportCopy\(daemon\);/);
  // 토스트의 색 · 층은 `.nx` 가 정한다 — 앱 뿌리로 옮겨 그려야 첫 실행 · 작업 틀 어느 화면에서도 보인다.
  assert.match(
    shell,
    /createPortal\(\s*<Toast toast=\{report\.toast\} onDone=\{report\.dismiss\} \/>,\s*document\.querySelector<HTMLElement>\("\.nx"\) \?\? document\.body,/,
  );
  // 첫 실행의 체크리스트에는 작업 틀(Workspace)이 없다 — 작업 틀의 길(use-shell-nav)에 달면 막힌 사람이 가장 먼저 만나는
  // 그 화면에서 메뉴가 아무 일도 하지 않는다.
  assert.doesNotMatch(read("../src/next/lib/use-shell-nav.ts"), /onCopyReport/);
  // 복사가 막힌 때의 말은 어느 화면에서나 맞다(설정은 첫 실행 화면에서 닿지 않는다).
  assert.match(L.help.reportFailed, /한 번 더/);
  assert.match(L.help.reportCopied, /^진단을 복사했어요/);
});
