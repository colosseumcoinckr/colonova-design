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
