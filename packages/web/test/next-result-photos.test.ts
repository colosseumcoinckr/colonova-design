import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PHOTO_CHARS, photoUrl } from "../src/next/lib/result-photos.ts";

const picture = (data = "AAAA", mediaType = "image/png") => ({ at: "", mediaType, data });

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
