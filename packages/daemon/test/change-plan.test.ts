// 보관 계획의 순수 판정(2026-10-11 피드백) — 도구 인자의 정리와 승인 경로의
// 변경별 나눔. `../dist` 임포트인 이유: change-plan 은 형제를 `.js` 지정자로
// 부른다 — src 직접 로드는 그 지정을 못 고친다(같은 이유가 다른 시험에도 있다).
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDescribeChanges, partitionApproved } from "../dist/change-plan.js";

test("normalizeDescribeChanges — 따옴표 · 매듭 기호 · 이미 붙은 접두를 벗기고 종류를 다시 붙인다", () => {
  const parsed = normalizeDescribeChanges({
    changes: [
      {
        kind: "feat",
        subject: '"feat(members): 회원 목록에 이름 검색 추가"',
        body: "검색어는 이름에만 걸린다.\n\nCo-Authored-By: Someone <a@b.c>",
        files: ["./src/member/List.tsx", "src\\member\\Search.tsx", "src/member/List.tsx"],
      },
      { kind: "완전 엉뚱한 말", subject: "- 상단 바의 그림자를 옅게", files: ["/src/top.css"] },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.changes, [
    {
      kind: "feat",
      subject: "회원 목록에 이름 검색 추가",
      body: "검색어는 이름에만 걸린다.",
      files: ["src/member/List.tsx", "src/member/Search.tsx"],
    },
    { kind: "chore", subject: "상단 바의 그림자를 옅게", files: ["src/top.css"] },
  ]);
});

test("normalizeDescribeChanges — 제목이 비었거나 경로가 없는 변경은 버린다", () => {
  const parsed = normalizeDescribeChanges({
    changes: [
      { kind: "fix", subject: "   ", files: ["a.ts"] },
      { kind: "fix", subject: "제목만 있다" },
      { kind: "fix", subject: "경로가 전부 빈 칸", files: ["", "  "] },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.changes, []);
});

test("normalizeDescribeChanges — 72자에서 제목을 닫고 changes 는 10건까지", () => {
  const long = normalizeDescribeChanges({
    changes: [{ kind: "chore", subject: `${"가".repeat(90)}...`, files: ["a.ts"] }],
  });
  assert.equal(long.ok, true);
  if (!long.ok) return;
  const first = long.changes[0]?.subject ?? "";
  assert.equal(Array.from(first).length, 72);
  const many = normalizeDescribeChanges({
    changes: Array.from({ length: 13 }, (_, i) => ({
      kind: "chore",
      subject: `변경 ${i}`,
      files: [`p${i}.ts`],
    })),
  });
  assert.equal(many.ok, true);
  if (!many.ok) return;
  assert.equal(many.changes.length, 10);
});

test("normalizeDescribeChanges — changes 가 배열이 아니면 한국어 오류 한 문장", () => {
  const parsed = normalizeDescribeChanges({ changes: "feat: 목록" });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(parsed.error.includes("changes"));
});

test("partitionApproved — 계획이 없으면 전부 leftover 다", () => {
  assert.deepEqual(partitionApproved(["a.ts", "b/c.ts"], null), {
    groups: [],
    leftover: ["a.ts", "b/c.ts"],
  });
});

test("partitionApproved — 경로를 변경마다 가르고 남은 것은 leftover 로 돌린다", () => {
  const { groups, leftover } = partitionApproved(
    ["src/member/List.tsx", "src/member/Search.tsx", "docs/guide.md", "notes.txt"],
    [
      {
        kind: "feat",
        subject: "회원 목록에 이름 검색 추가",
        body: "검색어는 이름에만 걸린다.",
        files: ["src/member"],
      },
      { kind: "docs", subject: "검색 사용 안내 추가", files: ["docs/guide.md"] },
    ],
  );
  assert.deepEqual(
    groups.map((group) => [group.subject, group.paths]),
    [
      ["feat: 회원 목록에 이름 검색 추가", ["src/member/List.tsx", "src/member/Search.tsx"]],
      ["docs: 검색 사용 안내 추가", ["docs/guide.md"]],
    ],
  );
  assert.equal(groups[0]?.message, "feat: 회원 목록에 이름 검색 추가\n\n검색어는 이름에만 걸린다.");
  assert.deepEqual(leftover, ["notes.txt"]);
});

test("partitionApproved — 같은 경로를 둘이 쥐면 첫 판이 이긴다", () => {
  const { groups, leftover } = partitionApproved(
    ["a.ts", "b.ts"],
    [
      { kind: "fix", subject: "첫 변경", files: ["a.ts", "b.ts"] },
      { kind: "chore", subject: "빈손인 변경", files: ["a.ts"] },
    ],
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.paths, ["a.ts", "b.ts"]);
  assert.deepEqual(leftover, []);
});

test("partitionApproved — 어느 경로에도 못 미치는 계획은 조용히 없는 것이다", () => {
  const { groups, leftover } = partitionApproved(
    ["a.ts"],
    [{ kind: "fix", subject: "없는 폴더", files: ["nope"] }],
  );
  assert.deepEqual(groups, []);
  assert.deepEqual(leftover, ["a.ts"]);
});
