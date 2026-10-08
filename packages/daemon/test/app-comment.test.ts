import assert from "node:assert/strict";
import { test } from "node:test";
// `../dist` 임포트인 이유: github.ts 가 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그 지정을 못 고친다.
import {
  APP_COMMENT_MARK,
  appAuthored,
  hasAppMark,
  isOwnAppComment,
  looksLikeLegacyAppComment,
  markAppComment,
} from "../dist/app-comment.js";
import { noticeBody } from "../dist/developer-notice.js";
import { replyFooter } from "../dist/developer-replies.js";
import { GitHubClient } from "../dist/github.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * 앱이 남긴 코멘트의 표식과 토큰 주인 코멘트의 가름(2026-10-07 베타 준비 분석). 핵심은 안전이다: 앱이 쓴 어떤
 * 코멘트도 AI 의 반영 턴이 되지 않고(되먹임 없음), 토큰 주인이 표식 없이 쓴 글은 개발자의 말로 읽힌다.
 * 프로세스를 띄우지 않는 순수 시험이다.
 */

const ME = "colonova-planner";
const row = (login: string, body: string) => ({ user: { login }, body });

test("표식 — 본문 끝에 한 줄, 이미 있으면 다시 달지 않는다", () => {
  const marked = markAppComment("안녕하세요");
  assert.equal(marked, `안녕하세요\n\n${APP_COMMENT_MARK}`);
  assert.ok(marked.split("\n")[0] === "안녕하세요", "첫 줄은 그대로다");
  assert.equal(markAppComment(marked), marked);
  assert.ok(hasAppMark(marked));
  assert.ok(!hasAppMark("<!-- 그냥 주석 -->"));
  assert.ok(!hasAppMark(undefined));
});

test("옛 앱의 글 — 앱만 쓰는 모양일 때만 읽는다(알림 · 해결된 알림 · 대리 표기 답장 · 반려 이유 청구)", () => {
  const notice = noticeBody(
    { key: "push:behind", slug: "app", title: "t", what: "w", tried: "t", ask: "a" },
    { projectName: "결제", authorName: "김기획" },
    1,
    new Date("2026-10-07T00:00:00Z"),
  );
  assert.ok(looksLikeLegacyAppComment(notice));
  assert.ok(looksLikeLegacyAppComment(`[OK] 해결됨 — ${notice}`), "해결되면 앞에 표지가 붙는다");
  assert.ok(looksLikeLegacyAppComment(`문구를 바꿨습니다.\n\n${replyFooter("김기획")}`));
  assert.ok(looksLikeLegacyAppComment(`한마디입니다\n\n${replyFooter(null)}\n`));
  assert.ok(
    looksLikeLegacyAppComment(
      "반려 이유를 남겨 주시면 AI 가 반영해 새 요청으로 다시 보냅니다. — ColoNova Design",
    ),
  );
  // 개발자가 쓴 글은 아니다 — 비슷하게 보여도 모양이 다르다.
  assert.ok(!looksLikeLegacyAppComment("LGTM"));
  assert.ok(!looksLikeLegacyAppComment("[ColoNova Design] 로고를 바꿔 주세요"));
  assert.ok(
    !looksLikeLegacyAppComment("— ColoNova Design 이 마음에 드네요 — 그런데 이 버튼은 고쳐 주세요"),
  );
  assert.ok(!looksLikeLegacyAppComment(`${replyFooter("김기획")}\n그런데 문구를 바꿔 주세요`));
  assert.ok(!looksLikeLegacyAppComment(42));
});

test("토큰 주인의 글 — 표식 없는 것은 개발자의 말이고, 앱의 표식이 있는 것만 건너뛴다", () => {
  // 개발자가 자기 토큰을 그대로 쓴 연결 — 옛 규칙은 이 코멘트를 통째로 건너뛰었다.
  assert.equal(isOwnAppComment(row(ME, "버튼 색을 바꿔 주세요"), ME), false);
  assert.equal(isOwnAppComment(row(ME, markAppComment("제 답장")), ME), true);
  assert.equal(isOwnAppComment(row(ME, replyFooter(null)), ME), true, "옛 앱의 대리 표기 답장");
  // 다른 사람의 글은 표식이 있어도(인용 · 복사) 건너뛰지 않는다 — 토큰 주인이 썼어야 한다.
  assert.equal(isOwnAppComment(row("dev1", markAppComment("인용")), ME), false);
  // 토큰 주인을 모르면(whoAmI 실패) 아무것도 건너뛰지 않는다 — 옛 규칙과 같다.
  assert.equal(isOwnAppComment(row(ME, markAppComment("제 답장")), null), false);
  assert.equal(isOwnAppComment(row(ME, markAppComment("제 답장")), ""), false);
  assert.equal(isOwnAppComment({ body: markAppComment("로그인 없는 행") }, ME), false);
  assert.ok(appAuthored(markAppComment("x")) && !appAuthored("x"));
});

/** 보낸 요청을 모으는 가짜 전송 — 코멘트 쓰기 문이 본문에 표식을 다는지 본다. */
function recording(): { transport: RestTransport; bodies: string[] } {
  const bodies: string[] = [];
  const transport: RestTransport = {
    async request(input) {
      if (input.body) bodies.push(String(JSON.parse(new TextDecoder().decode(input.body)).body));
      return { status: 201, body: new TextEncoder().encode(JSON.stringify({ id: 5 })) };
    },
  };
  return { transport, bodies };
}

test("쓰기 문 — commentOnIssue · replyToPullComment · updateIssueComment 가 모두 표식을 단다", async () => {
  const { transport, bodies } = recording();
  const client = new GitHubClient("t", transport);
  const to = { owner: "team", repo: "app" };
  await client.commentOnIssue({ ...to, number: 1, body: "알림입니다" });
  await client.replyToPullComment({ ...to, number: 1, commentId: 9, body: "답장입니다" });
  await client.updateIssueComment({ ...to, commentId: 5, body: "고친 알림" });
  // 해결 표지를 앞에 얹는 알림의 고쳐 쓰기 — 옛 본문에 표식이 있으면 다시 달지 않는다.
  await client.updateIssueComment({
    ...to,
    commentId: 5,
    body: `[OK] 해결됨 — ${markAppComment("알림입니다")}`,
  });
  assert.equal(bodies.length, 4);
  for (const body of bodies) {
    assert.ok(hasAppMark(body), body);
    assert.equal(body.split(APP_COMMENT_MARK).length, 2, "표식은 한 번만");
  }
  assert.ok(bodies[0]?.startsWith("알림입니다\n"), "첫 줄은 그대로다");
  assert.ok(bodies[3]?.startsWith("[OK] 해결됨 — 알림입니다"));
});
