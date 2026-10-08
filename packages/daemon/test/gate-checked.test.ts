import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PreviewDrivers } from "../dist/preview-drivers.js";
import { DaemonServer } from "../dist/server.js";
import { readTape } from "../dist/session-tape.js";

/**
 * 문제 없이 지나간 턴 끝 확인의 기록(2026-10-06 UX 점검). 예전에는 문제를 찾았을 때만 사용자에게 닿아서 「끝났다」 가
 * 확인된 말인지 알 수 없었다. 게이트는 실제로 열어 본 화면의 수와 휴대폰 폭까지 봤는지를 돌려주고, 서버는 그것을
 * 자동 보관이 서는 순간 `screens.saved` 와 대화록에 싣는다 — 사용자의 카드가 본 것만 말하게.
 */

/** 서버가 내보낸 사건 하나 — 시험이 읽는 칸만. */
type Broadcast = { event?: { kind?: string; checked?: unknown } };

/** 화면마다 데스크톱 · 휴대폰 열기의 성공을 정하는 가짜 창. */
function drivers(opens: (route: string, viewport: string) => { ok: boolean }) {
  return new PreviewDrivers({
    factory: () => ({
      forIsolated: () => ({
        open: async (route: string, options?: { viewport?: string }) => ({
          ...opens(route, options?.viewport ?? "desktop"),
          settled: true,
          blank: false,
        }),
        consoleLines: async () => [],
        screenshot: async () => ({ data: "", mediaType: "image/png" }),
        destroy: async () => {},
      }),
    }),
    activeRepo: () =>
      ({
        root: "/tmp/repo",
        status: async () => ({ previewUrl: "http://127.0.0.1:8888" }),
      }) as never,
    session: () => ({ state: "idle", title: "request", send: () => {} }) as never,
    sessions: () => [],
    notice: () => {},
  } as never);
}

async function gate(opens: (route: string, viewport: string) => { ok: boolean }, routes: string[]) {
  const preview = drivers(opens);
  for (const route of routes) preview.notePinned("s", route);
  return await preview.runGate("s");
}

test("runGate: 열린 화면의 수와 휴대폰 폭까지 봤는지를 돌려준다", async () => {
  const outcome = await gate(() => ({ ok: true }), ["/a", "/b"]);
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return;
  assert.equal(outcome.kept, 2);
  assert.equal(outcome.opened, 2);
  assert.equal(outcome.phone, true);
});

test("runGate: 휴대폰 폭으로 못 연 화면이 있으면 휴대폰은 봤다고 하지 않는다", async () => {
  const outcome = await gate(
    (route, viewport) => ({ ok: !(route === "/b" && viewport === "mobile") }),
    ["/a", "/b"],
  );
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return;
  assert.equal(outcome.opened, 2);
  assert.equal(outcome.phone, false, "열지 못한 점검을 문제 없음으로 말하지 않는다");
});

test("runGate: 열지 못한 화면은 열어 본 수에 들지 않는다 — 하나도 못 열었으면 0", async () => {
  const some = await gate((route) => ({ ok: route !== "/b" }), ["/a", "/b"]);
  assert.equal(some.status, "ok");
  if (some.status === "ok") {
    assert.equal(some.kept, 2);
    assert.equal(some.opened, 1);
  }
  const none = await gate(() => ({ ok: false }), ["/a", "/b"]);
  assert.equal(none.status, "ok");
  if (none.status === "ok") {
    assert.equal(none.opened, 0);
    assert.equal(none.phone, false);
  }
});

/** 서버 몸통의 두 걸음만 꺼내 돌린다 — 판정이 난 순간(startGate)과 보관이 선 순간(runAutoSave). */
function stub(root: string) {
  const events: unknown[] = [];
  const saves: string[] = [];
  const server = Object.create(DaemonServer.prototype) as any;
  Object.assign(server, {
    gateChecked: new Map(),
    gateFallbackCount: new Map(),
    screenMapDue: new Map(),
    autoSaveDue: new Set(["s"]),
    comparisonSaves: new Map(),
    config: {},
    logger: { info: () => {} },
    stats: { noteGateCheck: () => {} },
    drivers: {
      pinnedThisTurn: new Map([["s", new Map([["/members", { route: "/members" }]])]]),
      gatedSessions: new Set(),
    },
    manager: { get: () => ({ lastAssistantText: "회원 목록을 고쳤어요" }) },
    comparisons: { finish: async () => {} },
    broadcast: (message: unknown) => events.push(message),
    workspaceOfSession: () => ({
      slug: "p",
      paths: { root },
      repo: {
        repoCore: () => ({ previewUrl: "http://127.0.0.1:5174", snapshot: () => ({}) }),
      },
      supervisor: { tick: () => {} },
    }),
    fleet: {
      autoSaveTurn: async () => {
        saves.push("saved");
        return { sha: "sha-1", requestId: "req-1" };
      },
    },
  });
  return { server, events, saves };
}

test("startGate: 통과한 판정은 보관이 서기 전에 기록이 되어 runAutoSave 로 넘어간다", async () => {
  const { server } = stub("/tmp/unused");
  let seen: unknown;
  server.drivers.runGate = async () => ({ status: "ok", kept: 2, opened: 2, phone: true });
  server.runAutoSave = () => {
    seen = server.gateChecked.get("s");
  };
  server.startGate("s", 1000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen, { screens: 2, phone: true });
});

test("startGate: 타입 검사가 돌고 오류가 없었다면 기록에 그 사실이 실리고, 돌지 않았으면 칸이 없다(2026-10-07)", async () => {
  const cases: Array<[Record<string, unknown>, unknown]> = [
    // 돌았고 오류가 없었다 — 게이트는 0 도 싣는다.
    [
      { typeErrors: 0, typeMs: 900 },
      { screens: 2, phone: true, types: true },
    ],
    // 바꾼 TypeScript 파일이 없었거나 시간 안에 끝나지 않아 돌지 않았다 — 통과라고 하지 않는다.
    [{}, { screens: 2, phone: true }],
    // 오류가 있으면 게이트가 선다(ok 가 아니다) — 그래도 이 칸이 참이 되지는 않는다.
    [
      { typeErrors: 3, typeMs: 900 },
      { screens: 2, phone: true },
    ],
  ];
  for (const [typeFields, expected] of cases) {
    const { server } = stub("/tmp/unused");
    let seen: unknown;
    server.drivers.runGate = async () => ({
      status: "ok",
      kept: 2,
      opened: 2,
      phone: true,
      ...typeFields,
    });
    server.runAutoSave = () => {
      seen = server.gateChecked.get("s");
    };
    server.startGate("s", 1000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, expected, JSON.stringify(typeFields));
  }
});

test("startGate: 문제를 찾았거나 하나도 못 연 판정은 기록을 남기지 않는다", async () => {
  for (const outcome of [
    { status: "trouble", kept: 1, troubles: [] },
    { status: "ok", kept: 1, opened: 0, phone: false },
    { status: "broken" },
    { status: "skipped", reason: "no-screens" },
  ]) {
    const { server } = stub("/tmp/unused");
    let seen: unknown = "unset";
    server.drivers.runGate = async () => outcome;
    server.runAutoSave = () => {
      seen = server.gateChecked.get("s");
    };
    server.startGate("s", 1000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(seen, undefined, `${outcome.status} 은 기록이 없다`);
  }
});

test("runAutoSave: 기록은 screens.saved 와 대화록에 실리고 다음 턴으로 새지 않는다", async () => {
  const root = mkdtempSync(join(tmpdir(), "colonova-checked-"));
  try {
    const { server, events } = stub(root);
    // 이 턴의 사람의 말이 대화록에 먼저 있어야 한다(보관이 선 뒤 그 줄에 화면을 덧붙인다).
    const { appendTape } = await import("../dist/session-tape.js");
    appendTape(root, {
      sessionId: "s",
      afterTurn: 1,
      event: { kind: "user.echo", text: "회원 목록을 고쳐 줘", images: 0, requestId: "req-1" },
    });
    server.gateChecked.set("s", { screens: 2, phone: true });
    server.runAutoSave("s");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const saved = (events as Broadcast[]).find((event) => event.event?.kind === "screens.saved");
    assert.deepEqual(saved?.event?.checked, { screens: 2, phone: true });
    assert.equal(server.gateChecked.has("s"), false, "쓴 기록은 비운다");
    const echo = readTape(root, "s")
      .filter((row) => row.event.kind === "user.echo")
      .at(-1);
    assert.ok(echo, "대화록에 사용자 줄이 있다");
    assert.deepEqual((echo.event as { checked?: unknown }).checked, { screens: 2, phone: true });

    // 기록이 없는 턴의 보관에는 checked 가 없다.
    events.length = 0;
    server.autoSaveDue.add("s");
    server.runAutoSave("s");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const plain = (events as Broadcast[]).find((event) => event.event?.kind === "screens.saved");
    assert.ok(plain, "보관은 기록이 없어도 알린다");
    assert.equal(plain.event?.checked, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runAutoSave: 보관이 없는 턴에서도 기록은 비워진다 — 다음 턴으로 새지 않는다", () => {
  const { server } = stub("/tmp/unused");
  server.autoSaveDue.clear();
  server.gateChecked.set("s", { screens: 1, phone: false });
  server.runAutoSave("s");
  assert.equal(server.gateChecked.has("s"), false);
});
