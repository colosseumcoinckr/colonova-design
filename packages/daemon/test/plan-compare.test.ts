import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendCompareDecline,
  COMPARE_SECTION_LIMIT,
  clipSections,
  comparePrompt,
  compareScreens,
  parseCompareRows,
  readCompareDeclines,
} from "../dist/plan-compare.js";

/**
 * 화면과 맞춰 보기의 순수 재료 시험(2026-11-02 · 같이 고치기 UX 계획 C7 · C8) — 절 자르기 · 판정 말 ·
 * 답 줄 걸르기 · 안 받은 짝 · 먼저 볼 화면. 판정은 읽기만 하고 어디에도 쓰지 않는다.
 */

const doc = (sections: number): string =>
  Array.from({ length: sections }, (_, at) => `## 절 ${at + 1}\n\n몸 ${at + 1}`).join("\n\n");

test("절 자르기 — 상한 안이면 그대로, 넘으면 앞의 절만 두고 partial 를 달아", () => {
  const small = clipSections(doc(COMPARE_SECTION_LIMIT));
  assert.equal(small.partial, false);
  assert.ok(small.body.includes(`절 ${COMPARE_SECTION_LIMIT}`));

  const big = clipSections(doc(COMPARE_SECTION_LIMIT + 3));
  assert.equal(big.partial, true);
  assert.ok(!big.body.includes(`절 ${COMPARE_SECTION_LIMIT + 1}`));
  assert.ok(big.body.includes(`절 ${COMPARE_SECTION_LIMIT}`));
});

test("판정 말 — 문서 · 출처 · 먼저 볼 화면 · 기준 줄을 담는다", () => {
  const withScreens = comparePrompt({
    title: "회원가입 정책서",
    source: "초안 개정 3",
    markdown: "## 비밀번호 규칙\n\n8자 이상",
    partial: false,
    screens: [
      { route: "/signup", title: "회원가입" },
      { route: "/dormant", title: null },
    ],
  });
  assert.match(withScreens, /\[화면과 맞춰 보기\]/);
  assert.match(withScreens, /「회원가입 정책서」\(초안 개정 3\)/);
  assert.match(withScreens, /먼저 볼 화면[^\n]*회원가입 \(\/signup\) · \/dormant/);
  assert.match(withScreens, /파일 경로 · 컴포넌트 이름을 쓰지 않는다/);
  assert.ok(withScreens.endsWith("기준: 실린 문서와 화면이 같은 규칙을 말하면 끝이다."));

  // 아는 화면이 없으면 스스로 찾게 말한다 — 자르기 안내는 partial 일 때만.
  const without = comparePrompt({
    title: "정책서",
    source: "Confluence 판 4",
    markdown: "## 절\n\n몸",
    partial: true,
    screens: [],
  });
  assert.match(without, /스스로 찾는다/);
  assert.match(without, /앞의 절만 실었다/);
});

test("답 줄 걸르기 — 모양이 맞는 줄만, 상한을 넘기지 않고, 모양이 아니면 null", () => {
  const row = (section: string, over: Record<string, unknown> = {}) => ({
    section,
    plan: "8자 이상",
    screen: "10자 이상",
    screenName: "회원가입",
    ...over,
  });
  const parsed = parseCompareRows({
    rows: [row("비밀번호 규칙"), row("  ", { plan: 1 }), row("휴면 전환")],
    partial: false,
  });
  assert.deepEqual(
    parsed?.rows.map((one) => one.section),
    ["비밀번호 규칙", "휴면 전환"],
  );

  const capped = parseCompareRows({
    rows: Array.from({ length: 30 }, (_, at) => row(`절 ${at}`)),
    partial: false,
  });
  assert.equal(capped?.rows.length, 20);

  assert.equal(parseCompareRows(null), null);
  assert.equal(parseCompareRows({ rows: "x", partial: false }), null);
  assert.equal(parseCompareRows({ rows: [], partial: "yes" }), null);
});

test("안 받은 짝 — 남기면 그 문서의 거부 이름으로 읽히고 깨진 줄은 건너뛴다", () => {
  const home = mkdtempSync(join(tmpdir(), "compare-decline-"));
  try {
    const root = join(home, "demo");
    mkdirSync(join(root, "plans"), { recursive: true });
    assert.equal(readCompareDeclines(root, "10").size, 0);
    appendCompareDecline(root, "10", "회원가입", "2026-11-02T00:00:00.000Z");
    appendCompareDecline(root, "20", "주문 상세", "2026-11-02T00:00:01.000Z");
    writeFileSync(join(root, "plans", "compare-declines.jsonl"), "{broken\n", { flag: "a" });
    const ten = readCompareDeclines(root, "10");
    assert.equal(ten.size, 1);
    assert.ok(ten.has("회원가입"));
    assert.equal(readCompareDeclines(root, "20").has("회원가입"), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("먼저 볼 화면 — 같이 고친 기록의 카드와 연결 파일을 합쳐 중복을 뺀다", async () => {
  const home = mkdtempSync(join(tmpdir(), "compare-screens-"));
  try {
    const root = join(home, "demo");
    const repo = join(home, "repo");
    mkdirSync(join(root, "plans"), { recursive: true });
    mkdirSync(repo, { recursive: true });
    // 같이 고친 기록 — 이 문서가 고쳐진 턴의 결과 카드가 본 화면.
    writeFileSync(
      join(root, "plans", "screen-sync.jsonl"),
      [
        JSON.stringify({
          kind: "card",
          at: "2026-11-02T00:00:00.000Z",
          turn: {
            slug: "demo",
            sessionId: "s1",
            requestId: "r1",
            request: "비밀번호를 10자로",
            screens: [
              { route: "/signup", title: "회원가입" },
              { route: "/account", title: "" },
            ],
            files: [],
            sha: null,
          },
          sync: {
            phase: "done",
            docs: [
              {
                docKey: "p-10",
                pageId: "10",
                title: "회원가입 정책서",
                outcome: "adopted",
                changes: 1,
              },
            ],
            linked: [],
          },
        }),
        JSON.stringify({
          kind: "card",
          at: "2026-11-02T00:00:01.000Z",
          turn: {
            slug: "demo",
            sessionId: "s1",
            requestId: "r2",
            request: "다른 문서 요청",
            screens: [{ route: "/other", title: "다른 화면" }],
            files: [],
            sha: null,
          },
          sync: {
            phase: "done",
            docs: [
              { docKey: "p-99", pageId: "99", title: "다른 문서", outcome: "adopted", changes: 1 },
            ],
            linked: [],
          },
        }),
      ].join("\n") + "\n",
    );
    // 연결 파일 — 사람이 이어 둔 주소(제목은 모른다).
    writeFileSync(
      join(repo, "plans-map.json"),
      JSON.stringify({
        format: 1,
        links: [
          { pageId: "10", route: "/signup", section: null, note: null, createdAt: null },
          { pageId: "10", route: "/dormant", section: null, note: null, createdAt: null },
        ],
      }),
    );
    const screens = await compareScreens({ root, repoRoot: repo, pageId: "10" });
    assert.deepEqual(screens, [
      { route: "/signup", title: "회원가입" },
      { route: "/account", title: null },
      { route: "/dormant", title: null },
    ]);
    // 연결 파일이 없어도 기록만으로 선다.
    const recordOnly = await compareScreens({ root, repoRoot: null, pageId: "10" });
    assert.equal(recordOnly.length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
