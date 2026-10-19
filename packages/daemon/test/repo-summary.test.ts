import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildChecksSection } from "../dist/handoff-body.js";
import { handoffDraftTimeoutMs } from "../dist/repo-core.js";
import {
  DEFAULT_PR_SKELETON,
  HANDOFF_TEMPLATE_MAX_CHARS,
  handoffPrompt,
  memoPrompt,
} from "../dist/repo-prompts.js";
import { RepoSummarizer, readPullRequestTemplate } from "../dist/repo-summary.js";
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

test("PR 초안 — 의존성 · 설정 · CI 파일이 바뀌면 미리보기가 그 사실을 싣고, 화면 코드만이면 칸이 없다(2026-10-07)", async () => {
  const scene = await makeScene();
  try {
    const branch = "colonova-design/scope-test";
    await scene.git(["checkout", "-b", branch]);
    writeFileSync(join(scene.clone.path, "members.ts"), "export const searchByName = true;\n");
    await scene.git(["add", "members.ts"]);
    await scene.git(["commit", "-m", "이름 검색을 넣어 줘"]);
    scene.core.setCycle(branch, null);
    const summarizer = new RepoSummarizer(scene.core, async () => "feat: 이름 검색\n\n본문");

    const plain = await summarizer.handoffDraft();
    assert.equal("scopeRisk" in (plain.extras ?? {}), false, "화면 코드만이면 칸이 없다");

    writeFileSync(join(scene.clone.path, "package.json"), '{ "name": "scope-test" }\n');
    await scene.git(["add", "package.json"]);
    await scene.git(["commit", "-m", "패키지를 더해 줘"]);
    const risky = await summarizer.handoffDraft();
    assert.equal(risky.extras?.scopeRisk, true, "본문의 `### 범위` 가 ⚠ 를 세우는 같은 판정이다");
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

test("PR 초안 — 레포의 PR 템플릿을 틀로 주고, 커밋 제목이 변경 단위의 뼈대이며, 조직의 제목 · 글쓰기 규칙을 지시한다(2026-10-13 조직 레포 분석)", () => {
  const template = [
    "## 🎫 Context",
    "<!-- 관련된 Jira 링크를 붙여넣어 주세요 -->",
    "- Jira link:",
    "",
    "## ✨ What's Changed",
    "",
    "## 🚦 How to Test (검증방법)",
  ].join("\n");
  const prompt = handoffPrompt(
    ["feat: 회원 목록에 이름 검색 추가", "회원 목록 검색 넣어 줘", "docs: 검색 사용 안내 추가"],
    ["M\tsrc/members.tsx"],
    [],
    template,
  );
  const rules = prompt.split("PR 템플릿:")[0] ?? "";
  // 레포의 템플릿이 본문의 틀이고, 커밋 제목은 요청 메모가 아니라 변경 단위로 실린다(오래된 것부터, 한 줄에 하나).
  assert.ok(prompt.includes(`PR 템플릿:\n${template}\n`));
  assert.ok(
    prompt.includes(
      "이 요청의 커밋 제목 (오래된 것부터):\n- feat: 회원 목록에 이름 검색 추가\n- 회원 목록 검색 넣어 줘\n- docs: 검색 사용 안내 추가",
    ),
  );
  assert.ok(!prompt.includes("보관 메모 (요청과 작업 배경)"));
  // 제목: 조직 관습 접두 `type: 변경`, scope 없음, 명사형, 조직 규칙의 좋은 예 · 나쁜 예.
  assert.ok(rules.includes("`type: 변경` 꼴"));
  assert.ok(rules.includes("scope 괄호는 쓰지 않습니다"));
  assert.ok(
    rules.includes(
      "feat(기능 추가) · fix(오류 수정) · refactor(동작이 같은 구조 변경) · style(코드 서식) · docs(문서) · test(테스트) · chore(그 밖)",
    ),
  );
  assert.ok(rules.includes("명사형으로 끝맺어"));
  assert.ok(rules.includes("좋은 예: fix: 출고 시작 버튼이 선택한 언어로 표시되도록 수정"));
  // 본문: 템플릿의 섹션 머리와 순서, 주석은 버리고, 빈 섹션은 지우고, 링크 자리는 지어내지 않는다.
  assert.ok(rules.includes("섹션 머리와 순서를 그대로"));
  assert.ok(rules.includes("HTML 주석"));
  assert.ok(rules.includes("섹션째 지웁니다"));
  assert.ok(rules.includes("지어내지 않습니다"));
  // atomic: 변경 자리는 커밋 하나에 한 줄, `type:` 없는 줄은 배경일 뿐.
  assert.ok(rules.includes("커밋 하나에 한 줄씩"));
  assert.ok(rules.includes("`type:` 으로 시작하는 줄이 변경 단위"));
  // 사람이 쓴 것처럼: 동료의 합니다체 · 수식어 · 번역투 · 자기 언급 · 줄표 금지 · 비개발자가 읽는 문장.
  assert.ok(rules.includes("같은 팀 동료"));
  assert.ok(rules.includes("합니다체"));
  assert.ok(rules.includes("번역투"));
  assert.ok(rules.includes("자기 언급"));
  assert.ok(rules.includes("줄표(—)와 하이픈 두 개(--)를 쓰지 않습니다"));
  assert.ok(rules.includes("비개발자(기획 · QA)"));
  // 지시문 자체가 줄표를 쓰지 않는다 — 모델은 지시문의 말투를 따라 쓴다(금지 문장에서 이름을 부르는 한 번뿐).
  assert.equal(rules.split("—").length - 1, 1);
  // 정직의 규칙은 그대로다: 되돌린 변경 · 생략된 diff · 하지 않은 확인.
  assert.ok(rules.includes("되돌린 변경은 빼며"));
  assert.ok(rules.includes("실제 확인 결과가 자료에 있을 때만"));
  assert.ok(rules.includes("돌리지 않은 테스트를 돌렸다고 쓰지 않습니다"));
});

test("PR 초안 — 템플릿이 없으면 조직 공통 뼈대(Summary · Changes · Test plan · 영향 범위)를 틀로 준다", () => {
  assert.equal(DEFAULT_PR_SKELETON, "## Summary\n\n## Changes\n\n## Test plan\n\n## 영향 범위");
  const prompt = handoffPrompt(["feat: 회원 목록에 이름 검색 추가"], ["M\tsrc/members.tsx"]);
  assert.ok(prompt.includes(`PR 템플릿:\n${DEFAULT_PR_SKELETON}\n`));
  const blank = handoffPrompt(["feat: x"], ["M\ta.ts"], [], "   ");
  assert.ok(blank.includes(`PR 템플릿:\n${DEFAULT_PR_SKELETON}\n`));
});

test("PR 초안 — 긴 템플릿은 상한에서 닫고 생략 사실을 밝힌다", () => {
  const prompt = handoffPrompt(
    ["feat: x"],
    ["M\ta.ts"],
    [],
    `## Context\n${"가".repeat(HANDOFF_TEMPLATE_MAX_CHARS + 100)}`,
  );
  assert.ok(prompt.includes("(템플릿의 나머지는 생략했습니다)"));
  assert.ok(!prompt.includes("가".repeat(HANDOFF_TEMPLATE_MAX_CHARS)));
});

test("readPullRequestTemplate — GitHub 이 보는 자리를 차례로 보고, 폴더 · 빈 파일 · 없음은 null 이다", () => {
  const root = mkdtempSync(join(tmpdir(), "colonova-pr-template-"));
  try {
    assert.equal(readPullRequestTemplate(root), null);
    mkdirSync(join(root, ".github", "PULL_REQUEST_TEMPLATE"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    assert.equal(readPullRequestTemplate(root), null, "템플릿 폴더는 보지 않는다");
    writeFileSync(join(root, "docs", "PULL_REQUEST_TEMPLATE.md"), "   \n");
    assert.equal(readPullRequestTemplate(root), null, "빈 파일은 없는 것이다");
    writeFileSync(join(root, "docs", "PULL_REQUEST_TEMPLATE.md"), "## Changes\n\n## Testing\n");
    assert.equal(readPullRequestTemplate(root), "## Changes\n\n## Testing");
    writeFileSync(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Context\n");
    assert.equal(readPullRequestTemplate(root), "## Context", ".github 가 docs 보다 앞이다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("보관 메모 — 계획의 커밋과 같은 `type: 변경` 꼴을 지시한다(2026-10-13 실사용자 피드백)", () => {
  const prompt = memoPrompt([
    {
      path: "src/members.tsx",
      status: "modified",
      hunks: [{ header: "@@ -1 +1 @@", lines: ["+x"] }],
    },
  ]);
  assert.ok(prompt.includes("커밋 제목으로 쓸 한국어 한 줄"));
  assert.ok(prompt.includes("`type: 변경` 꼴"));
  assert.ok(prompt.includes("예: feat: 회원 관리 화면 추가"));
  assert.ok(prompt.includes("파일: src/members.tsx"));
});

test("PR 초안 — 쓰는 중에 같은 tip 을 다시 부르면 새 턴을 띄우지 않고 같은 답을 기다린다(2026-10-19 Windows 실기)", async () => {
  const scene = await makeScene();
  try {
    const branch = "colonova-design/pending-test";
    await scene.git(["checkout", "-b", branch]);
    writeFileSync(join(scene.clone.path, "members.ts"), "export const searchByName = true;\n");
    await scene.git(["add", "members.ts"]);
    await scene.git(["commit", "-m", "이름 검색을 넣어 줘"]);
    scene.core.setCycle(branch, null);

    let calls = 0;
    const answer = Promise.withResolvers<string>();
    const summarizer = new RepoSummarizer(scene.core, async () => {
      calls += 1;
      return answer.promise;
    });
    // 제출 확인이 여는 초안과, 그 사이 누른 제출이 부르는 초안.
    const dialog = summarizer.handoffDraft();
    const submit = summarizer.handoffDraft();
    await new Promise((resolve) => setTimeout(resolve, 200));
    answer.resolve("feat(members): 회원 목록에 이름 검색 추가\n\n이름으로 회원을 찾는다.");
    const [first, second] = await Promise.all([dialog, submit]);
    assert.equal(calls, 1, "같은 tip 의 두 호출이 턴 하나를 나눠 쓴다");
    assert.equal(first.title, "feat(members): 회원 목록에 이름 검색 추가");
    assert.deepEqual(second, first);
    // 끝난 뒤의 호출은 캐시가 답한다 — 쓰는 중 표식이 남아 다음 tip 을 막지 않는다.
    assert.deepEqual(await summarizer.handoffDraft(), first);
    assert.equal(calls, 1);
  } finally {
    await scene.dispose();
  }
});

test("PR 초안 예산 — Windows 는 45초, 그 밖은 15초 그대로다(2026-10-19 Windows 실기)", () => {
  assert.equal(handoffDraftTimeoutMs("win32"), 45_000);
  assert.equal(handoffDraftTimeoutMs("darwin"), 15_000);
  assert.equal(handoffDraftTimeoutMs("linux"), 15_000);
});
