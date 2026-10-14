import assert from "node:assert/strict";
import { test } from "node:test";
import { type DeveloperReview, readTurn, reviewToTurn } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가
// 그 지정을 못 고친다(developer-replies.test.ts 와 같은 길).
import { aiReviewerOf, aiReviewText } from "../dist/ai-review.js";
import { withoutMentions } from "../dist/developer-replies.js";

// AI 리뷰어의 줄 코멘트 (2026-10-14 사용자 결정) — 조직 레포에서 본 모양을 그대로 옮긴 견본.
const CODEX_INLINE =
  "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  접근성 이름도 테스트 계정으로 맞추세요**\n\n" +
  "화면에 보이는 버튼만 바뀌었지만 이 버튼의 접근성 이름은 여전히 옛 문구입니다.\n\n" +
  "Useful? React with 👍 / 👎.";

test("aiReviewerOf — 표에 있는 AI 리뷰어의 첫 글만 이름을 낸다", () => {
  const row = (login: string, extra: Record<string, unknown> = {}) => ({
    user: { login, type: "Bot" },
    ...extra,
  });
  assert.equal(aiReviewerOf(row("chatgpt-codex-connector[bot]")), "Codex");
  assert.equal(aiReviewerOf(row("claude[bot]", { in_reply_to_id: null })), "Claude");
  // 스레드의 답글은 아니다 — 우리 답장에 다시 답하면 고리가 된다.
  assert.equal(aiReviewerOf(row("claude[bot]", { in_reply_to_id: 41 })), null);
  // 표에 없는 봇(CI · 규칙 봇)과 사람은 아니다.
  assert.equal(aiReviewerOf(row("github-actions[bot]")), null);
  assert.equal(aiReviewerOf(row("pr-compliance-check-bot[bot]")), null);
  assert.equal(aiReviewerOf({ user: { login: "dev1", type: "User" } }), null);
});

test("aiReviewText — 배지는 이름만, 태그 · 굵은 글씨 · 반응 청하는 꼬리는 걷는다", () => {
  assert.equal(
    aiReviewText(CODEX_INLINE),
    "[P2] 접근성 이름도 테스트 계정으로 맞추세요\n\n화면에 보이는 버튼만 바뀌었지만 이 버튼의 접근성 이름은 여전히 옛 문구입니다.",
  );
  assert.equal(
    aiReviewText("🟡 **`locale` 이 의존성에 들어가요**"),
    "🟡 `locale` 이 의존성에 들어가요",
  );
  // 코드의 타입 인자 · JSX 는 꾸밈 태그가 아니다.
  assert.equal(
    aiReviewText("`Promise<void>` 를 돌려요 <sub>x</sub> `<Button />` `<span>`"),
    "`Promise<void>` 를 돌려요 x `<Button />` `<span>`",
  );
  // 줄머리 들여쓰기(코드 제안)는 그대로 둔다.
  assert.equal(aiReviewText("```ts\n  const a = 1;\n```"), "```ts\n  const a = 1;\n```");
  assert.equal(aiReviewText("Useful? React with 👍 / 👎."), "");
});

const aiRev = (id: number, body: string): DeveloperReview => ({
  id,
  kind: "inline",
  author: "Codex",
  body,
  pr: 12,
  path: "src/a.tsx",
  line: 3,
  at: "2026-10-14T00:00:00.000Z",
  source: "ai",
});

test("reviewToTurn — AI 리뷰어의 묶음은 따져 보고 고치라는 앞 문장과 끝의 기준, 표식의 source 를 싣는다", () => {
  const text = reviewToTurn([aiRev(7, "[P2] 접근성 이름도 맞추세요"), aiRev(8, "여백")]);
  const { marker, body } = readTurn(text);
  assert.equal(marker?.kind, "review");
  assert.equal(marker?.kind === "review" ? marker.source : undefined, "ai");
  assert.equal(marker?.kind === "review" ? marker.author : undefined, "Codex");
  assert.match(body, /AI 리뷰어의 코드 리뷰 의견 2건입니다/);
  assert.match(body, /실제로 맞는지 먼저 확인하고/);
  assert.match(body, /^1\. Codex \(#7\) \(src\/a\.tsx:3\): \[P2\] 접근성 이름도 맞추세요$/m);
  assert.match(
    body,
    /개발자에게 \(#<id>\):/,
    "답장 줄의 모양은 사람의 것과 같다 — 데몬이 같은 길로 뽑는다",
  );
  assert.match(body.trim().split("\n").at(-1) ?? "", /^끝의 기준: .*맞지 않는 의견은 고치지 말고/);
});

test("reviewToTurn — 사람의 코멘트는 옛 문장 그대로이고 표식에 source 가 없다", () => {
  const human: DeveloperReview = { ...aiRev(5, "버튼 위치"), author: "dev1" };
  delete human.source;
  const { marker, body } = readTurn(reviewToTurn([human]));
  assert.equal(marker?.kind === "review" ? marker.source : "x", undefined);
  assert.match(body, /^개발자 코멘트 1건에 답합니다/);
});

test("withoutMentions — @부름의 @ 만 걷고 메일 모양은 둔다", () => {
  assert.equal(withoutMentions("@codex address that feedback"), "codex address that feedback");
  assert.equal(withoutMentions("반영했습니다 (@claude 확인)"), "반영했습니다 (claude 확인)");
  assert.equal(withoutMentions("a@b.com"), "a@b.com");
  assert.equal(withoutMentions("{email} 로 보냈어요 @ 기호만"), "{email} 로 보냈어요 @ 기호만");
});
