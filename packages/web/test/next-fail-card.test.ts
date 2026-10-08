import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";
import { failWhy } from "../src/next/lib/thread.ts";

/**
 * 실패 카드의 이유(2026-10-07 베타 준비 분석) — 계정류는 데몬이 판정해 `failure: "account"` 로 싣는다. 카드는 그 갈래를
 * 읽을 뿐 문장을 다시 가르지 않는다(영어 원문을 웹이 정규식으로 읽으면 CLI 판마다 어긋난다).
 */

test("failWhy: 계정류가 가장 먼저다 — 한도 문장이 섞여 있어도, 다섯 번 물은 표식이 있어도", () => {
  const account = {
    failure: "account" as const,
    resultText: "usage limit reached",
    escalated: true,
  };
  assert.equal(failWhy(account, L), L.account.failWhy);
  assert.equal(failWhy({ failure: "account", resultText: null }, L), L.account.failWhy);
});

test("failWhy: 계정류가 아니면 예전 순서 그대로 — 한도 · 다섯 번 물음 · 짧은 기본", () => {
  assert.equal(failWhy({ resultText: "usage limit reached" }, L), L.chat.failLimit);
  assert.equal(failWhy({ resultText: "temporary", escalated: true }, L), L.cards.failWhy);
  assert.equal(failWhy({ resultText: null }, L), L.chat.failWhyShort);
  assert.equal(failWhy({ resultText: "Credit balance is too low" }, L), L.chat.failWhyShort);
});

test("계정류 문장은 사용자 어휘 — 요금제 · 크레딧 · 다시 로그인을 말하고 개발 어휘가 없다", () => {
  assert.match(L.account.failWhy, /요금제/);
  assert.match(L.account.failWhy, /크레딧/);
  assert.match(L.account.failWhy, /다시 로그인/);
  assert.match(L.account.failLoginNote, /다시 시도/);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("배선: 대화록은 계정류 블록에만 로그인 길을 건네고, 카드는 마지막 실패(다시 시도가 있는 카드)에만 단추를 단다", () => {
  const thread = read("../src/next/chat/Thread.tsx");
  assert.match(
    thread,
    /onLogin=\{block\.failure === "account" \? \(props\.onLogin \?\? null\) : null\}/,
  );
  assert.match(thread, /failWhy\(block, L\)/);
  const cards = read("../src/next/chat/cards.tsx");
  const fail = cards.slice(cards.indexOf("export function FailCard"));
  // 단추는 `다시 시도` 의 바닥줄(`retry &&`) 안에 있다 — 옛 실패 카드는 계정을 이미 고친 뒤일 수 있다.
  assert.ok(fail.indexOf("{retry && (") < fail.indexOf("L.account.switchAccount"));
  assert.ok(fail.indexOf("L.account.switchAccount") < fail.indexOf("L.vocab.retry"));
  const column = read("../src/next/chat/ChatColumn.tsx");
  assert.match(column, /onboardingFix\(provider === "codex" \? "login-codex" : "login-claude"\)/);
});

test("배선: 데몬이 단 갈래는 대화록 블록까지 그대로 온다", () => {
  const client = read("../src/lib/daemon-client.ts");
  assert.match(client, /failure\?: "account";/);
  assert.match(client, /event\.failure === "account" \? \{ failure: "account" as const \}/);
});
