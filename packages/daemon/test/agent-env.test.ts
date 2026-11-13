import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
// `../dist` 임포트인 이유: src 는 형제를 `.js` 지정자로 부르므로 직접 로드가
// 그 지정을 못 고친다(repo-command-env.test.ts 와 같은 길).
import { APP_SECRET_ENV_KEYS, withoutAppSecrets, withoutSelfUpdate } from "../dist/agent-env.js";

/** 앱의 자격 재정의 키 — credentials.ts 가 읽는 세 가지. */
const SECRETS = {
  COLONOVA_DESIGN_CONFLUENCE_EMAIL: "planner@example.com",
  COLONOVA_DESIGN_CONFLUENCE_TOKEN: "atlassian-token",
  COLONOVA_DESIGN_REPO_PAT: "github-pat",
} as const;

test("앱 비밀 세 키는 거른다 — 이메일 · 토큰 · 저장소 PAT", () => {
  const env = withoutAppSecrets({ ...SECRETS, PATH: "/usr/bin" });
  for (const key of Object.keys(SECRETS)) {
    assert.equal(key in env, false, `${key} 가 남았다`);
  }
});

test("다른 키는 남는다 — PATH · COLONOVA_DESIGN_PORT 등", () => {
  const env = withoutAppSecrets({
    PATH: "/usr/bin",
    COLONOVA_DESIGN_PORT: "7823",
    DISABLE_AUTOUPDATER: "1",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.COLONOVA_DESIGN_PORT, "7823");
  assert.equal(env.DISABLE_AUTOUPDATER, "1");
});

test("받은 객체는 건드리지 않는다 — 복사본에서 지운다", () => {
  const input: NodeJS.ProcessEnv = { ...SECRETS, PATH: "/usr/bin" };
  withoutAppSecrets(input);
  for (const [key, value] of Object.entries(SECRETS)) {
    assert.equal(input[key], value, `${key} 가 원본에서 지워졌다`);
  }
});

test("자기 업데이트 끔을 얹으면 비밀은 없고 끄는 표식만 있다", () => {
  const env = withoutSelfUpdate(withoutAppSecrets({ ...SECRETS }));
  assert.equal(env.DISABLE_AUTOUPDATER, "1");
  for (const key of Object.keys(SECRETS)) {
    assert.equal(key in env, false, `${key} 가 남았다`);
  }
});

test("앱 비밀 키의 명단은 credentials 가 읽는 세 가지다", () => {
  assert.deepEqual([...APP_SECRET_ENV_KEYS].sort(), Object.keys(SECRETS).sort());
});

/** src 기준 상대 경로를 `/` 로 — Windows 의 `\` 에서도 명단 이름이 같게. */
const srcName = (root: string, path: string) => relative(root, path).split(sep).join("/");

/** `../src` 아래의 .ts 파일 — 하위 폴더까지(src/agent/drivers 포함). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

test("withoutSelfUpdate 를 부르는 모든 src 파일은 withoutAppSecrets 도 부른다", () => {
  // 파일 단위로 본다 — 포매터가 줄을 나눌 수 있다(2026-10-23 · 최종 구현 계획 F0).
  const root = join(import.meta.dirname, "../src");
  const offenders = sourceFiles(root)
    .filter((path) => !path.endsWith("agent-env.ts"))
    .filter((path) => {
      const src = readFileSync(path, "utf8");
      return src.includes("withoutSelfUpdate(") && !src.includes("withoutAppSecrets(");
    })
    .map((path) => srcName(root, path));
  assert.deepEqual(offenders, []);
});

test("쓸기가 진짜 소스를 읽는다 — 자식을 띄우는 자리가 명단에 잡힌다", () => {
  const root = join(import.meta.dirname, "../src");
  const callers = sourceFiles(root)
    .filter((path) => readFileSync(path, "utf8").includes("withoutSelfUpdate("))
    .map((path) => srcName(root, path));
  for (const name of [
    "agent/drivers/claude/session.ts",
    "agent/drivers/claude/one-shot.ts",
    "agent-install.ts",
    "onboarding.ts",
  ]) {
    assert.ok(callers.includes(name), `${name} 가 명단에 없다 — 쓸기가 헛돈다`);
    assert.equal(statSync(join(root, name)).isFile(), true);
  }
});
