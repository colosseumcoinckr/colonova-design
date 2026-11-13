import assert from "node:assert/strict";
import { test } from "node:test";
import { mirrorPlainText, searchDocs } from "../dist/doc-meta.js";

test("검색은 이름·숫자 엔티티를 푼 글에서 일치 위치와 요약을 만든다", () => {
  const text = mirrorPlainText(
    "---\ntitle: hidden\n---\n\n# Zone &mdash; **정책** &middot; 오차 &plusmn;1 &#x26; &#8212; 끝",
  );
  assert.equal(text, "Zone — 정책 · 오차 ±1 & — 끝");
  const hits = searchDocs([{ pageId: "1", title: "규칙", text }], "±1");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.snippet, text);
  assert.equal(searchDocs([{ pageId: "1", title: "규칙", text }], "mdash").length, 0);
});
test("풀린 글의 길이로 요약을 자르며 태그처럼 보이는 글도 문자열로 남긴다", () => {
  const text = mirrorPlainText(
    `${"&middot;".repeat(80)} Zone ${"&plusmn;".repeat(120)} &lt;script&gt;x&lt;/script&gt; &unknown;`,
  );
  const hits = searchDocs([{ pageId: "1", title: "규칙", text }], "Zone");
  assert.ok(hits[0]?.snippet.startsWith(`…${"·".repeat(39)} Zone`));
  assert.ok(text.includes("<script>x</script> &unknown;"));
  assert.ok(!hits[0]?.snippet.includes("&middot;"));
});
