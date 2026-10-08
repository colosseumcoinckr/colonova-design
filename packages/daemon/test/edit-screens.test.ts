// 라이브감(2026-10-08 베타 준비 분석) — 편집한 파일 → 화면의 판정(추측하지 않는다)과 턴당 화면당 한 번의 장부.
// `../dist` 임포트인 이유: node --test 는 src 의 `.js` 지정자를 못 읽는다(먼저 빌드).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
import {
  EditAnnouncer,
  type EditedScreen,
  indexScreens,
  MAX_TOLD_PER_TURN,
  repoRelativePath,
  screenOfFile,
} from "../dist/edit-screens.js";
import type { ScreenMapRow } from "../dist/screen-map.js";

/** 지도 한 행 — 저장 하나가 건드린 파일들과 그 턴이 가리킨 화면들. */
function row(
  sha: string,
  files: string[],
  screens: Array<[route: string, title?: string]>,
  routes: string[] = screens.map(([route]) => route),
): ScreenMapRow {
  return {
    at: "2026-10-08T00:00:00.000Z",
    sha,
    routes,
    files,
    screens: screens.map(([route, title]) => ({ route, title: title ?? "" })),
  };
}

// ————— 문(Next.js) —————

test("Next 의 고정 경로 문은 지도가 아는 화면일 때만 알린다 — 제목은 지도의 것", () => {
  const index = indexScreens([
    row("a", ["app/members/page.tsx"], [["/members", "회원 목록"]]),
    row("b", ["app/page.tsx"], [["/"]]),
  ]);
  assert.deepEqual(screenOfFile("app/members/page.tsx", index), {
    route: "/members",
    title: "회원 목록",
  });
  // 제목을 모르는 화면은 제목 없이 — 문장을 만들지 않는 것은 웹의 몫이다.
  assert.deepEqual(screenOfFile("app/page.tsx", index), { route: "/" });
  assert.deepEqual(screenOfFile("src/app/page.tsx", index), { route: "/" });
});

test("문이 가리킨 화면을 지도가 모르면 말하지 않는다 — 처음 보는 화면 · 동적 문", () => {
  const index = indexScreens([row("a", ["app/members/page.tsx"], [["/members", "회원 목록"]])]);
  assert.equal(screenOfFile("app/pricing/page.tsx", index), null);
  // `[id]` 문은 어느 주소인지 모른다 — 같은 예시 주소(/members/42)를 두 번 보았어도 말하지 않는다.
  const withExample = indexScreens([
    row("a", ["app/members/[id]/page.tsx"], [["/members/42"]]),
    row("b", ["app/members/[id]/page.tsx"], [["/members/42"]]),
  ]);
  assert.equal(screenOfFile("app/members/[id]/page.tsx", withExample), null);
});

test("route group 은 없는 셈, pages 라우터의 고정 파일도 문이다", () => {
  const index = indexScreens([
    row("a", [], [["/cart", "장바구니"]]),
    row("b", [], [["/about", "소개"]]),
  ]);
  assert.deepEqual(screenOfFile("app/(shop)/cart/page.tsx", index), {
    route: "/cart",
    title: "장바구니",
  });
  assert.deepEqual(screenOfFile("pages/about.tsx", index), { route: "/about", title: "소개" });
});

// ————— 관찰(지도) —————

test("관찰: 두 번 이상의 저장이 모두 같은 화면 하나만 가리킨 파일은 알린다", () => {
  const index = indexScreens([
    row("a", ["src/Billing.tsx", "src/BillingTable.tsx"], [["/billing", "결제 내역"]]),
    row("b", ["src/BillingTable.tsx"], [["/billing"]]),
    row("c", ["src/Billing.tsx"], [["/billing"]]),
  ]);
  assert.deepEqual(screenOfFile("src/BillingTable.tsx", index), {
    route: "/billing",
    title: "결제 내역",
  });
  assert.deepEqual(screenOfFile("src/Billing.tsx", index), {
    route: "/billing",
    title: "결제 내역",
  });
});

test("관찰: 한 번만 본 파일은 말하지 않는다 — 우연일 수 있다", () => {
  const index = indexScreens([row("a", ["src/Once.tsx"], [["/billing", "결제 내역"]])]);
  assert.equal(screenOfFile("src/Once.tsx", index), null);
});

test("관찰: 여러 화면에 쓰이는 공용 파일은 말하지 않는다", () => {
  const index = indexScreens([
    row("a", ["src/Layout.tsx"], [["/billing", "결제 내역"]]),
    row("b", ["src/Layout.tsx"], [["/members", "회원 목록"]]),
    row("c", ["src/Layout.tsx"], [["/billing"]]),
  ]);
  assert.equal(screenOfFile("src/Layout.tsx", index), null);
});

test("관찰: 한 저장이 화면 둘을 가리켰거나 화면이 없던 저장에 든 파일은 말하지 않는다", () => {
  const two = indexScreens([
    row("a", ["src/Shared.tsx"], [["/a"], ["/b"]]),
    row("b", ["src/Shared.tsx"], [["/a"]]),
  ]);
  assert.equal(screenOfFile("src/Shared.tsx", two), null);
  const none = indexScreens([
    row("a", ["src/Util.tsx"], [["/a", "화면 A"]]),
    row("b", ["src/Util.tsx"], [["/a"]]),
    row("c", ["src/Util.tsx"], []),
  ]);
  assert.equal(screenOfFile("src/Util.tsx", none), null);
});

test("관찰: 같은 화면의 다른 쓰임새(쿼리 · 전체 주소 · 핀 id)는 하나로 센다 — 외부 주소는 화면이 아니다", () => {
  const index = indexScreens([
    row(
      "a",
      ["src/Member.tsx"],
      [["/members?tab=2", "회원"]],
      ["http://127.0.0.1:5273/members?tab=2"],
    ),
    {
      at: "2026-10-08T00:00:00.000Z",
      sha: "b",
      files: ["src/Member.tsx"],
      routes: ["members", "http://127.0.0.1:5273/members", "https://docs.example.com/guide"],
    },
  ]);
  assert.deepEqual(screenOfFile("src/Member.tsx", index), { route: "/members", title: "회원" });
  // 외부 주소만 가리킨 저장은 화면이 없던 저장이다.
  const external = indexScreens([
    row("a", ["src/Ext.tsx"], [], ["https://example.com/x"]),
    row("b", ["src/Ext.tsx"], [], ["https://example.com/y"]),
  ]);
  assert.equal(screenOfFile("src/Ext.tsx", external), null);
});

test("제목은 가장 최근의 것이고, 빈 제목은 이전 제목을 지우지 않는다", () => {
  const index = indexScreens([
    row("a", ["src/P.tsx"], [["/p", "옛 이름"]]),
    row("b", ["src/P.tsx"], [["/p", "새 이름"]]),
    row("c", ["src/P.tsx"], [["/p", ""]]),
  ]);
  assert.deepEqual(screenOfFile("src/P.tsx", index), { route: "/p", title: "새 이름" });
});

test("코드 파일이 아니거나 시험 · 스토리 · 선언 파일이면 화면이 아니다", () => {
  const ok = "src/Billing.tsx";
  const files = ["src/Billing.css", "README.md", "package.json", "src/Billing.test.tsx"];
  const stories = ["src/Billing.stories.tsx", "src/billing.d.ts", "src/__tests__/Billing.tsx"];
  const all = [ok, ...files, ...stories];
  const index = indexScreens([
    row("s1", all, [["/billing", "결제 내역"]]),
    row("s2", all, [["/billing"]]),
  ]);
  // 같은 증거를 가진 코드 파일은 알린다 — 아래가 null 인 이유는 파일의 종류뿐이다.
  assert.deepEqual(screenOfFile(ok, index), { route: "/billing", title: "결제 내역" });
  for (const file of [...files, ...stories]) assert.equal(screenOfFile(file, index), null, file);
});

test("처음 보는 파일 · 존재하지 않는 경로 · 낯선 모양의 지도 행은 조용히 null", () => {
  const index = indexScreens([
    row("a", ["src/A.tsx"], [["/a", "A"]]),
    // 손으로 고친 지도 — 문자열이 아닌 값이 있어도 색인이 죽지 않는다.
    {
      at: "x",
      sha: "b",
      files: [3, "src/A.tsx"],
      routes: [7, "/a"],
      screens: [{ route: 1, title: 2 }],
    } as unknown as ScreenMapRow,
  ]);
  assert.equal(screenOfFile("src/Never.tsx", index), null);
  assert.equal(screenOfFile("", index), null);
  assert.equal(screenOfFile("does/not/exist.tsx", indexScreens([])), null);
});

// ————— 경로 —————

test("repoRelativePath — 절대 · 상대 · 두 번째 뿌리 · 레포 밖", () => {
  const root = join("/work", "clone");
  assert.equal(repoRelativePath([root], join(root, "app", "page.tsx")), "app/page.tsx");
  assert.equal(repoRelativePath([root], "app/page.tsx"), "app/page.tsx");
  assert.equal(repoRelativePath([root], "./src/../app/page.tsx"), "app/page.tsx");
  // 도구가 심볼릭 링크를 푼 실제 경로로 쓴 경우 — 두 번째 뿌리가 받는다.
  const real = join("/private", "work", "clone");
  assert.equal(repoRelativePath([root, real], join(real, "app", "page.tsx")), "app/page.tsx");
  // 레포 밖 · 뿌리 자체 · 위로 나가는 경로는 화면이 아니다.
  assert.equal(repoRelativePath([root], "/etc/passwd"), null);
  assert.equal(repoRelativePath([root], "../elsewhere/x.tsx"), null);
  assert.equal(repoRelativePath([root], root), null);
  assert.equal(repoRelativePath([], "a.tsx"), null);
});

// ————— 장부(EditAnnouncer) —————

const SESSION = "s-1";
const ROOT = join("/work", "clone");

function scene(rows: ScreenMapRow[] = DEFAULT_ROWS) {
  const told: Array<{ sessionId: string; screen: EditedScreen }> = [];
  let reads = 0;
  const announcer = new EditAnnouncer({
    where: (sessionId) =>
      sessionId === SESSION ? { roots: [ROOT], projectRoot: "/data/p" } : null,
    readRows: async () => {
      reads += 1;
      return rows;
    },
    emit: (sessionId, screen) => told.push({ sessionId, screen }),
  });
  let n = 0;
  /** 편집 도구 하나가 시작해서 끝난다. */
  const edit = (path: string, opts: { name?: string; isError?: boolean; input?: unknown } = {}) => {
    const toolUseId = `t${++n}`;
    announcer.observe(SESSION, {
      kind: "tool.start",
      toolUseId,
      name: opts.name ?? "Edit",
      input: "input" in opts ? opts.input : { file_path: path },
      agentId: null,
    });
    announcer.observe(SESSION, {
      kind: "tool.end",
      toolUseId,
      isError: opts.isError === true,
      content: "",
      agentId: null,
    });
  };
  const turnEnd = () =>
    announcer.observe(SESSION, {
      kind: "turn.end",
      subtype: "success",
      isError: false,
      costUsd: null,
      numTurns: null,
      durationMs: null,
      resultText: null,
    } as ChatEvent);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { announcer, told, edit, turnEnd, flush, reads: () => reads };
}

const DEFAULT_ROWS: ScreenMapRow[] = [
  row("a", ["app/members/page.tsx"], [["/members", "회원 목록"]]),
  row("b", ["app/billing/page.tsx"], [["/billing", "결제 내역"]]),
  row("c", ["src/Shared.tsx"], [["/members"]]),
  row("d", ["src/Shared.tsx"], [["/billing"]]),
];

test("편집이 끝나면 그 화면을 한 번 알린다 — 같은 화면의 되풀이는 조용하다", async () => {
  const s = scene();
  s.edit(join(ROOT, "app/members/page.tsx"));
  await s.flush();
  assert.deepEqual(s.told, [
    { sessionId: SESSION, screen: { route: "/members", title: "회원 목록" } },
  ]);
  s.edit(join(ROOT, "app/members/page.tsx"));
  s.edit("app/members/page.tsx");
  await s.flush();
  assert.equal(s.told.length, 1);
  // 다른 화면은 새로 알린다.
  s.edit(join(ROOT, "app/billing/page.tsx"));
  await s.flush();
  assert.deepEqual(
    s.told.map((entry) => entry.screen.route),
    ["/members", "/billing"],
  );
  // 지도는 턴에 한 번만 읽는다.
  assert.equal(s.reads(), 1);
});

test("공용 파일 · 어느 화면에도 안 걸리는 파일 · 레포 밖 파일은 알리지 않는다", async () => {
  const s = scene();
  s.edit(join(ROOT, "src/Shared.tsx"));
  s.edit(join(ROOT, "package.json"));
  s.edit(join(ROOT, "src/unknown/Thing.tsx"));
  s.edit("/etc/hosts");
  await s.flush();
  assert.deepEqual(s.told, []);
});

test("실패한 편집 · 편집이 아닌 도구 · 낯선 입력은 알리지 않는다", async () => {
  const s = scene();
  s.edit(join(ROOT, "app/members/page.tsx"), { isError: true });
  s.edit(join(ROOT, "app/members/page.tsx"), { name: "Read" });
  s.edit(join(ROOT, "app/members/page.tsx"), { input: { command: "ls" } });
  s.edit(join(ROOT, "app/members/page.tsx"), { input: null });
  await s.flush();
  assert.deepEqual(s.told, []);
});

test("끝나지 않은 도구는 알리지 않는다 — 파일이 쓰이기 전에 미리보기를 옮기지 않는다", async () => {
  const s = scene();
  s.announcer.observe(SESSION, {
    kind: "tool.start",
    toolUseId: "open",
    name: "Write",
    input: { file_path: join(ROOT, "app/members/page.tsx") },
    agentId: null,
  });
  await s.flush();
  assert.deepEqual(s.told, []);
});

test("한 호출이 여러 파일을 쓰면(Codex fileChange) 화면마다 한 번씩 알린다", async () => {
  const s = scene();
  s.edit("", {
    name: "fileChange",
    input: {
      changes: [
        { path: join(ROOT, "app/members/page.tsx") },
        { path: join(ROOT, "app/billing/page.tsx") },
        { path: join(ROOT, "src/Shared.tsx") },
      ],
    },
  });
  await s.flush();
  assert.deepEqual(
    s.told.map((entry) => entry.screen.route),
    ["/members", "/billing"],
  );
});

test("턴이 끝나면 장부를 비운다 — 다음 턴은 같은 화면을 다시 알린다", async () => {
  const s = scene();
  s.edit(join(ROOT, "app/members/page.tsx"));
  await s.flush();
  s.turnEnd();
  s.edit(join(ROOT, "app/members/page.tsx"));
  await s.flush();
  assert.equal(s.told.length, 2);
  assert.equal(s.reads(), 2);
});

test("판정을 기다리는 동안 턴이 끝났으면 낡은 알림은 버린다", async () => {
  const told: string[] = [];
  let release: (rows: ScreenMapRow[]) => void = () => {};
  const announcer = new EditAnnouncer({
    where: () => ({ roots: [ROOT], projectRoot: "/data/p" }),
    readRows: () => new Promise<ScreenMapRow[]>((resolve) => (release = resolve)),
    emit: (_sessionId, screen) => told.push(screen.route),
  });
  announcer.observe(SESSION, {
    kind: "tool.start",
    toolUseId: "t",
    name: "Edit",
    input: { file_path: join(ROOT, "app/members/page.tsx") },
    agentId: null,
  });
  announcer.observe(SESSION, {
    kind: "tool.end",
    toolUseId: "t",
    isError: false,
    content: "",
    agentId: null,
  });
  announcer.forget(SESSION);
  release(DEFAULT_ROWS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(told, []);
});

test("모르는 세션 · 지도를 못 읽음 · 도중의 예외는 조용하다", async () => {
  // 세션을 모르면(where → null) 아무것도.
  const unknown = scene();
  unknown.announcer.observe("other", {
    kind: "tool.start",
    toolUseId: "x",
    name: "Edit",
    input: { file_path: join(ROOT, "app/members/page.tsx") },
    agentId: null,
  });
  unknown.announcer.observe("other", {
    kind: "tool.end",
    toolUseId: "x",
    isError: false,
    content: "",
    agentId: null,
  });
  await unknown.flush();
  assert.deepEqual(unknown.told, []);
  // 지도를 못 읽으면 말하지 않을 뿐이다.
  const told: string[] = [];
  const broken = new EditAnnouncer({
    where: () => ({ roots: [ROOT], projectRoot: "/data/p" }),
    readRows: async () => {
      throw new Error("읽지 못함");
    },
    emit: (_sessionId, screen) => told.push(screen.route),
  });
  broken.observe(SESSION, {
    kind: "tool.start",
    toolUseId: "y",
    name: "Edit",
    input: { file_path: join(ROOT, "app/members/page.tsx") },
    agentId: null,
  });
  broken.observe(SESSION, {
    kind: "tool.end",
    toolUseId: "y",
    isError: false,
    content: "",
    agentId: null,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(told, []);
});

test("한 턴이 알리는 화면 수에는 상한이 있다", async () => {
  const rows = Array.from({ length: MAX_TOLD_PER_TURN + 4 }, (_, at) =>
    row(`r${at}`, [`app/s${at}/page.tsx`], [[`/s${at}`, `화면 ${at}`]]),
  );
  const s = scene(rows);
  for (let at = 0; at < MAX_TOLD_PER_TURN + 4; at += 1) s.edit(join(ROOT, `app/s${at}/page.tsx`));
  await s.flush();
  assert.equal(s.told.length, MAX_TOLD_PER_TURN);
});

// ————— 이음매(소스 계약) —————

const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("서버가 도구 이벤트를 장부에 먹이고 session.editing 으로 방송한다", () => {
  const server = src("server.ts");
  // 모든 사건이 지나는 자리 — 통계 바로 곁, 방송 앞이다.
  assert.match(
    server,
    /this\.stats\.observe\(sessionId, event\);[\s\S]{0,260}this\.editAnnouncer\.observe\(sessionId, event\);[\s\S]{0,60}this\.broadcast\(\{ type: "session\.event"/,
  );
  assert.match(server, /type: "session\.editing",\s*sessionId,\s*route: screen\.route,/);
  // 턴이 내려앉거나 세션이 닫히면 장부를 버린다.
  assert.match(
    server,
    /state === "idle" \|\| state === "error" \|\| state === "closed"\) \{\s*this\.editAnnouncer\.forget\(sessionId\);/,
  );
});

test("로그 · 통계에 경로를 남기지 않는다 — 장부는 선로의 재료만 만든다", () => {
  const code = src("edit-screens.ts")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.doesNotMatch(code, /logger|console\.|appendFile|writeFile|\.info\(|\.warn\(/);
  assert.doesNotMatch(code, /spawn|execFile|child_process/);
});
