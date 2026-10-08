import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
// 이 시험은 빌드 뒤에 돈다(루트 pnpm test = build → node --test). projects 는 environment.js 를
// 데리고 있어 src 직접 로드가 안 된다(project-registry-create.test.ts 와 같은 길).
import { claudeProjectKey } from "../dist/environment.js";
import { ProjectRegistry, slugify } from "../dist/projects.js";

/**
 * 한글 프로젝트 이름표(slug)의 ASCII 접미 (2026-10-07, 베타 준비 분석).
 *
 * Claude 는 대화 기록 폴더를 클론 경로에서 계산하며 영숫자가 아닌 글자를 모두 `-` 로 바꾼다 —
 * 그래서 글자 수가 같은 한글 이름 `결제` · `회원` 은 같은 폴더를 가리켰고, `대화 모두 지우기` 가 그
 * 폴더를 통째로 지웠다. 새 프로젝트의 slug 는 영숫자 · `-` `_` `.` 밖의 글자가 있으면 이름 뒤에 해시
 * 6자리를 붙인다. 화면의 이름은 그대로고, 이미 있는 프로젝트의 slug 는 건드리지 않는다.
 */

const NONE: ReadonlySet<string> = new Set();

/** 데이터 폴더 아래 한 프로젝트의 클론 경로 — Claude 의 대화 폴더 키는 이 경로에서 나온다. */
const cloneOf = (slug: string): string => `/home/u/.colonova-design/projects/${slug}/repo`;

test("재현: 옛 규칙에서 `결제` · `회원` 은 같은 Claude 대화 폴더 키였다", () => {
  // 옛 slugify 는 정리만 하고 이름을 그대로 폴더로 썼다 — 이 경로 둘이 그 결과다.
  assert.equal(claudeProjectKey(cloneOf("결제")), claudeProjectKey(cloneOf("회원")));
  // 같은 글자 수의 한글은 몇 글자든 같은 모양이고, 글자 수가 다르면 달라진다.
  assert.equal(claudeProjectKey(cloneOf("가나다")), claudeProjectKey(cloneOf("라마바")));
  assert.notEqual(claudeProjectKey(cloneOf("결제")), claudeProjectKey(cloneOf("결제앱")));
});

test("새 규칙: `결제` · `회원` 의 slug 도 Claude 키도 서로 다르다", () => {
  const pay = slugify("결제", NONE);
  const member = slugify("회원", NONE);
  assert.notEqual(pay, member);
  assert.match(pay, /^결제-[0-9a-f]{6}$/);
  assert.match(member, /^회원-[0-9a-f]{6}$/);
  assert.notEqual(claudeProjectKey(cloneOf(pay)), claudeProjectKey(cloneOf(member)));
});

test("영숫자와 - _ . 만으로 된 이름은 접미 없이 그대로다 — 폴더 이름이 읽힌다", () => {
  assert.equal(slugify("My App", NONE), "my-app");
  assert.equal(slugify("my_app", NONE), "my_app");
  assert.equal(slugify("v1.2.3", NONE), "v1.2.3");
  assert.equal(slugify("  Pay  Core  ", NONE), "pay-core");
  assert.equal(slugify("checkout", NONE), "checkout");
});

test("영숫자 밖의 글자가 하나라도 있으면 접미가 붙는다 — 한글 · 느낌표 · 악센트", () => {
  assert.match(slugify("결제", NONE), /-[0-9a-f]{6}$/);
  assert.match(slugify("Pay!", NONE), /^pay!-[0-9a-f]{6}$/);
  assert.match(slugify("café", NONE), /^café-[0-9a-f]{6}$/);
  assert.match(slugify("Pay 결제", NONE), /^pay-결제-[0-9a-f]{6}$/);
});

test("같은 이름은 같은 접미다 — 다시 들여도 같은 폴더를 찾는다", () => {
  assert.equal(slugify("결제", NONE), slugify("결제", NONE));
  // 앞뒤 공백은 이름이 아니다.
  assert.equal(slugify("  결제  ", NONE), slugify("결제", NONE));
  // mac 에서 온 NFD 한글과 NFC 한글은 같은 이름이다.
  assert.equal(slugify("결제".normalize("NFD"), NONE), slugify("결제".normalize("NFC"), NONE));
  // 이름이 다르면 접미도 다르다.
  const suffix = (slug: string) => slug.slice(slug.lastIndexOf("-") + 1);
  assert.notEqual(suffix(slugify("결제", NONE)), suffix(slugify("회원", NONE)));
  assert.notEqual(suffix(slugify("결제", NONE)), suffix(slugify("결제앱", NONE)));
});

test("접미는 이름을 줄여 32자 상한 안에 든다 — 길어도 접미가 살아 있다", () => {
  const long = slugify("결제 시스템 개선 프로젝트 관리 도구 모음집 2024 리뉴얼 최종", NONE);
  assert.ok(Array.from(long).length <= 32, `32자 이하여야 한다: ${long}`);
  assert.match(long, /^결제-시스템-개선-프로젝트-관리-도구-모음집-[0-9a-f]{6}$/);
  // 이름이 접미 앞에서 `-` 로 끝나도 `--` 가 되지 않는다(25자째가 이어 붙인 `-` 일 때).
  const cut = slugify(`${"가".repeat(24)} 나다라`, NONE);
  assert.doesNotMatch(cut, /--/);
  assert.match(cut, /^가{24}-[0-9a-f]{6}$/);
  // ASCII 이름의 상한은 그대로 32 — 접미가 없으니 이름이 다 쓰인다.
  assert.equal(slugify("a".repeat(40), NONE), "a".repeat(32));
});

test("이모지 한가운데서 자르지 않는다 — 깨진 글자가 폴더 이름에 남지 않는다", () => {
  const slug = slugify("😀".repeat(40), NONE);
  assert.equal(slug.isWellFormed(), true);
  assert.ok(Array.from(slug).length <= 32);
  // 선로의 slug 상한(64 UTF-16 칸)을 넘지 않는다.
  assert.ok(slug.length <= 64 - 3, `선로 상한 안이어야 한다: ${slug.length}`);
});

test("taken 충돌은 -2, -3 으로 풀린다", () => {
  const first = slugify("결제", NONE);
  const second = slugify("결제", new Set([first]));
  assert.equal(second, `${first}-2`);
  assert.equal(slugify("결제", new Set([first, second])), `${first}-3`);
  assert.equal(slugify("pay", new Set(["pay"])), "pay-2");
});

test("같은 slug 가 아니라 같은 대화 폴더가 겹침이다 — my_app 과 my-app 은 한 폴더", () => {
  // `_` `.` `-` 는 모두 `-` 로 접히므로 두 slug 의 Claude 키가 같다.
  assert.equal(claudeProjectKey(cloneOf("my_app")), claudeProjectKey(cloneOf("my-app")));
  assert.equal(slugify("my-app", new Set(["my_app"])), "my-app-2");
  assert.equal(slugify("my.app", new Set(["my-app"])), "my.app-2");
  // 대소문자만 다른 것도 대소문자를 가리지 않는 파일 시스템에서는 한 폴더다.
  assert.equal(slugify("pay", new Set(["PAY"])), "pay-2");
});

test("옛 slug 는 그대로 두고 새 프로젝트만 접미를 받는다 — 같은 이름이 곁에 서도 키가 다르다", () => {
  const legacy = "결제"; // 접미 이전에 만든 프로젝트의 slug
  const fresh = slugify("결제", new Set([legacy]));
  assert.notEqual(fresh, legacy);
  assert.notEqual(claudeProjectKey(cloneOf(fresh)), claudeProjectKey(cloneOf(legacy)));
  // 옛 `회원` 과 새 `결제` 도 한 폴더가 아니다.
  const other = slugify("결제", new Set(["회원"]));
  assert.notEqual(claudeProjectKey(cloneOf(other)), claudeProjectKey(cloneOf("회원")));
});

test("경로에 위험한 입력도 안전한 한 조각이 된다", () => {
  const hostile = [
    "../../etc/passwd",
    "..",
    " .. ",
    ".",
    "...",
    "a/b",
    "a\\b",
    "C:\\Windows\\System32",
    "/etc",
    "CON",
    "nul",
    "COM1.txt",
    "lpt9",
    "Aux.log",
    "foo.",
    "foo. .",
    "tab\there",
    "nul\u0000byte",
    "***",
    "",
    "   ",
    "~",
    "$(whoami)",
  ];
  const root = "/home/u/.colonova-design/projects";
  for (const name of hostile) {
    const slug = slugify(name, NONE);
    const shown = JSON.stringify(name);
    assert.ok(slug.length > 0, `${shown}: 빈 slug`);
    assert.notEqual(slug, ".", shown);
    assert.notEqual(slug, "..", shown);
    assert.doesNotMatch(slug, /[/\\:*?"<>|]/, `${shown}: 경로 글자 → ${slug}`);
    const controls = [...slug].filter((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
    assert.deepEqual(controls, [], `${shown}: 제어 문자 → ${slug}`);
    assert.doesNotMatch(slug, /^\./, `${shown}: 점으로 시작 → ${slug}`);
    assert.doesNotMatch(slug, /\.$/, `${shown}: 점으로 끝남(Windows 가 뗀다) → ${slug}`);
    // Windows 장치 이름은 접미로 풀려 폴더가 만들어진다.
    assert.doesNotMatch(slug, /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i, `${shown} → ${slug}`);
    // 데이터 폴더 아래의 한 조각으로 남는다 — 부모로 새지 않는다.
    const inside = relative(root, join(root, slug));
    assert.ok(inside === slug && !inside.includes(sep), `${shown}: 밖으로 샘 → ${inside}`);
  }
  assert.equal(slugify("", NONE), "project");
  assert.equal(slugify(" .. ", NONE), "project");
  assert.match(slugify("CON", NONE), /^con-[0-9a-f]{6}$/);
});

test("점 · 하이픈 · 밑줄뿐인 이름은 글자가 없는 이름이다 — `-` 폴더가 되지 않고 project 로 떨어진다(2026-10-08 F15)", () => {
  for (const name of [". .", "-", "_", "---", "_._", " - . - ", "- _ -"]) {
    assert.equal(slugify(name, NONE), "project", JSON.stringify(name));
  }
  // 같은 폴더를 나눠 쓰지 않는다 — 두 번째는 번호가 붙는다.
  assert.equal(slugify(". .", new Set(["project"])), "project-2");
  assert.equal(slugify("-", new Set(["project", "project-2"])), "project-3");
  // 글자나 숫자가 하나라도 있으면 그대로다.
  assert.equal(slugify("_a_", NONE), "_a_");
  assert.equal(slugify("v1.", NONE), "v1");
  assert.match(slugify("-결제-", NONE), /결제-[0-9a-f]{6}$/);
});

test("레지스트리: 한글 이름 둘이 다른 폴더와 다른 대화 폴더를 받고, 화면 이름은 그대로다", () => {
  const dir = mkdtempSync(join(tmpdir(), "project-slug-"));
  const env = {
    COLONOVA_DESIGN_PROJECTS_SETTINGS: join(dir, "projects.json"),
    COLONOVA_DESIGN_PROJECTS_DIR: join(dir, "projects"),
  };
  try {
    const reg = ProjectRegistry.load(env);
    const pay = reg.create({ name: "결제", repoUrl: "https://github.com/org/a.git" });
    const member = reg.create({ name: "회원", repoUrl: "https://github.com/org/b.git" });
    assert.notEqual(pay.slug, member.slug);
    assert.equal(pay.name, "결제"); // 접미는 디스크 폴더에만 붙는다
    assert.equal(member.name, "회원");
    const payRepo = reg.paths(pay.slug).repoRoot;
    const memberRepo = reg.paths(member.slug).repoRoot;
    assert.notEqual(payRepo, memberRepo);
    assert.notEqual(claudeProjectKey(payRepo), claudeProjectKey(memberRepo));
    // 디스크의 레지스트리에도 같은 slug 가 남는다.
    const again = ProjectRegistry.load(env);
    assert.deepEqual(
      again.list().map((project) => [project.slug, project.name]),
      [
        [pay.slug, "결제"],
        [member.slug, "회원"],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("레지스트리: 접미 이전의 프로젝트는 그대로 읽히고, 새로 들인 같은 이름은 다른 slug 를 받는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "project-slug-legacy-"));
  const file = join(dir, "projects.json");
  const env = {
    COLONOVA_DESIGN_PROJECTS_SETTINGS: file,
    COLONOVA_DESIGN_PROJECTS_DIR: join(dir, "projects"),
  };
  try {
    mkdirSync(dir, { recursive: true });
    const legacy = (slug: string, repo: string) => ({
      slug,
      name: slug,
      repo: { url: repo, baseBranch: "main", branch: null, handoff: null },
    });
    writeFileSync(
      file,
      JSON.stringify({
        active: "결제",
        projects: [
          legacy("결제", "https://github.com/org/a.git"),
          legacy("회원", "https://github.com/org/b.git"),
        ],
      }),
    );
    const reg = ProjectRegistry.load(env);
    // 마이그레이션은 없다 — slug 는 손대지 않는다.
    assert.deepEqual(
      reg.list().map((project) => project.slug),
      ["결제", "회원"],
    );
    const fresh = reg.create({ name: "결제", repoUrl: "https://github.com/org/c.git" });
    assert.match(fresh.slug, /^결제-[0-9a-f]{6}$/);
    for (const old of ["결제", "회원"]) {
      assert.notEqual(
        claudeProjectKey(reg.paths(fresh.slug).repoRoot),
        claudeProjectKey(reg.paths(old).repoRoot),
        `새 프로젝트가 옛 ${old} 와 대화 폴더를 나눠 쓴다`,
      );
    }
    assert.equal(JSON.parse(readFileSync(file, "utf8")).projects[0].slug, "결제");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
