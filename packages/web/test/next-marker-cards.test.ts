import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 기계가 쓴 턴의 종류가 빠짐없이 갖춰졌는지 지킨다(2026-10-07 베타 준비 분석 — 새 종류 `ci` 를 더하며). 새 표식 종류를 프로토콜에
 * 더하고 카드나 커밋 제목의 분기를 잊으면 그 턴은 날것의 글(`<!-- colonova-design:… -->` 줄 포함)로 대화에 서거나 사용자의
 * 말처럼 커밋 제목이 된다. 소스를 읽는 계약 시험이다 — 렌더러 없이 분기의 존재를 본다.
 */
const here = import.meta.dirname;
const read = (path: string) => readFileSync(join(here, path), "utf8");

const marker = read("../../protocol/src/turn-marker.ts");
const thread = read("../src/next/chat/Thread.tsx");
const subject = read("../../daemon/src/common-instructions.ts");

/** 프로토콜의 표식 종류 목록(`KINDS`). */
const kinds = (() => {
  const match = /const KINDS:[^=]*=\s*\[([^\]]*)\]/.exec(marker);
  assert.ok(match, "KINDS 목록을 찾지 못했다");
  return [...(match[1] ?? "").matchAll(/"([a-z]+)"/g)].map((hit) => hit[1] ?? "");
})();

test("표식 종류 — 목록이 읽히고 새 종류 ci 가 들어 있다", () => {
  assert.ok(kinds.length >= 7, kinds.join(","));
  assert.ok(kinds.includes("ci"));
});

test("대화록 — 모든 표식 종류가 Thread 의 카드 분기를 갖는다", () => {
  for (const kind of kinds) {
    assert.ok(thread.includes(`marker?.kind === "${kind}"`), `Thread.tsx 에 ${kind} 분기가 없다`);
  }
});

test("커밋 제목 — 사용자의 말이 아닌 기계 턴은 turnSubjectOf 가 말 없는 턴으로 센다", () => {
  // comments(핀) · review(고치기)는 문장이 곧 요청의 뜻이라 제목이 된다 — 나머지는 기계의 목소리다.
  const speaks = new Set(["comments", "review"]);
  for (const kind of kinds.filter((name) => !speaks.has(name))) {
    assert.ok(
      subject.includes(`marker?.kind === "${kind}"`),
      `turnSubjectOf 의 말 없는 턴 목록에 ${kind} 가 없다`,
    );
  }
});
