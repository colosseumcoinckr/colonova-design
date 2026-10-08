// PLAN 단계 6 의 순수 시험 — mergeToolBlock (도구 구간 갱신) · pickHandoffTitle
// (제목은 생성할 때만). `../dist` 임포트인 이유: node --test 는 src 의 `.js`
// 지정자를 못 읽는다(cycle-ledger.test.ts 와 같은 길).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiKindsOf,
  buildAiLine,
  buildChecksSection,
  buildFilesSection,
  buildScopeSection,
  classifyScopePath,
  formatHandoffTitle,
  mergeToolBlock,
  NUMSTAT_TRUST_CHARS,
  noteLine,
  PLAIN_TITLE_MAX_CHARS,
  pickHandoffTitle,
  plainHandoffTitle,
  readToolNote,
  SCOPE_RULES,
  scopeOfNumstat,
  summarizeChecks,
  TOOL_BLOCK_END,
  TOOL_BLOCK_START,
} from "../dist/handoff-body.js";

const BLOCK = "> 작성: 기획자\n\n### 바뀐 파일\n\n- a.ts (+1 −0)";
const wrap = (body: string) => `${TOOL_BLOCK_START}\n${body}\n${TOOL_BLOCK_END}`;

test("mergeToolBlock — 구간이 없으면 본문 끝에 붙인다", () => {
  assert.equal(
    mergeToolBlock("개발자가 쓴 첫 문단.", BLOCK),
    `개발자가 쓴 첫 문단.\n\n${wrap(BLOCK)}`,
  );
});

test("mergeToolBlock — 빈 본문이면 구간만 선다", () => {
  assert.equal(mergeToolBlock(null, BLOCK), wrap(BLOCK));
  assert.equal(mergeToolBlock("", BLOCK), wrap(BLOCK));
});

test("mergeToolBlock — 구간이 있으면 그 사이만 바꾼다", () => {
  const existing = `앞 문단.\n\n${wrap("옛 내용")}\n\n뒷 문단.`;
  assert.equal(mergeToolBlock(existing, BLOCK), `앞 문단.\n\n${wrap(BLOCK)}\n\n뒷 문단.`);
});

test("mergeToolBlock — 개발자가 구간 밖에 쓴 글은 그대로다", () => {
  const existing = `${wrap("옛 내용")}\n\n개발자가 나중에 쓴 줄.`;
  const merged = mergeToolBlock(existing, BLOCK);
  assert.ok(merged.includes("개발자가 나중에 쓴 줄."));
  assert.ok(!merged.includes("옛 내용"));
});

test("mergeToolBlock — 구간을 지웠어도 다음 제출은 잃지 않는다(끝에 다시 붙는다)", () => {
  // 개발자가 구간을 통째로 지운 본문 — 구간이 없으므로 끝에 붙고, 지운 사실이
  // 개발자의 다른 글을 덮지 않는다.
  const merged = mergeToolBlock("개발자 본문만 남았다.", BLOCK);
  assert.equal(merged, `개발자 본문만 남았다.\n\n${wrap(BLOCK)}`);
});

test("mergeToolBlock — 구간이 둘 이상이면 첫 것만 바꾸고 나머지는 지운다", () => {
  const existing = `${wrap("첫 옛 내용")}\n\n사이 글.\n\n${wrap("둘 옛 내용")}`;
  assert.equal(mergeToolBlock(existing, BLOCK), `${wrap(BLOCK)}\n\n사이 글.`);
});

test("mergeToolBlock — 같은 내용을 두 번 갱신해도 결과는 같다 (멱등)", () => {
  const once = mergeToolBlock("본문.", BLOCK);
  assert.equal(mergeToolBlock(once, BLOCK), once);
});

test("pickHandoffTitle — 초안이 있으면 초안을 쓴다", () => {
  assert.equal(
    pickHandoffTitle({
      draftTitle: "feat(members): 회원 목록 추가",
      firstCommitSubject: "작업 1",
      fallback: "기본",
    }),
    "feat(members): 회원 목록 추가",
  );
});

test("pickHandoffTitle — 초안이 비면 첫 커밋 제목에 형식을 붙인다", () => {
  assert.equal(
    pickHandoffTitle({
      draftTitle: "", // handoffDraft 의 턴이 시간 안에 답하지 못한 모양
      firstCommitSubject: "회원 목록 만들기",
      fallback: "기본",
    }),
    "chore: 회원 목록 만들기",
  );
});

test("pickHandoffTitle — 커밋 제목마저 없으면 기본 제목", () => {
  assert.equal(
    pickHandoffTitle({
      draftTitle: null,
      firstCommitSubject: null,
      fallback: "ColoNova Design 화면 전달",
    }),
    "chore: ColoNova Design 화면 전달",
  );
});

test("자동 제목 — 기존 타입 · scope · breaking 표식은 보존하고 한 줄 72자로 제한한다", () => {
  assert.equal(
    formatHandoffTitle("fix(submit)!: 중복 제출 방지\n본문"),
    "fix(submit)!: 중복 제출 방지",
  );
  assert.equal(formatHandoffTitle("docs: 사용 안내 수정"), "docs: 사용 안내 수정");
  const title = formatHandoffTitle(`feat: ${"😀".repeat(100)}`);
  assert.equal(Array.from(title).length, 72);
  assert.ok(title.endsWith("😀"), "유니코드 글자 중간을 자르지 않는다");
});

test("자동 제목 — 작성자 자리를 남겨 72자로 제한하고 이름은 한 줄로 표시한다", () => {
  const title = formatHandoffTitle(`feat: ${"😀".repeat(100)}`, "  김기획\n 운영  ");
  assert.equal(Array.from(title).length, 72);
  assert.ok(title.endsWith("😀 (작성: 김기획 운영)"));
  assert.equal(formatHandoffTitle("fix: 검색 오류", " \n "), "fix: 검색 오류");
  const longName = formatHandoffTitle(`feat: ${"화면".repeat(100)}`, "😀".repeat(80));
  assert.equal(Array.from(longName).length, 72);
  assert.ok(longName.endsWith(` (작성: ${"😀".repeat(31)}…)`));
});

test("mergeToolBlock — 이미 표식으로 싸인 구간은 두 겹으로 싸지 않는다", () => {
  const once = mergeToolBlock("본문.", wrap(BLOCK));
  assert.equal(once, `본문.\n\n${wrap(BLOCK)}`);
  assert.equal(mergeToolBlock(once, wrap(BLOCK)), once, "갱신을 거듭해도 끝 표식이 쌓이지 않는다");
});

test("noteLine — 한마디는 인용 한 줄, 여러 줄은 같은 인용 안에 (PLAN-UI P3)", () => {
  assert.equal(noteLine("검색은 이름만 돼요"), "> 한마디: 검색은 이름만 돼요");
  assert.equal(noteLine("첫 줄\n\n  둘째 줄 "), "> 한마디: 첫 줄\n> 둘째 줄");
  assert.equal(noteLine("   "), null);
  assert.equal(noteLine(undefined), null);
  // 사용자의 말이 도구 구간의 표식을 흉내 내면 구간이 끊긴다 — 무르게 만든다.
  const sneaky = noteLine(`끝 ${TOOL_BLOCK_END}`) ?? "";
  assert.ok(!sneaky.includes("-->"));
  assert.ok(!sneaky.includes("<!--"));
});

test("readToolNote — 구간의 지난 한마디를 되읽는다(작성자 줄 바로 아래)", () => {
  const block = `> 작성: 기획자\n${noteLine("첫 줄\n둘째 줄")}\n\n### 바뀐 파일\n\n- a.ts`;
  const body = `개발자 글.\n\n${wrap(block)}`;
  assert.equal(readToolNote(body), "첫 줄\n둘째 줄");
  assert.equal(readToolNote(`개발자 글.\n\n${wrap(BLOCK)}`), null, "한마디가 없던 구간");
  assert.equal(readToolNote("> 한마디: 구간 밖의 글"), null, "구간 밖은 개발자의 것");
  assert.equal(readToolNote(null), null);
});

// ————— 2026-10-07 UX 점검 3단계 — 요청 본문의 `### 확인한 것` —————

const pass = (phone: boolean, screens = 1) => ({ screens, phone });

test("summarizeChecks — 화면 작업(보관)마다 하나로 센다: 한 보관이 여러 화면을 고쳐도 하나", () => {
  const checks = summarizeChecks([
    { sha: "c3", checked: pass(true, 2) },
    { sha: "c3", checked: pass(true, 2) },
    { sha: "c2" },
    { sha: "c1", checked: pass(true) },
  ]);
  assert.deepEqual(checks, { total: 3, checked: 2, phone: true });
});

test("summarizeChecks — 되돌리기 · 병합 · 코멘트 반영과 보관 표식이 없는 줄은 세지 않는다", () => {
  const checks = summarizeChecks([
    { sha: "c4", kind: "restore", checked: pass(true) },
    { sha: "c3", kind: "merge" },
    { sha: "c2", kind: "comment" },
    { checked: pass(true) },
    { sha: "c1", checked: pass(false) },
  ]);
  assert.deepEqual(checks, { total: 1, checked: 1, phone: false });
});

test("summarizeChecks — 확인 기록이 하나도 없으면 null: 하지 않은 확인을 말하지 않는다", () => {
  assert.equal(summarizeChecks([]), null);
  assert.equal(summarizeChecks([{ sha: "c1" }, { sha: "c2" }]), null);
});

test("summarizeChecks — 휴대폰 폭은 확인이 지난 작업이 모두 봤을 때만 말한다", () => {
  assert.equal(
    summarizeChecks([
      { sha: "c2", checked: pass(true) },
      { sha: "c1", checked: pass(false) },
    ])?.phone,
    false,
  );
  // 확인이 지나지 않은 작업의 휴대폰 여부는 묻지 않는다 — 기록이 없는 작업이다.
  assert.equal(summarizeChecks([{ sha: "c2", checked: pass(true) }, { sha: "c1" }])?.phone, true);
});

test("buildChecksSection — 모두 지났고 휴대폰 폭까지 봤을 때의 글", () => {
  assert.equal(
    buildChecksSection({ total: 3, checked: 3, phone: true }),
    [
      "### 확인한 것",
      "",
      "AI 가 작업을 끝낼 때마다 도구가 바뀐 화면을 다시 열어 봅니다. 이번 제출에 담긴 화면 작업 3건 모두에서 확인이 문제 없이 지나갔습니다 — 화면이 끝까지 열렸고, 콘솔 오류 · 실패한 요청 · 이름 없는 컨트롤 · 너무 흐린 글자 · 휴대폰 폭의 가로 넘침에서 새로 찾은 문제가 없었습니다.",
      "",
      "레포의 검사(check)와 빌드는 이 확인에 들어 있지 않습니다.",
      "",
    ].join("\n"),
  );
});

test("buildChecksSection — 일부만 지났으면 나머지는 확인 기록이 없다고 말한다 · 휴대폰 말은 빠진다", () => {
  const section = buildChecksSection({ total: 5, checked: 2, phone: false });
  assert.ok(section.includes("화면 작업 5건 중 2건에서 확인이 문제 없이 지나갔습니다"));
  assert.ok(section.includes("나머지 3건은 확인 기록이 없습니다."));
  assert.ok(!section.includes("휴대폰"), "보지 않은 것은 말하지 않는다");
  assert.ok(section.endsWith("\n"), "다른 절처럼 줄바꿈으로 끝난다");
});

test("buildChecksSection — 숫자뿐이다: 화면 이름 · 요소 · 경로가 들어갈 자리가 없다(D38)", () => {
  const section = buildChecksSection({ total: 2, checked: 1, phone: true });
  assert.ok(!/[\w-]+\/[\w-]+|\.tsx?\b|"/.test(section.replace("check", "")), section);
  // 타입 검사 줄이 든 글도 같다.
  const typed = buildChecksSection({ total: 2, checked: 1, phone: true, types: 1 });
  assert.ok(!/[\w-]+\/[\w-]+|\.tsx?\b|"/.test(typed.replace("check", "")), typed);
});

// ————— 2026-10-07 베타 준비 분석 — 개발자가 믿을 근거: `### 범위` · AI 작성 줄 · 타입 검사 한 줄 —————

/** numstat 한 줄 — 추가 · 삭제 · 경로. */
const stat = (path: string, added = 1, removed = 0) => `${added}\t${removed}\t${path}`;
const numstatOf = (...paths: string[]) => paths.map((path) => stat(path)).join("\n");

test("범위 분류 표 — 순서가 곧 우선순위이자 본문에 서는 차례다: 락파일 · 의존성 정의 · CI · 설정", () => {
  assert.deepEqual(
    SCOPE_RULES.map((rule) => [rule.kind, rule.label]),
    [
      ["lockfile", "락파일"],
      ["package", "의존성 정의"],
      ["ci", "CI · 배포"],
      ["config", "설정"],
    ],
  );
});

test("범위 분류 — 분류마다 대표 파일이 제 분류로 든다(어느 깊이에서든)", () => {
  const samples: Record<string, string[]> = {
    lockfile: [
      "pnpm-lock.yaml",
      "packages/web/package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
      "Cargo.lock",
      "poetry.lock",
      "uv.lock",
      "composer.lock",
      "Gemfile.lock",
      "go.sum",
    ],
    package: [
      "package.json",
      "packages/web/package.json",
      "requirements.txt",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
      "Gemfile",
      "composer.json",
    ],
    ci: [
      ".github/workflows/ci.yml",
      ".github/workflows/deploy/prod.yaml",
      ".github/actions/setup/action.yml",
      ".gitlab-ci.yml",
      "Jenkinsfile",
      ".circleci/config.yml",
      "azure-pipelines.yml",
      "bitbucket-pipelines.yml",
      ".travis.yml",
    ],
    config: [
      "vite.config.ts",
      "packages/web/next.config.mjs",
      "tailwind.config.js",
      "eslint.config.js",
      "tsconfig.json",
      "packages/web/tsconfig.app.json",
      "jsconfig.json",
      ".eslintrc",
      ".eslintrc.cjs",
      ".prettierrc.json",
      "biome.json",
      "biome.jsonc",
      ".npmrc",
      ".nvmrc",
      ".env",
      ".env.local",
      "src/.env.production",
      ".envrc",
      "Dockerfile",
      "docker/Dockerfile.dev",
      "docker-compose.yml",
      "compose.yaml",
      "vercel.json",
      "netlify.toml",
    ],
  };
  for (const [kind, paths] of Object.entries(samples)) {
    for (const path of paths) {
      assert.equal(classifyScopePath(path)?.kind, kind, `${path} 은 ${kind}`);
    }
  }
});

test("범위 분류 — 표에 없는 파일은 그 밖이다: 모르는 것을 위험으로 몰지 않는다(과분류 금지)", () => {
  for (const path of [
    "src/App.tsx",
    "src/styles/app.css",
    "public/logo.png",
    "README.md",
    "docs/package.json.md",
    "src/config.tsx",
    "src/lib/env.ts",
    "src/environment.ts",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    "packages/web/src/lockfile.ts",
    "notes/pnpm-lock.yaml.bak",
  ]) {
    assert.equal(classifyScopePath(path), null, `${path} 은 그 밖`);
  }
});

test("범위 분류 — 한 파일이 둘에 맞으면 앞의 분류 · 이름 바꿈은 두 쪽을 모두 · 따옴표로 싼 경로와 대문자도 읽는다", () => {
  assert.equal(classifyScopePath(".github/workflows/build.config.js")?.kind, "ci");
  // git 이 적는 이름 바꿈 — 위험한 파일로 바뀌어 들어오거나 위험한 파일이 이름을 잃어도 신호다.
  assert.equal(classifyScopePath("package.json => package.json.bak")?.kind, "package");
  assert.equal(classifyScopePath("docs/old.md => package.json")?.kind, "package");
  assert.equal(classifyScopePath("src/{old => new}/package.json")?.kind, "package");
  assert.equal(classifyScopePath("{ => packages}/web/pnpm-lock.yaml")?.kind, "lockfile");
  assert.equal(classifyScopePath("src/{a => b}/App.tsx"), null);
  // git 은 특수 문자가 든 경로를 따옴표로 싼다.
  assert.equal(classifyScopePath('".github/workflows/배포.yml"')?.kind, "ci");
  assert.equal(classifyScopePath("DOCKERFILE")?.kind, "config");
});

test("scopeOfNumstat — 위험 분류는 표의 차례로, 그 밖은 수로 · 빈 입력과 못 읽는 입력은 null", () => {
  const scope = scopeOfNumstat(
    numstatOf(
      "src/App.tsx",
      "pnpm-lock.yaml",
      "package.json",
      ".github/workflows/ci.yml",
      "vite.config.ts",
      "src/b.css",
    ),
  );
  assert.equal(scope?.total, 6);
  assert.equal(scope?.other, 2);
  assert.equal(scope?.complete, true);
  assert.deepEqual(
    scope?.risky.map((group) => [group.rule.kind, group.paths]),
    [
      ["lockfile", ["pnpm-lock.yaml"]],
      ["package", ["package.json"]],
      ["ci", [".github/workflows/ci.yml"]],
      ["config", ["vite.config.ts"]],
    ],
  );
  assert.equal(scopeOfNumstat(""), null);
  assert.equal(scopeOfNumstat("\n  \n"), null);
  assert.equal(scopeOfNumstat("읽을 수 없는 줄"), null);
  assert.equal(buildScopeSection(""), null, "빈 목록이면 절이 없다");
});

test("scopeOfNumstat — 바이너리 · 이름 바꿈 줄도 한 파일로 센다", () => {
  const scope = scopeOfNumstat(
    [
      "-\t-\tpublic/logo.png",
      "2\t2\tsrc/{old => new}/Card.tsx",
      "0\t0\tpackage.json => package.json.bak",
    ].join("\n"),
  );
  assert.equal(scope?.total, 3);
  assert.equal(scope?.other, 2);
  assert.equal(scope?.risky.length, 1);
});

test("buildFilesSection — 범위와 같은 읽기를 나눠 써도 바뀐 파일 절은 그대로다", () => {
  assert.equal(
    buildFilesSection("3\t1\tsrc/a.tsx\n-\t-\tpublic/logo.png\n\n뜻 모를 줄\n"),
    [
      "### 바뀐 파일",
      "",
      "바뀐 파일 2개 · +3 −1",
      "",
      "- src/a.tsx (+3 −1)",
      "- public/logo.png",
      "",
    ].join("\n"),
  );
  assert.equal(buildFilesSection(""), null);
});

test("buildScopeSection — 화면 코드만 바뀌었으면 「건드리지 않았습니다」 한 줄이 선다", () => {
  assert.equal(
    buildScopeSection(
      numstatOf("src/pages/Members.tsx", "src/pages/Members.css", "public/empty.png"),
    ),
    [
      "### 범위",
      "",
      "이번 변경의 범위 — 파일 3개",
      "",
      "- 의존성 · 설정 · CI 파일은 건드리지 않았습니다",
      "",
    ].join("\n"),
  );
});

test("buildScopeSection — 락파일 · package.json · CI · 설정이 든 입력은 머리줄에 ⚠ 를 세우고 그 파일 이름만 늘어놓는다", () => {
  const section = buildScopeSection(
    numstatOf(
      "src/pages/Members.tsx",
      "src/pages/Members.css",
      "pnpm-lock.yaml",
      "package.json",
      ".github/workflows/ci.yml",
      "vite.config.ts",
      "tsconfig.json",
    ),
  );
  assert.equal(
    section,
    [
      "### 범위",
      "",
      "⚠ 이번 변경의 범위 — 의존성 · 설정 · CI 파일이 바뀌었습니다 (파일 7개 중 5개)",
      "",
      "- ⚠ 락파일 1개 — pnpm-lock.yaml",
      "- ⚠ 의존성 정의 1개 — package.json (어느 항목이 바뀌었는지는 확인하지 않았습니다)",
      "- ⚠ CI · 배포 1개 — .github/workflows/ci.yml",
      "- ⚠ 설정 2개 — vite.config.ts, tsconfig.json",
      "- 그 밖의 파일 2개",
      "",
    ].join("\n"),
  );
  assert.ok(!section?.includes("건드리지 않았습니다"), "위험이 있으면 안심의 말은 나오지 않는다");
});

test("buildScopeSection — package.json 만 · 락파일만 · 둘 다: 갈라 말한다", () => {
  const pkg = buildScopeSection(numstatOf("package.json", "src/a.tsx")) ?? "";
  assert.ok(
    pkg.includes(
      "- ⚠ 의존성 정의 1개 — package.json (어느 항목이 바뀌었는지는 확인하지 않았습니다)",
    ),
  );
  assert.ok(!pkg.includes("락파일"));
  const lock = buildScopeSection(numstatOf("pnpm-lock.yaml", "src/a.tsx")) ?? "";
  assert.ok(lock.includes("- ⚠ 락파일 1개 — pnpm-lock.yaml"));
  assert.ok(!lock.includes("의존성 정의"));
  const both = buildScopeSection(numstatOf("package.json", "pnpm-lock.yaml")) ?? "";
  assert.ok(both.includes("- ⚠ 락파일 1개 — pnpm-lock.yaml"));
  assert.ok(both.includes("- ⚠ 의존성 정의 1개 — package.json"));
  assert.ok(!both.includes("그 밖의 파일"), "그 밖이 없으면 그 줄도 없다");
  for (const section of [pkg, lock, both]) {
    assert.ok(section.includes("⚠ 이번 변경의 범위"));
    assert.ok(!section.includes("건드리지 않았습니다"));
  }
});

test("buildScopeSection — .env 는 내용이 아니라 파일이 건드려졌다는 사실만 말한다(어느 깊이에서든)", () => {
  const section = buildScopeSection(numstatOf("src/.env.local", "src/a.tsx")) ?? "";
  assert.ok(section.includes("- ⚠ 설정 1개 — src/.env.local"));
  assert.ok(section.includes("(파일 2개 중 1개)"));
});

test("buildScopeSection — 위험 분류의 이름은 다섯까지만 늘어놓고 나머지는 수로 말한다 · ⚠ 는 그대로다", () => {
  const files = Array.from({ length: 8 }, (_, index) => `.github/workflows/w${index}.yml`);
  const section = buildScopeSection(numstatOf(...files)) ?? "";
  const names = files.slice(0, 5).join(", ");
  assert.ok(section.includes(`- ⚠ CI · 배포 8개 — ${names} 외 3개`), section);
  assert.ok(section.includes("⚠ 이번 변경의 범위"));
  assert.ok(section.includes("(파일 8개 중 8개)"));
});

test("buildScopeSection — 잘렸거나 못 읽은 줄이 있으면 「건드리지 않았습니다」 를 말하지 않는다", () => {
  // 데몬이 쥔 git 출력의 상한에 닿은 목록 — 앞이 잘렸을 수 있다.
  const line = "1\t0\tsrc/a.tsx\n";
  const long = line.repeat(Math.ceil(NUMSTAT_TRUST_CHARS / line.length));
  assert.equal(scopeOfNumstat(long)?.complete, false);
  const cut = buildScopeSection(long) ?? "";
  assert.ok(cut.includes("- 의존성 · 설정 · CI 파일은 잘려서 확인하지 못했습니다"));
  assert.ok(!cut.includes("건드리지 않았습니다"));
  assert.ok(!cut.includes("⚠"), "위험을 찾지 못한 채 ⚠ 를 세우지 않는다");
  // 상한 아래의 목록은 믿는다.
  assert.equal(scopeOfNumstat(numstatOf("src/a.tsx"))?.complete, true);
  // 못 읽은 줄이 섞인 목록.
  const garbled = buildScopeSection(`${numstatOf("src/a.tsx")}\n뜻 모를 줄\n`) ?? "";
  assert.ok(garbled.includes("- 의존성 · 설정 · CI 파일은 잘려서 확인하지 못했습니다"));
  assert.ok(!garbled.includes("건드리지 않았습니다"));
  // 잘린 목록에서도 찾은 위험은 말한다 — 더 있을 수 있다는 말과 함께.
  const risky = buildScopeSection(`${numstatOf("pnpm-lock.yaml")}\n뜻 모를 줄\n`) ?? "";
  assert.ok(risky.includes("⚠ 이번 변경의 범위"));
  assert.ok(risky.includes("- 파일 목록을 끝까지 읽지 못해 이보다 더 있을 수 있습니다"));
  assert.ok(!risky.includes("건드리지 않았습니다"));
});

test("buildAiLine — 종류를 알 때와 모를 때: 사실만, 과장도 축소도 없이", () => {
  assert.equal(
    buildAiLine(),
    "코드는 AI 가 썼고, 요청한 사람은 코드가 아니라 화면으로 확인했습니다.",
  );
  assert.equal(buildAiLine([]), buildAiLine());
  assert.equal(
    buildAiLine(["Claude Code"]),
    "코드는 AI(Claude Code)가 썼고, 요청한 사람은 코드가 아니라 화면으로 확인했습니다.",
  );
  assert.equal(
    buildAiLine(["Claude Code", "Codex"]),
    "코드는 AI(Claude Code · Codex)가 썼고, 요청한 사람은 코드가 아니라 화면으로 확인했습니다.",
  );
});

test("aiKindsOf — 작업마다 공급자를 알 때만 종류를 말한다", () => {
  const work = (sha: string, provider?: string, extra: Record<string, unknown> = {}) => ({
    sha,
    ...(provider ? { provider } : {}),
    ...extra,
  });
  assert.deepEqual(aiKindsOf([work("c2", "claude"), work("c2", "claude"), work("c1", "claude")]), [
    "Claude Code",
  ]);
  // 이름은 알파벳순이라 어느 커밋이 먼저여도 같은 글이다.
  assert.deepEqual(aiKindsOf([work("c2", "codex"), work("c1", "claude")]), [
    "Claude Code",
    "Codex",
  ]);
  // 하나라도 모르면 말하지 않는다 — 일부만 알고 「Claude Code 가 썼다」 고 하지 않는다.
  assert.deepEqual(aiKindsOf([work("c2", "claude"), work("c1")]), []);
  assert.deepEqual(aiKindsOf([work("c2", "claude"), work("c1", "gemini")]), []);
  // 손으로 고친 값이 이름이 되지 못한다.
  assert.deepEqual(aiKindsOf([work("c1", "__proto__")]), []);
  assert.deepEqual(aiKindsOf([work("c1", "constructor")]), []);
  assert.deepEqual(aiKindsOf([{ sha: "c1", provider: 5 as never }]), []);
  // 되돌리기 · 병합은 도구가 한 일이고 보관 표식이 없는 줄은 작업이 아니다 — 공급자를 몰라도 말을 막지 않는다.
  assert.deepEqual(
    aiKindsOf([
      work("c4", "claude"),
      work("c3", undefined, { kind: "restore" }),
      work("c2", undefined, { kind: "merge" }),
      { provider: "codex" },
    ]),
    ["Claude Code"],
  );
  // 코멘트 반영은 개발자의 말을 받아 AI 가 쓴 코드다 — 다른 공급자가 썼다면 그 이름도 싣고, 모르면 말하지 않는다.
  assert.deepEqual(aiKindsOf([work("c2", "codex", { kind: "comment" }), work("c1", "claude")]), [
    "Claude Code",
    "Codex",
  ]);
  assert.deepEqual(
    aiKindsOf([work("c2", undefined, { kind: "comment" }), work("c1", "claude")]),
    [],
  );
  assert.deepEqual(aiKindsOf([]), []);
});

test("AI 작성 줄은 한마디의 인용 밖에 선다 — 지난 한마디를 되읽을 때 섞이지 않는다", () => {
  const block = `> 작성: 기획자\n${noteLine("검색은 이름만 돼요")}\n\n${buildAiLine(["Claude Code"])}\n\n### 범위\n\n이번 변경의 범위 — 파일 1개`;
  assert.equal(readToolNote(`개발자 글.\n\n${wrap(block)}`), "검색은 이름만 돼요");
});

test("summarizeChecks — 타입 검사가 돌고 오류가 없었던 작업의 수를 센다: 하나도 없으면 칸이 없다", () => {
  const typed = { screens: 1, phone: true, types: true };
  assert.deepEqual(
    summarizeChecks([
      { sha: "c3", checked: typed },
      { sha: "c2", checked: pass(true) },
      { sha: "c1", checked: { ...typed, screens: 2 } },
    ]),
    { total: 3, checked: 3, phone: true, types: 2 },
  );
  const none = summarizeChecks([{ sha: "c1", checked: pass(true) }]);
  assert.deepEqual(none, { total: 1, checked: 1, phone: true });
  assert.equal("types" in (none ?? {}), false, "돌리지 않은 검사는 칸이 없다");
  // 확인이 지나지 않은 작업은 기록이 없다 — 타입 검사도 세지 않는다.
  assert.equal(summarizeChecks([{ sha: "c2", checked: typed }, { sha: "c1" }])?.types, 1);
  // 되돌리기는 작업이 아니다.
  assert.equal(
    summarizeChecks([
      { sha: "c2", kind: "restore", checked: typed },
      { sha: "c1", checked: pass(false) },
    ])?.types,
    undefined,
  );
  // 참이 아닌 값은 돌았다고 세지 않는다.
  assert.equal(
    summarizeChecks([{ sha: "c1", checked: { ...pass(true), types: false } }])?.types,
    undefined,
  );
});

test("buildChecksSection — 타입 검사 한 줄: 화면 확인 문단과 레포 검사 문장 사이에 선다", () => {
  assert.equal(
    buildChecksSection({ total: 3, checked: 3, phone: true, types: 2 }),
    [
      "### 확인한 것",
      "",
      "AI 가 작업을 끝낼 때마다 도구가 바뀐 화면을 다시 열어 봅니다. 이번 제출에 담긴 화면 작업 3건 모두에서 확인이 문제 없이 지나갔습니다 — 화면이 끝까지 열렸고, 콘솔 오류 · 실패한 요청 · 이름 없는 컨트롤 · 너무 흐린 글자 · 휴대폰 폭의 가로 넘침에서 새로 찾은 문제가 없었습니다.",
      "",
      "타입 검사: 이번 제출에 담긴 화면 작업 3건 중 2건에서 바뀐 TypeScript 파일의 타입 오류가 없었습니다. 나머지 1건은 검사 기록이 없습니다.",
      "",
      "레포의 검사(check)와 빌드는 이 확인에 들어 있지 않습니다.",
      "",
    ].join("\n"),
  );
  const all = buildChecksSection({ total: 3, checked: 3, phone: true, types: 3 });
  assert.ok(
    all.includes(
      "\n타입 검사: 이번 제출에 담긴 화면 작업 3건 모두에서 바뀐 TypeScript 파일의 타입 오류가 없었습니다.\n",
    ),
  );
  assert.ok(!all.includes("검사 기록이 없습니다"), "모두 돌았으면 기록이 없다는 말도 없다");
  // 돌리지 않은 검사를 통과라고 말하지 않는다 — 칸이 없거나 0 이면 줄이 없다. 개수가 작업 수를 넘어도 부풀리지 않는다.
  for (const checks of [
    { total: 3, checked: 3, phone: true },
    { total: 3, checked: 3, phone: true, types: 0 },
  ]) {
    assert.ok(!buildChecksSection(checks).includes("타입"), JSON.stringify(checks));
  }
  assert.ok(
    buildChecksSection({ total: 2, checked: 2, phone: true, types: 9 }).includes(
      "작업 2건 모두에서",
    ),
  );
});

test("plainHandoffTitle — 도구가 붙인 종류 접두어와 작성자 꼬리를 뗀 사용자의 말(2026-10-08 · 반영된 일)", () => {
  // formatHandoffTitle 의 거울 — 만든 제목이 그대로 되돌아온다.
  const made = formatHandoffTitle("회원 목록에 이름 검색을 넣었어요", "김기획");
  assert.equal(made, "chore: 회원 목록에 이름 검색을 넣었어요 (작성: 김기획)");
  assert.equal(plainHandoffTitle(made), "회원 목록에 이름 검색을 넣었어요");
  assert.equal(plainHandoffTitle("fix(submit)!: 중복 제출 방지"), "중복 제출 방지");
  assert.equal(plainHandoffTitle("feat(members): 검색  창\n본문은 읽지 않는다"), "검색 창");
  // 개발자가 고친 제목도 같은 규칙으로 읽는다 — 접두어가 없으면 그대로다.
  assert.equal(plainHandoffTitle("회원 목록 정렬"), "회원 목록 정렬");
  // 종류 접두어가 아닌 콜론은 건드리지 않는다.
  assert.equal(plainHandoffTitle("안내: 문구 정리"), "안내: 문구 정리");
});

test("plainHandoffTitle — 읽을 말이 없으면 null, 긴 말은 80자에서 말줄임으로 닫는다", () => {
  assert.equal(plainHandoffTitle(null), null);
  assert.equal(plainHandoffTitle(undefined), null);
  assert.equal(plainHandoffTitle("   \n  "), null);
  assert.equal(plainHandoffTitle("chore: (작성: 김기획)"), null, "말이 없는 제목은 없다");
  const long = plainHandoffTitle(`chore: ${"가".repeat(120)}`) ?? "";
  assert.equal(Array.from(long).length, PLAIN_TITLE_MAX_CHARS);
  assert.ok(long.endsWith("…"));
  const exact = "나".repeat(PLAIN_TITLE_MAX_CHARS);
  assert.equal(plainHandoffTitle(exact), exact, "상한과 같으면 자르지 않는다");
});
