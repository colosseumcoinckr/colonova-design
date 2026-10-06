import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-update-row.test.ts 와 같은 모양).
import { type FixInput, fixState } from "../src/next/lib/agent-fix.ts";

const base: FixInput = {
  id: "codex",
  starting: null,
  startError: null,
  install: null,
  installDone: null,
  login: null,
  loginDone: null,
  loginFor: null,
};

test("fixState: 아무 일도 없으면 쉰다", () => {
  assert.deepEqual(fixState(base), { phase: "idle" });
});

test("fixState: 설치는 이 카드의 AI 것일 때만 도는 중이다 — 업데이트 진행기나 다른 AI 는 아니다", () => {
  assert.deepEqual(fixState({ ...base, install: { kind: "install-codex", line: "x" } }), {
    phase: "installing",
  });
  assert.equal(fixState({ ...base, install: { kind: "install-claude", line: "x" } }).phase, "idle");
  assert.equal(fixState({ ...base, install: { kind: "update-codex", line: "x" } }).phase, "idle");
});

test("fixState: 요청을 보낸 틈에도 도는 중이다 — 단추가 다시 서서 두 번 눌리지 않게", () => {
  assert.equal(fixState({ ...base, starting: "install" }).phase, "installing");
  assert.equal(fixState({ ...base, starting: "login" }).phase, "starting-login");
});

test("fixState: 설치가 실패로 끝나면 실패가 서고, 다시 시작하면 곧바로 물러난다", () => {
  const failed = { kind: "install-codex", ok: false, detail: "네트워크에 닿지 못했습니다" };
  assert.deepEqual(fixState({ ...base, installDone: failed }), {
    phase: "failed",
    kind: "install",
    detail: "네트워크에 닿지 못했습니다",
  });
  // 다시 시도 — 도는 방송이 먼저고 낡은 실패는 말하지 않는다.
  assert.equal(
    fixState({
      ...base,
      installDone: failed,
      install: { kind: "install-codex", line: "내려받는 중" },
    }).phase,
    "installing",
  );
  assert.equal(fixState({ ...base, installDone: failed, starting: "install" }).phase, "installing");
  // 다른 AI 의 실패 · 성공으로 끝난 설치는 이 카드의 말이 아니다.
  assert.equal(
    fixState({ ...base, installDone: { ...failed, kind: "install-claude" } }).phase,
    "idle",
  );
  assert.equal(fixState({ ...base, installDone: { ...failed, ok: true } }).phase, "idle");
});

test("fixState: 로그인 방송은 시작한 AI 의 카드에 서고, 시작한 적이 없으면 모든 카드에 선다", () => {
  const login = { url: "https://example.com/login", wantsCode: true };
  assert.deepEqual(fixState({ ...base, login, loginFor: "codex" }), {
    phase: "login",
    url: "https://example.com/login",
    wantsCode: true,
  });
  assert.equal(fixState({ ...base, login, loginFor: "claude" }).phase, "idle");
  assert.equal(fixState({ ...base, login, loginFor: null }).phase, "login");
});

test("fixState: 로그인 실패는 시작한 AI 의 카드에만 서고, 도는 로그인이 있으면 물러난다", () => {
  const loginDone = { ok: false, detail: "로그인이 끝나지 않았습니다 — expired" };
  assert.deepEqual(fixState({ ...base, loginDone, loginFor: "codex" }), {
    phase: "failed",
    kind: "login",
    detail: "로그인이 끝나지 않았습니다 — expired",
  });
  assert.equal(fixState({ ...base, loginDone, loginFor: "claude" }).phase, "idle");
  assert.equal(fixState({ ...base, loginDone, loginFor: null }).phase, "idle");
  assert.equal(
    fixState({
      ...base,
      loginDone,
      loginFor: "codex",
      login: { url: "https://example.com/login", wantsCode: false },
    }).phase,
    "login",
  );
  // 성공으로 끝난 로그인은 실패가 아니다.
  assert.equal(
    fixState({ ...base, loginDone: { ok: true, detail: "" }, loginFor: "codex" }).phase,
    "idle",
  );
});

test("fixState: 요청이 닿지 않은 이유도 실패로 선다 — 도는 일이 없을 때", () => {
  assert.deepEqual(
    fixState({ ...base, startError: { kind: "login", detail: "연결이 끊겼습니다" } }),
    {
      phase: "failed",
      kind: "login",
      detail: "연결이 끊겼습니다",
    },
  );
  assert.equal(
    fixState({
      ...base,
      starting: "install",
      startError: { kind: "install", detail: "연결이 끊겼습니다" },
    }).phase,
    "installing",
  );
});
