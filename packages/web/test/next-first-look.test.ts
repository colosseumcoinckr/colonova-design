import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { FirstLook } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-result-photos.test.ts 와 같은 모양).
import { askFirstLook, firstLookUrl, forgetFirstLooks } from "../src/next/lib/first-look.ts";
import { MAX_PHOTO_CHARS } from "../src/next/lib/result-photos.ts";

/**
 * 서비스의 첫 화면 사진(2026-10-07 베타 준비 분석 · 첫 5분) — 홈의 `서비스가 떴어요` 줄에 서는 한 장. 사진은 있으면
 * 좋은 것이라 모든 실패는 사진 없는 줄이다 — 깨진 그림을 세우지 않는다.
 */
const look = (image: FirstLook["image"]): FirstLook => ({ route: "/", image });
const good = { at: "2026-10-07T00:00:00.000Z", mediaType: "image/jpeg", data: "QUJD" };

test("firstLookUrl: 그릴 수 있는 사진은 데이터 주소로", () => {
  assert.equal(firstLookUrl(look(good)), "data:image/jpeg;base64,QUJD");
  assert.equal(
    firstLookUrl(look({ ...good, mediaType: "image/webp" })),
    "data:image/webp;base64,QUJD",
  );
});

test("firstLookUrl: 없거나 · 형식이 다르거나 · 비었거나 · 너무 크면 null — 사진 없는 줄", () => {
  assert.equal(firstLookUrl(null), null);
  assert.equal(firstLookUrl(undefined), null);
  assert.equal(firstLookUrl(look(null)), null);
  assert.equal(
    firstLookUrl(look({ ...good, mediaType: "image/svg+xml" })),
    null,
    "SVG 는 스크립트를 품을 수 있다",
  );
  assert.equal(firstLookUrl(look({ ...good, mediaType: "text/html" })), null);
  assert.equal(firstLookUrl(look({ ...good, data: "" })), null);
  assert.equal(firstLookUrl(look({ ...good, data: "A".repeat(MAX_PHOTO_CHARS + 1) })), null);
});

test("askFirstLook: 같은 열쇠로는 한 번만 묻는다 — 홈이 오가도 숨은 창을 다시 열지 않는다", async () => {
  forgetFirstLooks();
  let asks = 0;
  const ask = async () => {
    asks += 1;
    return look(good);
  };
  const [a, b] = await Promise.all([
    askFirstLook("p|root|1|/", ask),
    askFirstLook("p|root|1|/", ask),
  ]);
  assert.equal(a, "data:image/jpeg;base64,QUJD");
  assert.equal(b, a);
  assert.equal(await askFirstLook("p|root|1|/", ask), a, "끝난 뒤에도 기억한다");
  assert.equal(asks, 1);
  // 서버가 새로 뜨면(열쇠가 달라진다) 새로 묻는다.
  await askFirstLook("p|root|2|/", ask);
  assert.equal(asks, 2);
});

test("askFirstLook: 못 찍었거나 던져도 null 이고, 그 실패도 기억한다 — 사진이 안 나오는 서비스에 되풀이해 묻지 않는다", async () => {
  forgetFirstLooks();
  let asks = 0;
  assert.equal(
    await askFirstLook("none", async () => {
      asks += 1;
      return look(null);
    }),
    null,
  );
  assert.equal(
    await askFirstLook("boom", async () => {
      asks += 1;
      throw new Error("timeout");
    }),
    null,
  );
  assert.equal(
    await askFirstLook("sync-throw", () => {
      asks += 1;
      throw new Error("not a promise");
    }),
    null,
    "동기로 던져도 조용히 null",
  );
  await askFirstLook("none", async () => look(good));
  await askFirstLook("boom", async () => look(good));
  assert.equal(asks, 3);
});

test("askFirstLook: 기억은 몇 개뿐이다 — 오래된 것부터 잊는다", async () => {
  forgetFirstLooks();
  let asks = 0;
  const ask = async () => {
    asks += 1;
    return look(good);
  };
  for (const key of ["a", "b", "c", "d", "e"]) await askFirstLook(key, ask);
  assert.equal(asks, 5);
  await askFirstLook("e", ask);
  assert.equal(asks, 5, "가장 새것은 남아 있다");
  await askFirstLook("a", ask);
  assert.equal(asks, 6, "가장 오래된 것은 잊었다");
});

test("홈: 사진은 지금 프로젝트의 줄에만, 서비스가 떠 있고 첫 화면을 읽은 뒤에만 묻는다 · 풀리지 않는 그림은 세우지 않는다", () => {
  const hook = readFileSync(new URL("../src/next/home/use-first-look.ts", import.meta.url), "utf8");
  assert.match(hook, /slug === daemon\.activeSlug/);
  assert.match(hook, /repo\?\.phase === "ready"/);
  assert.match(hook, /repo\.firstScreen !== undefined/);
  assert.match(hook, /decodes\(url\)\.then\(\(ok\) => \(ok \? url : null\)\)/);
  const view = readFileSync(new URL("../src/next/home/HomeView.tsx", import.meta.url), "utf8");
  assert.match(
    view,
    /const lookSlug = active !== null && ready\.includes\(active\.slug\) \? active\.slug : null;/,
  );
  const card = readFileSync(new URL("../src/next/home/HomeReady.tsx", import.meta.url), "utf8");
  assert.match(card, /photo\?\.slug === project\.slug/);
});
