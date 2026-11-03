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
  // 말: 제목 줄은 lineOf 가, 작은 줄은 요약(있을 때)과 바꿀 곳 수가 맡는다 — 바꿀 곳 수는 0일 때 서지 않는다(검토 REVIEW-W1).
  assert.match(line, /case "pending":\s*return L\.planSync\.pending\(title\);/);
  assert.match(line, /shown === "pending" && doc\.summary !== undefined/);
  assert.match(line, /shown === "pending" && doc\.changes > 0/);
  assert.match(line, /L\.planSync\.pendingChanges\(doc\.changes\)/);

  // unchanged 문서는 줄로 서지 않고, 초안 열쇠가 없는 pending 은 묻는 말 대신 제안(proposed)의
  // 말과 모양으로 떨어뜨린다 — 손이 없는 「초안도 고칠까요?」가 남지 않게(검토 REVIEW-W1).
  assert.match(line, /doc\.outcome !== "unchanged"/);
  assert.match(
    line,
    /doc\.outcome === "pending" && doc\.docKey === null \? "proposed" : doc\.outcome/,
  );

  // 세 손 — 고치기 · 건너뛰기는 shown 이 pending 일 때 한 묶음(<>)으로 선다(열쇠 없는 pending 은
  // proposed 로 떨어졌으니 이 조건 하나로 충분하다).
  const pending = /shown === "pending" && \(\s*<>([\s\S]*?)<\/>\s*\)\}/.exec(line);
  assert.ok(pending, "pending 손 묶음이 없다");
  // 고치기는 보통 소단추 — 닫는 따옴표까지 대조해 ghost 가 아님을 고정한다.
  assert.match(pending[1] ?? "", /className="nx-btn nx-btn--sm"/);
  // 건너뛰기 단추 자체의 클래스만 정확히 대조한다 — 뒤의 `보기` 단추가 대신 통과시키지 못하게(검토 REVIEW-W1).
  const skip = /<button[^>]*>([\s\S]*?)\{L\.planSync\.skip\}/.exec(pending[1] ?? "");
  assert.ok(skip, "건너뛰기 단추가 없다");
  assert.match(skip[0], /className="nx-btn nx-btn--sm nx-btn--ghost"/);
  assert.match(pending[1] ?? "", /L\.planSync\.apply\b/);
  assert.match(line, /hand\.apply\(requestId, docKey\)/);
  assert.match(line, /hand\.skip\(requestId, docKey\)/);
  assert.match(line, /L\.planSync\.applyFailed/);
  assert.match(line, /L\.planSync\.skipFailed/);

  // 모두 키보드로 닿는 진짜 단추다 — 고치기 · 건너뛰기 둘 뿐이다.
  assert.equal(pending[1]?.match(/<button/g)?.length, 2);
  assert.equal(pending[1]?.match(/type="button"/g)?.length, 2);
});

test("손 묶음 — 한 줄의 손은 nx-psync-hands 안에 함께 선다(작업 FC)", () => {
  // 좁은 칸에서 단추가 낱낱의 flex 아이템이면 첫 줄 끝과 다음 줄로 갈라져 어느 문서의
  // 손인지 헷갈린다 — 곁줄의 손은 묶음(nx-psync-hands)째 접혀야 한다.
  const hands = [...line.matchAll(/<span className="nx-psync-hands">([\s\S]*?)<\/span>/g)].map(
    (m) => m[1] ?? "",
  );
  assert.ok(hands.length >= 4, `손 묶음이 모자란다 — ${hands.length}개`);
  const docHands = hands.find((h) => h.includes("L.planSync.apply"));
  assert.ok(docHands, "문서 줄의 손 묶음이 없다");
  for (const name of ["apply", "skip", "view", "undo"]) {
    assert.match(docHands, new RegExp(`L\\.planSync\\.${name}\\b`), `${name} 손이 묶음 밖이다`);
  }
  // 실패 줄 · 연결 줄 · 고르기 줄도 같은 묶음을 쓴다.
  assert.ok(
    hands.some((h) => h.includes("L.planSync.retry")),
    "다시 시도 손이 묶음 밖이다",
  );
  assert.ok(
    hands.some((h) => h.includes("L.planSync.unlink")),
    "끊기 손이 묶음 밖이다",
  );
  assert.ok(
    hands.some((h) => h.includes("L.planSync.pick")),
    "고르기 손이 묶음 밖이다",
  );
});

test("declined 줄 — 말만 서고 손은 없다", () => {
  assert.match(line, /case "declined":\s*return L\.planSync\.declined\(title\);/);
  // declined 에 단추를 다는 묶음이 없고, `보기` 도 declined 에는 서지 않는다(shown 으로 잰다).
  assert.match(line, /shown !== "declined"/);
  assert.doesNotMatch(line, /shown === "declined" &&/);
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
