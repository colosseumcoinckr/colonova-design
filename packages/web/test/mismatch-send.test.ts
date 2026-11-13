import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { L } from "../src/next/labels.ts";
import {
  type MismatchSendResult,
  offerMismatchToComposer,
  sendMismatchNow,
} from "../src/next/lib/mismatch-model.ts";

/**
 * 누름=보내기 · 판정 실패 다시 시도 · 자동 맞춰 보기 토글(2026-11-03 A안 1A-1(b)(c) · 1A-2) —
 * `sendMismatchNow` 가 입력창 이벤트에 `send` 표시를 싣고, Composer 가 그 표시에 곧바로 보낸다.
 * 카드와 설정 줄은 문장이 `L.compare` 새 다섯 · `L.planLoop` 넷에서만 나오게 src 를 재고,
 * 이벤트의 send 표시는 창을 세워 실제로 담아 본다(window 만 세운다 — 나머지는 순수).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const card = read("../src/next/ui/MismatchCard.tsx");
const composer = read("../src/next/chat/Composer.tsx");
const planChat = read("../src/next/plans/draft/PlanChat.tsx");
const planTab = read("../src/next/chat/PlanTab.tsx");
const planDocView = read("../src/next/plans/PlanDocView.tsx");
const aiPage = read("../src/next/settings/AiPage.tsx");
const daemonClient = read("../src/lib/daemon-client.ts");

const snapshot = {
  attachment: { name: "기획.md", mediaType: "text/markdown", data: "# 기획\n" },
};

/** 받는 입력창이 있는 창 — preventDefault 를 부르는 수신자가 있으면 dispatchEvent 는 false 를 돌려준다.
 * `sent` 로 입력창 처리기의 답신(detail.sent)을 흉내낸다: true = 즉시 보냄 · undefined/false = 미리 채움. */
const windowWithReceiver = (sent?: boolean) => {
  const seen: Array<{ text?: string; send?: boolean; sent?: boolean; attachments?: unknown[] }> =
    [];
  const win = {
    dispatchEvent: (event: Event) => {
      const detail = ((event as CustomEvent).detail ?? {}) as { sent?: boolean };
      if (sent !== undefined) detail.sent = sent;
      seen.push(detail);
      event.preventDefault();
      return !event.defaultPrevented;
    },
  };
  return { win, seen };
};

const api = {
  draftSnapshot: () => Promise.resolve(snapshot),
} as unknown as Parameters<typeof sendMismatchNow>[0]["api"];

/** 시험의 창 세우기 — `window` 는 브라우저 전역이라 node 에 없으니 Reflect 로만 담고 거둔다. */
const holdWindow = (win: unknown) => {
  const before: unknown = Reflect.get(globalThis, "window");
  Reflect.set(globalThis, "window", win);
  return () => Reflect.set(globalThis, "window", before);
};

test('누름=보내기: 입력창이 보냈다고 답하면(sent=true) 결과는 "sent"', async () => {
  const { win, seen } = windowWithReceiver(true);
  const restore = holdWindow(win);
  let taken: MismatchSendResult | undefined;
  try {
    taken = await sendMismatchNow({
      api,
      brief: "「기능 정의」절을 「메인」화면의 실제 규칙과 같게 고쳐 줘.",
      target: { pageId: "p1" },
    });
  } finally {
    restore();
  }
  assert.equal(taken, "sent");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.send, true);
  assert.equal(seen[0]?.text, "「기능 정의」절을 「메인」화면의 실제 규칙과 같게 고쳐 줘.");
  assert.equal((seen[0]?.attachments ?? []).length, 1);
});

test('누름=보내기: 입력창이 미리 채웠다고 답하면(sent=false) 결과는 "prefilled"', async () => {
  const { win } = windowWithReceiver(false);
  const restore = holdWindow(win);
  try {
    const taken = await sendMismatchNow({ api, brief: "브리프", target: { pageId: "p1" } });
    assert.equal(taken, "prefilled");
  } finally {
    restore();
  }
});

test('누름=보내기: 받는 쪽이 sent 를 적지 않아도(옛 처리기) "prefilled" 로 떨어진다', async () => {
  const { win } = windowWithReceiver();
  const restore = holdWindow(win);
  try {
    const taken = await sendMismatchNow({ api, brief: "브리프", target: { pageId: "p1" } });
    assert.equal(taken, "prefilled");
  } finally {
    restore();
  }
});

test("고쳐서 보내기: offerMismatchToComposer 는 send 표시 없이 미리 채우기만 한다", async () => {
  const { win, seen } = windowWithReceiver();
  const restore = holdWindow(win);
  try {
    const taken = await offerMismatchToComposer({
      api,
      brief: "고쳐 볼 브리프",
      target: { docKey: "k1" },
    });
    assert.equal(taken, true);
  } finally {
    restore();
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.send, undefined);
  assert.equal(seen[0]?.text, "고쳐 볼 브리프");
});

test("누름=보내기: 받는 입력창이 없으면 false — 보낸 척하지 않는다", async () => {
  const win = { dispatchEvent: () => true };
  const restore = holdWindow(win);
  try {
    const taken = await sendMismatchNow({ api, brief: "브리프", target: { pageId: "p1" } });
    assert.equal(taken, false);
  } finally {
    restore();
  }
});

test("누름=보내기: 근거 읽기가 실패하면 이벤트도 안 뜨고 false", async () => {
  const failing = {
    draftSnapshot: () => Promise.reject(new Error("snapshot failed")),
  } as unknown as Parameters<typeof sendMismatchNow>[0]["api"];
  const win = { dispatchEvent: () => true };
  const restore = holdWindow(win);
  try {
    const taken = await sendMismatchNow({
      api: failing,
      brief: "브리프",
      target: { pageId: "p1" },
    });
    assert.equal(taken, false);
  } finally {
    restore();
  }
});

test("어긋남 카드: 화면을 기획서대로는 으뜸 손 · 고쳐서 보내기는 곁의 ghost 손", () => {
  // 으뜸 단추는 카드 안에 하나다 — 지금 카드의 단추 결(nx-btn--sm 의 으뜸 · nx-btn--ghost 의 곁손)을 지킨다.
  // 보낸 줄의 흔적(2026-11-12)이 누름 뒤의 일을 늘려 단추 머리와 글 사이가 멀어졌다 — 결은 그대로다.
  assert.match(card, /className="nx-btn nx-btn--sm"[\s\S]{0,900}?\{L\.compare\.send\}/);
  assert.match(card, /nx-btn--ghost[\s\S]{0,500}?\{L\.compare\.sendEdit\}/);
  assert.match(card, /sendEdit: \(row: DraftMismatchRow\) => Promise<void>;/);
  // 바로 나간 줄만 보낸 줄로 그린다 — 입력창을 채우는 데 그친 것은 세지 않는다(2026-11-12 기획자 체험).
  assert.match(card, /send: \(row: DraftMismatchRow\) => Promise<"sent" \| "prefilled">;/);
  assert.match(card, /result === "sent"[\s\S]{0,120}?setSent\(/);
  assert.match(card, /sent\.has\(key\)[\s\S]{0,300}?\{L\.compare\.sentRow\}/);
});

test("어긋남 카드의 세 자리: send 는 바로 보내기 · sendEdit 은 미리 채우기 — 결과값으로 토스트가 갈린다", () => {
  for (const source of [planDocView, planChat]) {
    assert.match(source, /send: \(row\)\s*=>\s*sendMismatchNow\(/);
    assert.match(source, /sendEdit: \(row\)\s*=>\s*offerMismatchToComposer\(/);
    // "sent" → 보냈다는 토스트 · "prefilled" → 미리 채웠다는 토스트 · false → 실패.
    assert.match(source, /result === false\) throw new Error\("composer away"\)/);
    assert.match(source, /result === "sent" \? L\.compare\.sentNowToast : L\.compare\.sentToast/);
  }
  // 기획서 탭은 문서가 골라져 있을 때만 손을 준다 — send/sendEdit 모두 같은 지키는 질문을 둔다.
  assert.match(planTab, /send:\s*picked === null[\s\S]*?sendMismatchNow\(/);
  assert.match(planTab, /sendEdit:\s*picked === null[\s\S]*?offerMismatchToComposer\(/);
  assert.match(planTab, /result === false\) throw new Error\("composer away"\)/);
  assert.match(planTab, /result === "sent" \? L\.compare\.sentNowToast : L\.compare\.sentToast/);
});

test("입력창: 누름=보내기는 입력창이 완전히 비었을 때만 보낸다 — 말 · 첨부 · 핀이 있으면 미리 채우기", () => {
  assert.match(composer, /send\?: boolean;/);
  assert.match(composer, /sent\?: boolean;/);
  // 즉시 보내기의 갈림 조건: send 표시 + 말 trim 빈 값 + 첨부 0 + 핀 0 + 보내는 중 아님 + 잠김 아님.
  assert.match(
    composer,
    /const sendsNow =[\s\S]{0,80}?detail\?\.send === true[\s\S]{0,120}?editorRef\.current\.text\.trim\(\) === ""[\s\S]{0,120}?editorRef\.current\.attachments\.length === 0[\s\S]{0,120}?pinsRef\.current\.length === 0[\s\S]{0,80}?!sendingRef\.current[\s\S]{0,80}?!lockedRef\.current/,
  );
  // 보내는 편집판은 브리프와 붙은 첨부뿐 — 쓰던 말 · 핀은 타지 않는다.
  assert.match(composer, /detail\.sent = true;/);
  assert.match(
    composer,
    /submitEditorRef\.current\(\{ text: detail\.text \?\? "", attachments: read \}\)/,
  );
  // 미리 채우기로 떨어지면 sent=false 를 적어 돌려주고 쓰던 말은 그대로다.
  assert.match(composer, /detail\.sent = false;/);
  assert.match(
    composer,
    /editorRef\.current\.text\.trim\(\) === ""\s*\?\s*detail\.text\s*:\s*editorRef\.current\.text/,
  );
});

test("판정 실패: 답 아래에 실패 한 줄과 다시 시도 — 실패한 시도에만 따로 다시 시도 줄이 선다", () => {
  assert.match(planChat, /message\.mismatchFailed === true/);
  assert.match(planChat, /L\.compare\.judgeFailed/);
  assert.match(planChat, /L\.compare\.retry/);
  assert.match(planChat, /L\.compare\.retryFailed/);
  // 다시 시도는 그 답의 판정을 다시 돌린다 — docKey · messageId 짝으로 간다.
  assert.match(planChat, /draftMismatchRetry\(mismatchDoc\.docKey, message\.messageId\)/);
});

test("자동 맞춰 보기 토글: AI 쪽에 한 줄 — 켬은 상태를 따르고 없으면 기본 켬", () => {
  assert.match(aiPage, /L\.planLoop\.row\b/);
  assert.match(aiPage, /L\.planLoop\.rowSub/);
  assert.match(aiPage, /daemon\.status\?\.planLoop \?\? true/);
  assert.match(aiPage, /L\.planLoop\.resumed/);
  assert.match(aiPage, /L\.planLoop\.saveFailed/);
  // 저장은 machine.set 의 planLoop — provider · 자동 설치 인자는 건드리지 않는다.
  assert.match(aiPage, /machineSet\(undefined, undefined, next\)/);
  // 낙관 표시는 상태 방송이 누른 값에 닿을 때 지워진다 — 4초 타이머가 지우지 않는다(검토 REVIEW-W2).
  assert.match(aiPage, /statusLoop === loopPending\) setLoopPending\(null\)/);
  assert.doesNotMatch(aiPage, /loopTimer|setTimeout\(\(\) => setLoopPending/);
  // 자리 — 미리보기 따라가기 줄 바로 아래에 선다(브리프 · 검토 REVIEW-W2).
  const follow = aiPage.indexOf('id="nx-ai-follow"');
  const loop = aiPage.indexOf('id="nx-ai-planloop"');
  assert.ok(follow !== -1 && loop !== -1 && follow < loop, "planLoop 줄은 followRow 줄 아래");
});

test("선로: machineSet 이 planLoop 를 셋째 선택 인자로 싣고, 다시 시도 요청이 있다", () => {
  assert.match(
    daemonClient,
    /machineSet: \(\s*provider: string \| null \| undefined,\s*agentAutoUpdate\?: boolean,\s*planLoop\?: boolean,\s*\)/,
  );
  assert.match(daemonClient, /\.\.\.\(planLoop !== undefined \? \{ planLoop \} : \{\}\)/);
  assert.match(
    daemonClient,
    /draftMismatchRetry: \(docKey: string, messageId: string\) => Promise<\{ ok: true \}>/,
  );
  assert.match(daemonClient, /type: "draft\.mismatchRetry", docKey, messageId/);
});

test("문장: 네 몫 말이 labels 에 모두 있다 — L.compare 새 다섯 · L.planLoop 넷", () => {
  assert.equal(L.compare.sendEdit, "고쳐서 보내기");
  assert.match(L.compare.sentNowToast, /보냈어요/);
  assert.match(L.compare.judgeFailed, /견주지 못/);
  assert.equal(L.compare.retry, "다시 시도");
  assert.match(L.compare.retryFailed, /다시 시도/);
  assert.match(L.planLoop.row, /맞춰/);
  assert.match(L.planLoop.rowSub, /비교해 고칠 곳을 물어요/);
  assert.match(L.planLoop.saveFailed, /설정/);
  assert.match(L.planLoop.resumed, /다시 켰어요/);
});
