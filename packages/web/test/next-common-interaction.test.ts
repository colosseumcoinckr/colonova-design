import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { KeyboardEvent } from "react";
import { seedModalFocus, visibleFocusable } from "../src/hooks/focusable.ts";
import { type CopyState, createCopyController } from "../src/next/lib/copy-controller.ts";
import { composing } from "../src/next/lib/ime.ts";
import { createLatestRequest } from "../src/next/lib/latest-request.ts";
import { createPopoverStack } from "../src/next/lib/popover-stack.ts";
import { scrollBehavior, scrollToTarget } from "../src/next/lib/scroll-to-target.ts";

test("U-193: 조합 중 Esc · Enter 는 취소 · 전송 · 기본 동작에 손대지 않는다", () => {
  for (const key of ["Escape", "Enter"])
    for (const signal of [
      { isComposing: true, keyCode: 0 },
      { isComposing: false, keyCode: 229 },
    ]) {
      const calls: string[] = [];
      const event = {
        key,
        nativeEvent: { isComposing: signal.isComposing },
        keyCode: signal.keyCode,
        preventDefault: () => calls.push("prevent"),
      } as unknown as KeyboardEvent;
      const handle = () => {
        if (composing(event)) return;
        event.preventDefault();
        calls.push(key);
      };
      handle();
      assert.deepEqual(calls, []);
    }
  assert.equal(
    composing({ nativeEvent: { isComposing: false }, keyCode: 13 } as KeyboardEvent),
    false,
  );
});

test("U-193: 열한 입력 처리기는 공통 검사에서 먼저 돌아간다", () => {
  const files = [
    "plans/comments/CommentComposer.tsx",
    "plans/draft/DraftEditor.tsx",
    "plans/view/DocLabels.tsx",
    "plans/PlansList.tsx",
    "plans/comments/DocDrawer.tsx",
    "plans/draft/PlanChat.tsx",
    "onboarding/FirstRun.tsx",
  ];
  const count = files.reduce(
    (sum, file) =>
      sum +
      [
        ...readFileSync(new URL(`../src/next/${file}`, import.meta.url), "utf8").matchAll(
          /(?:onKeyDown=\{\(event\) => \{|const on(?:KeyDown|PaneKey|InputKeyDown|Escape|ColumnKey) = \(event:[^\n]+\) => \{)\s*(?:if \(event.key[^\n]+\) return;\s*)?if \(composing\(event\)\) return;/g,
        ),
      ].length,
    0,
  );
  assert.equal(count, 11);
});

test("늦은 답: 순서 역전 · 대상 변경 · 같은 대상으로 복귀 · 닫힘", () => {
  const gate = createLatestRequest<string>();
  const old = gate.begin("a");
  const latest = gate.begin("a");
  assert.equal(gate.isCurrent(old, "a"), false);
  assert.equal(gate.isCurrent(latest, "b"), false);
  assert.equal(gate.isCurrent(latest, "a"), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(latest, "a"), false);
  const returned = gate.begin("a");
  assert.equal(gate.isCurrent(latest, "a"), false);
  assert.equal(gate.isCurrent(returned, "a"), true);
  assert.equal(createLatestRequest<string>().isCurrent(returned, "a"), false);
});

test("U-130: 형제 팝은 교체하고 자식 팝만 맨 위 Esc 를 소유한다", () => {
  const stack = createPopoverStack<string>();
  const closed: string[] = [];
  const offA = stack.add("a", () => closed.push("a"));
  stack.add("b", () => closed.push("b"));
  assert.deepEqual(closed, ["a"]);
  offA();
  assert.equal(stack.isTop("b"), true);
  const offChild = stack.add(
    "child",
    () => {},
    (node) => node === "b",
  );
  assert.equal(stack.isTop("b"), false);
  assert.equal(stack.isTop("child"), true);
  offChild();
  assert.equal(stack.isTop("b"), true);
});

Object.defineProperty(globalThis, "getComputedStyle", {
  configurable: true,
  writable: true,
  value: () => ({ visibility: "visible" }),
});

test("U-131 · U-196: disabled · inert · 숨김 · 음수 tabIndex 는 후보가 아니다", (t) => {
  t.mock.method(globalThis, "getComputedStyle", (el: { visibility: string }) => ({
    visibility: el.visibility,
  }));
  const node = (patch = {}) =>
    ({
      tabIndex: 0,
      matches: () => false,
      closest: () => null,
      getClientRects: () => [1],
      visibility: "visible",
      ...patch,
    }) as unknown as HTMLElement;
  assert.equal(visibleFocusable(node()), true);
  for (const patch of [
    { tabIndex: -1 },
    { matches: () => true },
    { closest: () => ({}) },
    { getClientRects: () => [] },
    { visibility: "hidden" },
    { visibility: "collapse" },
  ])
    assert.equal(visibleFocusable(node(patch)), false);
});

test("U-093: 이미 들어온 autoFocus 는 판의 처음 초점에 빼앗기지 않는다", (t) => {
  const calls: string[] = [];
  const input = {
    focus: () => calls.push("input"),
    tabIndex: 0,
    matches: () => false,
    closest: () => null,
    getClientRects: () => [1],
  } as unknown as HTMLElement;
  t.mock.method(globalThis, "getComputedStyle", () => ({ visibility: "visible" }));
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: input },
  });
  try {
    const panel = {
      contains: (el: unknown) => el === input,
      focus: () => calls.push("panel"),
    } as HTMLElement;
    seedModalFocus(panel);
    assert.deepEqual(calls, []);
    seedModalFocus(panel, input);
    assert.deepEqual(calls, ["input"]);
  } finally {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("U-194: 동작 줄이기는 auto, 일반 설정은 smooth", () => {
  assert.equal(scrollBehavior(true), "auto");
  assert.equal(scrollBehavior(false), "smooth");
  scrollToTarget(null);
});

test("U-195: 준비 중 중복 복사는 막고 실패 원문은 남긴다", async () => {
  const states: CopyState[] = [];
  let release!: (text: string) => void;
  let writes = 0;
  let fails = 0;
  const copy = createCopyController({
    write: async () => {
      writes++;
      throw Error("denied");
    },
    changed: (state) => states.push(state),
    failed: () => fails++,
    schedule: () => 1,
    cancel: () => {},
  });
  const pending = copy.copy(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await copy.copy("duplicate");
  release("original");
  await pending;
  assert.equal(writes, 1);
  assert.equal(fails, 1);
  assert.deepEqual(states, [
    { phase: "copying", text: null },
    { phase: "failed", text: "original" },
  ]);
});

test("U-195: 마지막 성공 타이머만 남고 언마운트 뒤 완료는 무시한다", async () => {
  const states: CopyState[] = [];
  const cancelled: unknown[] = [];
  let id = 0;
  let release!: () => void;
  const copy = createCopyController({
    write: async () => {},
    changed: (state) => states.push(state),
    failed: () => {},
    schedule: () => ++id,
    cancel: (timer) => cancelled.push(timer),
  });
  await copy.copy("one");
  await copy.copy("two");
  copy.dispose();
  assert.deepEqual(cancelled, [1, 2]);
  const late = createCopyController({
    write: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    changed: (state) => states.push(state),
    failed: () => {},
    schedule: () => ++id,
    cancel: () => {},
  });
  const pending = late.copy("three");
  late.dispose();
  release();
  await pending;
  assert.equal(states.at(-1)?.phase, "copying");
  assert.equal(id, 2);
});
