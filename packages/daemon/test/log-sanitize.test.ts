import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFileLogger } from "../dist/log.js";

/**
 * 로그의 정화는 message 와 fields 둘 다 지난다(2026-10-02). message 만 흘려
 * 보내던 시절, 호출자가 문장에 실은 사용자 경로 · 토큰이 그대로 남었다.
 */
test("로그: message 와 fields 모두에서 사용자 경로 · 비밀이 걷힌다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-log-"));
  try {
    const logger = createFileLogger({
      dir,
      now: () => new Date("2026-10-02T09:00:00Z"),
    });
    logger.info("보관 실패 /Users/alice/repo/pages/Home.tsx (ghp_ABCDEFGHIJKLMNOPQRST12)", {
      detail: "/Users/alice/repo/또다른파일.ts",
      email: "alice@example.com",
    });
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    const line = readFileSync(join(dir, files[0]!), "utf8");
    assert.ok(!line.includes("/Users/alice"), "message 의 계정 경로가 그대로 남으면 안 된다");
    assert.ok(!line.includes("ghp_ABCDEFGHIJKLMNOPQRST12"), "토큰이 그대로 남으면 안 된다");
    assert.ok(!line.includes("alice@example.com"), "이메일이 그대로 남으면 안 된다");
    assert.ok(line.includes("~"), "계정 뿌리는 ~ 로 눌러 담는다");
    assert.ok(line.includes("{secret}"), "토큰은 {secret} 로 바뀐다");
    assert.ok(line.includes("보관 실패"), "문장 자체는 남는다 — 종류가 로그의 일이다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("로그: 줄바꿈이 있던 message 도 한 줄로 눌러 담긴다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-log-"));
  try {
    const logger = createFileLogger({ dir, now: () => new Date("2026-10-02T09:00:00Z") });
    logger.warn("첫 줄\n둘째 줄");
    const [name] = readdirSync(dir);
    const lines = readFileSync(join(dir, name!), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.includes("⏎"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
