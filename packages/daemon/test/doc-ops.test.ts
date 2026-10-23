import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceMirrorLedger } from "../dist/confluence-mirror.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import { DocOps } from "../dist/doc-ops.js";
import type { DaemonLogger } from "../dist/log.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * 문서 관리 서비스 시험(2026-10-23 · 작업 D1a) — 임시 폴더의 가짜 프로젝트 · 기획서 사본(원장),
 * 기록된 전송, 가짜 걷기로 게이트 · 범위 · 권한 · 초안 알림 · 휴지통 기록 · 멱등 · 모르는
 * 결과를 본다. 합성 문서만 쓰고, 실사이트는 절대 두드리지 않는다.
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const PARENT_ID = "77";
const COMMAND_ID = "0b1e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
const NOW = new Date("2026-10-23T01:00:00Z");

const readPageUrl = (id: string) => `/wiki/api/v2/pages/${id}?body-format=storage`;
const trashedUrl = `/wiki/api/v2/pages/${PAGE_ID}?status=trashed&body-format=storage`;
const childrenUrl = `/wiki/api/v2/pages/${PAGE_ID}/direct-children?limit=250`;

const pageJson = (id: string, title: string, parentId: string | null, version: number) => ({
  id,
  title,
  spaceId: "SP1",
  version: { number: version, createdAt: "2026-10-23T00:00:00Z" },
  parentId,
  body: { storage: { value: `<p>${title}의 문단이다.</p>`, representation: "storage" } },
});

/** 조건 맞춤 — 미리보기의 답을 기다린다(자지 않는다). */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  assert.fail(`조건이 끝내 맞지 않았다: ${what}`);
}

interface Rig {
  ops: DocOps;
  requests: string[];
  served: Record<string, { status?: number; json?: unknown; body?: string }>;
  walkCalls: string[];
  /** 다음 걷기를 실패로 만든다 — 결과가 걷기의 실패를 타지 않는지 본다. */
  setWalkFailure(fail: boolean): void;
  plansRoot: string;
  trashFile: string;
  cleanup(): void;
}

function rig(): Rig {
  const home = mkdtempSync(join(tmpdir(), "doc-ops-"));
  // 기획서 사본 — 프로젝트 폴더 아래 confluence/ 다. 클론은 아예 없다(2026-10-23 · 기획서 사본 이동 계획 §1 D1).
  mkdirSync(join(home, "demo", "confluence"), { recursive: true });
  writeConfluenceLedger(confluenceMirrorLedger(join(home, "demo")), {
    site: SITE,
    roots: [ROOT_ID],
    lastSyncAt: null,
    pages: {
      [PAGE_ID]: {
        path: "COLO/login",
        title: "로그인 화면",
        version: 4,
        sections: [],
        comments: null,
      },
      "55": {
        path: "COLO/other",
        title: "다른 문서",
        version: 2,
        sections: [],
        comments: null,
      },
      [PARENT_ID]: {
        path: "COLO/parent",
        title: "부모 문서",
        version: 1,
        sections: [],
        comments: null,
      },
    },
    folders: { "50": { path: "COLO/가지", title: "가지 폴더" } },
    unsupported: {},
  });
  const served: Record<string, { status?: number; json?: unknown; body?: string }> = {
    [`GET ${readPageUrl(PAGE_ID)}`]: { json: pageJson(PAGE_ID, "로그인 화면", ROOT_ID, 4) },
    [`GET ${readPageUrl("55")}`]: { json: pageJson("55", "다른 문서", ROOT_ID, 2) },
    [`GET ${childrenUrl}`]: {
      json: {
        results: [
          { id: "124", title: "아이 문서", type: "page" },
          { id: "125", title: "둘째 아이", type: "page" },
        ],
      },
    },
    [`GET /wiki/api/v2/pages/${PAGE_ID}/operations`]: {
      json: {
        operations: [
          { operation: "delete", targetType: "page" },
          { operation: "update", targetType: "page" },
        ],
      },
    },
    "GET /wiki/api/v2/pages/55/direct-children?limit=250": { json: { results: [] } },
    "GET /wiki/api/v2/pages/55/operations": {
      json: { operations: [{ operation: "read", targetType: "page" }] },
    },
    [`GET /wiki/api/v2/pages/${PARENT_ID}/operations`]: {
      json: {
        operations: [
          { operation: "create", targetType: "page" },
          { operation: "update", targetType: "page" },
        ],
      },
    },
    [`GET /wiki/api/v2/pages/${ROOT_ID}/operations`]: {
      json: {
        operations: [
          { operation: "create", targetType: "page" },
          { operation: "update", targetType: "page" },
        ],
      },
    },
    [`GET ${trashedUrl}`]: { json: pageJson(PAGE_ID, "버려진 로그인 화면", ROOT_ID, 4) },
    [`DELETE /wiki/api/v2/pages/${PAGE_ID}`]: { status: 204, body: "" },
    [`POST /wiki/rest/api/content/${PAGE_ID}/copy`]: { json: { id: "808", title: "합성 사본" } },
    [`PUT /wiki/rest/api/content/${PAGE_ID}/move/append/${PARENT_ID}`]: { json: {} },
    [`PUT /wiki/api/v2/pages/${PAGE_ID}`]: {
      json: { id: PAGE_ID, version: { number: 5 } },
    },
  };
  const requests: string[] = [];
  const transport: RestTransport = {
    async request(input) {
      requests.push(`${input.method} ${input.url}`);
      const route = served[`${input.method} ${input.url}`];
      if (route === undefined) return { status: 404, body: Buffer.from("{}", "utf8"), headers: {} };
      return {
        status: route.status ?? 200,
        body: Buffer.from(route.body ?? JSON.stringify(route.json ?? {}), "utf8"),
        headers: {},
      };
    },
  };
  const walkCalls: string[] = [];
  let walkFailure = false;
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const setting: Record<string, string> = {
    "confluenceSite:demo": SITE,
    "confluenceRootId:demo": ROOT_ID,
    "confluenceRootTitle:demo": "합성 뿌리",
  };
  const logger: DaemonLogger = { info() {}, warn() {}, error() {} };
  const ops = new DocOps({
    registry: { activeSlug: () => "demo", paths: (slug) => ({ root: join(home, slug) }) },
    machineSetting: { get: (key) => setting[key] ?? null },
    credentials,
    broadcast: () => {},
    logger,
    transport: () => transport,
    now: () => NOW,
    walkNow: async (slug) => {
      walkCalls.push(slug);
      if (walkFailure) throw new Error("걷기가 막혔다");
    },
  });
  const plansRoot = join(home, "demo", "plans");
  return {
    ops,
    requests,
    served,
    walkCalls,
    setWalkFailure(fail: boolean) {
      walkFailure = fail;
    },
    plansRoot,
    trashFile: join(plansRoot, "trash.json"),
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** 발행 게이트 — 켜고 끄는 것은 시험이 정한다. */
function gate(on: boolean): void {
  if (on) process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  else delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
}

test("게이트가 꺼진 미리보기 — publish-disabled 하나만 선다(원격을 두드리지 않는다)", async () => {
  const { ops, requests, walkCalls, plansRoot, cleanup } = rig();
  try {
    gate(false);
    const preview = await ops.preview("trash", PAGE_ID);
    assert.deepEqual(preview.blockers, ["publish-disabled"]);
    assert.equal(preview.childCount, null);
    assert.equal(requests.length, 0);

    const result = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.equal(result.state, "failed");
    assert.match(result.detail, /꺼져/);
    assert.equal(requests.length, 0);
    assert.equal(walkCalls.length, 0);
    // 실패에는 기록을 남기지 않는다 — 같은 명령으로 다시 시도할 수 있다.
    assert.ok(!existsSync(join(plansRoot, "ops", `${COMMAND_ID}.json`)));
  } finally {
    gate(false);
    cleanup();
  }
});

test("범위 밖의 문서 — 원장에 없는 문서는 out-of-scope 로 막힌다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const preview = await ops.preview("trash", "999");
    assert.deepEqual(preview.blockers, ["out-of-scope"]);
    assert.equal(requests.length, 0);
    const result = await ops.trash({ pageId: "999", commandId: COMMAND_ID });
    assert.equal(result.state, "failed");
    assert.match(result.detail, /목록에 없는/);
    assert.equal(requests.length, 0);
  } finally {
    gate(false);
    cleanup();
  }
});

test("권한이 없는 문서 — 필요한 동작이 없으면 no-permission 으로 막힌다", async () => {
  const { ops, cleanup } = rig();
  try {
    gate(true);
    const preview = await ops.preview("trash", "55");
    assert.deepEqual(preview.blockers, ["no-permission"]);
    assert.equal(preview.childCount, 0);
    const result = await ops.trash({ pageId: "55", commandId: COMMAND_ID });
    assert.equal(result.state, "failed");
    assert.match(result.detail, /권한/);
  } finally {
    gate(false);
    cleanup();
  }
});

test("미발행 초안이 있는 문서 — has-draft 는 알림일 뿐, 지우지도 막지도 않는다", async () => {
  const { ops, requests, walkCalls, plansRoot, cleanup } = rig();
  try {
    gate(true);
    // 초안의 존재만 본다 — 내용은 보지 않는다(초안은 사람이 버린다).
    mkdirSync(join(plansRoot, "drafts"), { recursive: true });
    writeFileSync(join(plansRoot, "drafts", `p-${PAGE_ID}.json`), "{}\n");
    const preview = await ops.preview("trash", PAGE_ID);
    assert.deepEqual(preview.blockers, ["has-draft"]);
    assert.equal(preview.hasDraft, true);
    assert.equal(preview.childCount, 2);

    const result = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.equal(result.state, "applied");
    // 초안은 남는다 — 미발행 초안을 자동 정리하지 않는다(정본 계획 §9).
    assert.ok(existsSync(join(plansRoot, "drafts", `p-${PAGE_ID}.json`)));
    assert.ok(requests.includes(`DELETE /wiki/api/v2/pages/${PAGE_ID}`));
    await until(() => walkCalls.length === 1, "걷기 한 번");
  } finally {
    gate(false);
    cleanup();
  }
});

test("같은 부모로 옮기기 — same-parent 로 알리고 보내지 않는다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const preview = await ops.preview("move", PAGE_ID, ROOT_ID);
    assert.deepEqual(preview.blockers, ["same-parent"]);
    // 부모의 원장 정보 — 뿌리의 제목은 설정의 것이다.
    assert.deepEqual(preview.target, { id: ROOT_ID, type: "page", title: "합성 뿌리" });
    const result = await ops.move({ pageId: PAGE_ID, commandId: COMMAND_ID, parentId: ROOT_ID });
    assert.equal(result.state, "failed");
    assert.match(result.detail, /이미 그 부모/);
    assert.ok(!requests.some((row) => row.includes("/move/")));
  } finally {
    gate(false);
    cleanup();
  }
});

test("trash 적용 — 휴지통 목록에 기록하고 트리를 한 번 걷는다", async () => {
  const { ops, requests, walkCalls, trashFile, cleanup } = rig();
  try {
    gate(true);
    const result = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.deepEqual(result, {
      commandId: COMMAND_ID,
      op: "trash",
      state: "applied",
      pageId: PAGE_ID,
      detail: "",
    });
    assert.ok(requests.includes(`DELETE /wiki/api/v2/pages/${PAGE_ID}`));
    const entries = ops.trashed();
    assert.deepEqual(entries, [
      { pageId: PAGE_ID, title: "로그인 화면", parentId: ROOT_ID, trashedAt: NOW.toISOString() },
    ]);
    const saved = JSON.parse(readFileSync(trashFile, "utf8")) as {
      entries: Array<{ pageId: string }>;
    };
    assert.deepEqual(
      saved.entries.map((row) => row.pageId),
      [PAGE_ID],
    );
    await until(() => walkCalls.length === 1, "걷기 한 번");
    assert.deepEqual(walkCalls, ["demo"]);
  } finally {
    gate(false);
    cleanup();
  }
});

test("같은 commandId 로 두 번 — 한 번만 보내고 같은 결과로 답한다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const first = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    const second = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.deepEqual(second, first);
    assert.equal(
      requests.filter((row) => row === `DELETE /wiki/api/v2/pages/${PAGE_ID}`).length,
      1,
    );
  } finally {
    gate(false);
    cleanup();
  }
});

test("모르는 결과 — 적용 여부를 모르니 같은 명령으로도 다시 보내지 않는다", async () => {
  const { ops, requests, served, walkCalls, cleanup } = rig();
  try {
    gate(true);
    served[`DELETE /wiki/api/v2/pages/${PAGE_ID}`] = {
      status: 500,
      json: { message: "Internal Server Error" },
    };
    const first = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.equal(first.state, "unknown");
    assert.match(first.detail, /500/);
    const second = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.deepEqual(second, first);
    assert.equal(
      requests.filter((row) => row === `DELETE /wiki/api/v2/pages/${PAGE_ID}`).length,
      1,
    );
    // 결과 불명 뒤에도 트리를 걷는다 — 실제 상태를 목록에 비추는 것이 사람이 판단할 재료다.
    await until(() => walkCalls.length === 1, "걷기 한 번");
  } finally {
    gate(false);
    cleanup();
  }
});

test("trash 실패 — 결과는 failed 이고 걷기를 부르지 않는다", async () => {
  const { ops, served, walkCalls, trashFile, cleanup } = rig();
  try {
    gate(true);
    served[`DELETE /wiki/api/v2/pages/${PAGE_ID}`] = {
      status: 400,
      json: { message: "합성 거절" },
    };
    const result = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.equal(result.state, "failed");
    assert.match(result.detail, /400/);
    // 실패 뒤에는 걷지 않는다 — 휴지통 기록도 없다.
    assert.equal(walkCalls.length, 0);
    assert.deepEqual(ops.trashed(), []);
    assert.ok(!existsSync(trashFile), "실패는 휴지통 목록을 쓰지 않는다");
  } finally {
    gate(false);
    cleanup();
  }
});

test("걷기가 막혀도 문서 관리의 결과는 그대로다", async () => {
  const { ops, walkCalls, setWalkFailure, trashFile, cleanup } = rig();
  try {
    gate(true);
    setWalkFailure(true);
    const result = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.deepEqual(result, {
      commandId: COMMAND_ID,
      op: "trash",
      state: "applied",
      pageId: PAGE_ID,
      detail: "",
    });
    await until(() => walkCalls.length === 1, "걷기 한 번");
    // 휴지통 기록은 걷기의 실패와 상관없이 살아 있다.
    const saved = JSON.parse(readFileSync(trashFile, "utf8")) as {
      entries: Array<{ pageId: string }>;
    };
    assert.deepEqual(
      saved.entries.map((row) => row.pageId),
      [PAGE_ID],
    );
  } finally {
    gate(false);
    cleanup();
  }
});

test("restore — 이 앱이 휴지통으로 옮긴 문서가 아니면 not-trashed-here 로 막힌다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const preview = await ops.preview("restore", PAGE_ID);
    assert.deepEqual(preview.blockers, ["not-trashed-here"]);
    const result = await ops.restore({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.equal(result.state, "failed");
    assert.match(result.detail, /이 앱이 휴지통/);
    assert.equal(requests.length, 0);
  } finally {
    gate(false);
    cleanup();
  }
});

test("restore 적용 — 휴지통 판 + 1 로 되살리고 목록에서 빠진다", async () => {
  const { ops, requests, walkCalls, trashFile, served, cleanup } = rig();
  try {
    gate(true);
    assert.equal((await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID })).state, "applied");
    await until(() => ops.trashed().length === 1, "휴지통 기록");
    const restoreCommand = "1b2e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
    const result = await ops.restore({ pageId: PAGE_ID, commandId: restoreCommand });
    assert.deepEqual(result, {
      commandId: restoreCommand,
      op: "restore",
      state: "applied",
      pageId: PAGE_ID,
      detail: "",
    });
    assert.deepEqual(ops.trashed(), []);
    const saved = JSON.parse(readFileSync(trashFile, "utf8")) as { entries: unknown[] };
    assert.equal(saved.entries.length, 0);
    // 휴지통 본문을 읽고 status current 로 되살린다.
    assert.ok(requests.includes(`GET ${trashedUrl}`));
    assert.ok(requests.includes(`PUT /wiki/api/v2/pages/${PAGE_ID}`));
    assert.deepEqual(
      served[`GET ${trashedUrl}`]?.json,
      pageJson(PAGE_ID, "버려진 로그인 화면", ROOT_ID, 4),
    );
    await until(() => walkCalls.length === 2, "걷기 두 번");
  } finally {
    gate(false);
    cleanup();
  }
});

test("copy 적용 — 새 문서의 id 로 답한다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const result = await ops.copy({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      title: "합성 사본",
      parentId: PARENT_ID,
    });
    assert.deepEqual(result, {
      commandId: COMMAND_ID,
      op: "copy",
      state: "applied",
      pageId: "808",
      detail: "",
    });
    assert.ok(requests.includes(`POST /wiki/rest/api/content/${PAGE_ID}/copy`));
    // 복제는 휴지통 목록을 쓰지 않는다.
    assert.deepEqual(ops.trashed(), []);
  } finally {
    gate(false);
    cleanup();
  }
});

test("move 적용 — 문서의 id 는 유지된다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const result = await ops.move({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      parentId: PARENT_ID,
    });
    assert.deepEqual(result, {
      commandId: COMMAND_ID,
      op: "move",
      state: "applied",
      pageId: PAGE_ID,
      detail: "",
    });
    assert.ok(requests.includes(`PUT /wiki/rest/api/content/${PAGE_ID}/move/append/${PARENT_ID}`));
  } finally {
    gate(false);
    cleanup();
  }
});

test("복제 · 이동의 대상 부모 — 원장 밖 부모는 out-of-scope 로 막히고 보내지 않는다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const previewCopy = await ops.preview("copy", PAGE_ID, "888");
    assert.deepEqual(previewCopy.blockers, ["out-of-scope"]);
    assert.equal(previewCopy.target, null);
    assert.deepEqual((await ops.preview("move", PAGE_ID, "888")).blockers, ["out-of-scope"]);
    const copy = await ops.copy({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      title: "합성 사본",
      parentId: "888",
    });
    assert.equal(copy.state, "failed");
    assert.match(copy.detail, /목록에 없는/);
    const move = await ops.move({ pageId: PAGE_ID, commandId: COMMAND_ID, parentId: "888" });
    assert.equal(move.state, "failed");
    assert.equal(requests.length, 0, "원격을 두드리지 않는다");
  } finally {
    gate(false);
    cleanup();
  }
});

test("같은 commandId 의 다른 명령 — 남의 기록을 돌려주지 않고 오류다", async () => {
  const { ops, requests, cleanup } = rig();
  try {
    gate(true);
    const first = await ops.trash({ pageId: PAGE_ID, commandId: COMMAND_ID });
    assert.equal(first.state, "applied");
    // 다른 문서의 같은 아이디 — 오류이지 문서 A 의 결과가 아니다.
    await assert.rejects(
      ops.trash({ pageId: "55", commandId: COMMAND_ID }),
      /이미 다른 문서 관리 명령에/,
    );
    // 다른 종류의 같은 아이디도 오류이다.
    await assert.rejects(
      ops.restore({ pageId: PAGE_ID, commandId: COMMAND_ID }),
      /이미 다른 문서 관리 명령에/,
    );
    assert.equal(requests.filter((row) => row.startsWith("DELETE")).length, 1);
  } finally {
    gate(false);
    cleanup();
  }
});

test("미리보기 — 자식 수와 부모의 원장 정보를 실어 보낸다", async () => {
  const { ops, cleanup } = rig();
  try {
    gate(true);
    const preview = await ops.preview("copy", PAGE_ID, PARENT_ID);
    assert.equal(preview.op, "copy");
    assert.equal(preview.title, "로그인 화면");
    assert.equal(preview.childCount, 2);
    assert.equal(preview.hasDraft, false);
    assert.deepEqual(preview.target, { id: PARENT_ID, type: "page", title: "부모 문서" });
    assert.equal(preview.checkedAt, NOW.toISOString());
  } finally {
    gate(false);
    cleanup();
  }
});
