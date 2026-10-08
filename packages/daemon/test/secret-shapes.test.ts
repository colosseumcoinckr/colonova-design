import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { maskSecretShapes, SECRET_PLACEHOLDER } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: 이 모듈들은 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그것을 못 고친다.
import { summarizeLogErrors } from "../dist/diagnostics.js";
import { createFileLogger, sanitizeText } from "../dist/log.js";

/**
 * 비밀 걸러내기의 틈(2026-10-08 검토 FIX1) — 로그(`sanitizeText`)와 웹의 진단 복사 글이 같은 한 곳
 * (`maskSecretShapes`)을 읽고, 그 규칙이 `gho_` · `ghs_` · `ghu_` · `ghr_` · `glpat-` · `npm_` 까지 안다.
 * 진단의 오류 종류가 낱말을 걷는 하한도 41자에서 24자로 내렸다. 걸러내기는 과잉으로 기우는 쪽이 싸지만
 * 정상 문장 · 환경 변수 이름 · 짧은 식별자는 그대로여야 한다 — 막는 쪽과 지나가는 쪽을 함께 센다.
 * 토큰 모양은 이어 붙여 만든다(저장소의 비밀 스캐너가 시험 값을 진짜로 읽지 않게).
 */

const BODY = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6kL9";
/** 접두 뒤에 올 `n` 자의 몸통. */
const body = (n: number) => BODY.repeat(3).slice(0, n);

const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["ghp_", body(36)],
  ["gho_", body(36)],
  ["ghu_", body(36)],
  ["ghs_", body(36)],
  ["ghr_", body(36)],
  ["ghs_", `${body(10)}_${body(10)}`], // 밑줄이 든 설치 토큰
  ["github_pat_", body(40)],
  ["glpat-", body(20)],
  ["glpat-", `${body(10)}-${body(10)}`], // 줄표 · 밑줄이 든 몸통
  ["npm_", body(36)],
  ["sk-", body(24)],
  ["sk-ant-", body(30)],
  ["rk-", body(24)],
  ["AKIA", "IOSFODNN7EXAMPLE"],
  ["AIza", body(30)],
  ["xoxb-", `1234-5678-${body(24)}`],
  ["xoxp-", `1234-5678-${body(24)}`],
  ["https://hooks.slack.com/services/", `T0000/B0000/${body(24)}`],
];

for (const [prefix, rest] of SHAPES) {
  const secret = `${prefix}${rest}`;
  test(`비밀 걸러내기 — ${prefix} 로 시작하는 토큰이 든 줄이 가려진다`, () => {
    const line = `전송 실패 token=${secret} 다시 시도`;
    for (const out of [maskSecretShapes(line), sanitizeText(line)]) {
      assert.equal(out.includes(secret), false, `토큰이 남았다: ${prefix}…`);
      assert.equal(out.includes(rest), false, `토큰 몸통이 남았다: ${prefix}…`);
      assert.ok(out.includes(SECRET_PLACEHOLDER), "가린 자리 표시가 있다");
      assert.ok(out.startsWith("전송 실패 token="), "앞의 글은 그대로다");
      assert.ok(out.endsWith(" 다시 시도"), "뒤의 글은 그대로다");
    }
  });
}

test("비밀 걸러내기 — 낱말 경계가 없어도(다른 글자에 붙어 와도) 가린다", () => {
  const secret = `gho_${body(36)}`;
  assert.equal(maskSecretShapes(`x-access-token:${secret}@host`).includes(body(36)), false);
  assert.equal(maskSecretShapes(`ENV_TOKEN=${secret}`).includes(body(36)), false);
  assert.equal(maskSecretShapes(`("${secret}")`).includes(body(36)), false);
});

test("비밀 걸러내기 — Bearer 는 어휘를 남기고 값만 가린다", () => {
  assert.equal(
    maskSecretShapes(`Authorization: Bearer ${body(30)}`),
    "Authorization: Bearer {secret}",
  );
  assert.equal(sanitizeText(`Bearer  ${body(30)}.${body(12)}`), "Bearer {secret}");
});

test("비밀 걸러내기 — 일반 문장 · 환경 변수 이름 · 짧은 식별자는 그대로다", () => {
  const plain = [
    "turn failed after 3 retries",
    "게이트 실패 · capture · 요청 실패",
    "npm_config_registry 가 비어 있어요",
    "npm_lifecycle_event=build npm_execpath=/usr/lib/npm",
    "npm_package_version 1.2.3",
    "ghost_mode 와 lights_on 은 그대로",
    "ghp 는 접두가 아니다 · gho 도 그렇다",
    "glpat 이라는 낱말 · npm 이라는 낱말",
    "GitHub 이 응답했어요 (403)",
    "repo.sync · TypeError · ECONNRESET",
  ];
  for (const text of plain) {
    assert.equal(maskSecretShapes(text), text, text);
    assert.equal(sanitizeText(text), text, text);
  }
});

test("로그 파일 — 새 접두의 토큰도 message · fields 에서 걷힌다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-log-"));
  try {
    const logger = createFileLogger({ dir, now: () => new Date("2026-10-08T09:00:00Z") });
    const oauth = `gho_${body(36)}`;
    const gitlab = `glpat-${body(20)}`;
    const npm = `npm_${body(36)}`;
    logger.error(`올리기 실패 ${oauth}`, { detail: `${gitlab} / ${npm}` });
    const [name] = readdirSync(dir);
    const line = readFileSync(join(dir, name ?? ""), "utf8");
    for (const secret of [oauth, gitlab, npm]) assert.equal(line.includes(secret), false);
    assert.ok(line.includes("올리기 실패"), "문장 자체는 남는다 — 종류가 로그의 일이다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ————— 오류 종류의 긴 토큰 하한 —————

const NOW = new Date("2026-10-08T12:00:00.000Z");
const stamp = NOW.toISOString();
const errorLine = (message: string) => `${stamp}\terror\t${message}`;

test("오류 종류 — 24자 이상의 토큰 닮은 낱말은 걷고, 짧은 식별자 · 정상 낱말은 남긴다", () => {
  const long24 = body(24); // 옛 41자 하한을 지나던 길이
  const long40 = body(40);
  const kinds = summarizeLogErrors(
    [
      errorLine(`요청 실패 ${long24}`),
      errorLine(`확인 실패 ${long40}`),
      errorLine("복제 실패 abcdefghijklmnopqrstuvw"), // 23자 — 남는다
      errorLine("보관 실패 repo.sync TypeError"),
      errorLine("게이트 실패 capture"),
    ],
    NOW,
  ).map((entry) => entry.kind);
  assert.deepEqual(
    kinds.sort(),
    [
      "게이트 실패 capture",
      "복제 실패 abcdefghijklmnopqrstuvw",
      "보관 실패 repo.sync TypeError",
      "요청 실패",
      "확인 실패",
    ].sort(),
  );
  const text = JSON.stringify(kinds);
  assert.equal(text.includes(long24), false);
  assert.equal(text.includes(long40), false);
});

test("오류 종류 — 새 접두의 토큰은 낱말 하한 이전에 가려져 종류에 남지 않는다", () => {
  const secrets = [`ghs_${body(36)}`, `glpat-${body(20)}`, `npm_${body(36)}`];
  const kinds = summarizeLogErrors(
    secrets.map((secret) => errorLine(`전송 거절 ${secret}`)),
    NOW,
  );
  assert.deepEqual(
    kinds.map((entry) => [entry.kind, entry.count]),
    [["전송 거절", 3]],
  );
});
