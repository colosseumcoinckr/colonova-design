import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 기획서 연결의 자리(2026-11-13 사용자 결정 — 연결을 프로젝트 쪽으로, R1-1 계약 시험) —
 * 폼은 `project/PlansConnectDialog` 의 대화상자 하나에만 살고, 그 밖의 길(빈 상태 · 띠 · 설정 줄 ·
 * 프로젝트 카드)은 전부 `nav.openPlansConnect` 로 모인다. 누군가 단추를 옛 길(`openSettings("connection")`)
 * 로 되돌리거나 설정에 폼을 되살려도 이 시험이 붙잡는다.
 */

const NEXT = join(import.meta.dirname, "../src/next");
const read = (file: string) => readFileSync(join(NEXT, file), "utf8");

/** `plans/` 아래의 모든 소스 — 새 파일이 생겨도 자동으로 잡힌다. */
const plansFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? plansFiles(join(dir, entry.name))
      : entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
        ? [join(dir, entry.name)]
        : [],
  );

test('plans/ 아래 어디에도 옛 길(openSettings("connection"))이 없다', () => {
  for (const file of plansFiles(join(NEXT, "plans"))) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !source.includes('openSettings("connection")'),
      `${file} 가 연결을 설정 쪽으로 보낸다`,
    );
  }
});

test("설정 → 연결 쪽은 폼을 모른다 — 한 줄과 `열기` 뿐이다", () => {
  const page = read("settings/ConnectionPage.tsx");
  assert.ok(!page.includes("ConfluenceConnect"), "ConnectionPage 가 ConfluenceConnect 를 되살렸다");
  assert.ok(page.includes("onOpenPlansConnect"), "설정 줄이 대화상자로 가는 손을 잃었다");
});

test("폼은 기획서 연결 대화상자 안에만 산다 — 다시 연다는 같은 대화상자다", () => {
  const dialog = read("project/PlansConnectDialog.tsx");
  assert.ok(dialog.includes("ConfluenceConnect"), "PlansConnectDialog 가 폼을 렌더하지 않는다");
  assert.ok(
    dialog.includes('key={daemon.activeSlug ?? ""}'),
    "프로젝트를 바꿔도 폼이 리마운트되지 않는다",
  );
});

test("nav 계약에 openPlansConnect 가 있고 plans 의 단추들이 그것을 부른다", () => {
  const slots = read("slots.ts");
  assert.ok(slots.includes("openPlansConnect"), "ShellNav 계약에 openPlansConnect 가 없다");
  for (const file of ["plans/PlansColumn.tsx", "plans/PlansSidebar.tsx"]) {
    assert.ok(read(file).includes("nav.openPlansConnect"), `${file} 가 대화상자를 열지 않는다`);
  }
  for (const file of ["plans/PlansEmpty.tsx", "plans/PlansList.tsx"]) {
    assert.ok(read(file).includes("onConnect"), `${file} 가 연결 손을 받지 않는다`);
  }
});

test("대화상자 안에서 제목은 한 번 — 폼 첫 줄은 상태만 말한다(R1-2)", () => {
  const connect = read("settings/ConfluenceConnect.tsx");
  assert.ok(
    connect.includes("L.plans.statusRow"),
    "폼 첫 줄이 상태 알약 줄이 아니다 — 머리와 제목이 겹친다",
  );
  assert.ok(
    !connect.includes("sub={L.plans.titleSub}"),
    "폼 첫 줄이 대화상자 머리와 같은 자리의 보조를 또 말한다",
  );
});

test("reset 중 `열기` 는 표식을 거두고 돌아간다(R1-3)", () => {
  const dialog = read("settings/SettingsDialog.tsx");
  // 조기 반환이 표식을 남기면 뒤의 정상 닫기가 뜻밖에 대화상자를 연다.
  assert.ok(
    /reset\.phase !== "idle"\) \{\s*plansAfter\.current = false;/s.test(dialog),
    "reset 조기 반환이 plansAfter 표식을 거두지 않는다",
  );
});

test("설정을 열면 기획서 연결 대화상자는 먼저 닫힌다(R1-4)", () => {
  const workspace = read("Workspace.tsx");
  const openSettings = workspace.match(
    /const openSettings = \(page\?: SettingsPage\) => \{([\s\S]*?)\};/,
  );
  assert.ok(openSettings !== null, "openSettings 를 찾지 못한다");
  assert.ok(
    openSettings[1].includes("setPlansConnectOpen(false)"),
    "설정이 열린 대화상자 아래에 깔린다",
  );
});

test("연결 전 대화상자의 처음 초점은 사이트 주소 입력이다(감독자 걷기)", () => {
  const connect = read("settings/ConfluenceConnect.tsx");
  // ModalFrame 은 안의 autoFocus 를 지킨다 — 입력 칸이 보일 때 사이트 주소가 서야 한다.
  assert.ok(connect.includes("autoFocus"), "사이트 입력에 autoFocus 가 없다");
  // 입력 셋은 모두 값을 받아야 한다 — 수리 중 autoFocus 가 사이트 칸의 onChange 를 밀어낸 일이 있었다(2026-11-13).
  const inputs = connect.match(/<input[\s\S]*?\/>/g) ?? [];
  assert.ok(inputs.length >= 4, "입력 칸을 찾지 못한다");
  for (const input of inputs) {
    const id = /id="([^"]+)"/.exec(input)?.[1] ?? "?";
    assert.ok(input.includes("onChange="), `${id} 입력이 값을 받지 않는다`);
  }
});

test("카드 줄의 글자 규칙은 그 줄에만 걸린다", () => {
  const css = read("project/project.css");
  // 전역 `.nx-mi b` 는 앱의 모든 메뉴 줄을 한 줄로 묶는다 — 기획서 연결 줄의 클래스로만 건다.
  assert.ok(!/(^|\n)\.nx-mi b\s*\{/.test(css), "전역 .nx-mi b 규칙이 있다");
});
