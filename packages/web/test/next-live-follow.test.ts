import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-ci-line.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import {
  DRIVING_HOLD_MS,
  EDITING_FRESH_MS,
  type FollowModes,
  type FollowView,
  isFreshSignal,
  judgeSignal,
  pickLiveLine,
  routePath,
  shouldFollow,
} from "../src/next/lib/follow-edit.ts";

/**
 * 라이브감(2026-10-08 베타 준비 분석) — AI 가 고치는 화면을 같이 따라간다. 사용자를 방해하지 않는 것이 전부다: 이번 턴에 미리보기를
 * 직접 만졌으면 · 보고 있지 않으면 · 짚는 중이면 옮기지 않고, 옮겼다면 늘 한 줄로 말한다. 판정은 순수 함수로 표를 지키고,
 * 훅 · 데몬 · 선로의 이음매는 소스 계약으로 지킨다(렌더러 없이 훅을 돌릴 길이 없다).
 */

const T0 = 1_000_000;
const VIEW: FollowView = { visible: true, covered: false, external: false };
const MODES: FollowModes = {
  follow: true,
  pin: false,
  modal: false,
  frozen: false,
  history: false,
};
const base = () => ({
  turnStartedAt: T0,
  lastUserPreviewActionAt: null as number | null,
  currentRoute: "/" as string | null,
  target: "/members",
  view: VIEW,
  modes: MODES,
});

test("routePath: 쿼리 · 해시 · 끝 슬래시는 화면을 바꾸지 않는다", () => {
  assert.equal(routePath("/members?tab=2#top"), "/members");
  assert.equal(routePath("/members/"), "/members");
  assert.equal(routePath("members"), "/members");
  assert.equal(routePath(""), "/");
  assert.equal(routePath("/"), "/");
  assert.equal(routePath("/?x=1"), "/");
});

test("shouldFollow: 방해받지 않았고 다른 화면을 보고 있으면 옮긴다", () => {
  assert.equal(shouldFollow(base()), true);
  // 사용자가 이 턴 전에 미리보기를 만졌던 것은 방해가 아니다.
  assert.equal(shouldFollow({ ...base(), lastUserPreviewActionAt: T0 - 1 }), true);
  // 쿼리만 다른 같은 화면은 옮길 일이 아니다 — 아래 `같은 화면` 표.
  assert.equal(shouldFollow({ ...base(), currentRoute: "/members?tab=2" }), false);
});

test("shouldFollow: 이번 턴이 시작된 뒤 사용자가 미리보기를 만졌으면 옮기지 않는다", () => {
  assert.equal(shouldFollow({ ...base(), lastUserPreviewActionAt: T0 }), false);
  assert.equal(shouldFollow({ ...base(), lastUserPreviewActionAt: T0 + 5_000 }), false);
});

test("shouldFollow: 옮기지 않는 모든 경우 — 하나라도 걸리면 거절", () => {
  const no = (patch: Partial<ReturnType<typeof base>>, why: string) =>
    assert.equal(shouldFollow({ ...base(), ...patch }), false, why);
  no({ modes: { ...MODES, follow: false } }, "설정이 꺼져 있다");
  no({ turnStartedAt: null }, "턴이 언제 시작했는지 모른다");
  no({ view: { ...VIEW, visible: false } }, "홈이 떠 있거나 대화 탭이 앞이라 칸이 숨었다");
  no({ view: { ...VIEW, covered: true } }, "준비 중 · 오류 · 잠금 덮개가 무대를 가린다");
  no({ view: { ...VIEW, external: true } }, "사람이 일부러 외부 페이지로 나갔다");
  no({ modes: { ...MODES, pin: true } }, "핀 모드");
  no({ modes: { ...MODES, modal: true } }, "비교 대화상자 같은 겹판이 열려 있다");
  no({ modes: { ...MODES, frozen: true } }, "제출한 때의 화면을 보는 중");
  no({ modes: { ...MODES, history: true } }, "작업 기록 서랍이 열려 있다");
  no({ currentRoute: null }, "어디를 보는지 모른다");
  no({ currentRoute: "/members" }, "이미 그 화면이다");
  no({ currentRoute: "/members/" }, "끝 슬래시만 다른 같은 화면이다");
  no({ target: "members" }, "경로가 아닌 값은 옮기지 않는다");
});

// ————— 신호 하나를 맞이하는 판정(훅이 부르는 한 곳) — 전이를 재생한다 —————

/** 훅의 상태(decidedTurn)를 흉내 내며 신호를 차례로 먹인다. */
function replay() {
  let decided: string | null = null;
  const names: Record<string, string> = { "/": "첫 화면", "/billing": "결제 내역" };
  return (patch: {
    sessionId?: string;
    turnStartedAt?: number | null;
    route?: string;
    title?: string | null;
    at?: number;
    now?: number;
    touched?: number | null;
    here?: string | null;
    view?: FollowView;
    modes?: FollowModes;
  }) => {
    const at = patch.at ?? T0 + 4_000;
    const verdict = judgeSignal({
      decidedTurn: decided,
      sessionId: patch.sessionId ?? "s1",
      turnStartedAt: patch.turnStartedAt === undefined ? T0 : patch.turnStartedAt,
      signal: {
        route: patch.route ?? "/members",
        title: patch.title === undefined ? "회원 목록" : patch.title,
        at,
      },
      now: patch.now ?? at + 20,
      titleOf: (route) => names[route] ?? null,
      lastUserPreviewActionAt: patch.touched === undefined ? null : patch.touched,
      currentRoute: patch.here === undefined ? "/" : patch.here,
      view: patch.view ?? VIEW,
      modes: patch.modes ?? MODES,
    });
    decided = verdict.turn;
    return verdict.follow;
  };
}

test("전이: 방해받지 않은 사용자의 미리보기는 첫 편집의 화면으로 옮겨지고, 이름을 말한다", () => {
  const feed = replay();
  assert.deepEqual(feed({}), { route: "/members", name: "회원 목록" });
});

test("전이: 한 턴의 기회는 첫 신호 하나뿐이다 — 두 번째 화면의 신호는 옮기지 않는다", () => {
  const feed = replay();
  assert.notEqual(feed({}), null);
  assert.equal(feed({ route: "/billing", title: "결제 내역", at: T0 + 30_000 }), null);
  // 다음 턴은 새 기회다.
  assert.deepEqual(
    feed({ turnStartedAt: T0 + 120_000, at: T0 + 125_000, route: "/billing", title: "결제 내역" }),
    {
      route: "/billing",
      name: "결제 내역",
    },
  );
});

test("전이: 사용자가 이번 턴에 미리보기를 만진 뒤에는 옮겨지지 않는다 — 그 턴의 기회는 그것으로 끝이다", () => {
  const feed = replay();
  // 4초에 첫 신호가 오는데 사용자는 2초에 만졌다.
  assert.equal(feed({ touched: T0 + 2_000 }), null);
  // 만진 사실이 사라진 것처럼 두 번째 신호가 와도(예: 이후 사용자가 다른 화면으로 돌아감) 같은 턴이라 옮기지 않는다.
  assert.equal(
    feed({ route: "/billing", title: "결제 내역", at: T0 + 30_000, touched: null }),
    null,
  );
});

test("전이: 사용자가 이 턴 전에 만졌던 것은 방해가 아니다", () => {
  const feed = replay();
  assert.notEqual(feed({ touched: T0 - 500 }), null);
});

test("전이: 막 도착하지 않은 낡은 신호(대화를 옮겨 다시 만난 것)로는 옮기지 않고, 그 턴의 기회도 쓴다", () => {
  const feed = replay();
  assert.equal(feed({ at: T0 + 4_000, now: T0 + 4_000 + EDITING_FRESH_MS + 1 }), null);
  assert.equal(feed({ route: "/billing", title: "결제 내역", at: T0 + 30_000 }), null);
});

test("전이: 다른 대화는 다른 턴이다 — 열쇠가 대화마다 갈린다", () => {
  const feed = replay();
  assert.notEqual(feed({ sessionId: "a" }), null);
  assert.notEqual(feed({ sessionId: "b" }), null);
});

test("전이: 이름을 말할 수 없으면 옮기지 않는다 — 신호의 제목 → 칸이 아는 이름 순으로 찾는다", () => {
  const feed = replay();
  // 제목도 없고 칸도 모르는 화면 — 투명하게 말할 수 없으니 옮기지 않는다.
  assert.equal(feed({ title: null, route: "/unknown" }), null);
  const next = replay();
  // 신호에 제목이 없어도 칸이 아는 이름이 있으면 그것으로 말한다.
  assert.deepEqual(next({ title: null, route: "/billing" }), {
    route: "/billing",
    name: "결제 내역",
  });
});

test("전이: 이미 그 화면을 보고 있으면 옮기지 않는다", () => {
  const feed = replay();
  assert.equal(feed({ here: "/members" }), null);
});

test("전이: 사람이 하는 일 · 설정 · 덮개는 어느 신호보다 먼저다", () => {
  const cases: Array<[string, Parameters<ReturnType<typeof replay>>[0]]> = [
    ["설정 꺼짐", { modes: { ...MODES, follow: false } }],
    ["핀 모드", { modes: { ...MODES, pin: true } }],
    ["겹판", { modes: { ...MODES, modal: true } }],
    ["칸이 숨음", { view: { ...VIEW, visible: false } }],
    ["덮개", { view: { ...VIEW, covered: true } }],
    ["외부 페이지", { view: { ...VIEW, external: true } }],
    ["어디인지 모름", { here: null }],
    ["턴 시작을 모름", { turnStartedAt: null }],
  ];
  for (const [why, patch] of cases) assert.equal(replay()(patch), null, why);
});

// ————— 한 줄의 차례 —————

test("pickLiveLine: 옮겼어요 → 눌러 보는 중 → 고치는 중, 없으면 말이 없다", () => {
  assert.deepEqual(pickLiveLine({ moved: "회원 목록", driving: true, editingName: "결제" }), {
    kind: "moved",
    name: "회원 목록",
  });
  assert.deepEqual(pickLiveLine({ moved: null, driving: true, editingName: "결제" }), {
    kind: "driving",
  });
  assert.deepEqual(pickLiveLine({ moved: null, driving: false, editingName: "결제" }), {
    kind: "editing",
    name: "결제",
  });
  // 제목을 모르면 고치는 중 문장은 없다.
  assert.equal(pickLiveLine({ moved: null, driving: false, editingName: null }), null);
});

test("isFreshSignal: 막 도착한 신호만", () => {
  assert.equal(isFreshSignal(1_000, 1_000), true);
  assert.equal(isFreshSignal(1_000, 1_000 + EDITING_FRESH_MS), true);
  assert.equal(isFreshSignal(1_000, 1_000 + EDITING_FRESH_MS + 1), false);
  // 시계가 거꾸로 가도 낡은 신호로 치지 않는다.
  assert.equal(isFreshSignal(5_000, 4_000), true);
});

// ————— 문장 —————

test("문장: 이름 앞 · 뒤의 말 — 이름이 `화면` 으로 끝나면 그 말을 겹치지 않아 조사가 늘 맞는다", () => {
  const whole = (parts: [string, string], name: string) => `${parts[0]}${name}${parts[1]}`;
  assert.equal(L.live.driving, "AI가 화면을 직접 눌러 보는 중");
  assert.equal(
    whole(L.live.editing("회원 목록"), "회원 목록"),
    "AI가 지금 ‘회원 목록’ 화면을 고치는 중",
  );
  assert.equal(whole(L.live.editing("첫 화면"), "첫 화면"), "AI가 지금 ‘첫 화면’을 고치는 중");
  assert.equal(whole(L.live.moved("결제"), "결제"), "‘결제’ 화면으로 옮겼어요");
  assert.equal(whole(L.live.moved("첫 화면"), "첫 화면"), "‘첫 화면’으로 옮겼어요");
});

// ————— 이음매(소스 계약) —————

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const column = strip(read("src/next/preview/PreviewColumn.tsx"));
const hook = strip(read("src/next/preview/use-live-follow.ts"));
const css = strip(read("src/next/preview/preview.css"));

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다. */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

test("칸: 따라가기는 칸의 기존 이동 `go` 하나만 쓴다 — 새 이동의 길을 만들지 않는다", () => {
  assert.match(
    column,
    /const followTo = useCallback\(\s*\(route: string\) => \{\s*go\(route\);\s*setFollowTick\(/,
  );
  assert.match(column, /onFollow: followTo,/);
  // 막대의 주소 알약은 따라간 순간도 물들지만, 무대를 훑는 빛줄기는 턴 끝의 도착만의 것이다.
  assert.match(column, /arrivePulse=\{arriveTick \+ followTick\}/);
  assert.match(column, /sweep=\{arriveTick\}/);
  // 이동의 몸(setTarget)은 `go` 안의 한 곳뿐이다.
  assert.equal(column.match(/setTarget\(\{/g)?.length, 1);
});

test("칸: 사람의 손만 `noteUser` 로 남기고, 턴 끝의 도착 · 따라가기 · 자동 새로 고침은 남기지 않는다", () => {
  // 사람의 손 — 걸음 · 주소 · 기기 · 찍기 · 핀 · 화면 링크 · 막대의 단추들.
  for (const spot of [
    /const walk = \(delta: -1 \| 1\) => \{\s*noteUser\(\);/,
    /open: \(path\) => \{\s*noteUser\(\);/,
    /const onAddress = \(raw: string\): string \| null => \{\s*noteUser\(\);/,
    /const pickDevice = \(next: PreviewDevice\) => \{\s*noteUser\(\);/,
    /\(on\?: boolean\) => \{\s*noteUser\(\);/,
    /\(pin: ColoNovaDesignPinEnvelope\["pin"\]\) => \{\s*noteUser\(\);/,
    /onGo=\{\(path\) => \{\s*noteUser\(\);\s*go\(path\);/,
    /onReload=\{\(\) => \{\s*noteUser\(\);\s*reload\(\);/,
    /const showAi = async \(\) => \{\s*noteUser\(\);/,
    /const openFrozen = async \(\) => \{\s*noteUser\(\);/,
  ]) {
    assert.match(column, spot);
  }
  // 기계의 손 — 턴 끝의 도착(arriveOnTurnEnd)과 실패 재시도 · 따라가기는 사람의 손길로 세지 않는다.
  const arrival = column.slice(
    column.indexOf("const liveBefore"),
    column.indexOf("const cycleTitle"),
  );
  assert.ok(arrival.includes("arriveOnTurnEnd"), "도착의 구간을 찾지 못했다");
  assert.doesNotMatch(arrival, /noteUser/);
  assert.doesNotMatch(
    column.slice(column.indexOf("const retryStage"), column.indexOf("const pickDevice")),
    /noteUser/,
  );
  assert.doesNotMatch(column, /followTo = [^;]*noteUser/);
});

test("칸: 활성 대화의 조작 · 신호만 읽고, 라이브 층은 무대 안에서 얼린 화면 앞에 선다", () => {
  assert.match(
    column,
    /driving: activeSessionId !== null && daemon\.browserDriving\.has\(activeSessionId\),/,
  );
  assert.match(
    column,
    /editing: activeSessionId \? \(daemon\.editingScreens\.get\(activeSessionId\) \?\? null\) : null,/,
  );
  assert.match(column, /follow: settings\.followEdits,/);
  assert.match(column, /<LiveLayer line=\{live\.line\} ring=\{live\.ring\} \/>\s*\{frozen && \(/);
  assert.match(column, /covered: overlay !== null,/);
  assert.match(column, /crowded: narrow && pinCount > 0,/);
});

test("훅: 신호마다 한 번 판정하고(턴의 열쇠), AI 의 초점 이동은 사람의 손길로 세지 않는다", () => {
  assert.match(hook, /const verdict = judgeSignal\(\{/);
  assert.match(hook, /decidedTurn\.current = verdict\.turn;/);
  assert.match(hook, /\}, \[editing\]\);/);
  // 판정하는 순간에 열린 겹판을 본다(비교 대화상자 포함).
  assert.match(hook, /modes: \{ \.\.\.modes, modal: overlayOpen\(\) \}/);
  // 게스트 초점 — AI 가 조작하는 동안과 직후의 것은 거른다.
  assert.match(hook, /document\.addEventListener\("focusin", onFocusIn\)/);
  // iframe(개발용 브라우저 경로)은 focusin 이 없다 — 창의 blur 뒤 초점이 게스트에 있고 창이 초점을 쥐고 있을 때만 사람의 손길이다.
  assert.match(hook, /window\.addEventListener\("blur", onBlur\)/);
  assert.match(
    hook,
    /if \(!document\.hasFocus\(\) \|\| !guestOf\(document\.activeElement\)\) return;/,
  );
  assert.match(hook, /if \(Date\.now\(\) < aiUntil\.current\) return;/);
  assert.match(
    hook,
    /driving \? Number\.POSITIVE_INFINITY : Date\.now\(\) \+ DRIVING_FOCUS_GRACE_MS/,
  );
  // 찍기 · 얼린 화면 · 덮개 · 다른 알약 · 작업 기록 서랍이 같은 자리를 쓰면 한 줄과 고리는 비켜 선다.
  assert.match(
    hook,
    /const hidden =\s*!view\.visible \|\| view\.covered \|\| view\.crowded \|\| modes\.frozen \|\| modes\.pin \|\| modes\.history;/,
  );
  // 눌러 보는 중은 도구 사이의 틈을 붙든다.
  assert.match(hook, /window\.setTimeout\(\(\) => setHeld\(false\), DRIVING_HOLD_MS\)/);
  assert.ok(DRIVING_HOLD_MS >= 2_000, "도구와 도구 사이의 틈보다 짧으면 한 줄이 깜빡인다");
});

test("CSS: 라이브 층은 입력을 막지 않고, 움직임은 backwards 만 쓴다", () => {
  for (const selector of [".nx-pvdrive", ".nx-pvlive"]) {
    const rule = body(selector);
    assert.match(rule, /pointer-events:\s*none/, `${selector} 가 입력을 가로챈다`);
    assert.doesNotMatch(rule, /\b(both|forwards)\b/, `${selector} 는 채움에 backwards 만 쓴다`);
  }
  assert.match(body(".nx-pvdrive"), /z-index:\s*5/);
  // 아래 가운데의 알약은 덮개(8) · 늦게 뜸 알약(7) 아래, 찍기 알약(10) · 핀 보내기 알약(9) 보다 아래다.
  assert.match(body(".nx-pvlive"), /z-index:\s*6/);
  // 숨 쉬는 점과 고리는 동작 줄이기가 한 번으로 줄인다(next.css 의 전역 블록) — 따로 지우지 않는다.
  assert.doesNotMatch(css, /nx-pvdrive[^{]*\{[^}]*animation-iteration-count/);
});

test("설정: 기본 켜짐, 꺼 둔 사람의 고름만 남고, AI 쪽 한 줄이 끈다", () => {
  const settings = read("src/lib/settings.ts");
  assert.match(settings, /followEdits: true,/);
  assert.match(settings, /followEdits: stored\.followEdits !== false,/);
  const ai = read("src/next/settings/AiPage.tsx");
  assert.match(
    ai,
    /<SRow title=\{L\.live\.followRow\} id="nx-ai-follow" sub=\{L\.live\.followRowSub\}>/,
  );
  assert.match(ai, /onChange=\{\(followEdits\) => onSettingsChange\(\{ followEdits \}\)\}/);
  assert.match(
    read("src/next/settings/SettingsDialog.tsx"),
    /onChatChange=\{onChatChange\}\s*onSettingsChange=\{onSettingsChange\}\s*loginExpired/,
  );
});

test("선로: session.editing 은 선택 필드의 새 메시지이고, 웹이 세우고 턴이 끝나면 거둔다", () => {
  const protocol = read("../protocol/src/messages.ts");
  assert.match(
    protocol,
    /type: "session\.editing";\s*sessionId: string;\s*route: string;\s*title\?: string;/,
  );
  const client = read("src/lib/daemon-client.ts");
  assert.match(client, /if \(message\.type === "session\.editing"\) \{/);
  // 턴이 내려앉거나 세션이 닫히면, 연결이 끊기면 거둔다.
  assert.match(
    client,
    /message\.state === "idle" \|\| message\.state === "error" \|\| message\.state === "closed"\) \{\s*setEditingScreens/,
  );
  assert.match(
    client,
    /setEditingScreens\(\(prev\) => \(prev\.size === 0 \? prev : new Map\(\)\)\);/,
  );
});
