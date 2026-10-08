// 데몬이 대화에 내려놓는 알림 문장의 말투(2026-10-08 베타 준비 분석) — 사용자가 그대로 읽는 것은 해요체 · 사용자의 어휘이고,
// 웹이 머리말로 알아보는 표식 문장(`L.daemonNotice`)은 한 글자도 어긋나지 않는다. 소스의 글을 읽는 순수 시험이다.
//
// 읽는 사람별 분류(좁게 — 사용자가 그대로 읽는 것만 고친다):
//   표식  — `일시적인 문제입니다` · `사용량이 다시 채워지는대로` · `AI 프로그램을 다시 켰어요`. 웹 대화록이 첫머리로 알아보고 제 문장으로
//           바꿔 그린다(`noticeKind`). 바꾸면 인식이 깨져 데몬의 문장이 그대로 보인다 → 이 시험이 웹 labels 와의 일치를 지킨다.
//   사용자 — 위 셋이 아닌 `kind: "notice"` 의 text, 그리고 모든 RPC 거절이 지나는 `asPlannerFacingError` 의 문장. 앞의 한 줄이 대화록에 그대로 선다.
//   AI · 개발자 — 턴 글(표식 턴의 몸) · 도구 결과 · 로그 · 개발자 알림. 이 시험이 보지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = join(import.meta.dirname, "../src");
const session = readFileSync(join(SRC, "session.ts"), "utf8");
const dispatch = readFileSync(join(SRC, "dispatch.ts"), "utf8");
const labels = readFileSync(join(SRC, "../../web/src/next/labels.ts"), "utf8");

/** 웹이 알아보는 표식의 머리말 — labels.ts 의 `daemonNotice` 칸에서 읽는다. */
function markerHeads(): { retry: string; wait: string; revive: string } {
  const start = labels.indexOf("daemonNotice: {");
  const block = labels.slice(start, labels.indexOf("},", start));
  const head = (key: string) => new RegExp(`${key}:\\s*"([^"]+)"`).exec(block)?.[1] ?? "";
  return { retry: head("retry"), wait: head("wait"), revive: head("revive") };
}

/** `kind: "notice"` 이벤트마다 그 안의 한국어 문자열 리터럴을 모은다(`});` 에서 끊는다). */
function noticeTexts(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/kind: "notice"/g)) {
    const from = match.index ?? 0;
    const to = source.indexOf("});", from);
    const slice = source.slice(from, to === -1 ? from + 600 : to);
    for (const literal of slice.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
      const text = literal[1] ?? literal[2] ?? "";
      if (/[가-힣]/.test(text)) out.push(text);
    }
  }
  return out;
}

const heads = markerHeads();
const isMarker = (text: string) => Object.values(heads).some((head) => text.startsWith(head));

test("표식 문장: 웹 labels 의 머리말과 데몬 소스의 첫머리가 글자 그대로 같다", () => {
  assert.deepEqual(heads, {
    retry: "일시적인 문제입니다",
    wait: "사용량이 다시 채워지는대로",
    revive: "AI 프로그램을 다시 켰어요",
  });
  // 웹이 `startsWith` 로 알아본다 — 데몬의 문장이 이 머리로 시작해야 한다(재시도의 꼬리 `(n/N)` 도 그대로).
  assert.match(
    session,
    /`일시적인 문제입니다 — 같은 말로 스스로 다시 시도합니다 \(\$\{this\.retryAttempt\}\/\$\{this\.retryDelays\.length\}\)\./,
  );
  assert.match(
    session,
    /"사용량이 다시 채워지는대로 스스로 이어서 합니다 — 잠시만 기다려 주세요\."/,
  );
  assert.match(dispatch, /text: "AI 프로그램을 다시 켰어요 — 하던 일을 이어서 합니다"/);
});

test("사용자가 읽는 알림: 표식이 아닌 notice 는 모두 해요체 · 사용자의 어휘다", () => {
  const texts = [...noticeTexts(session), ...noticeTexts(dispatch)].filter(
    (text) => !isMarker(text),
  );
  assert.ok(texts.length >= 5, `훑은 알림이 너무 적다: ${texts.length}`);
  for (const text of texts) {
    assert.doesNotMatch(text, /니다(?![가-힣])/, `합쇼체: ${text}`);
    assert.doesNotMatch(text, /(?<![패리])턴|에이전트|CLI|레포|경로/, `개발 어휘: ${text}`);
  }
});

test("바꾼 문장: 로그인 복귀 · 대화 정리 · 말을 보내지 못함 · 바로 보내지 못해 기다림", () => {
  const texts = noticeTexts(session);
  assert.ok(texts.includes("로그인이 돌아왔어요 — 방금 하던 일을 이어서 해요."));
  assert.ok(texts.includes("대화가 길어져 정리한 뒤 이어서 해요 — 잠시만 기다려 주세요."));
  assert.match(
    session,
    /text: `\$\{this\.providerLabel\}에게 말을 보내지 못했어요 — 다시 보내 주세요\./,
  );
  // 웹의 `지금 답이 끝나면 바로 보낼게요`(L.chat.queuedAfter)와 같은 말로 기다림을 말한다.
  assert.ok(
    texts.some((text) =>
      text.startsWith("지금 도는 답에 바로 보내지 못했어요 — 답이 끝나면 바로 보낼게요."),
    ),
  );
  assert.match(labels, /queuedAfter: "지금 답이 끝나면 바로 보낼게요"/);
});

test("모든 RPC 거절이 지나는 문장(asPlannerFacingError)도 해요체이고 한글이라 한 번 감싸면 다시 감싸이지 않는다", () => {
  assert.match(
    session,
    /"AI와의 대화가 방금 끊겼어요 — 입력창의 말을 잠시 뒤 다시 보내면 이어져요\."/,
  );
  // 이 함수의 `한글이 든 오류는 그대로 지나간다` 규칙이 새 문장에도 맞는다 — 한글이 들어 있다.
  assert.match("AI와의 대화가 방금 끊겼어요", /[\p{Script=Hangul}]/u);
});
