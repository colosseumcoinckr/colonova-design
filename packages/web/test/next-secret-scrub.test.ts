import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { scrubText } from "../src/next/lib/diagnostics-text.ts";

/**
 * 진단 복사 글의 마지막 방어(`scrubText`)가 데몬 로그와 같은 비밀 규칙(protocol 의 `maskSecretShapes`)을
 * 읽는다(2026-10-08 검토 FIX1). 따로 있을 때 웹은 `rk-` · `AKIA` · 슬랙 웹훅을 몰랐고, 둘 다 `gho_` ·
 * `ghs_` · `ghu_` · `ghr_` · `glpat-` · `npm_` 를 몰랐다. 토큰 모양은 이어 붙여 만든다.
 */

const BODY = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6kL9";
const body = (n: number) => BODY.repeat(3).slice(0, n);

const SECRETS: ReadonlyArray<readonly [string, string]> = [
  ["ghp_", `ghp_${body(36)}`],
  ["gho_", `gho_${body(36)}`],
  ["ghu_", `ghu_${body(36)}`],
  ["ghs_", `ghs_${body(36)}`],
  ["ghr_", `ghr_${body(36)}`],
  ["github_pat_", `github_pat_${body(40)}`],
  ["glpat-", `glpat-${body(20)}`],
  ["npm_", `npm_${body(36)}`],
  ["sk-", `sk-${body(30)}`],
  ["rk-", `rk-${body(30)}`],
  ["AKIA", "AKIAIOSFODNN7EXAMPLE"],
  ["AIza", `AIza${body(30)}`],
  ["xoxb-", `xoxb-1234-5678-${body(24)}`],
  ["hooks.slack.com", `https://hooks.slack.com/services/T0000/B0000/${body(24)}`],
];

for (const [name, secret] of SECRETS) {
  test(`scrubText — ${name} 토큰이 든 줄이 가려진다`, () => {
    const out = scrubText(`연결 실패 값=${secret} 끝`);
    assert.equal(out.includes(secret), false);
    assert.equal(out.includes(body(20)), false, "토큰 몸통이 남았다");
    assert.ok(out.includes("{secret}"));
    assert.ok(out.startsWith("연결 실패 값="));
    assert.ok(out.endsWith(" 끝"));
  });
}

test("scrubText — Bearer 는 어휘를 남기고 값만 가린다", () => {
  assert.equal(scrubText(`Authorization: Bearer ${body(30)}`), "Authorization: Bearer {secret}");
});

test("scrubText — 일반 문장 · 환경 변수 이름 · 버전은 그대로다", () => {
  const plain = [
    "앱 0.4.0 · Claude Code 2.1.292 · macOS",
    "npm_config_registry 와 npm_lifecycle_event",
    "ghost_mode · lights_on · highs",
    "gho 나 npm 이라는 낱말만",
    "요청 실패 · repo.sync · TypeError",
  ];
  for (const text of plain) assert.equal(scrubText(text), text, text);
});

test("소스 계약 — 두 걸러내기는 같은 한 곳을 읽고 제 정규식을 따로 두지 않는다", () => {
  const web = readFileSync(new URL("../src/next/lib/diagnostics-text.ts", import.meta.url), "utf8");
  const daemon = readFileSync(new URL("../../daemon/src/log.ts", import.meta.url), "utf8");
  for (const [label, source] of [
    ["웹 진단 글", web],
    ["데몬 로그", daemon],
  ] as const) {
    assert.match(source, /maskSecretShapes/, `${label}: maskSecretShapes 를 읽는다`);
    for (const prefix of ["ghp_", "github_pat_", "xox[bp]", "AKIA"]) {
      assert.equal(source.includes(prefix), false, `${label}: ${prefix} 규칙을 따로 두지 않는다`);
    }
  }
  const shared = readFileSync(
    new URL("../../protocol/src/secret-shapes.ts", import.meta.url),
    "utf8",
  );
  for (const prefix of ["gh[pousr]_", "glpat-", "npm_"]) {
    assert.ok(shared.includes(prefix), `공유 규칙에 ${prefix} 가 있다`);
  }
});
