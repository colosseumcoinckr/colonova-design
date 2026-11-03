import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 같이 고치기 게이트의 곁줄 카드(2026-11-03 A안 1A-1 · 1A-2 — 작업 W1). 판정이 끝나면 `pending` 줄이
 * 「고치기 · 건너뛰기 · 보기」 세 손을 서고, `declined` 는 말만 남고, 문서를 고르기도 전의 실패는
 * `다시 시도` 줄로 다시 돌린다. 시험 러너가 .tsx 를 굴리지 않으므로 기존 시험의 결대로 마크업과 선로
 * 계약을 소스에서 글로 읽는다(next-band-frame · next-labels 와 같은 방식).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const line = read("../src/next/chat/PlanSyncLine.tsx");
const column = read("../src/next/chat/ChatColumn.tsx");
const client = read("../src/lib/daemon-client.ts");

test("pending 줄 — 제목 · 요약 · 바꿀 곳 수와 세 손이 함께 선다", () => {
  // 말: 제목 줄은 lineOf 가, 작은 줄은 요약(있을 때)과 바꿀 곳 수가 맡는다 — 바꿀 곳 수는 0일 때 서지 않는다.
  assert.match(line, /case "pending":\s*return L\.planSync\.pending\(doc\.title\);/);
  assert.match(line, /doc\.outcome === "pending" && doc\.summary !== undefined/);
  assert.match(line, /doc\.outcome === "pending" && doc\.changes > 0/);
  assert.match(line, /L\.planSync\.pendingChanges\(doc\.changes\)/);

  // pending 인데 초안 열쇠가 없으면 누를 것이 없다 — 줄 자체를 걸러 세우지 않는다(검토 반영).
  assert.match(line, /doc\.outcome !== "pending" \|\| doc\.docKey !== null/);

  // 세 손 — 고치기 · 건너뛰기는 초안 열쇠가 있을 때 한 묶음(<>)으로 선다.
  const pending =
    /doc\.outcome === "pending" && doc\.docKey !== null && \(\s*<>([\s\S]*?)<\/>\s*\)\}/.exec(line);
  assert.ok(pending, "pending 손 묶음이 없다");
  // 고치기는 보통 소단추 — 닫는 따옴표까지 대조해 ghost 가 아님을 고정한다.
  assert.match(pending[1] ?? "", /className="nx-btn nx-btn--sm"/);
  // 건너뛰기 단추 자체에 대해 ghost 를 정확히 대조한다(뒤의 보기 단추가 대신 통과시키지 못하게).
  assert.match(pending[1] ?? "", /className="nx-btn nx-btn--sm nx-btn--ghost"/);
  assert.match(pending[1] ?? "", /L\.planSync\.apply\b/);
  assert.match(pending[1] ?? "", /L\.planSync\.skip\b/);
  assert.match(line, /hand\.apply\(requestId, docKey\)/);
  assert.match(line, /hand\.skip\(requestId, docKey\)/);
  assert.match(line, /L\.planSync\.applyFailed/);
  assert.match(line, /L\.planSync\.skipFailed/);

  // 모두 키보드로 닿는 진짜 단추다 — 고치기 · 건너뛰기 둘 뿐이다.
  assert.equal(pending[1]?.match(/<button/g)?.length, 2);
  assert.equal(pending[1]?.match(/type="button"/g)?.length, 2);
});

test("declined 줄 — 말만 서고 손은 없다", () => {
  assert.match(line, /case "declined":\s*return L\.planSync\.declined\(doc\.title\);/);
  // declined 에 단추를 다는 묶음이 없다.
  assert.doesNotMatch(line, /outcome === "declined"[\s\S]{0,120}<button/);
  // `보기` 도 declined 에는 서지 않는다.
  assert.match(line, /doc\.outcome !== "declined"/);
});

test("전체 실패 줄 — 문서 없이 failure 만 있어도 서고 다시 시도로 잇는다", () => {
  // failure 만 있는 결과도 곁줄이 선다 — 조기 반환이 failure 를 본다.
  assert.match(line, /sync\.failure === undefined\s*\)\s*\n?\s*return null;/);
  assert.match(line, /sync\.failure !== undefined && \(/);
  assert.match(line, /L\.planSync\.failedAll/);
  assert.match(line, /hand\.retry\(requestId\)/);
  assert.match(line, /L\.planSync\.retryFailed/);
  assert.match(line, /L\.planSync\.retry\b/);
});

test("손 계약 — PlanSyncHand 에 apply · skip · retry 가 있고 대화 칸이 api 로 잇는다", () => {
  for (const name of ["apply", "skip", "retry"]) {
    assert.match(line, new RegExp(`${name}: \\(requestId: string[^)]*\\) => Promise<void>`));
  }
  assert.match(column, /api\.draftSyncApply\(activeId, requestId, docKey\)/);
  assert.match(column, /api\.draftSyncSkip\(activeId, requestId, docKey\)/);
  assert.match(column, /api\.draftSyncRetry\(activeId, requestId\)/);
});

test("선로 계약 — 세 요청이 프로토콜의 이름과 인자로 나간다(syncPick 과 같은 창)", () => {
  assert.match(client, /\{ type: "draft\.syncApply", sessionId, requestId, docKey \}, 60_000/);
  assert.match(client, /\{ type: "draft\.syncSkip", sessionId, requestId, docKey \}, 60_000/);
  assert.match(client, /\{ type: "draft\.syncRetry", sessionId, requestId \}, 60_000/);
  // api 형태에도 같은 자리에 선다.
  for (const name of ["draftSyncApply", "draftSyncSkip", "draftSyncRetry"]) {
    assert.match(client, new RegExp(`${name}: \\(sessionId: string`));
  }
});
