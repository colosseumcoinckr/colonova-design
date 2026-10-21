import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readConfluenceLedger, writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import { RequestRouter, type RouterDeps } from "../dist/dispatch.js";
import { MachineSetting } from "../dist/machine-setting.js";

/**
 * 기획서(Confluence) 연결 명령의 순수 시험(기획서 동기화 1단계 · M2) — RequestRouter 를
 * 가짜 자격 저장소 · 임시 machine.json · 기록된 fixture 전송으로 돌린다
 * (diagnostics-collect.test.ts 의 라우터 양식 · github 의 fixture 규약). 프로세스를 띄우지
 * 않는 순수 시험이다.
 */

const EMAIL = "me@example.com";
const TOKEN = "tok";
const AUTH_USER = { type: "known", accountId: "5f0", displayName: "정인권" } as const;
const WHO_URL = "/wiki/rest/api/user/current";

/** 기록 쌍 한 세트 — 이름은 사람이 읽고, cite 는 어느 엔드포인트인지 말한다. */
function fixture(
  name: string,
  url: string,
  status: number,
  json: unknown,
): Record<string, unknown> {
  return {
    name,
    cite: url,
    request: { method: "GET", url },
    response: { status, json },
  };
}

interface Rig {
  router: RequestRouter;
  store: MemoryCredentialStore;
  machine: MachineSetting;
  machineFile: string;
  cloneRoot: string;
  cleanup(): void;
}

/** 라우터 한 대 — 활성 프로젝트는 demo 고, 클론은 임시 폴더의 .git 이다. */
function rig(fixturePairs: Array<Record<string, unknown>>, slug = "demo"): Rig {
  const home = mkdtempSync(join(tmpdir(), "confluence-connect-"));
  const fixtureDir = join(home, "fixtures");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "fixtures.json"), JSON.stringify(fixturePairs));
  const machineFile = join(home, "machine.json");
  const machine = new MachineSetting(machineFile);
  machine.load();
  const store = new MemoryCredentialStore();
  const cloneRoot = join(home, "clone");
  mkdirSync(join(cloneRoot, ".git", "info"), { recursive: true });
  const fleet = {
    workspaces: new Map([[slug, { repo: { root: cloneRoot } }]]),
  };
  const router = new RequestRouter({
    registry: { activeSlug: () => slug },
    credentials: store,
    machineSetting: machine,
    fleet,
    confluence: {
      clearExpired() {},
      importNow: async () => ({ imported: 0, skipped: 0, capped: false }),
    },
  } as unknown as RouterDeps);
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
  process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = fixtureDir;
  return {
    router,
    store,
    machine,
    machineFile,
    cloneRoot,
    cleanup() {
      if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
      else process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = previous;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

const connect = (extra: Record<string, unknown> = {}) => ({
  id: "cc1",
  type: "confluence.connect",
  site: "colosseum.atlassian.net",
  email: EMAIL,
  token: TOKEN,
  ...extra,
});

test("연결 — 검증이 이기면 자격은 저장소로, 미러는 슬러그 키로, 응답에 자격은 없다", async () => {
  const rig1 = rig([fixture("연결 확인", WHO_URL, 200, AUTH_USER)]);
  try {
    const reply = (await rig1.router.dispatch(connect())) as {
      site: string;
      rootTitle: string | null;
    };
    assert.deepEqual(reply, { site: "colosseum.atlassian.net", rootTitle: null });
    assert.equal(await rig1.store.load("confluence-pat"), `${EMAIL}\n${TOKEN}`);
    assert.equal(rig1.machine.get("confluenceSite:demo"), "colosseum.atlassian.net");
    // 토큰 · 이메일은 응답 어디에도 다시 나오지 않는다(부포함 단언).
    const text = JSON.stringify(reply);
    assert.ok(!text.includes(EMAIL));
    assert.ok(!text.includes(TOKEN));
  } finally {
    rig1.cleanup();
  }
});

test("연결 — 검증 실패는 한국어 재연결 문장이고 아무것도 저장하지 않는다", async () => {
  const rig2 = rig([fixture("연결 확인", WHO_URL, 401, { message: "Unauthorized" })]);
  try {
    await assert.rejects(rig2.router.dispatch(connect()), /다시 연결/);
    assert.equal(await rig2.store.load("confluence-pat"), null);
    assert.equal(rig2.machine.get("confluenceSite:demo"), null);
  } finally {
    rig2.cleanup();
  }
});

test("연결 — 두 프로젝트는 서로의 미러를 덮어쓰지 않는다(슬러그 키 분리)", async () => {
  const rig3 = rig(
    [fixture("연결 확인", WHO_URL, 200, AUTH_USER), fixture("연결 확인", WHO_URL, 200, AUTH_USER)],
    "demo",
  );
  try {
    await rig3.router.dispatch(connect());
    // 같은 저장소 자격으로 둘째 프로젝트(beta)를 다른 사이트에 묶는다.
    const routerBeta = new RequestRouter({
      registry: { activeSlug: () => "beta" },
      credentials: rig3.store,
      machineSetting: rig3.machine,
      fleet: { workspaces: new Map() },
      confluence: {
        clearExpired() {},
        importNow: async () => ({ imported: 0, skipped: 0, capped: false }),
      },
    } as unknown as RouterDeps);
    await routerBeta.dispatch(
      connect({ site: "other.atlassian.net", email: undefined, token: undefined }),
    );
    assert.equal(rig3.machine.get("confluenceSite:demo"), "colosseum.atlassian.net");
    assert.equal(rig3.machine.get("confluenceSite:beta"), "other.atlassian.net");
  } finally {
    rig3.cleanup();
  }
});

test("연결 — 기준 페이지를 고르면 뿌리의 id 와 제목이 미러에 둔다", async () => {
  const root = {
    id: "987",
    title: "8.8 ColoNova",
    body: { storage: { value: "<p/>" } },
    version: { number: 3 },
  };
  const rig4 = rig([
    fixture("연결 확인", WHO_URL, 200, AUTH_USER),
    fixture("기준 페이지", "/wiki/api/v2/pages/987?body-format=storage", 200, root),
  ]);
  try {
    const reply = (await rig4.router.dispatch(connect({ rootPageId: "987" }))) as {
      rootTitle: string | null;
    };
    assert.equal(reply.rootTitle, "8.8 ColoNova");
    assert.equal(rig4.machine.get("confluenceRootId:demo"), "987");
    assert.equal(rig4.machine.get("confluenceRootTitle:demo"), "8.8 ColoNova");
  } finally {
    rig4.cleanup();
  }
});

test("재연결 — 이메일·토큰을 비우고 보내면 저장된 자격으로 다시 검증한다", async () => {
  const rig5 = rig([
    fixture("연결 확인", WHO_URL, 200, AUTH_USER),
    fixture("연결 확인", WHO_URL, 200, AUTH_USER),
  ]);
  try {
    await rig5.router.dispatch(connect());
    const reply = (await rig5.router.dispatch(connect({ email: undefined, token: undefined }))) as {
      site: string;
    };
    assert.equal(reply.site, "colosseum.atlassian.net");
    assert.equal(await rig5.store.load("confluence-pat"), `${EMAIL}\n${TOKEN}`);
  } finally {
    rig5.cleanup();
  }
});

test("기준 페이지 찾기 — 연결 전엔 한국어 거절, 연결 뒤엔 CQL 목록이다", async () => {
  const cql = `type=page AND title ~ "8.8"`;
  const searchUrl = `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=100`;
  const rig6 = rig([
    fixture("연결 확인", WHO_URL, 200, AUTH_USER),
    fixture("기준 페이지 찾기", searchUrl, 200, {
      results: [
        { content: { id: "987" }, title: "8.8 ColoNova" },
        { content: { id: "988" }, title: "8.8 ColoNova · 부록" },
      ],
    }),
  ]);
  try {
    await assert.rejects(
      rig6.router.dispatch({ id: "s1", type: "confluence.suggestRoots", query: "8.8" }),
      /먼저 연결/,
    );
    await rig6.router.dispatch(connect());
    const reply = (await rig6.router.dispatch({
      id: "s2",
      type: "confluence.suggestRoots",
      query: "8.8",
    })) as { roots: Array<{ id: string; title: string }> };
    assert.deepEqual(reply.roots, [
      { id: "987", title: "8.8 ColoNova" },
      { id: "988", title: "8.8 ColoNova · 부록" },
    ]);
  } finally {
    rig6.cleanup();
  }
});

test("거름 — 연결이 서면 클론의 .git/info/exclude 에 기획서 폴더가 한 줄로 박힌다(멱등)", async () => {
  const rig7 = rig([
    fixture("연결 확인", WHO_URL, 200, AUTH_USER),
    fixture("연결 확인", WHO_URL, 200, AUTH_USER),
  ]);
  try {
    await rig7.router.dispatch(connect());
    await rig7.router.dispatch(connect());
    const exclude = readFileSync(join(rig7.cloneRoot, ".git", "info", "exclude"), "utf8");
    const lines = exclude.split(/\r?\n/).filter((line) => line === "docs/plans/");
    assert.equal(lines.length, 1, exclude);
  } finally {
    rig7.cleanup();
  }
});

test("뿌리를 바꿔 다시 연결하면 원장이 비워진다 — 새 뿌리의 문서가 처음부터 다시 걷힌다(2026-10-18 설계자 지적)", async () => {
  const rig4 = rig([
    fixture("누구나", WHO_URL, 200, AUTH_USER),
    fixture("뿌리 문서", "/wiki/api/v2/pages/999?body-format=storage", 200, {
      id: "999",
      title: "8.8 ColoNova",
      spaceId: "SP1",
      version: { number: 1 },
      parentId: null,
      body: { storage: { value: "<p>가</p>", representation: "storage" } },
    }),
    fixture("새 뿌리 문서", "/wiki/api/v2/pages/555?body-format=storage", 200, {
      id: "555",
      title: "9.0 ColoNova",
      spaceId: "SP1",
      version: { number: 1 },
      parentId: null,
      body: { storage: { value: "<p>나</p>", representation: "storage" } },
    }),
  ]);
  try {
    await rig4.router.dispatch(connect());
    const ledgerFile = join(rig4.cloneRoot, "docs", "plans", "confluence.json");
    // 뿌리(999)를 이미 골라 둔 연결 — 거울에 새기고 옛 문서를 원장에 심어 둔다.
    rig4.machine.set("confluenceRootId:demo", "999");
    writeConfluenceLedger(ledgerFile, {
      site: "https://colosseum.atlassian.net",
      roots: ["999"],
      lastSyncAt: "2026-10-18T00:00:00Z",
      pages: {
        "111": { path: "COLO/옛문서", title: "옛문서", version: 1, sections: [], comments: null },
      },
    });
    // 같은 뿌리로 다시 연결 — 원장은 그대로다.
    await rig4.router.dispatch(connect({ email: undefined, token: undefined }));
    const kept = readConfluenceLedger(ledgerFile);
    assert.equal(kept.roots[0], "999");
    assert.ok(kept.pages["111"] !== undefined);
    // 다른 뿌리로 다시 연결 — 원장이 비워져 다음 가져오기가 새 뿌리 전체를 걷는다.
    await rig4.router.dispatch(connect({ email: undefined, token: undefined, rootPageId: "555" }));
    const cleared = readConfluenceLedger(ledgerFile);
    assert.deepEqual(cleared.roots, []);
    assert.deepEqual(Object.keys(cleared.pages), []);
    assert.equal(rig4.machine.get("confluenceRootId:demo"), "555");
  } finally {
    rig4.cleanup();
  }
});
