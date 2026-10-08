import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendScreenMap, readScreenMap } from "../dist/screen-map.js";

/**
 * 화면 지도 행의 확인 기록(2026-10-07 UX 점검 3단계) — 보관 때 그 턴의 자동 확인이 문제 없이 지났다는 기록을 적고,
 * 읽을 때 모양이 맞는 것만 남긴다. 손으로 고친 파일이나 옛 모양이 확인했다고 속이지 못하게.
 */
const row = (sha: string, extra: Record<string, unknown> = {}) => ({
  at: "2026-10-07T01:00:00Z",
  sha,
  routes: ["/members"],
  files: ["a.tsx"],
  ...extra,
});

test("확인 기록은 지도에 적히고 그대로 읽힌다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "screen-map-checked-"));
  try {
    await appendScreenMap(dir, row("c1", { checked: { screens: 2, phone: true } }));
    await appendScreenMap(dir, row("c2"));
    const rows = await readScreenMap(dir);
    assert.deepEqual(rows[0]?.checked, { screens: 2, phone: true });
    assert.equal(rows[1]?.checked, undefined, "기록이 없는 보관은 기록이 없다");
    assert.equal("checked" in (rows[1] ?? {}), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("타입 검사 기록(types)은 참일 때만 남는다 — 거짓이나 낯선 값은 돌지 않았다는 말과 같다(2026-10-07)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "screen-map-checked-"));
  try {
    await appendScreenMap(dir, row("c1", { checked: { screens: 2, phone: true, types: true } }));
    await appendScreenMap(dir, row("c2", { checked: { screens: 1, phone: false } }));
    const rows = await readScreenMap(dir);
    assert.deepEqual(rows[0]?.checked, { screens: 2, phone: true, types: true });
    assert.deepEqual(rows[1]?.checked, { screens: 1, phone: false });
    assert.equal("types" in (rows[1]?.checked ?? {}), false, "돌지 않은 검사는 칸이 없다");

    const odd = [false, "true", 1, null, {}];
    writeFileSync(
      join(dir, "screen-map.jsonl"),
      `${odd
        .map((types, index) =>
          JSON.stringify(row(`o${index}`, { checked: { screens: 1, phone: true, types } })),
        )
        .join("\n")}\n`,
    );
    const back = await readScreenMap(dir);
    assert.equal(back.length, odd.length);
    for (const entry of back) {
      assert.deepEqual(
        entry.checked,
        { screens: 1, phone: true },
        "참이 아닌 값은 기록이 되지 못한다",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("보관한 세션의 AI 공급자는 지도에 적히고 그대로 읽힌다 — 없는 행은 칸이 없다(2026-10-07)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "screen-map-checked-"));
  try {
    await appendScreenMap(dir, row("c1", { provider: "claude" }));
    await appendScreenMap(dir, row("c2"));
    const rows = await readScreenMap(dir);
    assert.equal(rows[0]?.provider, "claude");
    assert.equal("provider" in (rows[1] ?? {}), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("모양이 맞지 않는 확인 기록은 버린다 — 행은 산다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "screen-map-checked-"));
  try {
    const broken = [
      { screens: 0, phone: true },
      { screens: 1.5, phone: true },
      { screens: "2", phone: true },
      { screens: 2, phone: "yes" },
      { screens: 2 },
      "확인함",
      null,
    ];
    writeFileSync(
      join(dir, "screen-map.jsonl"),
      `${broken.map((checked, index) => JSON.stringify(row(`b${index}`, { checked }))).join("\n")}\n`,
    );
    const rows = await readScreenMap(dir);
    assert.equal(rows.length, broken.length, "행 자체는 모두 산다");
    assert.ok(rows.every((entry) => entry.checked === undefined));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
