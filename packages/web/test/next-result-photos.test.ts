import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PHOTO_CHARS, photoUrl, readPhotos } from "../src/next/lib/result-photos.ts";

/**
 * `고친 화면` 카드가 읽는 수정 전 · 수정 후 사진(2026-10-06 UX 점검). 카드는 수정 후만 집고 수정 전은 버려
 * 전 · 후가 대화상자 뒤에만 있었다 — 이제 둘 다 쥔다. 남의 사진이나 그릴 수 없는 사진은 없는 것으로 친다.
 */
const picture = (data = "AAAA", mediaType = "image/png") => ({ at: "", mediaType, data });
const record = (over: Record<string, unknown> = {}) =>
  ({
    requestId: "req-1",
    sessionId: "s",
    sha: "x",
    route: "/members",
    title: "회원",
    viewport: "desktop",
    before: picture("BEFORE"),
    after: picture("AFTER"),
    ...over,
  }) as never;

test("readPhotos: 요청과 화면이 맞는 기록의 수정 전 · 수정 후를 둘 다 준다", () => {
  const photos = readPhotos(record(), { requestId: "req-1", route: "/members" });
  assert.equal(photos.before, "data:image/png;base64,BEFORE");
  assert.equal(photos.after, "data:image/png;base64,AFTER");
});

test("readPhotos: 수정 전 사진이 없으면 수정 후만 — 카드에 토글이 서지 않는 모양", () => {
  const photos = readPhotos(record({ before: null }), { requestId: "req-1", route: "/members" });
  assert.equal(photos.before, null);
  assert.equal(photos.after, "data:image/png;base64,AFTER");
});

test("readPhotos: 요청이나 화면이 다른 기록은 사진이 없다 — 남의 사진을 보여 주지 않는다", () => {
  assert.deepEqual(readPhotos(record(), { requestId: "other", route: "/members" }), {
    before: null,
    after: null,
  });
  assert.deepEqual(readPhotos(record(), { requestId: "req-1", route: "/settings" }), {
    before: null,
    after: null,
  });
  assert.deepEqual(readPhotos(null, { requestId: "req-1", route: "/members" }), {
    before: null,
    after: null,
  });
});

test("readPhotos: 경로의 표기가 달라도(앞 슬래시 · index) 같은 화면이면 맞다", () => {
  assert.notEqual(
    readPhotos(record({ route: "members" }), { requestId: "req-1", route: "/members" }).after,
    null,
  );
  assert.notEqual(
    readPhotos(record({ route: "index" }), { requestId: "req-1", route: "/" }).after,
    null,
  );
});

test("photoUrl: 그릴 수 있는 형식과 크기만 — 빈 사진 · 낯선 형식 · 너무 큰 사진은 없다", () => {
  assert.equal(photoUrl(picture("AAAA", "image/jpeg")), "data:image/jpeg;base64,AAAA");
  assert.equal(photoUrl(picture("AAAA", "image/webp")), "data:image/webp;base64,AAAA");
  assert.equal(photoUrl(picture("", "image/png")), null);
  assert.equal(
    photoUrl(picture("AAAA", "image/svg+xml")),
    null,
    "스크립트를 품을 수 있는 형식은 막는다",
  );
  assert.equal(photoUrl(picture("AAAA", "text/html")), null);
  assert.equal(photoUrl(picture("A".repeat(MAX_PHOTO_CHARS + 1))), null);
  assert.notEqual(photoUrl(picture("A".repeat(MAX_PHOTO_CHARS))), null);
  assert.equal(photoUrl(null), null);
  assert.equal(photoUrl(undefined), null);
});
