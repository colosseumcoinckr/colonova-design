import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entryPane,
  PANE_MEMORY_PREFIX,
  readPaneMemory,
  writePaneMemory,
} from "../src/next/lib/pane-memory.ts";

/**
 * 프로젝트별 마지막 자리(2026-10-31 홈 걷기 §2) — 앱을 열거나 프로젝트를 옮길 때 그 프로젝트가 마지막으로
 * 있던 자리로 돌아간다. 기억이 없으면 화면 자리다. 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
 */

/** 가짜 저장소 — 저장이 막히는 기계도 흉내 낸다. */
const fakeStorage = (rows: Map<string, string> = new Map(), broken = false): Storage =>
  ({
    getItem: (key: string) => {
      if (broken) throw new Error("blocked");
      return rows.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("blocked");
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      if (broken) throw new Error("blocked");
      rows.delete(key);
    },
    clear: () => rows.clear(),
    key: () => null,
    get length() {
      return rows.size;
    },
  }) as Storage;

test("기억 없는 프로젝트는 화면 자리로 들어선다", () => {
  const storage = fakeStorage();
  assert.equal(readPaneMemory(storage, "alpha"), null);
  assert.equal(entryPane(storage, "alpha"), "preview");
  // 아직 등록부가 모르는 프로젝트(null)도 화면 자리다.
  assert.equal(entryPane(storage, null), "preview");
  assert.equal(entryPane(storage, undefined), "preview");
});

test("기억이 있으면 그 자리로 — 기획서든 화면이든", () => {
  const storage = fakeStorage(new Map([[`${PANE_MEMORY_PREFIX}alpha`, "plans"]]));
  assert.equal(readPaneMemory(storage, "alpha"), "plans");
  assert.equal(entryPane(storage, "alpha"), "plans");
  const screen = fakeStorage(new Map([[`${PANE_MEMORY_PREFIX}beta`, "preview"]]));
  assert.equal(entryPane(screen, "beta"), "preview");
});

test("모르는 값은 기억 없는 것과 같다 — 낡은 · 깨진 기록이 자리를 가리지 않는다", () => {
  const storage = fakeStorage(new Map([[`${PANE_MEMORY_PREFIX}alpha`, "home"]]));
  assert.equal(readPaneMemory(storage, "alpha"), null);
  assert.equal(entryPane(storage, "alpha"), "preview");
});

test("쓴 기억은 프로젝트마다 따로 산다", () => {
  const storage = fakeStorage();
  writePaneMemory(storage, "alpha", "plans");
  writePaneMemory(storage, "beta", "preview");
  assert.equal(readPaneMemory(storage, "alpha"), "plans");
  assert.equal(readPaneMemory(storage, "beta"), "preview");
  // 다시 쓰면 덮는다.
  writePaneMemory(storage, "alpha", "preview");
  assert.equal(readPaneMemory(storage, "alpha"), "preview");
});

test("저장이 막혀도 흐르는 코드는 멈추지 않고, 읽기는 기억 없음으로 답한다", () => {
  const broken = fakeStorage(new Map(), true);
  assert.equal(readPaneMemory(broken, "alpha"), null);
  assert.doesNotThrow(() => writePaneMemory(broken, "alpha", "plans"));
  assert.equal(entryPane(broken, "alpha"), "preview");
});
