import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
import { markTurn } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: session 은 형제(.js 지정자)를 부른다 — turn-selfheal.test.ts 와 같다. 가짜 전송(agent)을 붙여
// 세션이 CLI 에 내려놓는 글과 사용자가 보는 글(에코 · 제목 · 보관 제목)이 갈라지는지만 본다 — CLI 는 없다.
import { turnSubjectOf } from "../dist/common-instructions.js";
import { NEW_SESSION_TITLE, Session } from "../dist/session.js";

/**
 * 보던 화면 꼬리(2026-10-07 베타 준비 분석): AI 가 읽는 글에는 한 줄이 붙고, 사용자가 보는 글 — 에코 · 대화 제목 ·
 * 보관(커밋) 제목 — 은 그대로여야 한다. 꼬리를 붙이는 자리가 `deliver` 하나라 이 시험이 그 하나를 지킨다.
 */
function harness() {
  const echoes: string[] = [];
  const sent: Array<{ text: string; attachments?: unknown[] }> = [];
  const steered: string[] = [];
  const session = new Session({ cwd: tmpdir(), provider: "claude" }, {
    onEvent: (_id: string, event: ChatEvent) => {
      if (event.kind === "user.echo") echoes.push(event.text);
    },
    onState: () => undefined,
    onPermissionRequest: () => undefined,
    onQuestionRequest: () => undefined,
  } as never);
  session.attach({
    alive: true,
    send: (turn: { text: string; attachments?: unknown[] }) => {
      sent.push(turn);
      return Promise.resolve();
    },
    steer: (turn: { text: string }) => {
      steered.push(turn.text);
      return Promise.resolve();
    },
  } as never);
  return { session, echoes, sent, steered };
}

const WORDS = "이 화면에서 버튼 크게 해 줘";
const TAIL = "[지금 사용자가 보는 화면: /members]";

test("AI 가 받는 글에는 보던 화면 한 줄이 붙고, 사용자가 보는 글은 그대로다", () => {
  const { session, echoes, sent } = harness();
  session.send(WORDS, undefined, undefined, "queue", { path: "/members?tab=2" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.text, `${WORDS}\n\n${TAIL}`, "AI 에게는 말 + 꼬리");
  assert.deepEqual(echoes, [WORDS], "에코는 사용자의 말 그대로");
  assert.equal(session.title, WORDS, "대화 제목은 말에서 — 꼬리를 모른다");
  assert.equal(session.lastSentText, WORDS, "보관 제목의 재료도 말 그대로");
  assert.deepEqual(turnSubjectOf(session.lastSentText), { message: WORDS });
});

test("보던 화면이 없으면(홈에서 보냄) 글은 그대로 나간다", () => {
  const { session, sent } = harness();
  session.send(WORDS);
  assert.equal(sent[0]?.text, WORDS);
});

test("핀이 있는 턴에는 붙지 않는다 — 핀이 더 정확하다", () => {
  const { session, sent } = harness();
  session.send(WORDS, undefined, [{ screen: "/members" }], "queue", { path: "/members" });
  assert.equal(sent[0]?.text, WORDS);
});

test("기계가 쓴 턴에는 붙지 않는다", () => {
  const { session, sent } = harness();
  const brief = markTurn({ kind: "brief", title: "회원 목록" }, "화면을 만들어 주세요");
  session.send(brief, undefined, undefined, "queue", { path: "/members" });
  assert.equal(sent[0]?.text, brief);
});

test("첨부는 그대로 따라간다 — 꼬리가 첨부 목록을 건드리지 않는다", () => {
  const { session, sent } = harness();
  const image = { name: "logo.png", mediaType: "image/png", data: "aGk=" };
  session.send(WORDS, [image], undefined, "queue", { path: "/members" });
  assert.deepEqual(sent[0]?.attachments, [image]);
});

test("꼬리가 붙은 턴도 이름 없는 대화의 제목은 말의 첫 문장이다", () => {
  const { session } = harness();
  assert.equal(session.title, NEW_SESSION_TITLE);
  session.send("회원 목록 검색창을 키워 줘. 그리고 색도 바꿔 줘", undefined, undefined, "queue", {
    path: "/members",
  });
  assert.equal(session.title, "회원 목록 검색창을 키워 줘.");
});

test("도는 턴에 실어 보내는 말(steer)에도 같은 꼬리가 붙는다", async () => {
  const { session, steered, echoes } = harness();
  session.send("처음 요청", undefined, undefined, "queue", { path: "/a" });
  session.send(WORDS, undefined, undefined, "steer", { path: "/members" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(steered, [`${WORDS}\n\n${TAIL}`]);
  assert.deepEqual(echoes, ["처음 요청", WORDS], "에코는 둘 다 사용자의 말");
});
