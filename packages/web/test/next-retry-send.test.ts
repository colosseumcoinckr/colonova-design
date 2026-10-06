import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-conv-title.test.ts 와 같은 모양).
import {
  planRetry,
  SENT_ORIGINAL_MAX_BYTES,
  type SentOriginal,
  sentOriginalBytes,
} from "../src/next/lib/retry-send.ts";

/**
 * `다시 시도` 가 첨부를 되살리는 판정(2026-10-06 UX 점검). 대화 기록의 사용자 턴에는 첨부의 바이트가
 * 없고 개수와 이름뿐이라, 말만 다시 보내면 사진을 붙여 보낸 말이 사진 없이 간다.
 */
const image = (name: string, data = "AAAA") => ({
  kind: "image" as const,
  name,
  mediaType: "image/png",
  data,
  size: 0,
});
const file = (name: string) => ({
  kind: "file" as const,
  name,
  mediaType: "text/plain",
  data: "QUJD",
  size: 3,
});
const original = (text: string, attachments: SentOriginal["attachments"]): SentOriginal => ({
  text,
  attachments,
});

test("planRetry: 보낸 원본이 짝이 맞으면 그대로 다시 보낸다", () => {
  const kept = original("이 사진처럼 만들어 줘", [image("a.png"), file("brief.txt")]);
  const plan = planRetry(
    { text: "이 사진처럼 만들어 줘", images: 1, files: ["brief.txt"] },
    kept,
    0,
  );
  assert.deepEqual(plan, { kind: "replay", original: kept });
});

test("planRetry: 데몬이 핀 턴에 얹은 `파일 후보` 줄이 있어도 첫 줄이 같으면 짝이다", () => {
  const marker = "<!-- colonova-design:comments items=2 -->";
  const kept = original(`${marker}\n핀 둘`, [image("pin-1.jpg"), image("pin-2.jpg")]);
  const echoed = `${marker}\n핀 둘\n파일 후보: src/Button.tsx`;
  assert.equal(planRetry({ text: echoed, images: 2 }, kept, 0).kind, "replay");
});

test("planRetry: 첨부 개수가 다르면 짝이 아니다 — 다른 창이 같은 대화에 보낸 말을 막는다", () => {
  const kept = original("같은 말", [image("a.png")]);
  assert.equal(planRetry({ text: "같은 말", images: 2 }, kept, 0).kind, "putBack");
  assert.equal(
    planRetry({ text: "같은 말", images: 1, files: ["x.txt"] }, kept, 0).kind,
    "putBack",
  );
});

test("planRetry: 첫 줄이 다르면 짝이 아니다", () => {
  const kept = original("앞선 말", [image("a.png")]);
  assert.equal(planRetry({ text: "다른 말", images: 1 }, kept, 0).kind, "putBack");
});

test("planRetry: 원본이 없고 되살릴 수 없는 첨부가 있으면 말을 입력창으로 돌려준다", () => {
  assert.deepEqual(planRetry({ text: "사진 봐 줘", images: 1 }, null, 0), {
    kind: "putBack",
    lost: 1,
  });
  assert.deepEqual(
    planRetry({ text: "파일 봐 줘", images: 0, files: ["a.csv", "b.csv"] }, null, 0),
    {
      kind: "putBack",
      lost: 2,
    },
  );
  assert.deepEqual(planRetry({ text: "둘 다", images: 2, files: ["a.csv"] }, null, 0), {
    kind: "putBack",
    lost: 3,
  });
});

test("planRetry: 기록이 되살리는 그림(핀의 찍은 그림)은 잃은 것으로 세지 않는다", () => {
  // 핀 둘의 찍은 그림이 둘 다 기록에 있다 — 잃는 것이 없으니 기록으로 다시 짠다.
  assert.deepEqual(planRetry({ text: "핀 묶음", images: 2 }, null, 2), { kind: "rebuild" });
  // 핀 둘 + 따로 붙인 그림 하나 — 하나는 되살릴 수 없다.
  assert.deepEqual(planRetry({ text: "핀 묶음", images: 3 }, null, 2), {
    kind: "putBack",
    lost: 1,
  });
});

test("planRetry: 첨부가 없는 말은 원본이 없어도 그냥 다시 보낸다", () => {
  assert.deepEqual(planRetry({ text: "그냥 말", images: 0 }, null, 0), { kind: "rebuild" });
  assert.deepEqual(planRetry({ text: "그냥 말", images: 0, files: [] }, null, 0), {
    kind: "rebuild",
  });
});

test("sentOriginalBytes: base64 글자 수가 곧 메모리다", () => {
  assert.equal(
    sentOriginalBytes(original("x", [image("a.png", "A".repeat(10)), file("b.txt")])),
    14,
  );
  assert.equal(sentOriginalBytes(original("x", [])), 0);
  assert.ok(SENT_ORIGINAL_MAX_BYTES >= 8 * 1024 * 1024, "한 장의 첨부 한도(8MB)보다 작지 않다");
});
