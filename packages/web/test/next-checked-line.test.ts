import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";

/**
 * `고친 화면` 카드의 확인 줄(2026-10-06 UX 점검) — 턴 끝의 자동 확인이 문제 없이 지나갔을 때 열어 본 화면의 수와 본
 * 것을 한 줄로 말한다. 말이 사실보다 크면 안 된다: 휴대폰 폭은 그 점검이 실제로 돈 때만 말하고, 비개발자의 말로
 * 쓴다(개발 어휘 없이).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("확인 줄: 열어 본 화면의 수를 말한다", () => {
  assert.match(L.requestResult.checked(3, false), /화면 3곳을 다시 열어 확인했어요/);
  assert.match(L.requestResult.checked(1, true), /화면 1곳을 다시 열어 확인했어요/);
});

test("확인 줄: 휴대폰 폭은 점검이 돈 때만 말한다 — 안 본 것을 봤다고 하지 않는다", () => {
  assert.match(L.requestResult.checked(2, true), /휴대폰 크기에서도 옆으로 밀리지 않아요/);
  assert.doesNotMatch(L.requestResult.checked(2, false), /휴대폰|밀리/);
  // 어느 쪽이든 본 것은 화면이 비지 않았고 오류가 없다는 것까지다 — 접근성 · 대비 같은 말은 하지 않는다.
  for (const phone of [true, false]) {
    assert.match(L.requestResult.checked(2, phone), /비거나 오류가 나는 곳이 없/);
    assert.doesNotMatch(L.requestResult.checked(2, phone), /접근성|대비|콘솔|뷰포트|렌더/);
  }
});

test("이음매: 데몬의 기록이 선로 · 대화록 복원 · 카드까지 간다", () => {
  const client = read("../src/lib/daemon-client.ts");
  // screens.saved 가 사용자 줄에 checked 를 덧붙이고, user.echo(복원)도 그대로 옮긴다.
  assert.match(
    client,
    /changedScreens: event\.screens,\s*\.\.\.\(event\.checked \? \{ checked: event\.checked \} : \{\}\)/,
  );
  assert.match(
    client,
    /\.\.\.\(event\.checked \? \{ checked: event\.checked \} : \{\}\),\s*id: `u\$\{\+\+noticeSeq\}`/,
  );
  const thread = read("../src/next/chat/Thread.tsx");
  assert.match(thread, /\{result\?\.checked && \(\s*<p className="nx-results-checked">/);
});
