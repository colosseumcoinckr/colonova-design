import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: 번역기는 protocol 의 `.js` 지정자를 부른다 — src 직접 로드는 그것을 못 고친다.
import { MessageTranslator } from "../dist/agent/drivers/claude/event-mapper.js";

/**
 * 실측(2026-10-07, CLI 2.1.292 에 틀린 키를 먹여 얻은 스트림): API 가 끝내 실패하면 CLI 는 합성
 * assistant 메시지(`is_api_error_message: true`)에 `error: "authentication_failed"` 를 달고, 이어
 * result 는 `is_error: true` · `api_error_status` · `result` 문장만 싣는다 — 오류 코드는 result 에 없다.
 * 번역기가 그 코드를 턴 끝(`turn.end.errorCode`)으로 이어 주는지 지킨다.
 */

const syntheticError = (error: string, text: string, parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  error,
  is_api_error_message: true,
  message: { id: "msg_synth", role: "assistant", content: [{ type: "text", text }] },
});

const result = (extra: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  is_error: true,
  api_error_status: 401,
  result: "Failed to authenticate. API Error: 401 API key is invalid.",
  duration_ms: 1000,
  num_turns: 1,
  total_cost_usd: 0,
  ...extra,
});

function turnEnds(events: ChatEvent[]): Array<ChatEvent & { kind: "turn.end" }> {
  return events.filter(
    (event): event is ChatEvent & { kind: "turn.end" } => event.kind === "turn.end",
  );
}

test("실패한 턴의 끝에 CLI 의 오류 코드가 실린다", () => {
  const translator = new MessageTranslator();
  const events = [
    ...translator.translate(syntheticError("billing_error", "Credit balance is too low")),
    ...translator.translate(result({ result: "Credit balance is too low", api_error_status: 400 })),
  ];
  const [end] = turnEnds(events);
  assert.equal(end?.isError, true);
  assert.equal(end?.errorCode, "billing_error");
  assert.equal(end?.resultText, "Credit balance is too low");
});

test("코드는 한 턴의 것이다 — 다음 턴의 실패가 옛 코드를 입지 않는다", () => {
  const translator = new MessageTranslator();
  translator.translate(syntheticError("account_on_hold", "Your account is on hold"));
  const [first] = turnEnds(translator.translate(result()));
  assert.equal(first?.errorCode, "account_on_hold");
  // 코드가 없는 다음 실패(예: 크래시 result)는 코드가 없다.
  const [second] = turnEnds(translator.translate(result({ subtype: "error_during_execution" })));
  assert.equal(second?.isError, true);
  assert.equal("errorCode" in (second ?? {}), false);
});

test("성공한 턴에는 코드를 싣지 않는다 — 중간에 복구된 API 오류가 성공 턴을 입지 않는다", () => {
  const translator = new MessageTranslator();
  translator.translate(syntheticError("overloaded", "API Error: 529 Overloaded"));
  const [end] = turnEnds(translator.translate(result({ is_error: false, result: "다 했어요" })));
  assert.equal(end?.isError, false);
  assert.equal("errorCode" in (end ?? {}), false);
  // 그리고 비워진다 — 그다음 실패가 그 옛 코드를 물려받지 않는다.
  const [next] = turnEnds(translator.translate(result()));
  assert.equal("errorCode" in (next ?? {}), false);
});

test("하위 에이전트의 API 오류는 이 턴의 코드가 아니다", () => {
  const translator = new MessageTranslator();
  translator.translate(syntheticError("billing_error", "Credit balance is too low", "toolu_sub"));
  const [end] = turnEnds(translator.translate(result()));
  assert.equal("errorCode" in (end ?? {}), false);
});

test("합성 오류 메시지의 문장은 지금처럼 답변 글로도 흐른다 — 이 변경이 번역을 바꾸지 않는다", () => {
  const translator = new MessageTranslator();
  const events = translator.translate(syntheticError("billing_error", "Credit balance is too low"));
  assert.deepEqual(
    events.map((event) => event.kind),
    ["text.done"],
  );
});
