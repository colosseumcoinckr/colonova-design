import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DraftPlanRef } from "@colonova-design/protocol";
import {
  appendPlanRefs,
  buildPlanRefsSection,
  PLAN_REF_MARKER,
  planRefHeader,
  readPlanRef,
  readPlanRefs,
} from "../dist/plan-refs.js";

/**
 * 기획 근거 기록의 시험(2026-10-23 · 작업 C3) — 표식의 왕복과 이스케이프, JSON 줄
 * 기록의 덧붙이기 · 거름, `### 기획 근거` 절의 줄 모양을 본다. 합성 제목만 쓴다.
 */

/** 합성 근거 — 실제 문서를 흉내 내지 않는다. */
function ref(over: Partial<DraftPlanRef> = {}): DraftPlanRef {
  return {
    title: "로그인 화면",
    pageId: "123",
    docKey: null,
    url: "https://site.atlassian.net/wiki/pages/viewpage.action?pageId=123",
    version: 4,
    revision: null,
    published: true,
    sections: [],
    ...over,
  };
}

function entry(
  at: string,
  sessionId = "s1",
  one = ref(),
): { at: string; sessionId: string; ref: DraftPlanRef } {
  return { at, sessionId, ref: one };
}

test("표식 — 근거 기록을 첫 줄에 싣고 그대로 되읽는다", () => {
  const withSections = ref({ sections: ["배경", "목표"] });
  const header = planRefHeader(withSections);
  assert.ok(header.startsWith(`<!-- ${PLAN_REF_MARKER} `), header);
  assert.ok(header.endsWith("-->"));
  assert.deepEqual(
    readPlanRef(`${header}\n\n# 로그인 화면\n\n몸이다.`),
    withSections,
    "첫 줄의 표식만 읽는다",
  );
});

test("표식 — 제목의 `--` 는 이스케이프로 흘러 왕복을 지킨다", () => {
  const header = planRefHeader(ref({ title: "가--이--드" }));
  const payload = header.slice(`<!-- ${PLAN_REF_MARKER} `.length, -3);
  assert.ok(!payload.includes("--"), payload);
  assert.equal(readPlanRef(header)?.title, "가--이--드");
});

test("표식 — 다른 글은 근거가 아니다", () => {
  assert.equal(readPlanRef(""), null);
  assert.equal(readPlanRef("# 기획서\n\n몸이다."), null);
  assert.equal(readPlanRef("<!-- 다른 도구의 표식 -->"), null);
  assert.equal(readPlanRef(`<!-- ${PLAN_REF_MARKER} -->`), null);
});

test("표식 — 깨진 JSON 과 어긋난 모양은 던지지 않고 버린다", () => {
  assert.equal(readPlanRef(`<!-- ${PLAN_REF_MARKER} {어깨 -->`), null);
  assert.equal(readPlanRef(`<!-- ${PLAN_REF_MARKER} {"title":"x"} -->`), null);
  assert.equal(readPlanRef(`<!-- ${PLAN_REF_MARKER} ${JSON.stringify({ title: 3 })} -->`), null);
});

test("기록 — 덧붙이고 읽고, since 로 거르고 깨진 줄은 건너뛴다", () => {
  const home = mkdtempSync(join(tmpdir(), "plan-refs-"));
  try {
    const file = join(home, "plans", "refs.jsonl");
    appendPlanRefs(file, [
      entry("2026-10-23T00:00:00Z", "s1"),
      entry("2026-10-23T01:00:00Z", "s2"),
    ]);
    assert.deepEqual(
      readPlanRefs(file, null).map((row) => row.sessionId),
      ["s1", "s2"],
    );
    assert.deepEqual(
      readPlanRefs(file, new Date("2026-10-23T01:00:00Z")).map((row) => row.sessionId),
      ["s2"],
    );
    assert.deepEqual(readPlanRefs(file, new Date("2027-01-01T00:00:00Z")), []);
    assert.deepEqual(readPlanRefs(join(home, "없는", "기록.jsonl"), null), []);
    // 깨진 줄 사이의 온전한 기록은 살린다 — 온전한 기록 뒤에 깨진 줄을 얹고 다시 덧붙인다.
    const kept = readFileSync(file, "utf8");
    writeFileSync(file, `${kept}깨진 줄이다\n${JSON.stringify({ at: "2026-10-23T03:00:00Z" })}\n`, {
      mode: 0o600,
    });
    appendPlanRefs(file, [entry("2026-10-23T02:00:00Z", "s3")]);
    assert.deepEqual(
      readPlanRefs(file, null).map((row) => row.sessionId),
      ["s1", "s2", "s3"],
    );
    // 권한 — 폴더 0o700, 파일 0o600(공통 계약 §2).
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, "plans")).mode & 0o777, 0o700);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("기록 — 빈 덧붙이기는 파일을 만들지 않는다", () => {
  const home = mkdtempSync(join(tmpdir(), "plan-refs-"));
  try {
    appendPlanRefs(join(home, "plans", "refs.jsonl"), []);
    assert.equal(existsSync(join(home, "plans")), false, "폴더도 생기지 않는다");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("절 — 발행된 문서는 링크 · 판 · 절로 선다", () => {
  assert.equal(
    buildPlanRefsSection([entry("2026-10-23T00:00:00Z", "s1", ref({ sections: ["배경"] }))]),
    [
      "### 기획 근거",
      "",
      "이 화면 작업이 근거로 삼은 기획 문서다.",
      "",
      "- [로그인 화면](https://site.atlassian.net/wiki/pages/viewpage.action?pageId=123) · 판 4 · 절: 배경",
      "",
    ].join("\n"),
  );
});

test("절 — 초안은 미발행 상태와 개정으로, 기존 공식본이 있으면 함께 말한다", () => {
  const official = buildPlanRefsSection([
    entry(
      "2026-10-23T00:00:00Z",
      "s1",
      ref({ published: false, docKey: "p-123", version: 4, revision: 3 }),
    ),
  ]);
  assert.match(
    official ?? "",
    /- 로그인 화면 — 아직 발행하지 않은 초안\(개정 3\) · 공식본: \[로그인 화면\]\(https:\/\/site\.atlassian\.net\/wiki\/pages\/viewpage\.action\?pageId=123\) 판 4/,
  );
  // 새 문서 초안 — 기존 공식본이 없어 그 줄도 없다.
  const fresh = buildPlanRefsSection([
    entry(
      "2026-10-23T00:00:00Z",
      "s1",
      ref({
        published: false,
        docKey: "p-123",
        pageId: null,
        url: null,
        version: null,
        revision: 0,
      }),
    ),
  ]);
  assert.ok(
    (fresh ?? "").includes("- 로그인 화면 — 아직 발행하지 않은 초안(개정 0)\n"),
    fresh ?? "",
  );
  assert.ok(!(fresh ?? "").includes("공식본"));
});

test("절 — 같은 문서는 마지막 기록 하나로 묶는다 · 비면 null 이다", () => {
  const section =
    buildPlanRefsSection([
      entry("2026-10-23T00:00:00Z", "s1", ref({ sections: ["옛 절"], version: 3 })),
      entry(
        "2026-10-23T00:00:00Z",
        "s1",
        ref({ title: "다른 문서", pageId: "555", url: "https://site.example/x", version: 1 }),
      ),
      entry("2026-10-23T01:00:00Z", "s2", ref({ sections: ["새 절"] })),
    ]) ?? "";
  const lines = section.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(lines.length, 2, section);
  assert.ok(lines[0]?.includes("· 판 4 · 절: 새 절"), lines[0]);
  assert.ok(lines[1]?.includes("다른 문서"), lines[1]);
  assert.equal(buildPlanRefsSection([]), null);
});

test("절 — 초안 본문과 근거 이외의 기록은 들어가지 않는다", () => {
  const section =
    buildPlanRefsSection([
      entry("2026-10-23T00:00:00Z", "s1", ref({ published: false, docKey: "p-123", revision: 2 })),
    ]) ?? "";
  assert.ok(!section.includes("```"), section);
  assert.ok(!section.includes("s1"), "대화의 신원은 남기지 않는다");
  // 근거 줄은 하나다 — 문서의 몸은 실지 않는다.
  assert.equal(section.split("\n").filter((line) => line.startsWith("- ")).length, 1);
});

test("절 — 초안의 절 고름도 줄에 남는다", () => {
  const section =
    buildPlanRefsSection([
      entry(
        "2026-10-23T00:00:00Z",
        "s1",
        ref({ published: false, docKey: "p-123", revision: 1, sections: ["목표"] }),
      ),
    ]) ?? "";
  assert.match(section ?? "", /아직 발행하지 않은 초안\(개정 1\) · 공식본: .* 판 4 · 절: 목표/);
});
