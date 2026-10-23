import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DraftPlanRef } from "@colonova-design/protocol";
import { parseClientMessage } from "../../protocol/dist/messages.js";
import { appendPlanRefs, PLAN_REFS_LIMIT } from "../dist/plan-refs.js";
import { draftHandlers } from "../dist/requests/drafts.js";

/**
 * 대화의 기획 근거 요청(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — `draft.refs` 가 활성
 * 프로젝트의 기록에서 그 대화의 근거만 최근 것이 앞으로 20개까지 돌려주는지 본다. 프로세스를
 * 띄우지 않는 순수 시험이다. 합성 제목만 쓴다.
 */

/** 합성 근거 — 실제 문서를 흉내 내지 않는다. */
function ref(over: Partial<DraftPlanRef> = {}): DraftPlanRef {
  return {
    title: "로그인 화면",
    pageId: "123",
    docKey: null,
    url: null,
    version: 4,
    revision: null,
    published: true,
    sections: [],
    ...over,
  };
}

/** 처리기만 거치는 자리 — 활성 프로젝트의 자료 방을 임시 폴더로 한다. */
function scene(t: { after(fn: () => void): void }, active = true) {
  const root = mkdtempSync(join(tmpdir(), "colonova-draft-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const handlers = draftHandlers({
    drafts: undefined as never,
    registry: {
      activeSlug: () => (active ? "p1" : null),
      paths: () => ({ root, repoRoot: join(root, "repo") }),
    } as never,
  });
  return { handlers, root, file: join(root, "plans", "refs.jsonl") };
}

type RefsReply = { at: string; ref: DraftPlanRef }[];

const ask = (handlers: { "draft.refs": unknown }, sessionId: string): RefsReply =>
  (handlers["draft.refs"] as (message: { sessionId: string }) => { refs: RefsReply })({
    sessionId,
  }).refs;

test("기록이 없으면 빈 목록 — 프로젝트가 없어도 빈 목록", (t) => {
  const { handlers } = scene(t);
  assert.deepEqual(ask(handlers, "s1"), []);
  const bare = scene(t, false);
  assert.deepEqual(ask(bare.handlers, "s1"), []);
});

test("그 대화의 기록만 온다", (t) => {
  const { handlers, file } = scene(t);
  appendPlanRefs(file, [
    { at: "2026-10-23T01:00:00Z", sessionId: "s1", ref: ref({ title: "정책서" }) },
    { at: "2026-10-23T02:00:00Z", sessionId: "s2", ref: ref({ title: "다른 대화의 것" }) },
    {
      at: "2026-10-23T03:00:00Z",
      sessionId: "s1",
      ref: ref({ title: "기능설계서", pageId: "456", version: 7 }),
    },
  ]);
  assert.deepEqual(
    ask(handlers, "s1").map((row) => row.ref.title),
    ["기능설계서", "정책서"],
  );
});

test("최근 것이 앞으로 선다", (t) => {
  const { handlers, file } = scene(t);
  appendPlanRefs(file, [
    { at: "2026-10-23T03:00:00Z", sessionId: "s1", ref: ref({ title: "셋째", pageId: "3" }) },
    { at: "2026-10-23T01:00:00Z", sessionId: "s1", ref: ref({ title: "첫째", pageId: "1" }) },
    { at: "2026-10-23T02:00:00Z", sessionId: "s1", ref: ref({ title: "둘째", pageId: "2" }) },
  ]);
  assert.deepEqual(
    ask(handlers, "s1").map((row) => row.ref.title),
    ["셋째", "둘째", "첫째"],
  );
});

test("같은 근거는 가장 최근 기록 하나로 합친다 — 절이 다르면 다른 근거다", (t) => {
  const { handlers, file } = scene(t);
  const same = ref({ sections: ["배경"] });
  appendPlanRefs(file, [
    { at: "2026-10-23T01:00:00Z", sessionId: "s1", ref: same },
    { at: "2026-10-23T02:00:00Z", sessionId: "s1", ref: { ...same } },
    {
      at: "2026-10-23T02:30:00Z",
      sessionId: "s1",
      ref: ref({ ...same, sections: ["목표"] }),
    },
  ]);
  assert.deepEqual(
    ask(handlers, "s1").map((row) => row.at),
    ["2026-10-23T02:30:00Z", "2026-10-23T02:00:00Z"],
  );
});

test("근거는 최근 20개까지다", (t) => {
  const { handlers, file } = scene(t);
  appendPlanRefs(
    file,
    Array.from({ length: PLAN_REFS_LIMIT + 2 }, (_, at) => ({
      at: new Date(Date.UTC(2026, 9, 1 + at)).toISOString(),
      sessionId: "s1",
      ref: ref({ title: `문서 ${at}`, pageId: String(100 + at) }),
    })),
  );
  const rows = ask(handlers, "s1");
  assert.equal(rows.length, PLAN_REFS_LIMIT);
  assert.equal(rows[0]?.ref.title, `문서 ${PLAN_REFS_LIMIT + 1}`);
  assert.equal(rows.at(-1)?.ref.title, "문서 2");
});

test("깨진 줄은 건너뛰고 읽는다", (t) => {
  const { handlers, root, file } = scene(t);
  mkdirSync(join(root, "plans"), { recursive: true });
  writeFileSync(
    file,
    `${[
      "{not json",
      JSON.stringify({
        at: "2026-10-23T01:00:00Z",
        sessionId: "s1",
        ref: { title: "모양이 어긋난 것" },
      }),
      JSON.stringify({ at: "2026-10-23T02:00:00Z", sessionId: "s1", ref: ref() }),
      "",
    ].join("\n")}\n`,
  );
  assert.deepEqual(
    ask(handlers, "s1").map((row) => row.ref.title),
    ["로그인 화면"],
  );
});

test("선로 — 대화 id 는 1자부터 200자까지다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({ id: "r1", type: "draft.refs", sessionId: "s".repeat(200) }),
  );
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.type, "draft.refs");
  for (const sessionId of ["", "s".repeat(201)]) {
    const bad = parseClientMessage(JSON.stringify({ id: "r2", type: "draft.refs", sessionId }));
    assert.ok(!bad.ok, sessionId.length);
  }
  const missing = parseClientMessage(JSON.stringify({ id: "r3", type: "draft.refs" }));
  assert.ok(!missing.ok);
});
