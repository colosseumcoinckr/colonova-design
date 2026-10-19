/** 개발 명령의 환경변수 전달만 검사한다. 실제 데몬은 부르지 않는다. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const DAEMON_COMMAND = "pnpm --filter @colonova-design/daemon dev";
const ENV_NAME = "COLONOVA_DESIGN_DEV_AGENTS";

test("개발 데몬 명령 — cross-env 는 루트 개발 의존성이다", () => {
  assert.ok(pkg.devDependencies["cross-env"]);
  assert.equal(pkg.scripts["dev:daemon"], `cross-env ${ENV_NAME}=1 ${DAEMON_COMMAND}`);
});

for (const inheritedValue of [undefined, "0"]) {
  test(`개발 데몬 명령 — 셸에서 환경변수를 1로 전달한다 (상속: ${inheritedValue ?? "없음"})`, (t) => {
    const script = pkg.scripts["dev:daemon"];
    // 끝 명령을 확인한 뒤 짧은 자식으로 바꾼다. 데몬이 실행되면 안 된다.
    assert.ok(script.endsWith(DAEMON_COMMAND));
    const dir = mkdtempSync(join(tmpdir(), "colonova dev env 한글-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "probe.mjs"),
      `console.log(JSON.stringify({ value: process.env.${ENV_NAME}, args: process.argv.slice(2) }));`,
    );

    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "path" && key.toUpperCase() !== ENV_NAME,
      ),
    );
    const inheritedPath = Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === "path",
    )?.[1];
    env.PATH = [join(ROOT, "node_modules", ".bin"), inheritedPath ?? ""].join(delimiter);
    if (inheritedValue !== undefined) env[ENV_NAME] = inheritedValue;
    const command = `${script.slice(0, -DAEMON_COMMAND.length)}"${process.execPath}" probe.mjs "argument with spaces"`;
    const result = spawnSync(command, {
      cwd: dir,
      env,
      // Windows 에서는 Git Bash 가 아니라 실제 cmd.exe 문법으로 검사한다.
      shell: process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh",
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(
      result.status,
      0,
      [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      value: "1",
      args: ["argument with spaces"],
    });
  });
}
