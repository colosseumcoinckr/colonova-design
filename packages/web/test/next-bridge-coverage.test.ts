import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 데스크톱의 `preload.ts` 가 렌더러에 내놓는 `onXxx: subscribe(…)` 채널마다 웹에 받는 곳이 있어야 한다
 * (2026-10-06 UX 점검). `onOpenProject` 는 preload · 타입 · 데스크톱의 송신까지 다 있는데 웹에 구독이
 * 없어서, 개발자 쪽 알림을 눌러도 창만 앞으로 오고 프로젝트는 그대로였다 — 보내는 쪽 시험이 아무리
 * 초록이어도 받는 쪽이 비어 있으면 아무도 모른다. 이 시험은 그 구멍의 종류를 막는다.
 */
const desktopPreload = new URL("../../desktop/src/preload.ts", import.meta.url);
const webSrc = new URL("../src/", import.meta.url).pathname;

/** 알려진 빈 구독 — 고치면 이 명단에서 지운다(아래 시험이 지우라고 말한다). */
const KNOWN_UNHEARD: Record<string, string> = {
  onHost:
    "main 이 마운트된 프로젝트 없이 열린 페이지(loose)의 요소를 `colonova-preview:host` 로 부탁하지만 " +
    "PreviewFrame 에 `setLooseSrc` 를 세우는 구독이 없다(2026-10-06 발견, 아직 고치지 않았다).",
};

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourcesUnder(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const channels = [
  ...new Set(
    [...readFileSync(desktopPreload, "utf8").matchAll(/\b(on[A-Z][A-Za-z]+):\s*subscribe/g)].map(
      (match) => match[1] as string,
    ),
  ),
];
const web = sourcesUnder(webSrc).map((path) => readFileSync(path, "utf8"));
const heard = (name: string) => web.some((text) => new RegExp(`\\.${name}\\b`).test(text));

test("preload 의 구독 채널을 찾는다 — 정규식이 조용히 빈손이 되지 않게", () => {
  assert.ok(channels.length >= 10, `채널 ${channels.length}개`);
  assert.ok(channels.includes("onOpenProject"));
  assert.ok(channels.includes("onOpenSession"));
});

test("preload 의 모든 구독 채널은 웹에 받는 곳이 있다", () => {
  const unheard = channels.filter((name) => !heard(name) && !(name in KNOWN_UNHEARD));
  assert.deepEqual(unheard, [], `받는 곳이 없는 채널: ${unheard.join(", ")}`);
});

test("알려진 빈 구독은 아직 비어 있다 — 고쳤다면 명단에서 지운다", () => {
  for (const name of Object.keys(KNOWN_UNHEARD)) {
    assert.equal(heard(name), false, `${name} 에 받는 곳이 생겼다 — KNOWN_UNHEARD 에서 지운다`);
  }
});
