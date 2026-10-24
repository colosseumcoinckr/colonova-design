// CI-순수-제외 — /bin/sh git 심을 실행한다. scripts/pure-tests.mjs 가 CI 에서 뺀다(2026-10-24).
import assert from "node:assert/strict";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BringUp } from "../dist/repo-bringup.js";
import { makeScene } from "./helpers/cycle-harness.ts";

/**
 * 준비가 옛 기획서 사본을 거두는 길 (2026-10-23 · 기획서 사본 이동 계획 §5) —
 * 정리 본체의 순수 시험은 confluence-legacy.test.ts 의 몫이다. 프로세스를 띄운다
 * — 로컬 pnpm test 의 몫, CI 순수 목록에 넣지 않는다(2026-10-23).
 */

/** 원장 몸통 — 지정한 상대 경로의 문서를 아는 것으로 적는다. */
const ledgerBody = (...paths: string[]) =>
  JSON.stringify({
    site: "https://synthetic.atlassian.net",
    roots: [],
    lastSyncAt: null,
    pages: Object.fromEntries(
      paths.map((path, index) => [String(900 + index), { path, title: "합성 제목", version: 1 }]),
    ),
    folders: {},
    unsupported: {},
  });

/** PATH 에서 진짜 git — 가짜 git 이 넘겨줄 몸통. */
function realGitPath(): string {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, "git");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 다음 후보
    }
  }
  return "/usr/bin/git";
}

test("준비의 이미 클론된 갈래 — 최신화 전에 옛 사본을 거둔다", async () => {
  const scene = await makeScene();
  try {
    const clone = scene.clone.path;
    mkdirSync(join(clone, "docs", "plans"), { recursive: true });
    writeFileSync(join(clone, "docs", "plans", "가이드.storage.xml"), "<storage/>");
    writeFileSync(join(clone, "docs", "plans", "가이드.md"), "# 합성");
    writeFileSync(join(clone, "docs", "plans", "confluence.json"), ledgerBody("가이드"));
    mkdirSync(join(clone, ".git", "info"), { recursive: true });
    appendFileSync(join(clone, ".git", "info", "exclude"), "docs/plans/\n");

    // 준비는 이 하네스 클론의 명령 선언이 없어 오류로 끝난다 — 그 전 단계인
    // 최신화 앞의 정리가 이미 디스크에 남았는지가 이 시험의 대상이다.
    await new BringUp(scene.core).bootstrap();

    assert.equal(existsSync(join(clone, "docs", "plans")), false);
    assert.equal(
      readFileSync(join(clone, ".git", "info", "exclude"), "utf8").includes("docs/plans/"),
      false,
    );
  } finally {
    scene.dispose();
  }
});

test("준비의 흔적 없는 클론 — 정리는 git ls-files 를 묻지 않고 지나간다", async () => {
  // 가짜 git — 부른 인자를 기록하고 진짜 git 에 넘긴다. COLONOVA_DESIGN_GIT_BIN 이
  // git 실행 파일을 가린다(environment 의 핀 · resolveGitExecutable).
  const binDir = mkdtempSync(join(tmpdir(), "colonova-legacy-bin-"));
  const log = join(binDir, "git-args.log");
  const shim = join(binDir, "git");
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${realGitPath()}" "$@"\n`);
  chmodSync(shim, 0o755);
  const savedBin = process.env.COLONOVA_DESIGN_GIT_BIN;
  const savedLog = process.env.FAKE_GIT_LOG;
  process.env.COLONOVA_DESIGN_GIT_BIN = shim;
  process.env.FAKE_GIT_LOG = log;
  const scene = await makeScene();
  try {
    // 준비는 이 하네스 클론의 명령 선언이 없어 오류로 끝난다 — 그 전 단계인
    // 최신화 앞의 정리가 흔적을 보지 않고 지나가는지가 이 시험의 대상이다.
    await new BringUp(scene.core).bootstrap();

    const calls = readFileSync(log, "utf8");
    assert.notEqual(calls.trim(), "", "가짜 git 이 불렸다 — 기록이 비면 이 시험은 못 본다");
    assert.equal(
      calls.split("\n").some((line) => line.includes("docs/plans")),
      false,
      "흔적이 없으면 ls-files 도 묻지 않는다",
    );
  } finally {
    scene.dispose();
    if (savedBin === undefined) delete process.env.COLONOVA_DESIGN_GIT_BIN;
    else process.env.COLONOVA_DESIGN_GIT_BIN = savedBin;
    if (savedLog === undefined) delete process.env.FAKE_GIT_LOG;
    else process.env.FAKE_GIT_LOG = savedLog;
    rmSync(binDir, { recursive: true, force: true });
  }
});
