import assert from "node:assert/strict";
import { test } from "node:test";
import type { EffortLevel, SessionModelInfo } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-thread.test.ts 와 같은 모양).
import { DEFAULT_EFFORT, modelName, seedEffort } from "../src/lib/chat-options.ts";
import { EFFORT_OF, effortWord } from "../src/next/lib/thread.ts";

const row = (
  over: Pick<SessionModelInfo, "value" | "displayName" | "resolvedModel">,
): SessionModelInfo => ({
  description: "",
  supportsEffort: true,
  supportedEffortLevels: null,
  supportsFastMode: false,
  ...over,
});

// Claude CLI 의 supportedModels 가 실제로 답한 모양(2026-09-29 probe).
const claude = [
  row({
    value: "default",
    displayName: "Default (recommended)",
    resolvedModel: "claude-opus-5[1m]",
  }),
  row({ value: "opus[1m]", displayName: "Opus (1M context)", resolvedModel: "claude-opus-5[1m]" }),
  row({ value: "claude-fable-5-1[1m]", displayName: "Fable", resolvedModel: "claude-fable-5-1" }),
  row({ value: "sonnet", displayName: "Sonnet", resolvedModel: "claude-sonnet-5" }),
];

test("modelName: 고른 행은 CLI 가 붙인 이름 그대로", () => {
  assert.equal(modelName(claude, "sonnet"), "Sonnet");
  assert.equal(modelName(claude, "claude-fable-5-1"), "Fable");
});

test("modelName: 고르지 않은 채(null)와 default 행은 같은 모델로 풀리는 행의 이름", () => {
  assert.equal(modelName(claude, null), "Opus (1M context)");
  assert.equal(modelName(claude, "default"), "Opus (1M context)");
  // 대화가 보고한 wire id 도 같은 행을 찾는다 — 창 표식([1m])이 빠져도.
  assert.equal(modelName(claude, "claude-opus-5[1m]"), "Opus (1M context)");
  assert.equal(modelName(claude, "claude-opus-5"), "Opus (1M context)");
});

test("modelName: 쌍이 없는 default 행은 풀린 id 를 이름으로 읽는다", () => {
  const [lone] = claude;
  assert.ok(lone);
  assert.equal(modelName([lone], null), "Opus 5");
});

test("modelName: 목록에 없는 id 는 버리지 않고 이름으로 읽는다", () => {
  assert.equal(modelName(claude, "claude-sonnet-5-5"), "Sonnet 5.5");
  assert.equal(modelName(claude, "claude-haiku-4-5-20251001"), "Haiku 4.5");
  // 날짜 꼬리는 버전이 아니다.
  assert.equal(modelName(claude, "claude-opus-5-20260101"), "Opus 5");
  assert.equal(modelName([], "some-model-2"), "some-model-2");
});

test("modelName: 아무것도 모델을 이름하지 않을 때만 null — 그때 칩은 AI 이름", () => {
  assert.equal(modelName([], null), null);
});

// 모델이 받는 단계의 실제 모양 — 예전 씨앗(가운데)은 둘 다 high(깊게)에 앉았다.
const narrowLevels: EffortLevel[] = ["low", "medium", "high", "xhigh"];
const claudeLevels: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

test("seedEffort: 고른 적 없는 생각 시간은 보통(medium)에서 시작한다", () => {
  assert.equal(DEFAULT_EFFORT, "medium");
  assert.equal(seedEffort(narrowLevels), "medium");
  assert.equal(seedEffort(claudeLevels), "medium");
  assert.equal(seedEffort(["medium"]), "medium");
  // 칩이 고른 적 없는 값(null)을 읽는 말과 씨앗이 같은 칸이다 — 보통.
  assert.equal(effortWord(null), "normal");
  assert.equal(EFFORT_OF.normal, DEFAULT_EFFORT);
  assert.equal(effortWord(DEFAULT_EFFORT), "normal");
});

test("seedEffort: 프로젝트의 처음 값은 모델이 받을 때만 이긴다", () => {
  assert.equal(seedEffort(claudeLevels, "high"), "high");
  assert.equal(seedEffort(narrowLevels, "low"), "low");
  // max 를 받지 않는 모델 — 처음 값을 버리고 보통으로.
  assert.equal(seedEffort(narrowLevels, "max"), "medium");
  assert.equal(seedEffort(claudeLevels, undefined), "medium");
});

test("seedEffort: 보통을 받지 않는 모델만 가운데, 단계를 모르면 씨앗도 없다", () => {
  assert.equal(seedEffort(["low", "high"]), "high");
  assert.equal(seedEffort(["low", "high", "max"]), "high");
  assert.equal(seedEffort(["high"]), "high");
  assert.equal(seedEffort([]), undefined);
  assert.equal(seedEffort([], "high"), undefined);
});
