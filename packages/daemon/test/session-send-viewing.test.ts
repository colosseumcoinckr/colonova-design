import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseClientMessage } from "@colonova-design/protocol";

/**
 * `session.send` 의 `viewing`(2026-10-06) — 보낸 순간 미리보기가 보여 주던 경로. 선택 필드라 옛 클라이언트의
 * 보내기는 그대로 되고(선로 버전은 올리지 않는다), 비었거나 너무 길면 선로가 막는다.
 */
const send = (extra: Record<string, unknown>) =>
  parseClientMessage(
    JSON.stringify({ id: "1", type: "session.send", sessionId: "s", text: "고쳐 줘", ...extra }),
  );

test("viewing 은 선택 필드다 — 없어도 된다", () => {
  assert.equal(send({}).ok, true);
});

test("viewing 은 경로 하나를 싣는다", () => {
  const read = send({ viewing: { path: "/members?tab=2" } });
  assert.equal(read.ok, true);
  if (read.ok && read.value.type === "session.send") {
    assert.deepEqual(read.value.viewing, { path: "/members?tab=2" });
  }
});

test("viewing 이 비었거나 너무 길거나 모양이 다르면 막는다", () => {
  assert.equal(send({ viewing: { path: "" } }).ok, false);
  assert.equal(send({ viewing: { path: "/".repeat(2_001) } }).ok, false);
  assert.equal(send({ viewing: "/members" }).ok, false);
});

// 데몬 안의 이음매 — 선로 → 세션 → 대기 방의 말 → 수정 전 사진의 차례. 한 곳만 빠져도 조용히 예전으로 돌아간다.
const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("viewing 은 dispatch → 세션 → 보내는 말 → 수정 전 사진의 차례로 간다", () => {
  assert.match(
    src("dispatch.ts"),
    /carrier\.send\(text, message\.attachments, message\.pins, message\.mode, message\.viewing\)/,
  );
  assert.match(src("session.ts"), /\.\.\.\(viewing \? \{ viewing \} : \{\}\),/);
  assert.match(
    src("server.ts"),
    /beforeRoutes\(\{ pins: item\.pins, viewing: item\.viewing, known \}\)/,
  );
});

test("viewing 은 게이트 입력이 아니다 — notePinned 는 핀만 받는다", () => {
  const server = src("server.ts");
  assert.match(
    server,
    /for \(const pin of pins\) this\.drivers\.notePinned\(sessionId, pin\.screen\);/,
  );
  assert.doesNotMatch(server, /notePinned\([^)]*viewing/);
});
