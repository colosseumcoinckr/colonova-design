import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceRootTitleKey, confluenceSiteKey } from "../dist/confluence-sync.js";
import { ProjectFleet } from "../dist/project-fleet.js";

/**
 * ProjectSummary.confluence 의 상태 배선 시험(수용 항목 13 · 2026-10-18) — server 조립이
 * fleet 에 미러와 만료 판정을 넘기는지, projectSummaries 가 그것을 문장 아닌 값으로 싣는지
 * 잡는다. generation-3 설계자 지적: 조립이 비면 시험만 통과하는 배선이 된다.
 */

interface Rig {
  fleet: ProjectFleet;
  home: string;
  cleanup(): void;
}

function rig(opts: { site?: string; expired?: boolean; ledger?: boolean }): Rig {
  const home = mkdtempSync(join(tmpdir(), "fleet-confluence-"));
  const cloneRoot = join(home, "clone");
  mkdirSync(join(cloneRoot, ".git"), { recursive: true });
  const machine = new Map<string, string>();
  if (opts.site !== undefined) machine.set(confluenceSiteKey("demo"), opts.site);
  if (opts.site !== undefined) machine.set(confluenceRootTitleKey("demo"), "8.8 ColoNova");
  if (opts.ledger === true) {
    mkdirSync(join(cloneRoot, "docs", "plans"), { recursive: true });
    writeConfluenceLedger(join(cloneRoot, "docs", "plans", "confluence.json"), {
      site: `https://${opts.site ?? "colosseum.atlassian.net"}`,
      roots: ["933068815"],
      lastSyncAt: "2026-10-18T01:00:00Z",
      pages: {
        "1818591273": {
          path: "COLO/8.8 ColoNova/정책서",
          title: "정책서",
          version: 3,
          sections: [],
          comments: { unresolved: 2 },
        },
      },
    });
  }
  const fleet = new ProjectFleet({
    registry: {
      list: () => [
        {
          slug: "demo",
          name: "데모",
          repo: {
            url: "https://example.com/demo.git",
            baseBranch: "main",
            branch: "cycle/demo",
            handoff: null,
          },
        },
      ],
      activeSlug: () => "demo",
      paths: () => ({ repoRoot: join(home, "clone"), work: join(home, "work") }),
    },
    manager: { get: () => undefined, all: () => [] },
    broadcast: () => {},
    notice: () => {},
    machineSetting: { get: (key: string) => machine.get(key) ?? null },
    confluenceExpired: () => opts.expired === true,
  } as never);
  return {
    fleet,
    home,
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("연결된 프로젝트의 상태 방송 — 미러와 원장에서 채워진다(수용 항목 13)", () => {
  const rig1 = rig({ site: "colosseum.atlassian.net", ledger: true });
  try {
    const summary = rig1.fleet.projectSummaries().find((row) => row.slug === "demo");
    assert.ok(summary !== undefined);
    assert.deepEqual(summary.confluence, {
      site: "colosseum.atlassian.net",
      connected: true,
      expired: false,
      rootTitle: "8.8 ColoNova",
      lastImportAt: "2026-10-18T01:00:00Z",
      pages: 1,
    });
  } finally {
    rig1.cleanup();
  }
});

test("미연결은 confluence 키 자체가 없다 — 읽지 못함이 아니라 「없다」", () => {
  const rig2 = rig({});
  try {
    const summary = rig2.fleet.projectSummaries().find((row) => row.slug === "demo");
    assert.ok(summary !== undefined);
    assert.equal(summary.confluence, undefined);
  } finally {
    rig2.cleanup();
  }
});

test("가져오기 중 401 의 만료 — expired 로 방송된다", () => {
  const rig3 = rig({ site: "colosseum.atlassian.net", expired: true });
  try {
    const summary = rig3.fleet.projectSummaries().find((row) => row.slug === "demo");
    assert.ok(summary !== undefined);
    assert.equal(summary.confluence?.expired, true);
    assert.equal(summary.confluence?.connected, true);
  } finally {
    rig3.cleanup();
  }
});

test("server 조립은 fleet 에 기획서 배선을 넘긴다 — 실제 조립 줄의 소스 계약(2026-10-18 · 수용 항목 13)", () => {
  // 시험 1-3 이 fleet 클래스의 판정을 잠근다. 이 시험은 조립 자리를 잠근다:
  // 리그가 자기 deps 를 읽는 것으로는 server.ts 의 회귀를 못 잡는다(4세대 정화 지적).
  const source = readFileSync(join(import.meta.dirname, "..", "src", "server.ts"), "utf8");
  const assembly = source.slice(
    source.indexOf("new ProjectFleet"),
    source.indexOf("await migrateProjectPats"),
  );
  assert.ok(
    assembly.includes("machineSetting: this.machineSetting"),
    "fleet 조립에 machineSetting 이 없다 — 상태 방송이 영원히 비어 있다",
  );
  assert.ok(
    assembly.includes("confluenceExpired: (slug) => this.confluence?.expiredState(slug) ?? false"),
    "fleet 조립에 confluenceExpired 지연 클로저가 없다 — 만료 상태가 방송되지 않는다",
  );
});
