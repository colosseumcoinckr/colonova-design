import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildChecksSection } from "../dist/handoff-body.js";
import { handoffPrompt } from "../dist/repo-prompts.js";
import { RepoSummarizer } from "../dist/repo-summary.js";
import { makeScene } from "./helpers/cycle-harness.ts";

test("PR 초안 — 최종 diff를 전달하고 본문의 Markdown과 같은 작업의 캐시를 보존한다", async () => {
  const scene = await makeScene();
  try {
    const branch = "colonova-design/summary-test";
    await scene.git(["checkout", "-b", branch]);
    writeFileSync(join(scene.clone.path, "temporary.ts"), "export const temporary = true;\n");
    await scene.git(["add", "temporary.ts"]);
    await scene.git(["commit", "-m", "임시 기능을 추가해 줘"]);
    await scene.git(["rm", "temporary.ts"]);
    writeFileSync(join(scene.clone.path, "members.ts"), "export const searchByName = true;\n");
    await scene.git(["add", "members.ts"]);
    await scene.git(["commit", "-m", "임시 기능은 빼고 이름 검색을 넣어 줘"]);
    scene.core.setCycle(branch, null);

    const prompts: string[] = [];
    const body =
      "이름으로 회원을 찾을 수 있도록 검색을 추가했습니다.\n\n### 확인할 점\n\n- 검색어를 지우면 전체 목록이 보이는지 확인해 주세요.";
    const summarizer = new RepoSummarizer(scene.core, async (prompt) => {
      prompts.push(prompt);
      return `# 제목: feat(members): 회원 목록에 이름 검색 추가\n\n${body}`;
    });
    const draft = await summarizer.handoffDraft();
    assert.equal(draft.title, "feat(members): 회원 목록에 이름 검색 추가");
    assert.equal(draft.body, body, "확인할 점의 Markdown 제목과 목록을 유지한다");
    assert.equal(draft.source, "machine");
    const evidence = prompts[0]?.split("최종 diff:\n")[1] ?? "";
    assert.ok(evidence.includes("+export const searchByName = true;"));
    assert.ok(!evidence.includes("temporary.ts"), "되돌린 파일은 최종 변경의 증거에 없다");
    assert.ok(prompts[0]?.includes("임시 기능을 추가해 줘"), "요청은 배경으로만 전달된다");
    assert.deepEqual(await summarizer.handoffDraft(), draft);
    assert.equal(prompts.length, 1, "같은 tip은 모델 턴을 추가로 쓰지 않는다");
  } finally {
    await scene.dispose();
  }
});

test("PR 초안 — 미리보기의 extras 가 본문과 같은 `확인한 것` 을 싣고, 기록이 없으면 비어 있다", async () => {
  let screens: Array<Record<string, unknown>> = [];
  const scene = await makeScene({ cycleScreens: () => screens as never });
  try {
    const branch = "colonova-design/checks-test";
    await scene.git(["checkout", "-b", branch]);
    writeFileSync(join(scene.clone.path, "members.ts"), "export const searchByName = true;\n");
    await scene.git(["add", "members.ts"]);
    await scene.git(["commit", "-m", "이름 검색을 넣어 줘"]);
    scene.core.setCycle(branch, null);
    const summarizer = new RepoSummarizer(scene.core, async () => "feat: 이름 검색\n\n본문");

    const none = await summarizer.handoffDraft();
    assert.equal(none.extras?.checks, null);
    assert.equal(none.extras?.checksSection, null);

    screens = [
      {
        route: "/members",
        title: "회원",
        note: "n",
        at: "T",
        sha: "s2",
        checked: { screens: 1, phone: true },
      },
      { route: "/pay", title: "결제", note: "n", at: "T", sha: "s1" },
    ];
    const some = await summarizer.handoffDraft();
    assert.deepEqual(some.extras?.checks, { total: 2, checked: 1, phone: true });
    assert.equal(
      some.extras?.checksSection,
      buildChecksSection({ total: 2, checked: 1, phone: true }),
    );
  } finally {
    await scene.dispose();
  }
});

test("PR 초안 — 큰 파일과 여러 파일의 diff는 생략 사실을 밝히고 크기를 제한한다", () => {
  const prompt = handoffPrompt(
    ["화면 추가"],
    ["M\tlarge.ts"],
    Array.from({ length: 60 }, (_, i) => ({
      path: `large-${i}.ts`,
      status: "modified" as const,
      hunks: [
        { header: "@@ -1 +1 @@", lines: Array.from({ length: 100 }, () => `+${"x".repeat(100)}`) },
      ],
    })),
  );
  const evidence = prompt.split("최종 diff:\n")[1] ?? "";
  assert.ok(evidence.includes("이 파일의 나머지는 생략"));
  assert.ok(evidence.includes("최종 diff의 나머지는 생략"));
  assert.ok(evidence.length < 17_000, "diff가 짧은 기계 턴의 입력 예산을 넘지 않는다");
});
