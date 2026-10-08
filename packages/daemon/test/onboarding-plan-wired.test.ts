import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runOnboardingChecks } from "../dist/onboarding.js";

/**
 * 요금제 막힘이 온보딩 게이트(`runOnboardingChecks`)에 실제로 이어져 있는가(2026-10-07 베타 준비 분석) — 가짜
 * `claude` 스크립트가 `auth status` 의 JSON 을 내고, 데몬이 그것을 읽어 `claude` 단계를 판정한다.
 * git · node 를 묻는 자식 프로세스를 띄우므로 순수 시험이 아니다(로컬 `pnpm test` 의 몫, Windows 는 건너뛴다).
 */

function fakeClaude(authJson: string): { dir: string; bin: string } {
  const dir = mkdtempSync(join(tmpdir(), "colonova-plan-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    `#!/bin/sh\ncase "$1" in\n  --version) echo "2.1.292 (Claude Code)" ;;\n  auth) cat <<'JSON'\n${authJson}\nJSON\n  ;;\nesac\n`,
  );
  chmodSync(bin, 0o755);
  return { dir, bin };
}

async function claudeStepFor(authJson: string) {
  const { dir, bin } = fakeClaude(authJson);
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const steps = await runOnboardingChecks({
      claudeExecutableOverride: bin,
      pnpmResolver: async () => null,
    });
    return steps.find((step) => step.id === "claude");
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    rmSync(dir, { recursive: true, force: true });
  }
}

const skip = process.platform === "win32";

test("무료 요금제 값이 내려오면 AI 단계가 막힌다 — 첫 요청 전에", { skip }, async () => {
  const step = await claudeStepFor(
    JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "free" }),
  );
  assert.equal(step?.status, "fail");
  assert.equal(step?.reason, "plan");
  assert.equal(step?.fix?.kind, "login-claude");
});

test("요금제를 모르는 로그인(null)은 통과한다 — 번들 CLI 의 값 표에서 무료 계정은 null 이다", {
  skip,
}, async () => {
  const step = await claudeStepFor(
    JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: null }),
  );
  assert.equal(step?.status, "pass");
  assert.equal(step?.reason, undefined);
});

test("유료 요금제는 통과하고, 로그인 안 된 계정은 기존대로 로그인 고침이다(reason 없음)", {
  skip,
}, async () => {
  const paid = await claudeStepFor(
    JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" }),
  );
  assert.equal(paid?.status, "pass");
  assert.match(paid?.detail ?? "", /max/);
  const out = await claudeStepFor(JSON.stringify({ loggedIn: false }));
  assert.equal(out?.status, "fail");
  assert.equal(out?.fix?.kind, "login-claude");
  assert.equal(out?.reason, undefined, "로그인 만료는 plan 이 아니다 — 카드가 로그인을 열어 준다");
});
