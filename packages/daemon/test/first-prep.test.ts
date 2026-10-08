import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { ChatEvent, RepoPhase } from "@colonova-design/protocol";
// Session 은 형제(.js 지정자)를 부르므로 dist 를 본다(turn-selfheal 과 같은 길).
import { ProjectFleet } from "../dist/project-fleet.js";
import { Session } from "../dist/session.js";
import { nextReadyWatch } from "../src/ready-notice.ts";

/** 상태 방송의 줄을 차례로 먹여 알림이 몇 번 나는지 센다. */
function run(phases: RepoPhase[]): number {
  let watching = false;
  let notices = 0;
  for (const phase of phases) {
    const next = nextReadyWatch(watching, phase);
    watching = next.watching;
    if (next.notify) notices += 1;
  }
  return notices;
}

test("첫 준비가 끝나면 ready 알림 한 번 (PLAN-UI U8)", () => {
  assert.equal(
    run([
      "cloning",
      "installing",
      "ready",
      // 다시 준비(최신화 · 미리보기 켜기)는 내려받기를 지나지 않는다.
      "pulling",
      "starting",
      "ready",
    ]),
    1,
  );
});

test("지금 보고 있는 프로젝트의 첫 준비도 알린다 — 사용자가 홈에 있으면 화면은 말이 없다 (2026-10-07)", () => {
  // 판정은 활성 여부를 읽지 않는다(인자도 없다) — 데스크톱은 창 포커스로, 웹은 보는 화면으로 거른다.
  assert.equal(nextReadyWatch.length, 2);
  assert.equal(run(["cloning", "installing", "starting", "ready"]), 1);
});

test("이미 준비된 프로젝트의 다시 준비는 알리지 않는다", () => {
  assert.equal(run(["pulling", "installing", "ready"]), 0);
});

test("오류를 지나도 첫 준비다 — AI 가 고친 뒤 끝나면 알린다", () => {
  assert.equal(run(["cloning", "error", "pulling", "installing", "ready"]), 1);
});

test("끝난 첫 준비는 한 번뿐이다 — 이어지는 ready 방송은 다시 알리지 않는다", () => {
  assert.equal(run(["cloning", "ready", "ready", "ready"]), 1);
});

function preparedSession() {
  const sends: string[] = [];
  const queued: number[] = [];
  const session = new Session(
    { cwd: tmpdir(), provider: "claude" },
    {
      onEvent: (_id: string, event: ChatEvent) => {
        if (event.kind === "queued") queued.push(event.items.length);
      },
      onState: () => undefined,
      onPermissionRequest: () => undefined,
      onQuestionRequest: () => undefined,
    },
  );
  session.attach({
    send: (turn: { text: string }) => {
      sends.push(turn.text);
      return Promise.resolve();
    },
  } as never);
  const endTurn = () =>
    session.driverHooks.onEvent({
      kind: "turn.end",
      subtype: "success",
      isError: false,
      costUsd: null,
      numTurns: null,
      durationMs: 1,
      resultText: null,
    } satisfies ChatEvent & { kind: "turn.end" });
  return { session, sends, queued, endTurn };
}

test("준비 중에 온 말은 대기 줄에 서고, 준비가 끝나면 차례로 나간다 (PLAN-UI U8)", () => {
  const { session, sends, queued, endTurn } = preparedSession();
  session.setPreparing(true);
  session.send("회원 목록 화면을 만들어 줘");
  session.send("검색창도 넣어 줘");
  assert.deepEqual(sends, [], "준비가 끝나기 전에는 아무것도 나가지 않는다");
  assert.deepEqual(
    session.heldItems().map((item) => item.text),
    ["회원 목록 화면을 만들어 줘", "검색창도 넣어 줘"],
  );
  assert.equal(queued.at(-1), 2, "대기 줄은 queued 로 화면에 보인다");

  session.setPreparing(false);
  assert.deepEqual(sends, ["회원 목록 화면을 만들어 줘"], "맨 앞 말부터 하나");
  endTurn();
  assert.deepEqual(sends, ["회원 목록 화면을 만들어 줘", "검색창도 넣어 줘"]);
  assert.equal(queued.at(-1), 0);
});

test("준비가 아닌 대화의 말은 그대로 나간다", () => {
  const { session, sends } = preparedSession();
  session.send("바로 가는 말");
  assert.deepEqual(sends, ["바로 가는 말"]);
  // 열린 문을 다시 여는 것은 아무 일도 하지 않는다.
  session.setPreparing(false);
  assert.deepEqual(sends, ["바로 가는 말"]);
});

test("fleet — 첫 준비가 끝나면 ready 알림을 내고(보고 있는 프로젝트도), 기다리던 말을 놓아 준다", () => {
  let active = "a";
  const notices: unknown[] = [];
  const { session, sends } = preparedSession();
  const fleet = new ProjectFleet({
    registry: {
      list: () => [],
      activeSlug: () => active,
      get: (slug: string) => ({ slug, name: slug === "b" ? "회원 관리" : "다른 것" }),
    },
    manager: { get: () => session, all: () => [session] },
    notice: (notice: unknown) => notices.push(notice),
  } as never);
  const inner = fleet as never as {
    workspaces: Map<string, unknown>;
    watchFirstPrep: (slug: string, status: { phase: RepoPhase; previewUrl?: string }) => void;
    preparing: Set<string>;
  };
  // 세션의 클론과 같은 뿌리를 가진 워크스페이스 하나 — 놓아 주기가 cwd 로 찾는다.
  inner.workspaces.set("b", { slug: "b", paths: { root: tmpdir(), repoRoot: tmpdir() } });

  active = "b";
  inner.watchFirstPrep("b", { phase: "cloning" });
  assert.ok(inner.preparing.has("b"));
  session.setPreparing(true);
  session.send("먼저 말해 둔 것");
  assert.deepEqual(sends, []);

  active = "a"; // 사용자가 다른 프로젝트로 갔다.
  inner.watchFirstPrep("b", { phase: "installing" });
  inner.watchFirstPrep("b", { phase: "ready" });
  assert.deepEqual(notices, [{ kind: "ready", slug: "b", title: "회원 관리" }]);
  assert.equal(inner.preparing.has("b"), false);
  assert.deepEqual(sends, ["먼저 말해 둔 것"], "준비가 끝나면 대기 줄이 풀린다");

  // 두 번째 ready(돌아와서 미리보기 켜기)는 다시 알리지 않는다.
  inner.watchFirstPrep("b", { phase: "starting" });
  inner.watchFirstPrep("b", { phase: "ready" });
  assert.equal(notices.length, 1);

  // 지금 보고 있는 프로젝트의 첫 준비도 알린다(2026-10-07) — 활성이어도 홈에 있으면 화면은 말이 없다.
  active = "c";
  inner.watchFirstPrep("c", { phase: "cloning" });
  inner.watchFirstPrep("c", { phase: "ready" });
  assert.deepEqual(notices.at(-1), { kind: "ready", slug: "c", title: "다른 것" });
  assert.equal(notices.length, 2);
});

test("fleet — ready 에 닿으면 서비스의 첫 화면을 한 번 읽어 스냅샷에 싣는다 (2026-10-07)", async () => {
  const reads: string[] = [];
  let emits = 0;
  const { session } = preparedSession();
  const fleet = new ProjectFleet({
    registry: {
      list: () => [],
      activeSlug: () => "b",
      get: (slug: string) => ({ slug, name: slug }),
    },
    manager: { get: () => session, all: () => [session] },
    notice: () => undefined,
    readFirstScreen: (url: string) => {
      reads.push(url);
      return Promise.resolve({ path: "/", title: "회원 관리 · 콜로노바" });
    },
  } as never);
  const inner = fleet as never as {
    workspaces: Map<string, unknown>;
    watchFirstPrep: (slug: string, status: { phase: RepoPhase; previewUrl?: string }) => void;
    firstScreens: Map<string, { path: string; title: string }>;
  };
  inner.workspaces.set("b", {
    slug: "b",
    paths: { root: tmpdir(), repoRoot: tmpdir() },
    repo: { repoCore: () => ({ emit: () => (emits += 1) }) },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // 준비 중에는 읽지 않는다 — 서버가 아직 없다.
  inner.watchFirstPrep("b", { phase: "cloning" });
  inner.watchFirstPrep("b", { phase: "starting" });
  assert.deepEqual(reads, []);

  inner.watchFirstPrep("b", { phase: "ready", previewUrl: "http://127.0.0.1:5173/" });
  await settle();
  assert.deepEqual(reads, ["http://127.0.0.1:5173/"]);
  assert.deepEqual(inner.firstScreens.get("b"), { path: "/", title: "회원 관리 · 콜로노바" });
  assert.equal(emits, 1, "읽은 것이 스냅샷에 실리도록 상태를 다시 방송한다");

  // ready 가 이어지는 방송은 읽지 않고, 돌아와서 다시 켜진 ready 는 읽되 같은 값이면 방송하지 않는다.
  inner.watchFirstPrep("b", { phase: "ready", previewUrl: "http://127.0.0.1:5173/" });
  await settle();
  assert.equal(reads.length, 1);
  inner.watchFirstPrep("b", { phase: "starting" });
  inner.watchFirstPrep("b", { phase: "ready", previewUrl: "http://127.0.0.1:5173/" });
  await settle();
  assert.equal(reads.length, 2);
  assert.equal(emits, 1, "같은 첫 화면이면 다시 방송하지 않는다");
});

test("fleet — 프로젝트 요약이 첫 준비 중임을 알린다: 내려받기를 본 순간 켜지고 ready 에 닿으면 꺼진다 (2026-10-07)", () => {
  const { session } = preparedSession();
  const project = {
    slug: "b",
    name: "회원 관리",
    repo: { url: "https://example.com/b.git", baseBranch: "main", branch: null, handoff: null },
  };
  const fleet = new ProjectFleet({
    registry: {
      list: () => [project],
      activeSlug: () => "b",
      get: () => project,
      paths: () => ({ repoRoot: tmpdir(), root: tmpdir() }),
    },
    manager: { get: () => session, all: () => [session], cachedThreads: () => null },
    notice: () => undefined,
  } as never);
  const inner = fleet as never as {
    watchFirstPrep: (slug: string, status: { phase: RepoPhase }) => void;
  };
  const summary = () => fleet.projectSummaries().find((entry) => entry.slug === "b");

  // 앱을 켜 두기만 한 프로젝트 — 첫 준비가 아니다(손대지 않은 프로젝트는 `missing` 으로 온다).
  assert.equal(summary()?.phase, "missing");
  assert.equal("firstPrep" in (summary() ?? {}), false);

  inner.watchFirstPrep("b", { phase: "cloning" });
  assert.equal(summary()?.firstPrep, true);
  // 오류를 지나도 표식은 이어진다 — AI 가 고쳐 다시 돌린 준비도 첫 준비다.
  inner.watchFirstPrep("b", { phase: "error" });
  assert.equal(summary()?.firstPrep, true);
  inner.watchFirstPrep("b", { phase: "installing" });
  assert.equal(summary()?.firstPrep, true);

  inner.watchFirstPrep("b", { phase: "ready" });
  assert.equal("firstPrep" in (summary() ?? {}), false, "ready 에 닿으면 꺼진다");
  // 다시 준비(최신화 · 재설치)는 내려받기를 지나지 않는다 — 켜지지 않는다.
  inner.watchFirstPrep("b", { phase: "pulling" });
  inner.watchFirstPrep("b", { phase: "installing" });
  assert.equal("firstPrep" in (summary() ?? {}), false);
});
