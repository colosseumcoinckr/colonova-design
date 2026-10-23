import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceMirrorLedger, confluenceMirrorRoot } from "../dist/confluence-mirror.js";
import {
  CONFLUENCE_POLL_MS,
  ConfluenceSync,
  confluenceSiteKey,
  MAX_INCOMPLETE_REWALKS,
  resetLedgerOnRootChange,
} from "../dist/confluence-sync.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
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
// 트리 걷기는 direct-children 이다 — 폴더가 응답에 오르는 v2 계약(2026-10-23 최종 구현 계획 F0).
const TREE_SEGMENT: Record<string, string> = {
  page: "pages",
  folder: "folders",
  whiteboard: "whiteboards",
  database: "databases",
  embed: "embeds",
};
const childrenUrl = (id: string, kind = "page") =>
  `/wiki/api/v2/${TREE_SEGMENT[kind]}/${id}/direct-children?limit=250`;
/** 아직 사는 페이지 아이 한 줄 — status 가 온다(archived 는 걷지 않는다). */
const pageChild = (id: string, title: string) => ({ id, title, type: "page", status: "current" });
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
      results: [pageChild("1", "01.시스템분석"), pageChild("2", "02.기능설계")],
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
  /** 등록부가 아는 프로젝트 폴더 — 사본 뿌리는 `<프로젝트 폴더>/confluence` 다. */
  projectRoot: string;
  /** 클론의 자리 — 사본 이동 뒤로는 아무것도 쓰이지 않는다(잔채를 본다). */
  cloneRoot: string;
  machine: MachineSetting;
  cleanup(): void;
}

/** 조건 맞춤 — 도는 바퀴가 사다리에 설 때까지 기다린다(자지 않는다 · doc-ops 시험의 같은 감각). */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  assert.fail(`조건이 끝내 맞지 않았다: ${what}`);
}

function rig(
  pairs: Array<Record<string, unknown>>,
  seed?: (projectRoot: string) => void,
  opts?: {
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
    /** 경고를 받아 적는 손 — 없으면 조용하다. */
    warns?: Array<{ message: string; fields: unknown }>;
    slugs?: string[];
    /** demo 의 프로젝트 폴더를 받아 다른 프로젝트의 폴더를 정한다 — 없으면 demo 만 등록부에 있다. */
    projectRoot?: (slug: string, demo: string, home: string) => string | null;
    machine?: (machine: MachineSetting) => void;
  },
): Rig {
  const home = mkdtempSync(join(tmpdir(), "confluence-sync-"));
  const fixtureDir = join(home, "fixtures");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "fixtures.json"), JSON.stringify(pairs));
  const cloneRoot = join(home, "clone");
  mkdirSync(join(cloneRoot, ".git", "info"), { recursive: true });
  const projectRoot = join(home, "project");
  mkdirSync(projectRoot);
  seed?.(projectRoot);
  const machine = new MachineSetting(join(home, "machine.json"));
  machine.load();
  machine.set(`confluenceSite:demo`, SITE);
  machine.set(`confluenceRootId:demo`, ROOT_ID);
  opts?.machine?.(machine);
  const store = new MemoryCredentialStore();
  void store.save("confluence-pat", "me@example.com\ntok");
  // env 는 sync 의 생성 전에 — 전송(기록된 fixture 의 테이프)은 생성 때 한 벌로 정해진다.
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
  process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = fixtureDir;
  const warns = opts?.warns;
  const sync = new ConfluenceSync({
    machineSetting: machine,
    credentials: store,
    projectRoot: (slug) =>
      opts?.projectRoot !== undefined
        ? opts.projectRoot(slug, projectRoot, home)
        : slug === "demo"
          ? projectRoot
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
    projectRoot,
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
    const base = join(confluenceMirrorRoot(rig1.projectRoot), "COLO", "8.8 ColoNova");
    // 정본은 원문 그대로, 마크다운은 파생물이다.
    assert.ok(existsSync(join(base, "8.8 ColoNova.md")));
    assert.ok(existsSync(join(base, "8.8 ColoNova.storage.xml")));
    assert.ok(existsSync(join(base, "01.시스템분석.md")));
    const ledger = JSON.parse(readFileSync(confluenceMirrorLedger(rig1.projectRoot), "utf8")) as {
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
    const ledger = JSON.parse(readFileSync(confluenceMirrorLedger(rig2.projectRoot), "utf8")) as {
      lastSyncAt: string | null;
      pages: Record<string, { version: number }>;
    };
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

// 시험 틀의 시한 — 합류가 다시 교착하면 매달림 대신 실패로 바뀐다(코드 안의 타이머가 아니다).
test("importNow 중복 눌림 — 합류한다(같은 바퀴가 두 번 돌지 않는다)", {
  timeout: 10_000,
}, async () => {
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
  const rig6 = rig(pairs, (projectRoot) => {
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
    // 원장의 문서에는 파일이 짝으로 따른다 — 자가 복구 판정이 파일 없는 문서를 걷기로
    // 돌리므로, 증분 상한만 보는 이 시험은 파일도 함께 심는다(2026-10-23 · 오케스트레이터 검토).
    for (const page of Object.values(pages)) {
      const base = join(confluenceMirrorRoot(projectRoot), page.path);
      mkdirSync(dirname(base), { recursive: true });
      writeFileSync(`${base}.md`, "옛 글");
      writeFileSync(`${base}.storage.xml`, "<p>옛 글</p>");
    }
    writeConfluenceLedger(confluenceMirrorLedger(projectRoot), {
      site: `https://${SITE}`,
      roots: [ROOT_ID],
      lastSyncAt: NOW.toISOString(),
      pages,
      folders: {},
      unsupported: {},
    });
  });
  try {
    const result = await rig6.sync.importNow("demo");
    assert.equal(result.imported, 500);
    assert.equal(result.capped, true);
    const ledger = JSON.parse(readFileSync(confluenceMirrorLedger(rig6.projectRoot), "utf8")) as {
      lastSyncAt: string | null;
      pages: Record<string, { version: number }>;
    };
    // 상한에 닿은 바퀴는 lastSyncAt 을 앞서지 않는다 — 다음 바퀴가 남은 문서를 이어받는다.
    assert.equal(ledger.lastSyncAt, NOW.toISOString());
    assert.equal(ledger.pages.p0000?.version, 2);
    assert.equal(ledger.pages.p0500?.version, 1, "상한 너머의 문서는 다음 바퀴의 몫이다");
  } finally {
    rig6.cleanup();
  }
});

test("등록부에 없는 프로젝트는 한국어로 거절한다 — 타이머도 조용히 건너뛴다", async () => {
  const warns: Array<{ message: string; fields: unknown }> = [];
  const sync = new ConfluenceSync({
    machineSetting: {
      get(key: string) {
        return key === confluenceSiteKey("demo") || key === `confluenceRootId:demo` ? "값" : null;
      },
    },
    credentials: new MemoryCredentialStore(),
    projectRoot: () => null,
    slugs: () => ["demo"],
    logger: {
      info() {},
      warn(message: string, fields: unknown) {
        warns.push({ message, fields });
      },
      error() {},
      debug() {},
    } as never,
  });
  await assert.rejects(sync.importNow("demo"), /프로젝트를 찾지 못했어요/);
  await assert.rejects(sync.walkNow("demo"), /프로젝트를 찾지 못했어요/);
  // 타이머는 연결돼 있어도 등록부에 없는 프로젝트를 조용히 건너뛴다 — 거절 경고가 쌓이지 않는다.
  // tickAll 은 사유 몸이다 — 건너뜀을 직접 보려고 타이머의 한 바퀴를 부른다.
  const timer = sync as unknown as { tickAll(): void };
  timer.tickAll();
  assert.deepEqual(warns, []);
});

test("첫 걷기 한가운데의 401 — 원장은 앞서지 않고 만료로 적힌다(레드팀 위반의 고침)", async () => {
  const pairs = [
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [pageChild("1", "01.시스템분석"), pageChild("2", "02.기능설계")],
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
    assert.equal(existsSync(confluenceMirrorLedger(rig7.projectRoot)), false);
  } finally {
    rig7.cleanup();
  }
});

// ————— 2026-10-19 고침 — 경로는 걷기 한 곳에서, 증분은 뿌리 아래로 —————

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
      results: [pageChild("1", oneTitle), pageChild("2", "02.기능설계")],
    }),
    fixture(
      "첫째 문서",
      readPageUrl("1"),
      200,
      page("1", oneTitle, "<p>가</p>", opts.oneVersion ?? 2, ROOT_ID),
    ),
    fixture("첫째의 아이", childrenUrl("1"), 200, {
      results: three ? [pageChild("3", "03.손자")] : [],
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

const plansFile = (projectRoot: string, path: string) =>
  join(confluenceMirrorRoot(projectRoot), `${path}.md`);
const readLedger = (projectRoot: string) =>
  JSON.parse(readFileSync(confluenceMirrorLedger(projectRoot), "utf8")) as {
    lastSyncAt: string | null;
    pages: Record<string, { path: string; title: string; version: number }>;
    folders: Record<string, { path: string; title: string }>;
    unsupported: Record<string, { path: string; title: string; type: string }>;
  };

/** 사본 폴더 아래의 모든 파일 — 원자 쓰기가 임시 파일을 남기지 않았는지 본다. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

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
    assert.equal(readLedger(rigA.projectRoot).pages["3"]?.path, place);
    assert.ok(existsSync(plansFile(rigA.projectRoot, place)));
    assert.ok(!existsSync(plansFile(rigA.projectRoot, "COLO/8.8 ColoNova/03.손자")));
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
    assert.ok(existsSync(plansFile(rigB.projectRoot, `${base}/${renamed}`)));
    assert.ok(existsSync(plansFile(rigB.projectRoot, `${base}/${renamed}/03.손자`)));
    assert.ok(!existsSync(plansFile(rigB.projectRoot, `${base}/01.시스템분석`)));
    assert.ok(
      !existsSync(join(confluenceMirrorRoot(rigB.projectRoot), base, "01.시스템분석")),
      "비어 버린 옛 폴더는 거둔다",
    );
    assert.equal(readLedger(rigB.projectRoot).pages["3"]?.path, `${base}/${renamed}/03.손자`);
  } finally {
    rigB.cleanup();
  }
});

test("데몬 시작 뒤 첫 바퀴는 트리를 걷는다 — 꺼져 있던 사이의 이동을 잡고 트리에 없는 문서를 거둔다", async () => {
  const base = "COLO/8.8 ColoNova";
  const old = "COLO/옛 자리/01.시스템분석";
  const gone = `${base}/09.지운문서`;
  const rigC = rig(firstImportFixtures(), (projectRoot) => {
    for (const path of [old, gone]) {
      mkdirSync(dirname(plansFile(projectRoot, path)), { recursive: true });
      writeFileSync(plansFile(projectRoot, path), "옛 글");
      writeFileSync(join(confluenceMirrorRoot(projectRoot), `${path}.storage.xml`), "<p>옛 글</p>");
    }
    const entry = (path: string, title: string, version: number) => ({
      path,
      title,
      version,
      sections: [],
      comments: null,
    });
    writeConfluenceLedger(confluenceMirrorLedger(projectRoot), {
      site: `https://${SITE}`,
      roots: [ROOT_ID],
      lastSyncAt: NOW.toISOString(),
      pages: {
        [ROOT_ID]: entry(`${base}/8.8 ColoNova`, "8.8 ColoNova", 3),
        "1": entry(old, "01.시스템분석", 2),
        "2": entry(`${base}/02.기능설계`, "02.기능설계", 1),
        "9": entry(gone, "09.지운문서", 1),
      },
      folders: {},
      unsupported: {},
    });
  });
  try {
    rigC.sync.start();
    rigC.sync.stop();
    const result = await rigC.sync.importNow("demo");
    // 판은 하나도 오르지 않았다 — 새로 가져온 것은 없고 자리만 바로잡았다.
    assert.deepEqual(result, { imported: 0, skipped: 3, capped: false });
    const ledger = readLedger(rigC.projectRoot);
    assert.equal(ledger.pages["1"]?.path, `${base}/01.시스템분석`);
    assert.ok(existsSync(plansFile(rigC.projectRoot, `${base}/01.시스템분석`)));
    assert.ok(
      !existsSync(join(confluenceMirrorRoot(rigC.projectRoot), "COLO", "옛 자리")),
      "옛 폴더를 거둔다",
    );
    // 빠짐없이 끝난 걷기만 거둔다 — 트리에 없는 문서는 원장과 폴더에서 함께 빠진다.
    assert.equal(ledger.pages["9"], undefined);
    assert.ok(!existsSync(plansFile(rigC.projectRoot, gone)));
  } finally {
    rigC.cleanup();
  }
});

// 시험 틀의 시한 — walkNow 합류가 다시 교착하면 매달림 대신 실패로 바뀐다(코드 안의 타이머가 아니다).
test("증분이 돌 차례의 walkNow — 트리를 걷고(direct-children) 휴지통으로 빠진 문서를 원장에서 거둔다", {
  timeout: 10_000,
}, async () => {
  const rigM = rig(
    [
      ...treeFixtures(),
      // 증분의 답 — 이동 · 휴지통은 검색에 안 나타난다. 걷기가 아니었다면 이 자리를 묻는다.
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, {
        results: [
          { content: { id: "3", title: "03.손자", version: { number: 5 } }, title: "03.손자" },
        ],
      }),
      // 걷기 바퀴 — 휴지통으로 빠진 3 는 트리에 없다.
      ...treeFixtures({ three: false }),
    ],
    undefined,
    { now: LATER() },
  );
  try {
    assert.equal((await rigM.sync.importNow("demo")).imported, 4);
    const result = await rigM.sync.walkNow("demo");
    // 남은 두 문서를 다시 읽되 판이 그대로라 새로 가져온 것은 없다.
    assert.deepEqual(result, { imported: 0, skipped: 3, capped: false });
    const ledger = readLedger(rigM.projectRoot);
    assert.equal(ledger.pages["3"], undefined, "휴지통으로 빠진 문서는 원장에서 거둬진다");
    assert.ok(!existsSync(plansFile(rigM.projectRoot, "COLO/8.8 ColoNova/01.시스템분석/03.손자")));
  } finally {
    rigM.cleanup();
  }
});

// 시험 틀의 시한 — walkNow 합류가 다시 교착하면 매달림 대신 실패로 바뀐다(코드 안의 타이머가 아니다).
test("증분 바퀴가 도는 중의 walkNow — 그 바퀴 뒤에 걷기 바퀴가 한 번 더 돌고 답은 걷기 바퀴의 것이다", {
  timeout: 10_000,
}, async () => {
  let clockCalls = 0;
  let sleeps = 0;
  let release: (() => void) | null = null;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rigN = rig(
    [
      ...treeFixtures(),
      // 증분 바퀴 — 첫 429 에서 주입한 기다림에 서고, 풀린 뒤 빈 답으로 끝난다.
      fixture("증분 찾기 429", cqlUrl(SINCE_NOW), 429, {}),
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, { results: [] }),
      // 걷기 바퀴 — 휴지통으로 빠진 3 는 트리에 없다.
      ...treeFixtures({ three: false }),
    ],
    undefined,
    {
      now: () => {
        clockCalls += 1;
        return new Date(NOW.getTime() + (clockCalls - 1) * CONFLUENCE_POLL_MS);
      },
      sleep: () => {
        sleeps += 1;
        return sleeps === 1 ? held : Promise.resolve();
      },
    },
  );
  try {
    assert.equal((await rigN.sync.importNow("demo")).imported, 4);
    const incremental = rigN.sync.importNow("demo");
    await until(() => sleeps === 1, "증분 바퀴가 429 사다리에 서기");
    const walk = rigN.sync.walkNow("demo");
    release?.();
    // 답은 도는 증분 바퀴의 것이 아니라, 그것이 끝난 뒤 한 번 더 돈 걷기 바퀴의 것이다.
    assert.deepEqual(await walk, { imported: 0, skipped: 3, capped: false });
    assert.deepEqual(await incremental, { imported: 0, skipped: 0, capped: false });
    assert.equal(clockCalls, 3, "바퀴는 증분 하나와 걷기 하나다");
    assert.equal(readLedger(rigN.projectRoot).pages["3"], undefined);
  } finally {
    rigN.cleanup();
  }
});

// 시험 틀의 시한 — walkNow 합류가 다시 교착하면 매달림 대신 실패로 바뀐다(코드 안의 타이머가 아니다).
test("걷기로 판정된 바퀴가 도는 중의 walkNow — 옛 트리로 끝난 걷기가 표를 지워도 우리 걷기가 다시 걷는다", {
  timeout: 10_000,
}, async () => {
  const renamed = "01.시스템분석(개정)";
  let sleeps = 0;
  let release: (() => void) | null = null;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rigQ = rig(
    [
      ...treeFixtures(),
      // 걷기로 판정된 바퀴 — 검색이 바뀐 제목을 알리고, 걷기 몸의 첫 읽기가 429 사다리에 선다.
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, {
        results: [{ content: { id: "1", title: renamed, version: { number: 3 } }, title: renamed }],
      }),
      fixture("뿌리 문서 429", readPageUrl(ROOT_ID), 429, {}),
      // 사다리가 풀리면 옛 트리(3 포함)로 걷기가 빠짐없이 끝난다 — walkDue 표를 지운다.
      ...treeFixtures({ oneTitle: renamed, oneVersion: 3 }),
      // walkNow 의 바퀴 — 새 트리(3 은 휴지통)를 다시 걷는다. 고침이 없으면 이 기록이 남아
      // 증분(빈 검색)으로 흘러 3 이 원장에 남는다.
      ...treeFixtures({ oneTitle: renamed, oneVersion: 3, three: false }),
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, { results: [] }),
    ],
    undefined,
    {
      now: LATER(),
      sleep: () => {
        sleeps += 1;
        return sleeps === 1 ? held : Promise.resolve();
      },
    },
  );
  try {
    assert.equal((await rigQ.sync.importNow("demo")).imported, 4);
    const walking = rigQ.sync.importNow("demo");
    await until(() => sleeps === 1, "걷기 바퀴가 429 사다리에 서기");
    const walk = rigQ.sync.walkNow("demo");
    release?.();
    // 답은 우리 걷기 바퀴의 것이다 — 새 트리를 걸어 3 을 거둔다.
    assert.deepEqual(await walk, { imported: 0, skipped: 3, capped: false });
    assert.deepEqual(await walking, { imported: 1, skipped: 3, capped: false });
    assert.equal(
      readLedger(rigQ.projectRoot).pages["3"],
      undefined,
      "walkNow 뒤 3 이 거두어져야 한다",
    );
    assert.ok(
      !existsSync(plansFile(rigQ.projectRoot, "COLO/8.8 ColoNova/01.시스템분석(개정)/03.손자")),
    );
  } finally {
    rigQ.cleanup();
  }
});

// 시험 틀의 시한 — walkNow 합류가 다시 교착하면 매달림 대신 실패로 바뀐다(코드 안의 타이머가 아니다).
test("walkNow 동시 두 번 — 걷기 바퀴는 하나로 합친다", { timeout: 10_000 }, async () => {
  let clockCalls = 0;
  const rigO = rig(
    [
      ...treeFixtures(),
      // 걷기 바퀴 한 벌 — 합치지 못하면 둘째 걷기가 남는 기록이 없어 실패한다.
      ...treeFixtures({ three: false }),
    ],
    undefined,
    {
      now: () => {
        clockCalls += 1;
        return new Date(NOW.getTime() + clockCalls * CONFLUENCE_POLL_MS);
      },
    },
  );
  try {
    assert.equal((await rigO.sync.importNow("demo")).imported, 4);
    const [first, second] = await Promise.all([
      rigO.sync.walkNow("demo"),
      rigO.sync.walkNow("demo"),
    ]);
    assert.deepEqual(first, { imported: 0, skipped: 3, capped: false });
    assert.deepEqual(second, first);
    assert.equal(clockCalls, 2, "첫 가져오기와 걷기 하나 — 걷기 바퀴는 하나다");
  } finally {
    rigO.cleanup();
  }
});

// 시험 틀의 시한 — walkNow 합류가 다시 교착하면 매달림 대신 실패로 바뀐다(코드 안의 타이머가 아니다).
test("walkNow 도 클론이 없어도 돈다 — 사본은 프로젝트 폴더에만 내린다", {
  timeout: 10_000,
}, async () => {
  const rigP = rig(firstImportFixtures(), undefined, {
    projectRoot: (slug, demo, home) => {
      if (slug !== "demo") return null;
      rmSync(join(home, "clone"), { recursive: true, force: true });
      return demo;
    },
  });
  try {
    const result = await rigP.sync.walkNow("demo");
    assert.deepEqual(result, { imported: 3, skipped: 0, capped: false });
    assert.ok(existsSync(plansFile(rigP.projectRoot, "COLO/8.8 ColoNova/8.8 ColoNova")));
    assert.ok(!existsSync(rigP.cloneRoot), "클론은 필요 없다 — 지워졌으면 지워진 채다");
  } finally {
    rigP.cleanup();
  }
});

test("검색이 실패한 바퀴는 원장의 시각을 앞서지 않는다 — 종류만 경고로 남긴다", async () => {
  const warns: Array<{ message: string; fields: unknown }> = [];
  const rigD = rig(
    [fixture("증분 찾기", cqlUrl(SINCE_NOW), 500, { message: "CQL 을 읽지 못했다" })],
    (projectRoot) =>
      writeConfluenceLedger(confluenceMirrorLedger(projectRoot), {
        site: `https://${SITE}`,
        roots: [ROOT_ID],
        lastSyncAt: NOW.toISOString(),
        pages: {},
        folders: {},
        unsupported: {},
      }),
    { now: () => new Date(NOW.getTime() + CONFLUENCE_POLL_MS), warns },
  );
  try {
    assert.deepEqual(await rigD.sync.importNow("demo"), {
      imported: 0,
      skipped: 0,
      capped: false,
    });
    assert.equal(readLedger(rigD.projectRoot).lastSyncAt, NOW.toISOString());
    assert.deepEqual(warns, [
      { message: "기획서 가져오기 실패", fields: { stage: "search", reason: "unavailable" } },
    ]);
  } finally {
    rigD.cleanup();
  }
});

test("클론이 서기 전(.git 없음)에도 가져온다 — 클론 폴더에는 아무것도 쓰지 않는다", async () => {
  const rigE = rig(firstImportFixtures(), undefined, {
    projectRoot: (slug, demo, home) => {
      if (slug !== "demo") return null;
      rmSync(join(home, "clone", ".git"), { recursive: true, force: true });
      return demo;
    },
  });
  try {
    assert.deepEqual(await rigE.sync.importNow("demo"), {
      imported: 3,
      skipped: 0,
      capped: false,
    });
    assert.ok(existsSync(plansFile(rigE.projectRoot, "COLO/8.8 ColoNova/01.시스템분석")));
    // 클론에는 아무것도 쓰지 않는다 — 사본은 프로젝트 폴더의 confluence 에만 산다.
    assert.deepEqual(readdirSync(rigE.cloneRoot), []);
  } finally {
    rigE.cleanup();
  }
});

test("타이머의 한 바퀴는 연결되고 등록부에 있는 프로젝트만 돈다 — 나머지는 경고 없이 건너뛴다", async () => {
  const warns: Array<{ message: string; fields: unknown }> = [];
  const rigF = rig(firstImportFixtures(), undefined, {
    warns,
    slugs: ["demo", "loose", "bare"],
    machine: (machine) => {
      // bare 는 연결됐지만 등록부에 없다. loose 는 등록부에 있지만 연결이 없다.
      machine.set("confluenceSite:bare", SITE);
      machine.set("confluenceRootId:bare", ROOT_ID);
    },
    projectRoot: (slug, demo) => (slug === "demo" || slug === "loose" ? demo : null),
  });
  try {
    // tickAll 은 사유 몸이다 — 건너뜀을 직접 보려고 타이머의 한 바퀴를 부른다.
    const timer = rigF.sync as unknown as { tickAll(): void };
    timer.tickAll();
    // 도는 바퀴에 합류해 끝을 기다린다.
    assert.equal((await rigF.sync.importNow("demo")).imported, 3);
    // 등록부에 없는 프로젝트는 조용히 건너뛴다 — 거절 경고가 쌓이지 않는다.
    assert.deepEqual(warns, []);
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

// ————— 2026-10-23 최종 구현 계획 F0 — 폴더 · 미지원 종류도 트리의 한 몸이다 —————

test("뿌리 아래의 폴더 — 폴더는 본문 없이 폴더가 되고 그 아래 문서는 폴더 안에 선다", async () => {
  const base = "COLO/8.8 ColoNova";
  const rigH = rig([
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [{ id: "F", title: "화면 목록", type: "folder", status: "current" }],
    }),
    fixture("폴더의 아이", childrenUrl("F", "folder"), 200, {
      results: [pageChild("1", "정책서")],
    }),
    fixture("폴더 아래 문서", readPageUrl("1"), 200, page("1", "정책서", "<p>가</p>", 1, "F")),
    fixture("문서의 아이", childrenUrl("1"), 200, { results: [] }),
  ]);
  try {
    // 폴더는 문서 수에 세지 않는다 — 가져온 것은 뿌리와 정책서 둘뿐이다.
    assert.deepEqual(await rigH.sync.importNow("demo"), { imported: 2, skipped: 0, capped: false });
    const place = `${base}/화면 목록/정책서`;
    assert.ok(existsSync(plansFile(rigH.projectRoot, place)));
    const ledger = readLedger(rigH.projectRoot);
    assert.equal(ledger.pages["1"]?.path, place);
    assert.deepEqual(ledger.folders, { F: { path: `${base}/화면 목록`, title: "화면 목록" } });
  } finally {
    rigH.cleanup();
  }
});

test("페이지 아이가 없는 폴더 — 빈 폴더든 화이트보드만 든 폴더든 원장 folders 에 선다", async () => {
  const base = "COLO/8.8 ColoNova";
  const rigI = rig([
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [
        { id: "E", title: "빈 폴더", type: "folder", status: "current" },
        { id: "W", title: "보드 폴더", type: "folder", status: "current" },
      ],
    }),
    fixture("빈 폴더의 아이", childrenUrl("E", "folder"), 200, { results: [] }),
    fixture("보드 폴더의 아이", childrenUrl("W", "folder"), 200, {
      results: [{ id: "B", title: "흐름 보드", type: "whiteboard", status: "current" }],
    }),
    fixture("보드의 아이", childrenUrl("B", "whiteboard"), 200, { results: [] }),
  ]);
  try {
    assert.deepEqual(await rigI.sync.importNow("demo"), { imported: 1, skipped: 0, capped: false });
    const ledger = readLedger(rigI.projectRoot);
    // 폴더 둘은 파일이 없어도 원장에 선다.
    assert.deepEqual(ledger.folders, {
      E: { path: `${base}/빈 폴더`, title: "빈 폴더" },
      W: { path: `${base}/보드 폴더`, title: "보드 폴더" },
    });
    // 문서는 뿌리뿐이다 — 보드는 미지원으로 산다.
    assert.deepEqual(Object.keys(ledger.pages), [ROOT_ID]);
    assert.deepEqual(ledger.unsupported, {
      B: { path: `${base}/보드 폴더/흐름 보드`, title: "흐름 보드", type: "whiteboard" },
    });
  } finally {
    rigI.cleanup();
  }
});

test("미지원 종류 — 화이트보드는 빠짐없이 끝나고, 모르는 종류는 빠짐없이 끝나지 않는다", async () => {
  const base = "COLO/8.8 ColoNova";
  const rigJ = rig([
    // 첫 바퀴 — 화이트보드와 문서. 본문을 읽지 않는 보드가 있어도 걷기는 빠짐없이 끝난다.
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [
        { id: "B", title: "흐름 보드", type: "whiteboard", status: "current" },
        pageChild("1", "첫문서"),
      ],
    }),
    fixture("보드의 아이", childrenUrl("B", "whiteboard"), 200, { results: [] }),
    fixture("첫문서", readPageUrl("1"), 200, page("1", "첫문서", "<p>가</p>", 1, ROOT_ID)),
    fixture("첫문서의 아이", childrenUrl("1"), 200, { results: [] }),
    // 둘째 바퀴(데몬 시작의 걷기) — 모르는 종류. 아래를 읽을 길이 없다.
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [{ id: "S", title: "바깥 링크", type: "smartlink", status: "current" }],
    }),
  ]);
  try {
    assert.equal((await rigJ.sync.importNow("demo")).imported, 2);
    const first = readLedger(rigJ.projectRoot);
    // 빠짐없이 끝난 걷기 — lastSyncAt 이 앞선다.
    assert.equal(first.lastSyncAt, NOW.toISOString());
    assert.deepEqual(first.unsupported, {
      B: { path: `${base}/흐름 보드`, title: "흐름 보드", type: "whiteboard" },
    });
    rigJ.sync.start();
    rigJ.sync.stop();
    const result = await rigJ.sync.importNow("demo");
    // 뿌리 문서는 판이 그대로다 — 건너뜀 하나.
    assert.deepEqual(result, { imported: 0, skipped: 1, capped: false });
    const second = readLedger(rigJ.projectRoot);
    // 모르는 종류는 미지원으로 남지만 걷기는 빠짐없이 끝나지 않았다 — 시각은 앞서지 않는다.
    assert.equal(second.lastSyncAt, NOW.toISOString());
    assert.deepEqual(second.unsupported, {
      B: { path: `${base}/흐름 보드`, title: "흐름 보드", type: "whiteboard" },
      S: { path: `${base}/바깥 링크`, title: "바깥 링크", type: "smartlink" },
    });
    // 빠짐없이 끝나지 못한 바퀴는 트리에 없는 옛 문서를 거두지 않는다 — 다음 바퀴의 몫이다.
    assert.ok(second.pages["1"] !== undefined);
  } finally {
    rigJ.cleanup();
  }
});

test("archived 아이 — 원장 어디에도 새지 않고 걷기는 빠짐없이 끝난다", async () => {
  const rigK = rig([
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [
        { id: "A", title: "옛문서", type: "page", status: "archived" },
        pageChild("1", "살아있는 문서"),
      ],
    }),
    fixture(
      "살아있는 문서",
      readPageUrl("1"),
      200,
      page("1", "살아있는 문서", "<p>가</p>", 1, ROOT_ID),
    ),
    fixture("살아있는 문서의 아이", childrenUrl("1"), 200, { results: [] }),
  ]);
  try {
    // archived 는 읽지도 걷지도 않는다 — 가져온 것은 뿌리와 살아있는 문서 둘뿐이다.
    assert.deepEqual(await rigK.sync.importNow("demo"), { imported: 2, skipped: 0, capped: false });
    const ledger = readLedger(rigK.projectRoot);
    // 시각이 앞섰다 — archived 때문에 걷기가 덜 끝났다고 하지 않는다.
    assert.equal(ledger.lastSyncAt, NOW.toISOString());
    // 원장의 열쇠 순서는 숫자열 키에서 오름차순이다 — 모음만 대어 본다.
    assert.deepEqual(Object.keys(ledger.pages).sort(), ["1", ROOT_ID].sort());
    assert.deepEqual(ledger.folders, {});
    assert.deepEqual(ledger.unsupported, {});
  } finally {
    rigK.cleanup();
  }
});

test("빠짐없이 끝난 다음 걷기 — 트리에서 사라진 폴더는 원장 folders 에서도 빠진다", async () => {
  const base = "COLO/8.8 ColoNova";
  const rigL = rig([
    // 첫 바퀴 — 폴더 F 아래 문서 하나.
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, {
      results: [{ id: "F", title: "화면 목록", type: "folder", status: "current" }],
    }),
    fixture("폴더의 아이", childrenUrl("F", "folder"), 200, {
      results: [pageChild("1", "정책서")],
    }),
    fixture("폴더 아래 문서", readPageUrl("1"), 200, page("1", "정책서", "<p>가</p>", 1, "F")),
    fixture("문서의 아이", childrenUrl("1"), 200, { results: [] }),
    // 둘째 바퀴(데몬 시작의 걷기) — 폴더가 트리에서 사라졌다.
    fixture("뿌리 문서", readPageUrl(ROOT_ID), 200, ROOT_PAGE),
    fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
    fixture("뿌리의 아이", childrenUrl(ROOT_ID), 200, { results: [] }),
  ]);
  try {
    assert.equal((await rigL.sync.importNow("demo")).imported, 2);
    rigL.sync.start();
    rigL.sync.stop();
    // 폴더 아래 문서도 트리에 없다 — 빠짐없이 끝난 걷기는 그 문서를 거두고 폴더 기록을 비운다.
    assert.deepEqual(await rigL.sync.importNow("demo"), { imported: 0, skipped: 1, capped: false });
    const ledger = readLedger(rigL.projectRoot);
    assert.deepEqual(ledger.folders, {});
    assert.deepEqual(Object.keys(ledger.pages), [ROOT_ID]);
    assert.ok(!existsSync(plansFile(rigL.projectRoot, `${base}/화면 목록/정책서`)));
  } finally {
    rigL.cleanup();
  }
});

// ————— 2026-10-23 기획서 사본 이동 — 사본 파일의 자가 복구 · 원장 안전(오케스트레이터 검토) —————

test("사본 파일이 사라진 문서 — 이번 바퀴는 걷기로 돌아 판 그대로 파일을 다시 쓴다", async () => {
  // 두 파일 각각 지워 본다 — 어느 한쪽이 없어도 자가 복구는 같다(2026-10-23 · 기획서 사본 이동 계획 §6).
  for (const suffix of [".md", ".storage.xml"] as const) {
    const rigT = rig(
      [
        ...treeFixtures(),
        // 치유 바퀴의 걷기 기록 — 증분이었다면 CQL 기록이 없어 바퀴가 실패한다(걷기 요청의 증거).
        ...treeFixtures(),
      ],
      undefined,
      { now: LATER() },
    );
    try {
      assert.equal((await rigT.sync.importNow("demo")).imported, 4);
      const place = "COLO/8.8 ColoNova/01.시스템분석";
      const file = join(confluenceMirrorRoot(rigT.projectRoot), `${place}${suffix}`);
      const before = readFileSync(file, "utf8");
      rmSync(file);
      const healed = await rigT.sync.importNow("demo");
      // 새로 받은 판이 아니므로 셈은 skipped 쪽이다 — 문서 넷 모두 판이 그대로다.
      assert.deepEqual(healed, { imported: 0, skipped: 4, capped: false });
      assert.equal(readFileSync(file, "utf8"), before);
      const ledger = readLedger(rigT.projectRoot);
      assert.equal(ledger.pages["1"]?.version, 2, "원장의 판은 그대로다");
      assert.equal(ledger.pages["1"]?.path, place);
      // 원자 쓰기 — 두 바퀴가 파일을 다시 써도 임시 파일은 남지 않는다.
      assert.deepEqual(
        filesUnder(confluenceMirrorRoot(rigT.projectRoot)).filter((found) =>
          found.includes("colonova-design-"),
        ),
        [],
      );
    } finally {
      rigT.cleanup();
    }
  }
});

test("파일이 다 있으면 증분은 걷지 않는다 — 자가 복구 판정이 회귀를 만들지 않는다", async () => {
  const rigV = rig(
    [
      ...treeFixtures(),
      // 증분 바퀴의 기록 — 걷기였다면 direct-children 기록이 모자라 바퀴가 실패한다.
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, { results: [] }),
    ],
    undefined,
    { now: LATER() },
  );
  try {
    assert.equal((await rigV.sync.importNow("demo")).imported, 4);
    assert.deepEqual(await rigV.sync.importNow("demo"), { imported: 0, skipped: 0, capped: false });
  } finally {
    rigV.cleanup();
  }
});

test("바퀴가 429 에 서 있는 동안 뿌리를 바꿔 연결해도 — 다음 바퀴가 새 뿌리를 처음부터 걷는다", {
  timeout: 10_000,
}, async () => {
  const NEW_ROOT = "555";
  let sleeps = 0;
  let release: (() => void) | null = null;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oldPage = "COLO/옛뿌리/옛문서";
  const rigU = rig(
    [
      // 도는 바퀴(옛 뿌리의 증분) — 첫 429 에서 주입한 기다림에 선다.
      fixture("증분 찾기 429", cqlUrl(SINCE_NOW), 429, {}),
      fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, { results: [] }),
      // 다음 바퀴 — 새 뿌리 555 의 첫 걷기.
      fixture(
        "새 뿌리 문서",
        readPageUrl(NEW_ROOT),
        200,
        page(NEW_ROOT, "9.0 ColoNova", "<p>나</p>", 1, null),
      ),
      fixture("공간 열쇠", "/wiki/api/v2/spaces/SP1", 200, { key: "COLO" }),
      fixture("새 뿌리의 아이", childrenUrl(NEW_ROOT), 200, {
        results: [pageChild("7", "새문서")],
      }),
      fixture("새 문서", readPageUrl("7"), 200, page("7", "새문서", "<p>새</p>", 1, NEW_ROOT)),
      fixture("새 문서의 아이", childrenUrl("7"), 200, { results: [] }),
    ],
    (projectRoot) => {
      // 옛 뿌리의 원장과 파일 — 사다리에 선 바퀴가 끝나며 되살리는 대상이다.
      mkdirSync(dirname(plansFile(projectRoot, oldPage)), { recursive: true });
      writeFileSync(plansFile(projectRoot, oldPage), "옛 글");
      writeFileSync(
        join(confluenceMirrorRoot(projectRoot), `${oldPage}.storage.xml`),
        "<p>옛 글</p>",
      );
      writeConfluenceLedger(confluenceMirrorLedger(projectRoot), {
        site: `https://${SITE}`,
        roots: [ROOT_ID],
        lastSyncAt: NOW.toISOString(),
        pages: {
          "1": { path: oldPage, title: "옛문서", version: 2, sections: [], comments: null },
        },
        folders: {},
        unsupported: {},
      });
    },
    {
      sleep: () => {
        sleeps += 1;
        return sleeps === 1 ? held : Promise.resolve();
      },
    },
  );
  try {
    const incremental = rigU.sync.importNow("demo");
    await until(() => sleeps === 1, "옛 뿌리의 증분 바퀴가 429 사다리에 서기");
    // 바퀴가 서 있는 동안 connect 가 하는 일 — 뿌리를 555 로 바꾸고 원장을 비운다.
    rigU.machine.set(`confluenceRootId:demo`, NEW_ROOT);
    resetLedgerOnRootChange(rigU.projectRoot, ROOT_ID, NEW_ROOT);
    release?.();
    // 서 있던 바퀴가 끝나며 옛 뿌리의 원장을 되살린다 — 고침이 없으면 다음 바퀴가 증분으로 돈다.
    await incremental;
    const resurrected = readLedger(rigU.projectRoot);
    assert.equal(resurrected.roots[0], ROOT_ID);
    assert.ok(resurrected.pages["1"] !== undefined);
    // 다음 바퀴 — 원장의 뿌리가 다르니 처음 가져오기처럼 걷는다.
    assert.deepEqual(await rigU.sync.importNow("demo"), { imported: 2, skipped: 0, capped: false });
    const ledger = readLedger(rigU.projectRoot);
    assert.deepEqual(ledger.roots, [NEW_ROOT]);
    assert.deepEqual(Object.keys(ledger.pages).sort(), [NEW_ROOT, "7"].sort());
    // 옛 문서는 원장과 파일에서 함께 빠진다.
    assert.ok(!existsSync(plansFile(rigU.projectRoot, oldPage)));
    assert.ok(existsSync(plansFile(rigU.projectRoot, "COLO/9.0 ColoNova/새문서")));
  } finally {
    rigU.cleanup();
  }
});

test("원장의 사본 밖 경로 — 읽을 때 빠지므로 증분도 거두기도 사본 밖을 만지지 않는다", {
  timeout: 10_000,
}, async () => {
  const sentinels: string[] = [];
  const rigS = rig(
    [fixture("증분 찾기", cqlUrl(SINCE_NOW), 200, { results: [] }), ...treeFixtures()],
    (projectRoot) => {
      // 사본 밖의 감시 파일 — join 이 `..` 를 풀면 이 자리를 건드리게 된다.
      for (const name of ["증분바깥", "걷기바깥"]) {
        for (const suffix of [".md", ".storage.xml"]) {
          const file = join(projectRoot, `${name}${suffix}`);
          writeFileSync(file, "사본 밖");
          sentinels.push(file);
        }
      }
      // 원장을 직접 심는다 — 쓰기 도구는 안전한 경로만 지나므로 나쁜 path 는 몸으로 적는다.
      mkdirSync(dirname(confluenceMirrorLedger(projectRoot)), { recursive: true });
      writeFileSync(
        confluenceMirrorLedger(projectRoot),
        `${JSON.stringify({
          site: `https://${SITE}`,
          roots: [ROOT_ID],
          lastSyncAt: NOW.toISOString(),
          pages: {
            X: { path: "../증분바깥", title: "바깥", version: 1, sections: [], comments: null },
            Y: {
              path: "COLO/../걷기바깥",
              title: "바깥",
              version: 1,
              sections: [],
              comments: null,
            },
          },
          folders: { F: { path: "..\\바깥폴더", title: "바깥" } },
          unsupported: { U: { path: "/절대/보드", title: "보드", type: "whiteboard" } },
        })}\n`,
      );
    },
  );
  try {
    // 증분 바퀴 — 나쁜 항목은 읽을 때부터 원장에 들어오지 않았다.
    assert.deepEqual(await rigS.sync.importNow("demo"), { imported: 0, skipped: 0, capped: false });
    assert.deepEqual(Object.keys(readLedger(rigS.projectRoot).pages), []);
    // 걷기 바퀴 — 빠짐없이 끝나 거두지만 사본 밖은 모른 체한다.
    assert.equal((await rigS.sync.walkNow("demo")).imported, 4);
    const ledger = readLedger(rigS.projectRoot);
    assert.deepEqual(Object.keys(ledger.folders), []);
    assert.deepEqual(Object.keys(ledger.unsupported), []);
    assert.ok(
      sentinels.every((file) => existsSync(file)),
      "사본 밖의 감시 파일은 그대로다",
    );
  } finally {
    rigS.cleanup();
  }
});
