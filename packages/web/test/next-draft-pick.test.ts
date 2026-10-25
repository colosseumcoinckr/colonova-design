import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionModelInfo } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-work-ledger.test.ts 와 같은 모양).
import {
  DRAFT_PICK_KEY,
  type DraftPick,
  readDraftPick,
  seedDraftPick,
  writeDraftPick,
} from "../src/next/plans/draft/draft-pick.ts";

/**
 * 기획 AI 의 모델 · 생각 시간 고름(2026-10-26 사용자 요청) — 저장된 고름의 읽기 · 쓰기와
 * 모델 목록이 처음 닿았을 때의 씨앗을 본다. 씨앗의 규칙은 화면 대화의 next 씨앗(useSessions)과
 * 같다는 것이 요점이다: 모델은 default 줄, 생각 시간은 받는 단계 가운데 보통.
 */

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function modelRow(overrides: Partial<SessionModelInfo> = {}): SessionModelInfo {
  return {
    value: "claude-sonnet-5",
    displayName: "Sonnet 5",
    resolvedModel: null,
    description: null,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportsFastMode: true,
    ...overrides,
  };
}

const NO_PICK: DraftPick = { model: null, effort: null };

test("readDraftPick — 없거나 깨진 기록은 고른 적 없는 것과 같다", () => {
  assert.deepEqual(readDraftPick(fakeStorage()), NO_PICK);
  assert.deepEqual(readDraftPick(fakeStorage({ [DRAFT_PICK_KEY]: "{깨진" })), NO_PICK);
  assert.deepEqual(
    readDraftPick(fakeStorage({ [DRAFT_PICK_KEY]: JSON.stringify({ model: 3, effort: null }) })),
    NO_PICK,
  );
  // 모르는 생각 시간 단계는 옛 기록이라도 못 믿는다 — 고른 적 없는 것으로 돌아간다.
  assert.deepEqual(
    readDraftPick(
      fakeStorage({ [DRAFT_PICK_KEY]: JSON.stringify({ model: "x", effort: "매우깊게" }) }),
    ),
    NO_PICK,
  );
});

test("readDraftPick · writeDraftPick — 고른 값을 왕복으로 저장한다", () => {
  const storage = fakeStorage();
  writeDraftPick(storage, { model: "claude-opus-5", effort: "high" });
  assert.deepEqual(readDraftPick(storage), { model: "claude-opus-5", effort: "high" });
  writeDraftPick(storage, { model: "default", effort: null });
  assert.deepEqual(readDraftPick(storage), { model: "default", effort: null });
});

test("seedDraftPick — 모델은 default 줄, 생각 시간은 받는 단계 가운데 보통", () => {
  const models = [
    modelRow({ value: "default", displayName: "Default (recommended)" }),
    modelRow({ value: "claude-opus-5", displayName: "Opus 5" }),
  ];
  assert.deepEqual(seedDraftPick(NO_PICK, models), { model: "default", effort: "medium" });
});

test("seedDraftPick — default 줄이 없으면 첫 줄이, 보통이 없으면 가운데 단계가 씨앗이다", () => {
  const only = [modelRow()];
  assert.deepEqual(seedDraftPick(NO_PICK, only), { model: "claude-sonnet-5", effort: "medium" });
  const narrow = [modelRow({ supportedEffortLevels: ["high", "xhigh"] })];
  assert.deepEqual(seedDraftPick(NO_PICK, narrow), { model: "claude-sonnet-5", effort: "xhigh" });
});

test("seedDraftPick — 생각 시간이 없는 모델은 모델만 씨앗이다", () => {
  const flat = modelRow({ supportsEffort: false, supportedEffortLevels: null });
  assert.deepEqual(seedDraftPick(NO_PICK, [flat]), { model: "claude-sonnet-5", effort: null });
});

test("seedDraftPick — 이미 고른 칸은 채우지 않고, 빈 목록 · 다 찬 고름은 씨앗이 없다", () => {
  assert.equal(seedDraftPick(NO_PICK, []), null);
  assert.equal(
    seedDraftPick({ model: "claude-opus-5", effort: "high" }, [modelRow()]),
    null,
    "다 고른 고름에는 씨앗이 없다",
  );
  // 모델만 골랐으면 생각 시간만 채운다.
  assert.deepEqual(seedDraftPick({ model: "claude-sonnet-5", effort: null }, [modelRow()]), {
    model: "claude-sonnet-5",
    effort: "medium",
  });
  // 골라 놓은 모델이 목록에 없으면 받는 단계를 모르니 생각 시간을 함부로 채우지 않는다.
  assert.equal(seedDraftPick({ model: "다른-모델", effort: null }, [modelRow()]), null);
});
