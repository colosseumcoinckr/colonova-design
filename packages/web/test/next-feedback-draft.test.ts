import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURE_CONTEXT_MAX, FEATURE_REQUEST_MAX } from "@colonova-design/protocol";
import {
  clearDraft,
  contextError,
  emptyDraft,
  FEEDBACK_DRAFT_KEY,
  loadDraft,
  mintCommandId,
  requestError,
  restoresUncertain,
  saveDraft,
} from "../src/next/feedback/lib.ts";

/** 창과 저장소를 갈아끼운다 — 시험끼리 초안 장부를 나눠 갖지 않게. */
function withStorage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  Object.assign(globalThis, { window: { localStorage: storage } });
}

test("feedback draft: 저장과 읽기가 돌아간다", () => {
  const backing = new Map<string, string>();
  withStorage({
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => void backing.set(key, value),
    removeItem: (key) => void backing.delete(key),
  });
  clearDraft();
  assert.equal(loadDraft(), null);
  saveDraft({ request: "검색창을 원해요", context: "", attempted: false, commandId: null });
  assert.deepEqual(loadDraft(), {
    request: "검색창을 원해요",
    context: "",
    attempted: false,
    commandId: null,
  });
  assert.equal(backing.has(FEEDBACK_DRAFT_KEY), true);
});

test("feedback draft: 저장소가 막힌 실행은 메모리로 갈아앉는다", () => {
  withStorage({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  clearDraft();
  saveDraft({ request: "메모리 초안", context: "", attempted: true, commandId: "fb-1" });
  assert.deepEqual(loadDraft(), {
    request: "메모리 초안",
    context: "",
    attempted: true,
    commandId: "fb-1",
  });
});

test("feedback draft: 쓰기가 막혀도 읽기는 살아 있다 — 그림자가 낡은 값을 이긴다", () => {
  // 할당량·정책으로 setItem 이 던지는 저장소 — getItem 은 옛 값을 돌려준다.
  const backing = new Map<string, string>([
    [FEEDBACK_DRAFT_KEY, JSON.stringify({ request: "옛 값", context: "", attempted: false })],
  ]);
  withStorage({
    getItem: (key) => backing.get(key) ?? null,
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("quota");
    },
  });
  saveDraft({ request: "새 값", context: "", attempted: false, commandId: null });
  assert.deepEqual(loadDraft(), {
    request: "새 값",
    context: "",
    attempted: false,
    commandId: null,
  });
  assert.equal(
    backing.get(FEEDBACK_DRAFT_KEY),
    JSON.stringify({ request: "옛 값", context: "", attempted: false }),
  );
});

test("feedback draft: 지우기가 막혀도 낡은 저장 값이 되살아나지 않는다", () => {
  const backing = new Map<string, string>();
  withStorage({
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => void backing.set(key, value),
    removeItem: () => {
      throw new Error("policy");
    },
  });
  saveDraft({ request: "먼저 저장한 값", context: "", attempted: false, commandId: null });
  clearDraft();
  // removeItem 이 던져 저장 값이 남아 있어도, tombstone 이 읽기를 막는다.
  assert.equal(backing.has(FEEDBACK_DRAFT_KEY), true);
  assert.equal(loadDraft(), null);
  // 그 뒤의 저장은 tombstone 을 다시 이긴다.
  saveDraft({ request: "그 뒤의 값", context: "", attempted: false, commandId: null });
  assert.deepEqual(loadDraft(), {
    request: "그 뒤의 값",
    context: "",
    attempted: false,
    commandId: null,
  });
});

test("feedback draft: 어긋난 저장 값은 버린다", () => {
  // 그림자를 비운다 — 성공한 지우기 뒤에는 그림자가 남지 않는다.
  withStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  clearDraft();
  // 저장소에 직접 심은 어긋난 값 — 그림자를 거치지 않는 독립된 시험이다.
  withStorage({
    getItem: (key) => (key === FEEDBACK_DRAFT_KEY ? "{oops" : null),
    setItem: () => {},
    removeItem: () => {},
  });
  assert.equal(loadDraft(), null);
  withStorage({
    getItem: (key) => (key === FEEDBACK_DRAFT_KEY ? JSON.stringify({ nope: true }) : null),
    setItem: () => {},
    removeItem: () => {},
  });
  assert.equal(loadDraft(), null);
  withStorage({
    getItem: (key) =>
      key === FEEDBACK_DRAFT_KEY ? JSON.stringify({ request: 5, attempted: "yes" }) : null,
    setItem: () => {},
    removeItem: () => {},
  });
  // 살릴 내용이 없는 값 — 빈 초안 대신 없음으로 답한다.
  assert.equal(loadDraft(), null);
});

test("feedback draft: 성공한 쓰기 뒤에는 그림자가 남지 않는다", () => {
  // 성공한 저장 뒤에 저장소를 갈아끼운다(다시 켠 실행의 모습) — 그림자가
  // 남아 있으면 새 저장소의 값을 가려 엉뚱한 초안을 되살린다.
  withStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  saveDraft({ request: "먼저 저장한 값", context: "", attempted: false, commandId: null });
  const fresh = new Map<string, string>([
    [FEEDBACK_DRAFT_KEY, JSON.stringify({ request: "저장된 값", context: "", attempted: false })],
  ]);
  withStorage({
    getItem: (key) => fresh.get(key) ?? null,
    setItem: (key, value) => void fresh.set(key, value),
    removeItem: (key) => void fresh.delete(key),
  });
  assert.deepEqual(loadDraft(), {
    request: "저장된 값",
    context: "",
    attempted: false,
    commandId: null,
  });
  // 성공한 지우기 뒤에도 마찬가지다 — 실제 저장소의 빈 값이 그대로 보인다.
  withStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  clearDraft();
  const empty = new Map<string, string>();
  withStorage({
    getItem: (key) => empty.get(key) ?? null,
    setItem: (key, value) => void empty.set(key, value),
    removeItem: (key) => void empty.delete(key),
  });
  assert.equal(loadDraft(), null);
});

test("feedback draft: 전송 시작 표시만 확인 불가로 복원한다", () => {
  assert.equal(restoresUncertain(null), false);
  assert.equal(restoresUncertain({ ...emptyDraft(), attempted: false }), false);
  assert.equal(restoresUncertain({ ...emptyDraft(), attempted: true }), true);
});

test("feedback draft: 문지기 — 공백과 길이 한도(계약의 상수)", () => {
  assert.equal(requestError("   "), "empty");
  assert.equal(requestError(""), "empty");
  assert.equal(requestError("검색창"), null);
  assert.equal(requestError("a".repeat(FEATURE_REQUEST_MAX)), null);
  assert.equal(requestError("a".repeat(FEATURE_REQUEST_MAX + 1)), "too-long");
  assert.equal(contextError("a".repeat(FEATURE_CONTEXT_MAX)), null);
  assert.equal(contextError("a".repeat(FEATURE_CONTEXT_MAX + 1)), "too-long");
  assert.equal(contextError(""), null);
});

test("feedback draft: 명령 ID는 매번 새 값이다", () => {
  assert.notEqual(mintCommandId(), mintCommandId());
  assert.ok(mintCommandId().length > 8);
});
