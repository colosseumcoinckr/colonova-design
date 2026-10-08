import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ProjectSummary } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-waiting.test.ts 와 같은 모양).
import { initialNav, navReducer } from "../src/next/lib/nav.ts";
import {
  nextReady,
  type SeenView,
  sameList,
  seesScreen,
  stepFirstPrep,
} from "../src/next/lib/ready-watch.ts";

/**
 * 첫 5분(2026-10-07 베타 준비 분석) — 첫 프로젝트의 첫 준비는 3~5분이고 사용자는 그동안 홈에 있다. 끝난 순간 앱 안에서
 * 말하는 판정(`ready-watch.ts`)과 홈의 준비 줄이 작업 화면으로 가는 길(`nav.ts` 의 `screen` · `HomeInbox`)을 지킨다.
 */
const P = (
  slug: string,
  phase: ProjectSummary["phase"],
  firstPrep?: boolean,
): Pick<ProjectSummary, "slug" | "phase" | "firstPrep"> => ({
  slug,
  phase,
  ...(firstPrep ? { firstPrep } : {}),
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("stepFirstPrep: 데몬이 첫 준비라고 말하는 동안 지켜보고, ready 로 바뀌는 순간 한 번 끝났다고 한다", () => {
  let watching = new Set<string>();
  const run = (...projects: Array<Pick<ProjectSummary, "slug" | "phase" | "firstPrep">>) => {
    const step = stepFirstPrep(watching, projects);
    watching = step.watching;
    return step.finished;
  };
  assert.deepEqual(run(P("a", "cloning", true)), []);
  assert.deepEqual(run(P("a", "installing", true)), []);
  assert.deepEqual(run(P("a", "starting", true)), []);
  assert.deepEqual(run(P("a", "ready")), ["a"], "ready 로 바뀐 순간");
  assert.deepEqual(run(P("a", "ready")), [], "이어지는 ready 방송은 다시 말하지 않는다");
  assert.deepEqual([...watching], []);
});

test("stepFirstPrep: 앱을 다시 켤 때의 준비(최신화 · 재설치)는 말하지 않는다 — 데몬의 표식이 없다", () => {
  let watching = new Set<string>();
  const run = (project: Pick<ProjectSummary, "slug" | "phase" | "firstPrep">) => {
    const step = stepFirstPrep(watching, [project]);
    watching = step.watching;
    return step.finished;
  };
  // 손대지 않은 프로젝트는 준비된 것이어도 `missing` 으로 온다 — 그것만으로 첫 준비라 믿지 않는다.
  assert.deepEqual(run(P("a", "missing")), []);
  assert.deepEqual(run(P("a", "pulling")), []);
  assert.deepEqual(run(P("a", "installing")), []);
  assert.deepEqual(run(P("a", "starting")), []);
  assert.deepEqual(run(P("a", "ready")), []);
});

test("stepFirstPrep: 창이 준비 도중에 켜져도 놓치지 않고, 오류를 지나도 첫 준비다", () => {
  let watching = new Set<string>();
  const run = (project: Pick<ProjectSummary, "slug" | "phase" | "firstPrep">) => {
    const step = stepFirstPrep(watching, [project]);
    watching = step.watching;
    return step.finished;
  };
  // 첫 스냅샷이 이미 설치 중이다(초대 파일을 AI 설치보다 먼저 놓아 준비가 미리 시작된 경우) — 데몬의 표식이 말해 준다.
  assert.deepEqual(run(P("a", "installing", true)), []);
  // 데몬은 오류에도 표식을 이어 둔다 — 표식이 잠깐 빠진 스냅샷이 와도 지켜보기는 이어진다.
  assert.deepEqual(run(P("a", "error")), []);
  assert.deepEqual([...watching], ["a"]);
  assert.deepEqual(run(P("a", "ready")), ["a"]);
});

test("stepFirstPrep: 프로젝트마다 따로 — 한 프로젝트가 끝나도 다른 프로젝트의 준비는 이어진다 · 사라진 프로젝트는 거둔다", () => {
  let step = stepFirstPrep(new Set(), [P("a", "installing", true), P("b", "cloning", true)]);
  assert.deepEqual([...step.watching].sort(), ["a", "b"]);
  step = stepFirstPrep(step.watching, [P("a", "ready"), P("b", "installing", true)]);
  assert.deepEqual(step.finished, ["a"]);
  assert.deepEqual([...step.watching], ["b"]);
  step = stepFirstPrep(step.watching, [P("a", "ready")]);
  assert.deepEqual([...step.watching], [], "목록에서 사라진 프로젝트는 지켜보지 않는다");
  assert.deepEqual(step.finished, []);
});

const home: SeenView = { view: "home", tab: "chat", narrow: false, activeSlug: "a" };
const work: SeenView = { view: "thread", tab: "chat", narrow: false, activeSlug: "a" };

test("seesScreen: 활성 프로젝트의 작업 화면이 열려 있을 때만 보고 있다 — 좁은 창은 화면 탭이 앞에 있어야 한다", () => {
  assert.equal(seesScreen(home, "a"), false, "홈은 미리보기 칸이 숨는다");
  assert.equal(seesScreen(work, "a"), true);
  assert.equal(seesScreen(work, "b"), false, "다른 프로젝트의 화면은 보고 있지 않다");
  assert.equal(
    seesScreen({ ...work, narrow: true, tab: "chat" }, "a"),
    false,
    "좁은 창의 대화 탭은 준비 카드를 가린다",
  );
  assert.equal(seesScreen({ ...work, narrow: true, tab: "preview" }, "a"), true);
  assert.equal(seesScreen({ ...work, activeSlug: null }, "a"), false);
});

test("nextReady: 홈이거나 다른 프로젝트일 때 끝나면 말하고(토스트 · 줄), 보고 있는 화면이면 조용하다", () => {
  const up = ["a", "b"];
  // 홈에서 a 가 끝났다.
  assert.deepEqual(nextReady({ ready: [], finished: ["a"], up, seen: home }), {
    ready: ["a"],
    announce: ["a"],
  });
  // 작업 화면을 보는 중에 a 가 끝났다 — 화면이 이미 말한다.
  assert.deepEqual(nextReady({ ready: [], finished: ["a"], up, seen: work }), {
    ready: [],
    announce: [],
  });
  // a 의 화면을 보는 중에 다른 프로젝트 b 가 끝났다 — b 의 화면은 보고 있지 않다.
  assert.deepEqual(nextReady({ ready: [], finished: ["b"], up, seen: work }), {
    ready: ["b"],
    announce: ["b"],
  });
});

test("nextReady: 줄은 그 프로젝트의 작업 화면을 볼 때 거두고, 사라진 프로젝트도 거둔다", () => {
  const up = ["a", "b"];
  // 홈에 줄이 둘 서 있다가 a 의 화면을 보게 됐다 — a 만 거둔다.
  assert.deepEqual(nextReady({ ready: ["a", "b"], finished: [], up, seen: work }), {
    ready: ["b"],
    announce: [],
  });
  // 좁은 창에서 화면 탭을 앞에 세우면 이미 본 것이다.
  assert.deepEqual(
    nextReady({
      ready: ["a"],
      finished: [],
      up,
      seen: { ...work, narrow: true, tab: "preview" },
    }).ready,
    [],
  );
  // 목록에서 사라진 프로젝트의 줄은 서 있지 않는다.
  assert.deepEqual(nextReady({ ready: ["a", "z"], finished: [], up, seen: home }).ready, ["a"]);
  // 서버가 다시 준비 중이면(떠 있지 않다) `떴어요` 가 거짓이 된다 — 줄을 거두고, 돌아와도 다시 말하지 않는다(지켜보기는 꺼졌다).
  assert.deepEqual(nextReady({ ready: ["a", "b"], finished: [], up: ["b"], seen: home }).ready, [
    "b",
  ]);
  // 같은 프로젝트가 두 번 쌓이지 않는다.
  assert.deepEqual(nextReady({ ready: ["a"], finished: ["a"], up, seen: home }).ready, ["a"]);
});

test("sameList: 순서까지 같을 때만 같다", () => {
  assert.equal(sameList([], []), true);
  assert.equal(sameList(["a", "b"], ["a", "b"]), true);
  assert.equal(sameList(["a", "b"], ["b", "a"]), false);
  assert.equal(sameList(["a"], ["a", "b"]), false);
});

test("nav: screen 은 작업 화면의 미리보기 쪽으로 — 홈에서 오든 서랍이 열려 있든", () => {
  let state = initialNav(false);
  state = navReducer(state, { type: "drawer", open: true });
  assert.equal(state.view, "home");
  state = navReducer(state, { type: "screen" });
  assert.equal(state.view, "thread");
  assert.equal(state.tab, "preview", "좁은 창은 화면 탭이 앞에 선다");
  assert.equal(state.drawer, false);
  // 대화를 여는 손(thread)은 탭을 건드리지 않는다 — 보내고 나면 대화가 보여야 한다.
  state = navReducer(initialNav(false), { type: "thread" });
  assert.equal(state.tab, "chat");
});

test("홈의 처음 켜는 준비 줄: 활성 프로젝트면 작업 화면으로, 다른 프로젝트면 옮긴다(2026-10-07)", () => {
  const inbox = read("../src/next/home/HomeInbox.tsx");
  // `switchProject` 는 이미 활성인 프로젝트로는 아무 데도 가지 않는다 — 첫 프로젝트(늘 활성)의 준비 줄이 죽어 있었다.
  const guarded =
    /project\.slug === active\?\.slug \? onShowScreen\(\) : onSwitch\(project\.slug\)/;
  assert.match(inbox, guarded);
  // 준비 줄의 묶음 안에 가드 없는 `onSwitch(project.slug)` 가 남지 않는다.
  const block = inbox.slice(inbox.indexOf("{preparing.map("), inbox.indexOf("{otherWorking.map("));
  assert.match(block, guarded);
  assert.doesNotMatch(block.replace(guarded, ""), /onSwitch\(project\.slug\)/);
  // 같은 규칙을 따르는 줄은 둘뿐이다 — 개발자 확인 대기 줄(작업 보기)과 이 줄. 나머지 줄은 활성이 아닌 프로젝트의 것이다.
  assert.match(inbox, /row\.slug === active\?\.slug \? onOpenWork\(\) : onSwitch\(row\.slug\)/);
  assert.match(
    inbox,
    /const others = daemon\.projects\.filter\(\(project\) => project\.slug !== daemon\.activeSlug\)/,
  );
  const view = read("../src/next/home/HomeView.tsx");
  assert.match(view, /onShowScreen=\{nav\.showScreen\}/);
  // 다른 프로젝트로 옮기는 길은 그대로다 — 활성이어도 아무 데도 안 가던 `switchProject` 자체는 건드리지 않는다.
  const shell = read("../src/next/lib/use-shell-nav.ts");
  assert.match(
    shell,
    /return slug === daemon\.activeSlug\s*\? Promise\.resolve\(true\)\s*: activate\(slug, undefined, options\);/,
  );
});

test("셸: 서비스가 떴다는 알림(OS)을 누르면 그 화면으로, 토스트의 단추도 같은 길이다(2026-10-07)", () => {
  const shell = read("../src/next/lib/use-shell-nav.ts");
  assert.match(shell, /if \(readyRef\.current\.includes\(slug\)\) now\.openProjectScreen\(slug\);/);
  assert.match(shell, /run: \(\) => latest\.current\.nav\.openProjectScreen\(slug\)/);
  // 준비 소식은 한 번 — 데몬의 첫 준비 표식에서만 나오고, 화면을 보고 있으면 말하지 않는다.
  assert.match(shell, /stepFirstPrep\(watchingPrep\.current, daemon\.projects\)/);
  // 서비스 화면으로 가는 길은 도착한 화면이 말한다 — `옮겼어요` 가 한 번 더 뜨지 않는다.
  assert.match(shell, /if \(!then\?\.screen\) toastSwitched\(slug\)/);
  const workspace = read("../src/next/Workspace.tsx");
  assert.match(workspace, /narrow,\s*onLayoutChange,/);
  assert.match(workspace, /ready=\{ready\}/);
});

test("토스트: 단추가 달리면 더 오래 머물고, 누르면 일을 하고 닫힌다", () => {
  const toast = read("../src/next/ui/Toast.tsx");
  assert.match(
    toast,
    /const lifeOf = \(note: ToastNote \| null\) => \(note\?\.action \? TOAST_ACTION_MS : TOAST_MS\)/,
  );
  assert.match(toast, /shown\.action\?\.run\(\);\s*done\.current\(\);/);
  const shell = read("../src/next/lib/use-shell-nav.ts");
  const ms = (name: string) =>
    Number(shell.match(new RegExp(`export const ${name} = ([\\d_]+);`))?.[1]?.replaceAll("_", ""));
  assert.ok(
    ms("TOAST_ACTION_MS") > ms("TOAST_MS"),
    "단추가 달린 토스트는 읽고 누를 시간이 더 필요하다",
  );
});
