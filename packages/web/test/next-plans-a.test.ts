import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { L } from "../src/next/labels.ts";
import { stashAsk, takeAsk } from "../src/next/plans/draft/pending-ask.ts";

let vite: ViteDevServer;
let PlanChat: typeof import("../src/next/plans/draft/PlanChat.tsx").PlanChat;
let DraftEditorSurface: typeof import("../src/next/plans/draft/DraftEditor.tsx").DraftEditorSurface;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null },
  });
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ PlanChat } = await vite.ssrLoadModule("/src/next/plans/draft/PlanChat.tsx"));
  ({ DraftEditorSurface } = await vite.ssrLoadModule("/src/next/plans/draft/DraftEditor.tsx"));
});
after(async () => {
  await vite?.close();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("U-109: 첫 요청은 긴 선택 원문과 절 근거를 함께 한 번 넘긴다", () => {
  const selection = "선택한 문단\n".repeat(100);
  const ask = {
    text: "이 부분을 고쳐 줘",
    selection,
    refs: [{ pageId: "other", title: "근거", version: 3, sections: ["예외"] }],
  };
  stashAsk("p-test", ask);
  assert.deepEqual(takeAsk("p-test"), ask);
  assert.equal(takeAsk("p-test"), null);
  const sent = L.drafts.questionWithSelection(ask.text, selection);
  assert.ok(sent.startsWith(ask.text));
  assert.equal(sent.split("> 선택한 문단").length - 1, 100);
});

test("U-105: 버리기 안내는 삭제 범위와 되돌릴 수 없음, 원본 보존을 전부 말한다", () => {
  for (const part of [
    "초안",
    "변경안",
    "초안 판 기록",
    "기획 대화",
    "되돌릴 수 없어요",
    "Confluence 원본은 그대로",
  ])
    assert.ok(L.drafts.discardBody.includes(part));
});

const daemon = { api: {}, status: null } as Parameters<typeof PlanChat>[0]["daemon"];
const nav = { toast: () => {} } as Parameters<typeof PlanChat>[0]["nav"];

test("U-110: 스트리밍 본문과 취소 단추는 진행 낭독 영역 밖에 선다", () => {
  const html = renderToStaticMarkup(
    createElement(PlanChat, {
      daemon,
      nav,
      docKey: "p-a",
      docTitle: "문서",
      inputRef: { current: null },
      conversation: null,
      pickedThreadId: null,
      pickThread: () => {},
      onShowInDoc: () => {},
      onConversationsChanged: () => {},
      draft: null,
      thread: {
        phase: "ready",
        thread: null,
        running: true,
        streamText: "stream-body-marker",
        reads: [],
        error: null,
        ask: async () => true,
        cancel: () => {},
        reject: async () => true,
        reload: () => {},
        retry: () => {},
      },
    }),
  );
  const statuses = [...html.matchAll(/<([a-z]+)[^>]*role="status"[^>]*>(.*?)<\/\1>/gs)].map(
    (match) => match[2],
  );
  assert.ok(statuses.some((text) => text.includes(L.drafts.aiWorking)));
  assert.ok(
    statuses.every((text) => !text.includes("stream-body-marker") && !text.includes("<button")),
  );
  assert.ok(html.includes("stream-body-marker"));
});

test("U-094: 코멘트 수를 아직 몰라도 기존 문서의 코멘트 진입은 남는다", () => {
  const view = {
    docKey: "p-a",
    pageId: "a",
    title: "문서",
    baseTitle: "문서",
    revision: 1,
    baseVersion: 2,
    blocks: [],
    state: "editing",
    stage: { notation: null, closed: false },
    pendingCommandId: null,
  };
  const draft = { phase: "ready", view, error: null, notice: null } as unknown as Parameters<
    typeof DraftEditorSurface
  >[0]["draft"];
  const html = renderToStaticMarkup(
    createElement(DraftEditorSurface, {
      daemon,
      nav,
      draft,
      site: null,
      rows: [],
      onClose: () => {},
      writable: true,
    }),
  );
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*>코멘트<\/button>/);
  assert.doesNotMatch(html, /코멘트 0/);
});

for (const phase of ["failed", "ready"] as const) {
  test(`U-197: ${phase} 오류는 기술 원문을 숨기고 한국어 안내는 보존한다`, () => {
    for (const raw of ["HTTP 500 /private/tmp/secret", "권한이 없어요"]) {
      const html = renderToStaticMarkup(
        createElement(PlanChat, {
          daemon,
          nav,
          docKey: "p-a",
          docTitle: "문서",
          inputRef: { current: null },
          conversation: null,
          pickedThreadId: null,
          pickThread: () => {},
          onShowInDoc: () => {},
          onConversationsChanged: () => {},
          draft: null,
          thread: {
            phase,
            thread: null,
            running: false,
            streamText: null,
            reads: [],
            error: raw,
            ask: async () => true,
            cancel: () => {},
            reject: async () => true,
            reload: () => {},
            retry: () => {},
          },
        }),
      );
      if (raw === "권한이 없어요") assert.ok(html.includes(raw));
      else {
        assert.doesNotMatch(html, /HTTP 500|private\/tmp\/secret/);
        assert.ok(
          html.includes(phase === "failed" ? L.drafts.convLoadFailed : L.chat.somethingWrong),
        );
      }
    }
  });
}

test("U-197: 지난 AI 답의 실패도 기술 원문을 노출하지 않는다", () => {
  const html = renderToStaticMarkup(
    createElement(PlanChat, {
      daemon,
      nav,
      docKey: "p-a",
      docTitle: "문서",
      inputRef: { current: null },
      conversation: null,
      pickedThreadId: null,
      pickThread: () => {},
      onShowInDoc: () => {},
      onConversationsChanged: () => {},
      draft: null,
      thread: {
        phase: "ready",
        thread: {
          docKey: "p-a",
          threadId: "t-a",
          messages: [
            {
              messageId: "m-a",
              role: "assistant",
              text: "",
              at: "2026-11-12T00:00:00Z",
              error: "API failure /secret",
            },
          ],
          proposals: [],
          running: false,
        },
        running: false,
        streamText: null,
        reads: [],
        error: null,
        ask: async () => true,
        cancel: () => {},
        reject: async () => true,
        reload: () => {},
        retry: () => {},
      },
    }),
  );
  assert.doesNotMatch(html, /API failure|\/secret/);
  assert.ok(html.includes(L.drafts.aiFailed));
});
