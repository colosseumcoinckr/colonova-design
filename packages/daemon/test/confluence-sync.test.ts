import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import {
  CONFLUENCE_POLL_MS,
  ConfluenceSync,
  MAX_INCOMPLETE_REWALKS,
  PLANS_DIR,
} from "../dist/confluence-sync.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import { GitLane } from "../dist/git-lane.js";
import { MachineSetting } from "../dist/machine-setting.js";

/**
 * 기획서 가져오기 루프의 순수 시험(기획서 동기화 1단계 · M3) — 기록된 fixture 전송과 임시
 * 클론으로 진짜 루프를 돌린다. 첫 가져오기 · CQL 증분 · 429 사다리 · 401 만료 · 상한이
 * 이 시험의 판정이다. 기다림은 주입해 자지 않는다(CI 는 프로세스를 띄우지 않는다).
 */

const ROOT_ID = "933068815";
const SITE = "colosseum.atlassian.net";
const NOW = new Date("2026-10-18T01:00:00Z");

const page = (
  id: string,
  title: string,
  storage: string,
  version: number,
  parentId: string | null,
) => ({
  id,
  title,
  spaceId: "SP1",
  version: { number: version, createdAt: "2026-10-18T00:40:00Z" },
  parentId,
  body: { storage: { value: storage, representation: "storage" } },
});

const ROOT_PAGE = page(ROOT_ID, "8.8 ColoNova", "<h1>머리말</h1><p>본문</p>", 3, null);

function fixture(
  name: string,
  url: string,
  status: number,
  json: unknown,
): Record<string, unknown> {
  return { name, cite: url, request: { method: "GET", url }, response: { status, json } };
}

const readPageUrl = (id: string) => `/wiki/api/v2/pages/${id}?body-format=storage`;
const childrenUrl = (id: string) => `/wiki/api/v2/pages/${id}/children?limit=100`;
// 증분은 뿌리 아래로 좁히고 판을 함께 싣는다 — 시각은 마지막 동기에서 겹침(12시간 1분)만큼 앞당긴 자리다.
const cqlUrl = (since: string) =>
  `/wiki/rest/api/search?cql=${encodeURIComponent(
    `type=page AND (id = ${ROOT_ID} OR ancestor = ${ROOT_ID}) AND lastModified > "${since}"`,
  )}&limit=100&expand=content.version`;
/** NOW 에서 겹침만큼 앞당긴 CQL 시각 — 원장의 lastSyncAt 이 NOW 인 증분이 묻는 자리. */
const SINCE_NOW = "2026/10/17 12:59";

function firstImportFixtures(): Array<Record<string, unknown>> {
  return [
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [
        { id: "1", title: "01.시스템분석" },
        { id: "2", title: "02.기능설계" },
      ],
    }),
    fixture(
      "첫째 문서",
      readPageUrl("1"),
      200,
      page("1", "01.시스템분석", "<p>가</p>", 2, ROOT_ID),
    ),
    fixture(
      "둘째 문서",
      readPageUrl("2"),
      200,
      page(
        "2",
        "02.기능설계",
        // 절은 머리말로 나뉜다 — 매크로가 든 절의 표식을 잡으려면 머리말이 앞선다.
        '<h2>주의</h2><ac:structured-macro ac:name="info"><ac:rich-text-body><p>주의 본문</p></ac:rich-text-body></ac:structured-macro>',
        1,
        ROOT_ID,
      ),
    ),
    // 잎 문서의 아이 목록도 읽어야 걷기가 빠짐없이 끝난다 — 빠지면 다음 바퀴가 다시 걷는다.
    fixture("첫째의 아이", childrenUrl("1"), 200, { results: [] }),
    fixture("둘째의 아이", childrenUrl("2"), 200, { results: [] }),
  ];
}

interface Rig {
  sync: ConfluenceSync;
  cloneRoot: string;
  machine: MachineSetting;
  cleanup(): void;
}

function rig(
  pairs: Array<Record<string, unknown>>,
  seed?: (cloneRoot: string) => void,
  opts?: {
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
    /** 경고를 받아 적는 손 — 없으면 조용하다. */
    warns?: Array<{ message: string; fields: unknown }>;
    slugs?: string[];
    /** demo 의 클론 모습을 받아 다른 프로젝트의 모습을 정한다 — 없으면 demo 만 클론이 있다. */
    workspaceOf?: (
      slug: string,
      demo: { root: string; laneRun: GitLane["run"] },
      home: string,
    ) => { root: string; laneRun: GitLane["run"] } | null;
    machine?: (machine: MachineSetting) => void;
  },
): Rig {
  const home = mkdtempSync(join(tmpdir(), "confluence-sync-"));
  const fixtureDir = join(home, "fixtures");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "fixtures.json"), JSON.stringify(pairs));
  const cloneRoot = join(home, "clone");
  mkdirSync(join(cloneRoot, ".git", "info"), { recursive: true });
  seed?.(cloneRoot);
  const machine = new MachineSetting(join(home, "machine.json"));
  machine.load();
  machine.set(`confluenceSite:demo`, SITE);
  machine.set(`confluenceRootId:demo`, ROOT_ID);
  opts?.machine?.(machine);
  const store = new MemoryCredentialStore();
  void store.save("confluence-pat", "me@example.com\ntok");
  const lane = new GitLane();
  // env 는 sync 의 생성 전에 — 전송(기록된 fixture 의 테이프)은 생성 때 한 벌로 정해진다.
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
  process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = fixtureDir;
  const demo = {
    root: cloneRoot,
    laneRun: ((kind, job, o) => lane.run(kind, job, o)) as GitLane["run"],
  };
  const warns = opts?.warns;
  const sync = new ConfluenceSync({
    machineSetting: machine,
    credentials: store,
    workspaceOf: (slug) =>
      opts?.workspaceOf !== undefined
        ? opts.workspaceOf(slug, demo, home)
        : slug === "demo"
          ? demo
          : null,
    slugs: () => opts?.slugs ?? ["demo"],
    logger: {
      info() {},
      warn(message: string, fields: unknown) {
        warns?.push({ message, fields });
      },
      error() {},
      debug() {},
    } as never,
    now: opts?.now ?? (() => NOW),
    sleep: opts?.sleep,
  });
  return {
    sync,
    cloneRoot,
    machine,
    cleanup() {
      if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
      else process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = previous;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("첫 가져오기 — 뿌리 아래 트리가 폴더와 파일과 원장으로 생긴다", async () => {
  const rig1 = rig(firstImportFixtures());
  try {
    const result = await rig1.sync.importNow("demo");
    assert.deepEqual(result, { imported: 3, skipped: 0, capped: false });
    const base = join(rig1.cloneRoot, PLANS_DIR, "COLO", "8.8 ColoNova");
    // 정본은 원문 그대로, 마크다운은 파생물이다.
    assert.ok(existsSync(join(base, "8.8 ColoNova.md")));
    assert.ok(existsSync(join(base, "8.8 ColoNova.storage.xml")));
    assert.ok(existsSync(join(base, "01.시스템분석.md")));
    const ledger = JSON.parse(
      readFileSync(join(rig1.cloneRoot, PLANS_DIR, "confluence.json"), "utf8"),
    ) as {
      lastSyncAt: string | null;
      roots: string[];
      pages: Record<
        string,
        { version: number; sections: Array<{ macro: boolean }>; comments: unknown }
      >;
    };
    assert.equal(ledger.roots[0], ROOT_ID);
    assert.equal(ledger.lastSyncAt, NOW.toISOString());
    assert.equal(Object.keys(ledger.pages).length, 3);
    // 매크로가 든 절은 원장에 macro:true 로 남는다.
    const macroPage = ledger.pages["2"];
    assert.ok(macroPage !== undefined);
    assert.equal(
      macroPage.sections.some((section) => section.macro),
      true,
    );
  } finally {
    rig1.cleanup();
  }
});

test("두 번째는 CQL 증분만 쓴다 — 원장의 lastSyncAt 에서 이어받는다", async () => {
  const rig2 = rig(
    [
      ...firstImportFixtures(),
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, {
        results: [{ content: { id: "1" }, title: "01.시스템분석" }],
      }),
      fixture(
        "바뀐 문서",
        readPageUrl("1"),
        200,
        page("1", "01.시스템분석", "<p>가</p><p>나</p>", 3, ROOT_ID),
      ),
    ],
    undefined,
    {
      // 첫 바퀴는 NOW 로 원장을 심고, 둘째 바퀴가 10분 뒤의 증분이다.
      now: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          return calls === 1 ? NOW : new Date(NOW.getTime() + CONFLUENCE_POLL_MS);
        };
      })(),
    },
  );
  try {
    const first = await rig2.sync.importNow("demo");
    assert.equal(first.imported, 3);
    const second = await rig2.sync.importNow("demo");
    assert.deepEqual(second, { imported: 1, skipped: 0, capped: false });
    const ledger = JSON.parse(
      readFileSync(join(rig2.cloneRoot, PLANS_DIR, "confluence.json"), "utf8"),
    ) as { lastSyncAt: string | null; pages: Record<string, { version: number }> };
    assert.equal(ledger.lastSyncAt, new Date(NOW.getTime() + CONFLUENCE_POLL_MS).toISOString());
    assert.equal(ledger.pages["1"]?.version, 3);
  } finally {
    rig2.cleanup();
  }
});

test("한도의 429 — 사다리를 타고 풀린다(기다림은 주입)", async () => {
  const waits: number[] = [];
  const rig3 = rig(
    [
      fixture("뿌리 문서", readPageUrl(ROOT_ID), 429, {}),
      fixture("뿌리 문서", readPageUrl(ROOT_ID), 429, {}),
      fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
      fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    ],
    undefined,
    {
      now: () => NOW,
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
  );
  try {
    const result = await rig3.sync.importNow("demo");
    assert.equal(result.imported, 1);
    assert.deepEqual(waits, [60_000, 120_000]);
  } finally {
    rig3.cleanup();
  }
});

test("가져오기 중 401 — 만료 상태로 적히고 connect 전까지 조용히 건너뛴다", async () => {
  const refused = rig([fixture("뿌리 문서", readPageUrl(ROOT_ID), 401, {})]);
  try {
    const result = await refused.sync.importNow("demo");
    assert.equal(result.imported, 0);
    assert.equal(refused.sync.expiredState("demo"), true);
    // 만료 뒤의 부르기는 아무 fixture 도 소모하지 않는다(건너뛴다).
    const again = await refused.sync.importNow("demo");
    assert.equal(again.imported, 0);
    // 다시 connect 가 이기면 루프가 달린다.
    refused.sync.clearExpired("demo");
    const resume = rig([
      fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
      fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    ]);
    try {
      // 같은 rig 의 env 를 빌려 쓴다 — fixture 디렉터리만 갈아끼운다.
      const result = await resume.sync.importNow("demo");
      assert.equal(result.imported, 1);
    } finally {
      resume.cleanup();
    }
  } finally {
    refused.cleanup();
  }
});

test("importNow 중복 눌림 — 합류한다(같은 바퀴가 두 번 돌지 않는다)", async () => {
  let clockCalls = 0;
  const rig5 = rig(firstImportFixtures(), undefined, {
    now: () => {
      clockCalls += 1;
      return NOW;
    },
  });
  try {
    const [first, second] = await Promise.all([
      rig5.sync.importNow("demo"),
      rig5.sync.importNow("demo"),
    ]);
    assert.deepEqual(first, second);
    assert.equal(clockCalls, 1, "합류는 한 바퀴만 돈다");
  } finally {
    rig5.cleanup();
  }
});

test("문서 수의 상한 — 닿으면 멈추고 lastSyncAt 을 앞서지 않는다", async () => {
  const total = 501;
  const pairs: Array<Record<string, unknown>> = [
    fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, {
      results: Array.from({ length: total }, (_, index) => ({
        content: { id: `p${String(index).padStart(4, "0")}` },
        title: `문서 ${index}`,
      })),
    }),
  ];
  for (let index = 0; index < total; index += 1) {
    const id = `p${String(index).padStart(4, "0")}`;
    pairs.push(
      fixture(
        `문서 ${index}`,
        readPageUrl(id),
        200,
        page(id, `문서 ${index}`, "<p>가</p>", 2, ROOT_ID),
      ),
    );
  }
  const rig6 = rig(pairs, (cloneRoot) => {
    // 원장에 600 문서를 미리 심는다 — CQL 이 부른 501 은 모두 원장이 아는 문서다.
    const pages: Record<
      string,
      { path: string; title: string; version: number; sections: never[]; comments: null }
    > = {};
    for (let index = 0; index < 600; index += 1) {
      const id = `p${String(index).padStart(4, "0")}`;
      // 제목은 Confluence 의 것과 같다 — 제목이 바뀐 문서는 걷기로 가므로, 이 시험은 증분의 상한만 잰다.
      pages[id] = {
        path: `COLO/기존/${id}`,
        title: `문서 ${index}`,
        version: 1,
        sections: [],
        comments: null,
      };
    }
    writeConfluenceLedger(join(cloneRoot, PLANS_DIR, "confluence.json"), {
      site: `https://${SITE}`,
      roots: [ROOT_ID],
      lastSyncAt: NOW.toISOString(),
      pages,
    });
  });
  try {
    const result = await rig6.sync.importNow("demo");
    assert.equal(result.imported, 500);
    assert.equal(result.capped, true);
    const ledger = JSON.parse(
      readFileSync(join(rig6.cloneRoot, PLANS_DIR, "confluence.json"), "utf8"),
    ) as { lastSyncAt: string | null; pages: Record<string, { version: number }> };
    // 상한에 닿은 바퀴는 lastSyncAt 을 앞서지 않는다 — 다음 바퀴가 남은 문서를 이어받는다.
    assert.equal(ledger.lastSyncAt, NOW.toISOString());
    assert.equal(ledger.pages["p0000"]?.version, 2);
    assert.equal(ledger.pages["p0500"]?.version, 1, "상한 너머의 문서는 다음 바퀴의 몫이다");
  } finally {
    rig6.cleanup();
  }
});

test("가져올 자리가 없으면(클론 없음) 한국어로 거절한다", async () => {
  const home = mkdtempSync(join(tmpdir(), "confluence-sync-"));
  try {
    const sync = new ConfluenceSync({
      machineSetting: { get: () => null },
      credentials: new MemoryCredentialStore(),
      workspaceOf: () => null,
      slugs: () => ["demo"],
      logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
    });
    await assert.rejects(sync.importNow("demo"), /클론/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("첫 걷기 한가운데의 401 — 원장은 앞서지 않고 만료로 적힌다(레드팀 위반의 고침)", async () => {
  const pairs = [
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [
        { id: "1", title: "01.시스템분석" },
        { id: "2", title: "02.기능설계" },
      ],
    }),
    fixture(
      "첫째 문서",
      readPageUrl("1"),
      200,
      page("1", "01.시스템분석", "<p>가</p>", 2, ROOT_ID),
    ),
    fixture("둘째 문서", readPageUrl("2"), 401, {}),
  ];
  const rig7 = rig(pairs);
  try {
    const result = await rig7.sync.importNow("demo");
    // 부분 결과는 없다 — 만료가 걷기 전체를 이긴다.
    assert.deepEqual(result, { imported: 0, skipped: 0, capped: false });
    assert.equal(rig7.sync.expiredState("demo"), true);
    // 원장이 쓰이지 않았다 — 파일이 없어야 다음 바퀴가 처음부터 다시 걷는다.
    assert.equal(existsSync(join(rig7.cloneRoot, PLANS_DIR, "confluence.json")), false);
  } finally {
    rig7.cleanup();
  }
});

// ————— 2026-10-19 고침 — 경로는 걷기 한 곳에서, 증분은 뿌리 아래로, 클론 전에는 쓰지 않는다 —————

const LATER = () => {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? NOW : new Date(NOW.getTime() + CONFLUENCE_POLL_MS);
  };
};

/** 뿌리 → [1, 2], 1 → [3] 의 빠짐없는 걷기 한 벌. 1 의 제목과 판, 3 의 제목은 바꿔 끼울 수 있다. */
function treeFixtures(opts: { oneTitle?: string; oneVersion?: number; three?: boolean } = {}) {
  const oneTitle = opts.oneTitle ?? "01.시스템분석";
  const three = opts.three ?? true;
  return [
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [
        { id: "1", title: oneTitle },
        { id: "2", title: "02.기능설계" },
      ],
    }),
    fixture(
      "첫째 문서",
      readPageUrl("1"),
      200,
      page("1", oneTitle, "<p>가</p>", opts.oneVersion ?? 2, ROOT_ID),
    ),
    fixture("첫째의 아이", childrenUrl("1"), 200, {
      results: three ? [{ id: "3", title: "03.손자" }] : [],
    }),
    ...(three
      ? [
          fixture("손자 문서", readPageUrl("3"), 200, page("3", "03.손자", "<p>다</p>", 1, "1")),
          fixture("손자의 아이", childrenUrl("3"), 200, { results: [] }),
        ]
      : []),
    fixture("둘째 문서", readPageUrl("2"), 200, page("2", "02.기능설계", "<p>나</p>", 1, ROOT_ID)),
    fixture("둘째의 아이", childrenUrl("2"), 200, { results: [] }),
  ];
}

const plansFile = (cloneRoot: string, path: string) => join(cloneRoot, PLANS_DIR, `${path}.md`);
const readLedger = (cloneRoot: string) =>
  JSON.parse(readFileSync(join(cloneRoot, PLANS_DIR, "confluence.json"), "utf8")) as {
    lastSyncAt: string | null;
    pages: Record<string, { path: string; title: string; version: number }>;
  };

test("증분이 처음 보는 문서를 만나면 트리를 걷는다 — 깊은 자리의 새 문서도 부모의 폴더 안에 선다", async () => {
  const rigA = rig(
    [
      ...treeFixtures({ three: false }),
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, {
        results: [{ content: { id: "3", title: "03.손자" }, title: "03.손자" }],
      }),
      ...treeFixtures({ three: true }),
    ],
    undefined,
    { now: LATER() },
  );
  try {
    assert.equal((await rigA.sync.importNow("demo")).imported, 3);
    const second = await rigA.sync.importNow("demo");
    assert.deepEqual(second, { imported: 1, skipped: 3, capped: false });
    // 뿌리 바로 아래가 아니라 첫째 문서의 폴더 안이다 — 첫 가져오기의 자리 규칙과 같다.
    const place = "COLO/8.8 ColoNova/01.시스템분석/03.손자";
    assert.equal(readLedger(rigA.cloneRoot).pages["3"]?.path, place);
    assert.ok(existsSync(plansFile(rigA.cloneRoot, place)));
    assert.ok(!existsSync(plansFile(rigA.cloneRoot, "COLO/8.8 ColoNova/03.손자")));
  } finally {
    rigA.cleanup();
  }
});

test("제목이 바뀐 문서 — 걷기가 그 파일과 아래 문서의 폴더를 함께 옮기고 옛 자리를 거둔다", async () => {
  const renamed = "01.시스템분석(개정)";
  const rigB = rig(
    [
      ...treeFixtures(),
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, {
        results: [{ content: { id: "1", title: renamed, version: { number: 3 } }, title: renamed }],
      }),
      ...treeFixtures({ oneTitle: renamed, oneVersion: 3 }),
    ],
    undefined,
    { now: LATER() },
  );
  try {
    assert.equal((await rigB.sync.importNow("demo")).imported, 4);
    const second = await rigB.sync.importNow("demo");
    // 제목을 바꾼 문서만 새로 가져왔고, 손자는 판이 그대로라 자리만 옮겼다.
    assert.deepEqual(second, { imported: 1, skipped: 3, capped: false });
    const base = "COLO/8.8 ColoNova";
    assert.ok(existsSync(plansFile(rigB.cloneRoot, `${base}/${renamed}`)));
    assert.ok(existsSync(plansFile(rigB.cloneRoot, `${base}/${renamed}/03.손자`)));
    assert.ok(!existsSync(plansFile(rigB.cloneRoot, `${base}/01.시스템분석`)));
    assert.ok(
      !existsSync(join(rigB.cloneRoot, PLANS_DIR, base, "01.시스템분석")),
      "비어 버린 옛 폴더는 거둔다",
    );
    assert.equal(readLedger(rigB.cloneRoot).pages["3"]?.path, `${base}/${renamed}/03.손자`);
  } finally {
    rigB.cleanup();
  }
});

test("데몬 시작 뒤 첫 바퀴는 트리를 걷는다 — 꺼져 있던 사이의 이동을 잡고 트리에 없는 문서를 거둔다", async () => {
  const base = "COLO/8.8 ColoNova";
  const old = "COLO/옛 자리/01.시스템분석";
  const gone = `${base}/09.지운문서`;
  const rigC = rig(firstImportFixtures(), (cloneRoot) => {
    for (const path of [old, gone]) {
      mkdirSync(dirname(plansFile(cloneRoot, path)), { recursive: true });
      writeFileSync(plansFile(cloneRoot, path), "옛 글");
      writeFileSync(join(cloneRoot, PLANS_DIR, `${path}.storage.xml`), "<p>옛 글</p>");
    }
    const entry = (path: string, title: string, version: number) => ({
      path,
      title,
      version,
      sections: [],
      comments: null,
    });
    writeConfluenceLedger(join(cloneRoot, PLANS_DIR, "confluence.json"), {
      site: `https://${SITE}`,
      roots: [ROOT_ID],
      lastSyncAt: NOW.toISOString(),
      pages: {
        [ROOT_ID]: entry(`${base}/8.8 ColoNova`, "8.8 ColoNova", 3),
        "1": entry(old, "01.시스템분석", 2),
        "2": entry(`${base}/02.기능설계`, "02.기능설계", 1),
        "9": entry(gone, "09.지운문서", 1),
      },
    });
  });
  try {
    rigC.sync.start();
    rigC.sync.stop();
    const result = await rigC.sync.importNow("demo");
    // 판은 하나도 오르지 않았다 — 새로 가져온 것은 없고 자리만 바로잡았다.
    assert.deepEqual(result, { imported: 0, skipped: 3, capped: false });
    const ledger = readLedger(rigC.cloneRoot);
    assert.equal(ledger.pages["1"]?.path, `${base}/01.시스템분석`);
    assert.ok(existsSync(plansFile(rigC.cloneRoot, `${base}/01.시스템분석`)));
    assert.ok(!existsSync(join(rigC.cloneRoot, PLANS_DIR, "COLO", "옛 자리")), "옛 폴더를 거둔다");
    // 빠짐없이 끝난 걷기만 거둔다 — 트리에 없는 문서는 원장과 폴더에서 함께 빠진다.
    assert.equal(ledger.pages["9"], undefined);
    assert.ok(!existsSync(plansFile(rigC.cloneRoot, gone)));
  } finally {
    rigC.cleanup();
  }
});

test("검색이 실패한 바퀴는 원장의 시각을 앞서지 않는다 — 종류만 경고로 남긴다", async () => {
  const warns: Array<{ message: string; fields: unknown }> = [];
  const rigD = rig(
    [fixture("증분 찾기", cqlUrl(SINCE_NOW), 500, { message: "CQL 을 읽지 못했다" })],
    (cloneRoot) =>
      writeConfluenceLedger(join(cloneRoot, PLANS_DIR, "confluence.json"), {
        site: `https://${SITE}`,
        roots: [ROOT_ID],
        lastSyncAt: NOW.toISOString(),
        pages: {},
      }),
    { now: () => new Date(NOW.getTime() + CONFLUENCE_POLL_MS), warns },
  );
  try {
    assert.deepEqual(await rigD.sync.importNow("demo"), {
      imported: 0,
      skipped: 0,
      capped: false,
    });
    assert.equal(readLedger(rigD.cloneRoot).lastSyncAt, NOW.toISOString());
    assert.deepEqual(warns, [
      { message: "기획서 가져오기 실패", fields: { stage: "search", reason: "unavailable" } },
    ]);
  } finally {
    rigD.cleanup();
  }
});

test("클론이 서기 전(.git 없음)에는 쓰지 않고 거절한다 — 준비가 그 폴더를 잔해로 지우지 않게", async () => {
  const rigE = rig(firstImportFixtures(), (cloneRoot) =>
    rmSync(join(cloneRoot, ".git"), { recursive: true, force: true }),
  );
  try {
    await assert.rejects(rigE.sync.importNow("demo"), /클론/);
    assert.equal(existsSync(join(rigE.cloneRoot, PLANS_DIR)), false);
  } finally {
    rigE.cleanup();
  }
});

test("타이머의 한 바퀴는 연결되고 클론이 선 프로젝트만 돈다 — 나머지는 경고 없이 건너뛴다", async () => {
  const warns: Array<{ message: string; fields: unknown }> = [];
  const rigF = rig(firstImportFixtures(), undefined, {
    warns,
    slugs: ["demo", "loose", "bare"],
    machine: (machine) => {
      // bare 는 연결됐지만 클론이 아직 없다. loose 는 클론은 있지만 연결이 없다.
      machine.set("confluenceSite:bare", SITE);
      machine.set("confluenceRootId:bare", ROOT_ID);
    },
    workspaceOf: (slug, demo, home) => {
      if (slug === "demo" || slug === "loose") return demo;
      if (slug === "bare") {
        mkdirSync(join(home, "bare"), { recursive: true });
        return { root: join(home, "bare"), laneRun: demo.laneRun };
      }
      return null;
    },
  });
  try {
    (rigF.sync as unknown as { tickAll(): void }).tickAll();
    // 도는 바퀴에 합류해 끝을 기다린다.
    assert.equal((await rigF.sync.importNow("demo")).imported, 3);
    assert.deepEqual(warns, []);
    assert.equal(existsSync(join(rigF.cloneRoot, "..", "bare", "docs")), false);
  } finally {
    rigF.cleanup();
  }
});

test("빠짐없이 끝나지 못한 걷기는 상한까지만 다시 걷는다 — 그 뒤는 증분으로 돈다", async () => {
  const warns: Array<{ message: string; fields: unknown }> = [];
  // 뿌리의 아이 목록은 늘 못 읽힌다(기록이 없다) — 걷기는 매번 빠짐없이 끝나지 못한다.
  const walk = () => [
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
  ];
  const pairs = [
    ...Array.from({ length: 1 + MAX_INCOMPLETE_REWALKS }, walk).flat(),
    fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, { results: [] }),
  ];
  const rigG = rig(pairs, undefined, { warns });
  try {
    // 첫 가져오기 한 번 + 다시 걷기 상한만큼은 걷기다.
    for (let round = 0; round <= MAX_INCOMPLETE_REWALKS; round += 1) {
      await rigG.sync.importNow("demo");
    }
    // 그다음 바퀴는 증분이다 — 걷기였다면 뿌리 기록이 모자라 실패 경고가 남는다.
    assert.deepEqual(await rigG.sync.importNow("demo"), {
      imported: 0,
      skipped: 0,
      capped: false,
    });
    assert.deepEqual(warns, []);
  } finally {
    rigG.cleanup();
  }
});
