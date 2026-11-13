import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientMessage } from "../../protocol/dist/messages.js";

/**
 * 기획서(Confluence) 명령의 선로 스키마(기획서 동기화 1단계 · M2) — feedback.test.ts 의
 * parseClientMessage 양식. 선택 필드 · 필수 필드의 경계와 이메일 빈 값 거절을 못 박는다.
 * 프로세스를 띄우지 않는 순수 시험이다.
 */

test("confluence.connect — 이메일·토큰 짝이면 받고, 사이트는 정규화 전 이름 그대로 실린다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "c1",
      type: "confluence.connect",
      site: "https://colosseum.atlassian.net/wiki/",
      email: "me@example.com",
      token: "tok",
    }),
  );
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(parsed.value.type, "confluence.connect");
    const message = parsed.value as { site: string; email?: string; token?: string };
    assert.equal(message.site, "https://colosseum.atlassian.net/wiki/");
    assert.equal(message.email, "me@example.com");
  }
});

test("confluence.connect — 이메일·토큰·뿌리는 선택이다(저장된 자격으로 다시 연결하는 길)", () => {
  const parsed = parseClientMessage(
    JSON.stringify({ id: "c2", type: "confluence.connect", site: "colosseum.atlassian.net" }),
  );
  assert.ok(parsed.ok);
});

test("confluence.connect — 이메일 빈 값은 거절이다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "c3",
      type: "confluence.connect",
      site: "colosseum.atlassian.net",
      email: "",
      token: "tok",
    }),
  );
  assert.ok(!parsed.ok);
});

test("confluence.connect — 토큰 없는 이메일은 짝이 아니라 선로에서 걸린다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "c4",
      type: "confluence.connect",
      site: "colosseum.atlassian.net",
      email: "me@example.com",
    }),
  );
  assert.ok(!parsed.ok);
  if (!parsed.ok) assert.match(parsed.error, /짝/);
});

test("confluence.connect — 사이트는 필수다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({ id: "c5", type: "confluence.connect", email: "me@example.com", token: "tok" }),
  );
  assert.ok(!parsed.ok);
});

test("confluence.suggestRoots — 궁은 필수고 빈 값은 거절이다", () => {
  const ok = parseClientMessage(
    JSON.stringify({ id: "s1", type: "confluence.suggestRoots", query: "8.8 ColoNova" }),
  );
  assert.ok(ok.ok);

  const empty = parseClientMessage(
    JSON.stringify({ id: "s2", type: "confluence.suggestRoots", query: "" }),
  );
  assert.ok(!empty.ok);

  const missing = parseClientMessage(JSON.stringify({ id: "s3", type: "confluence.suggestRoots" }));
  assert.ok(!missing.ok);
});
