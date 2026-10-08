import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../dist/child.js";

/**
 * `run` 은 `promisify(execFile)` 을 대신하는 한 곳이다(2026-10-07) — 여섯 파일이 각자 두던 것을
 * 하나로 모으며 `windowsHide` 기본값을 얹었다. 옛 모양(stdout · stderr 를 단 결과와 오류, 옵션
 * 통과, args 생략)이 그대로인지 진짜 자식 하나로 본다. 프로세스를 띄우므로 CI 의 순수 목록에는
 * 두지 않는다 — 로컬 `pnpm test` 의 몫이다.
 */

test("run: stdout · stderr 를 돌려주고 cwd 옵션을 넘긴다", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "child-run-")));
  try {
    const result = await run(
      process.execPath,
      ["-e", "process.stdout.write(process.cwd()); process.stderr.write('warn')"],
      { cwd: dir },
    );
    assert.equal(result.stdout, dir);
    assert.equal(result.stderr, "warn");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run: 0 이 아닌 종료는 stdout · stderr 를 단 오류로 거절한다", async () => {
  await assert.rejects(
    run(process.execPath, [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    ]),
    (error: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }) => {
      assert.equal(error.code, 3);
      assert.equal(error.stdout, "out");
      assert.equal(error.stderr, "err");
      return true;
    },
  );
});

test("run: 없는 프로그램은 ENOENT 로 거절한다", async () => {
  await assert.rejects(run("colonova-design-no-such-program", ["--version"]), {
    code: "ENOENT",
  });
});

test("run: 호출이 준 옵션이 기본값을 이긴다 — 타임아웃도 그대로 통한다", async () => {
  await assert.rejects(
    run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeout: 100 }),
    (error: { killed?: boolean }) => error.killed === true,
  );
});
