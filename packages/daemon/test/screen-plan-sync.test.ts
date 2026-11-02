import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PlanSync } from "@colonova-design/protocol";
import type { ScreenSyncResult } from "../dist/draft-service.js";
import type { MapLink } from "../dist/link-map.js";
import type { DaemonLogger } from "../dist/log.js";
import type { PlanRefEntry } from "../dist/plan-refs.js";
import {
  autoLinks,
  entriesAfterRestore,
  liveEntries,
  readSyncLines,
  ScreenPlanSync,
  type ScreenTurn,
  type SyncEntry,
  screenSyncFile,
  screenSyncPrompt,
  syncTargets,
} from "../dist/screen-plan-sync.js";

/**
 * 같이 고치기 시험(2026-10-30 사용자 결정 · 같이 고치기 계획) — 대상 고르기 · 잇기 · 판정 말 · 기록 · 화면 되돌리기
 * 묶기의 순수 판정과, 가짜 초안 서비스로 보관 → 같이 고치기 → 되돌리기 흐름을 본다.
 */

const ref = (
  sessionId: string,
  pageId: string | null,
  sections: string[] = [],
  docKey: string | null = null,
): PlanRefEntry => ({
  at: "2026-10-30T00:00:00Z",
  sessionId,
  ref: {
    title: `문서 ${pageId ?? docKey}`,
    pageId,
    docKey,
    url: null,
    version: 3,
    revision: null,
    published: pageId !== null,
    sections,
  },
});

const link = (pageId: string, route: string, section: string | null = null): MapLink => ({
  pageId,
  route,
  section,
  note: null,
  createdAt: null,
});

test("대상 — 이 대화의 근거가 먼저, 그다음 이 화면에 이어진 문서 · 같은 문서는 한 번이고 절은 합친다", () => {
  const targets = syncTargets({
    refs: [ref("s1", "10", ["가입 조건"]), ref("s2", "99"), ref("s1", "10", ["예외"])],
    links: [link("20", "/signup"), link("10", "/signup", "가입 조건"), link("30", "/other")],
    sessionId: "s1",
    routes: ["/signup/"],
  });
  assert.deepEqual(
    targets.map((target) => [target.pageId, target.sections]),
    [
      ["10", ["가입 조건", "예외"]],
      ["20", null],
    ],
  );
});

test("대상 — 문서 전체 근거가 하나라도 있으면 절 대신 전체 · 미발행 새 문서는 docKey 로 · 상한 3", () => {
  const targets = syncTargets({
    refs: [ref("s1", "10", ["가"]), ref("s1", "10"), ref("s1", null, [], "n-abc")],
    links: [link("20", "/a"), link("30", "/a"), link("40", "/a")],
    sessionId: "s1",
    routes: ["/a"],
  });
  assert.equal(targets.length, 3);
  assert.deepEqual(targets[0], { pageId: "10", docKey: null, title: "문서 10", sections: null });
  assert.deepEqual(targets[1], {
    pageId: null,
    docKey: "n-abc",
    title: "문서 n-abc",
    sections: null,
  });
  assert.equal(targets[2]?.pageId, "20");
});

test("잇기 — 근거 문서와 바뀐 화면 중 없는 연결만 · 화면이 많으면(공통 틀) 잇지 않는다 · 새 문서는 빠진다", () => {
  assert.deepEqual(
    autoLinks({
      refs: [ref("s1", "10"), ref("s1", null, [], "n-x"), ref("s2", "11")],
      links: [link("10", "/a")],
      sessionId: "s1",
      routes: ["/a", "/b"],
    }),
    [{ pageId: "10", title: "문서 10", route: "/b" }],
  );
  assert.deepEqual(
    autoLinks({
      refs: [ref("s1", "10")],
      links: [],
      sessionId: "s1",
      routes: ["/a", "/b", "/c", "/d"],
    }),
    [],
  );
});

test("판정 말 — 요청 · 화면 · 파일 · 절을 싣고 기준 한 줄로 닫는다", () => {
  const prompt = screenSyncPrompt({
    request: "비밀번호를 10자 이상으로 바꿔 줘",
    screens: [{ route: "/signup", title: "회원가입" }],
    files: ["src/pages/signup.tsx"],
    sections: ["가입 조건"],
  });
  assert.match(prompt, /요청: 비밀번호를 10자 이상으로 바꿔 줘/);
  assert.match(prompt, /회원가입 \(\/signup\)/);
  assert.match(prompt, /src\/pages\/signup\.tsx/);
  assert.match(prompt, /먼저 볼 절: 가입 조건/);
  assert.match(prompt.split("\n").at(-1) ?? "", /^기준: /);
});

test("화면 되돌리기 묶기 — 되돌림 지점보다 뒤의 보관에 묶인 기록만 새것부터 · 지점이 없으면 아무것도", () => {
  const entry = (entryId: string, sha: string | null): SyncEntry => ({
    kind: "entry",
    entryId,
    at: "",
    slug: "demo",
    sessionId: "s1",
    requestId: "r",
    sha,
    docKey: "p-1",
    title: "",
    proposalId: "",
    opIds: [],
    inverse: [],
  });
  const entries = [entry("e1", "c1"), entry("e2", "c2"), entry("e3", "c3"), entry("e0", null)];
  const history = ["c3", "c2", "c1", "c0"];
  assert.deepEqual(
    entriesAfterRestore(entries, history, "c1").map((one) => one.entryId),
    ["e3", "e2"],
  );
  assert.deepEqual(entriesAfterRestore(entries, history, "zz"), []);
});

/** 가짜 초안 서비스 — 부른 것을 적고 정한 답을 돌려준다. */
function fakeDrafts(answers: ScreenSyncResult[]) {
  const calls: Array<{ pageId: string | null; docKey: string | null; promptText: string }> = [];
  const undos: string[] = [];
  return {
    calls,
    undos,
    drafts: {
      async screenSync(input: {
        pageId: string | null;
        docKey: string | null;
        promptText: string;
      }) {
        calls.push(input);
        const answer = answers.shift();
        if (answer === undefined) throw new Error("답이 없다");
        return answer;
      },
      async screenSyncUndo(input: { docKey: string }) {
        undos.push(input.docKey);
        return { restored: 1, kept: 0 };
      },
    },
  };
}

const silent: DaemonLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as DaemonLogger;

function syncRig(answers: ScreenSyncResult[], connected = true) {
  const home = mkdtempSync(join(tmpdir(), "screen-sync-"));
  // 연결 레포 클론의 뿌리 — 연결 파일이 여기 생긴다.
  mkdirSync(join(home, "repo"));
  const fake = fakeDrafts(answers);
  const emitted: PlanSync[] = [];
  const sync = new ScreenPlanSync({
    drafts: fake.drafts,
    paths: () => ({ root: join(home, "p"), repoRoot: join(home, "repo") }),
    connected: () => connected,
    titleOf: (_slug, pageId) => (pageId === "77" ? "고른 문서" : null),
    emit: (_turn, value) => emitted.push(structuredClone(value)),
    logger: silent,
    now: () => new Date("2026-10-30T01:00:00Z"),
  });
  return {
    home,
    fake,
    emitted,
    sync,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** 문서가 든 끝 방송이 설 때까지 미세 쉼(자지 않는다). */
async function settled(emitted: PlanSync[]): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {
    const last = emitted.at(-1);
    if (last?.phase === "done" && last.docs.length > 0) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("끝 방송이 서지 않았다");
}

const turn: ScreenTurn = {
  slug: "demo",
  sessionId: "s1",
  requestId: "r1",
  request: "비밀번호를 10자 이상으로",
  screens: [{ route: "/signup", title: "회원가입" }],
  files: ["src/signup.tsx"],
  sha: "c1",
};

test("흐름 — 이어진 문서가 없고 연결돼 있으면 고르기를 권하고 기록을 남긴다 · 고르면 잇고 같이 고친다", async () => {
  const one = syncRig([
    {
      docKey: "p-77",
      title: "고른 문서",
      outcome: "adopted",
      changes: 1,
      summary: "가입 조건의 비밀번호 길이",
      proposalId: "prop-1",
      opIds: ["op-1"],
      inverse: [{ type: "title", before: "옛", after: "새" }],
      kept: 0,
    },
  ]);
  try {
    await one.sync.onSaved(turn);
    assert.equal(one.fake.calls.length, 0);
    assert.deepEqual(one.emitted.at(-1), {
      phase: "done",
      docs: [],
      linked: [],
      ask: { routes: ["/signup"] },
    });
    await one.sync.pick("demo", "s1", "r1", "77");
    // 고르기는 뒤에서 돈다 — 문서가 든 끝 방송을 기다린다.
    await settled(one.emitted);
    const done = one.emitted.at(-1);
    assert.equal(done?.phase, "done");
    assert.deepEqual(done?.linked, [{ pageId: "77", title: "고른 문서", route: "/signup" }]);
    assert.equal(done?.docs[0]?.outcome, "adopted");
    assert.equal(done?.docs[0]?.summary, "가입 조건의 비밀번호 길이");
    const entryId = done?.docs[0]?.entryId ?? "";
    assert.notEqual(entryId, "");
    // 연결 파일이 연결 레포 뿌리에 생겼다.
    const map = JSON.parse(readFileSync(join(one.home, "repo", "plans-map.json"), "utf8"));
    assert.equal(map.links[0].pageId, "77");
    // 되돌리기 — 초안 서비스에 닿고, 카드가 undone 으로 다시 선다. 두 번째는 아무것도 하지 않는다.
    assert.deepEqual(await one.sync.undo("demo", entryId), { restored: 1, kept: 0 });
    assert.deepEqual(one.fake.undos, ["p-77"]);
    assert.equal(one.emitted.at(-1)?.docs[0]?.outcome, "undone");
    assert.deepEqual(await one.sync.undo("demo", entryId), { restored: 0, kept: 0 });
    assert.equal(liveEntries(readSyncLines(screenSyncFile(join(one.home, "p")))).length, 0);
  } finally {
    one.cleanup();
  }
});

test("흐름 — 연결되지 않은 프로젝트에서 대상이 없으면 아무것도 보내지 않는다 · 바꿀 것 없는 문서는 기록이 없다", async () => {
  const one = syncRig([], false);
  try {
    await one.sync.onSaved(turn);
    assert.equal(one.emitted.length, 0);
  } finally {
    one.cleanup();
  }
});

test("화면 되돌리기 — 지점 뒤의 같이 고친 초안을 돌린다", async () => {
  const one = syncRig([
    {
      docKey: "p-77",
      title: "고른 문서",
      outcome: "adopted",
      changes: 1,
      proposalId: "prop-1",
      opIds: ["op-1"],
      inverse: [{ type: "title", before: "옛", after: "새" }],
    },
  ]);
  try {
    await one.sync.onSaved(turn);
    await one.sync.pick("demo", "s1", "r1", "77");
    await settled(one.emitted);
    assert.equal(await one.sync.undoAfterRestore("demo", ["c2", "c1", "c0"], "c0"), 1);
    assert.deepEqual(one.fake.undos, ["p-77"]);
    // 이미 되돌린 것은 다시 돌리지 않는다.
    assert.equal(await one.sync.undoAfterRestore("demo", ["c2", "c1", "c0"], "c0"), 0);
  } finally {
    one.cleanup();
  }
});
