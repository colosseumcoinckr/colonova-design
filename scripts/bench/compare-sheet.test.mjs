import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 맞춰 보기 정답표(2026-11-02 · 같이 고치기 UX 계획 0단계)의 모양 시험 — 시나리오 검사
// (lib.mjs)와 같은 자리에서 돈다. 정답표는 순수 데이터라 데몬 없이 잰다.

const here = dirname(fileURLToPath(import.meta.url));
const sheet = JSON.parse(readFileSync(join(here, "compare-sheet.json"), "utf8"));

test("정답표 — 문서마다 절이 있고 제목이 겹치지 않는다", () => {
  assert.ok(Array.isArray(sheet.docs) && sheet.docs.length >= 3, "견본 문서가 세 개는 있어야 한다");
  const titles = sheet.docs.map((doc) => doc.title);
  assert.equal(new Set(titles).size, titles.length, "문서 제목이 겹치면 안 된다");
  for (const doc of sheet.docs) {
    assert.equal(typeof doc.title, "string");
    assert.ok(doc.sections.length > 0, `${doc.title} 에 절이 있어야 한다`);
    assert.equal(
      new Set(doc.sections).size,
      doc.sections.length,
      `${doc.title} 의 절이 겹치면 안 된다`,
    );
  }
});

test("정답표 — 연결 표는 아는 문서 · 절만 가리키고, 빈 화면이 남는다(2026-11-03 · A안 0-2)", () => {
  assert.ok(Array.isArray(sheet.links), "연결 표 links 가 있어야 한다");
  const sectionsOf = new Map(sheet.docs.map((doc) => [doc.title, new Set(doc.sections)]));
  const linked = new Set();
  for (const row of sheet.links) {
    const sections = sectionsOf.get(row.doc);
    assert.ok(sections !== undefined, `모르는 문서 — ${row.doc}`);
    assert.equal(typeof row.route, "string");
    assert.ok(row.route.trim() !== "", `${row.doc} 의 화면 주소가 비었다`);
    if (row.section !== null) {
      assert.ok(sections.has(row.section), `${row.doc} 에 없는 절 — ${row.section}`);
    }
    linked.add(row.route);
  }
  // 일부러 비어 있는 화면이 있어야 1층의 놓침을 잰다.
  const unlinked = sheet.requests.filter((row) => row.doc !== null && !linked.has(row.route));
  assert.ok(unlinked.length > 0, "연결되지 않은 화면의 요청이 있어야 놓침을 잰다");
});

test("정답표 — 어긋난 규칙은 아는 문서 · 절만 가리킨다", () => {
  const sectionsOf = new Map(sheet.docs.map((doc) => [doc.title, new Set(doc.sections)]));
  for (const row of sheet.mismatches) {
    const sections = sectionsOf.get(row.doc);
    assert.ok(sections !== undefined, `모르는 문서 — ${row.doc}`);
    assert.ok(sections.has(row.section), `${row.doc} 에 없는 절 — ${row.section}`);
    for (const key of ["plan", "screen", "screenName"]) {
      assert.equal(typeof row[key], "string");
      assert.ok(row[key].trim() !== "", `${row.doc} · ${row.section} 의 ${key} 가 비었다`);
    }
  }
});

test("정답표 — 화면 요청 20개 안팎이고 아는 문서 · 절만 가리킨다", () => {
  assert.ok(sheet.requests.length >= 15 && sheet.requests.length <= 25, "요청은 20개 안팎이다");
  const sectionsOf = new Map(sheet.docs.map((doc) => [doc.title, new Set(doc.sections)]));
  const ids = sheet.requests.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "요청 id 가 겹치면 안 된다");
  for (const row of sheet.requests) {
    assert.equal(typeof row.request, "string");
    assert.ok(row.request.trim() !== "");
    assert.equal(typeof row.route, "string");
    assert.ok(row.route.trim() !== "", `${row.id} 에 화면 주소(route)가 없다`);
    if (row.doc !== null) {
      const sections = sectionsOf.get(row.doc);
      assert.ok(sections !== undefined, `모르는 문서 — ${row.doc}`);
      for (const section of row.sections) {
        assert.ok(sections.has(section), `${row.doc} 에 없는 절 — ${section}`);
      }
    } else {
      // 정답이 「닿는 문서 없음」인 요청 — 꾸밈 · 문구 요청의 거짓 양성을 잰다.
      assert.equal(row.sections.length, 0, "닿을 문서가 없으면 절도 없다");
    }
  }
  // 균형 — 닿는 요청과 안 닿는 요청이 둘 다 있어야 정확도의 두 면을 잰다.
  const hits = sheet.requests.filter((row) => row.doc !== null).length;
  assert.ok(
    hits > 0 && hits < sheet.requests.length,
    "닿는 요청과 안 닿는 요청이 섞여 있어야 한다",
  );
});
