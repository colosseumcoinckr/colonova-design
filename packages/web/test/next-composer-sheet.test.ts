import assert from "node:assert/strict";
// 순수 모듈 — src 에서 곧장 읽는다(next-starters.test.ts 와 같은 모양).
// DOM 은 없다 — 자리는 HTMLElement 를 흉내 낸 값으로만 세운다(모듈은 원소를 만지지 않고 참조만 쥔다).
import { test } from "node:test";
import {
  getComposerSheet,
  setComposerSheetHost,
  setComposerSheetOpen,
  subscribeComposerSheet,
  toggleComposerSheet,
} from "../src/next/lib/composer-sheet.ts";

const host = () => ({}) as HTMLElement;

/** 매 시험 뒤 공유 상태를 거둔다 — 모듈의 자리 · 열림은 전역이다. */
function reset(): void {
  setComposerSheetHost(null);
  setComposerSheetOpen(false);
}

test("처음 상태는 자리 없음 · 접힘이다", () => {
  assert.deepEqual(getComposerSheet(), { host: null, open: false });
  reset();
});

test("자리와 열림은 따로 간다 — 탭이 숨어도(자리만 남음) 열림이 유지된다", () => {
  const seat = host();
  setComposerSheetHost(seat);
  assert.deepEqual(getComposerSheet(), { host: seat, open: false });
  setComposerSheetOpen(true);
  assert.deepEqual(getComposerSheet(), { host: seat, open: true });
  // 자리를 거둬도 열림 판정은 남는다 — 대화 칸이 되살아날 때를 위한 상태.
  setComposerSheetHost(null);
  assert.deepEqual(getComposerSheet(), { host: null, open: true });
  reset();
});

test("토글은 열고 접는다 — 접힌 한 줄의 두 번째 누름이 거두는 길이다", () => {
  toggleComposerSheet();
  assert.equal(getComposerSheet().open, true);
  toggleComposerSheet();
  assert.equal(getComposerSheet().open, false);
  reset();
});

test("같은 값으로 다시 쓰면 듣는 손을 부르지 않고 같은 객체를 돌려준다", () => {
  const seat = host();
  setComposerSheetHost(seat);
  setComposerSheetOpen(true);
  let calls = 0;
  const off = subscribeComposerSheet(() => {
    calls += 1;
  });
  setComposerSheetHost(seat);
  setComposerSheetOpen(true);
  assert.equal(calls, 0);
  // 스냅샷은 값이 같으면 같은 객체여야 한다(useSyncExternalStore 가 믿는 약속).
  assert.equal(getComposerSheet(), getComposerSheet());
  setComposerSheetOpen(false);
  assert.equal(calls, 1);
  off();
  reset();
});

test("듣는 손은 자리 · 열림 어느 변화든 듣고, 거둔 뒤에는 부르지 않는다", () => {
  let calls = 0;
  const off = subscribeComposerSheet(() => {
    calls += 1;
  });
  setComposerSheetHost(host());
  setComposerSheetOpen(true);
  assert.equal(calls, 2);
  off();
  setComposerSheetOpen(false);
  assert.equal(calls, 2);
  reset();
});
