import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { confluenceSiteKey } from "../dist/confluence-sync.js";
import { mapRead, mapWrite, readPlanMap, screenInventory, writePlanMap } from "../dist/link-map.js";

/**
 * 연결 지도 읽기의 시험(2026-10-24 · 연결 지도 계획 §7) — 연결 파일의 판독
 * (정상 · 없음 · 깨짐 · 같은 열쇠), 화면 인벤토리(page 파일 × 관찰 지도), mapRead
 * 조립(연결 없음 · 연결 있음 · 고아 연결)을 본다. 합성 문서와 합성 라우트만 쓴다.
 */

/** 프로젝트 폴더와 클론 폴더의 짝 — 끝나면 지운다. */
function makeProject(): { root: string; repoRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "link-map-"));
  const repoRoot = join(root, "repo");
  mkdirSync(repoRoot, { recursive: true });
  return { root, repoRoot };
}

function seedPlanMap(repoRoot: string, value: unknown): void {
  writeFileSync(join(repoRoot, "plans-map.json"), JSON.stringify(value), "utf8");
}

test("연결 파일 — 없으면 빈 연결이고 깨진 것이 아니다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    assert.deepEqual(await readPlanMap(repoRoot), { links: [], broken: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("연결 파일 — 문서와 화면의 연결을 읽고 같은 열쇠는 한 줄로 합친다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    seedPlanMap(repoRoot, {
      format: 1,
      links: [
        {
          pageId: "1785626658",
          route: "/setting/user-management",
          createdAt: "2026-10-24T00:00:00.000Z",
        },
        { pageId: "1785626658", route: "http://localhost:5173/setting/user-management" },
        { pageId: "1785626658", route: "/setting/user-management", section: "사용자 등록" },
        { pageId: "1906999305", route: "member/view", note: "권한 표" },
      ],
    });
    const { links, broken } = await readPlanMap(repoRoot);
    assert.equal(broken, false);
    assert.deepEqual(
      links.map(({ pageId, route, section }) => ({ pageId, route, section })),
      [
        { pageId: "1785626658", route: "/setting/user-management", section: null },
        { pageId: "1785626658", route: "/setting/user-management", section: "사용자 등록" },
        { pageId: "1906999305", route: "/member/view", section: null },
      ],
      "루프백 전체 주소는 경로로 펴고 같은 (문서 · 화면 · 절)은 한 줄이다",
    );
    assert.equal(links[0]?.createdAt, "2026-10-24T00:00:00.000Z");
    assert.equal(links[2]?.note, "권한 표");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("연결 파일 — 한 줄이라도 모양이 틀리면 통째로 빈 연결이다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    const broken: unknown[] = [
      "{not json",
      { format: 2, links: [] },
      { format: 1, links: {} },
      { format: 1, links: [{ route: "/a" }] },
      { format: 1, links: [{ pageId: "1", route: "" }] },
      { format: 1, links: [{ pageId: "1", route: "https://example.com/a" }] },
      { format: 1, links: [{ pageId: "1", route: "/a", section: 3 }] },
    ];
    for (const value of broken) {
      seedPlanMap(repoRoot, value);
      const read = await readPlanMap(repoRoot);
      assert.deepEqual(read, { links: [], broken: true }, `깨진 파일: ${JSON.stringify(value)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("화면 인벤토리 — page 파일의 라우트와 관찰 제목을 합친다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    const rows = [
      {
        at: "1",
        sha: "a",
        routes: [],
        files: [],
        screens: [{ route: "/oms/list", title: "출고 목록" }],
      },
      {
        at: "2",
        sha: "b",
        routes: [],
        files: [],
        screens: [
          { route: "/oms/list", title: "출고 목록 v2" },
          { route: "member/view", title: "" },
        ],
      },
    ];
    writeFileSync(
      join(root, "screen-map.jsonl"),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
    mkdirSync(join(repoRoot, "src/app/member/list"), { recursive: true });
    writeFileSync(
      join(repoRoot, "src/app/member/list/page.tsx"),
      "export default function P() { return null; }",
      "utf8",
    );
    mkdirSync(join(repoRoot, "src/app/a/[id]"), { recursive: true });
    writeFileSync(
      join(repoRoot, "src/app/a/[id]/page.tsx"),
      "export default function P() { return null; }",
      "utf8",
    );
    writeFileSync(
      join(repoRoot, "src/app/layout.tsx"),
      "export default function L() { return null; }",
      "utf8",
    );
    mkdirSync(join(repoRoot, "app"), { recursive: true });
    writeFileSync(
      join(repoRoot, "app/page.tsx"),
      "export default function R() { return null; }",
      "utf8",
    );
    const screens = await screenInventory(root, repoRoot);
    assert.deepEqual(
      screens,
      [
        { route: "/", title: null, observed: false },
        { route: "/a/[…]", title: null, observed: false },
        { route: "/member/list", title: null, observed: false },
        { route: "/member/view", title: null, observed: true },
        { route: "/oms/list", title: "출고 목록 v2", observed: true },
      ],
      "동적 조각은 […] 한 모양이고 관찰 제목은 마지막 행의 것을 입힌다",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("화면 인벤토리 — 클론이 없으면 관찰만 산다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    const row = { at: "1", sha: "a", routes: ["http://localhost:5173/oms/list"], files: [] };
    writeFileSync(join(root, "screen-map.jsonl"), `${JSON.stringify(row)}\n`, "utf8");
    rmSync(repoRoot, { recursive: true, force: true });
    assert.deepEqual(await screenInventory(root, repoRoot), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** mapRead 에 줄 가짜 등록부 — 활성 슬러그와 프로젝트 폴더만 안다. 연결 기록은 끈다도 할 수 있다. */
function fakeDeps(root: string, repoRoot: string, slug: string | null, site = true) {
  return {
    registry: {
      activeSlug: () => slug,
      paths: () => ({ root, repoRoot }),
    },
    machineSetting: {
      get: (key: string) =>
        site && slug !== null && key === confluenceSiteKey(slug) ? "colosseum.atlassian.net" : null,
    },
  };
}

test("mapRead — 활성 프로젝트가 없으면 전부 비고 연결도 아니다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    const read = await mapRead(fakeDeps(root, repoRoot, null));
    assert.equal(read.linked, false);
    assert.deepEqual(read.docs, []);
    assert.deepEqual(read.screens, []);
    assert.deepEqual(read.links, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mapRead — 원장 문서와 화면·연결을 합치고 고아 연결도 그대로 둔다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    mkdirSync(join(root, "confluence"), { recursive: true });
    writeFileSync(
      join(root, "confluence", "confluence.json"),
      JSON.stringify({
        site: "colosseum.atlassian.net",
        roots: ["1767604270"],
        lastSyncAt: null,
        pages: {
          "1785626658": {
            path: "PROD/[TD] WMS/출고 목록 정책서",
            title: "출고 목록 정책서",
            version: 28,
          },
        },
        folders: { "9001": { path: "PROD/[TD] WMS", title: "[TD] WMS" } },
        unsupported: {},
      }),
      "utf8",
    );
    mkdirSync(join(repoRoot, "src/app/wms/outbound"), { recursive: true });
    writeFileSync(
      join(repoRoot, "src/app/wms/outbound/page.tsx"),
      "export default function P() { return null; }",
      "utf8",
    );
    seedPlanMap(repoRoot, {
      format: 1,
      links: [
        { pageId: "1785626658", route: "/wms/outbound" },
        { pageId: "9999", route: "/없는/화면" },
      ],
    });
    const read = await mapRead(fakeDeps(root, repoRoot, "demo"));
    assert.equal(read.linked, true);
    assert.deepEqual(read.docs, [
      {
        pageId: "1785626658",
        title: "출고 목록 정책서",
        version: 28,
        path: "PROD/[TD] WMS/출고 목록 정책서",
      },
    ]);
    assert.deepEqual(read.folders, [
      { folderId: "9001", title: "[TD] WMS", path: "PROD/[TD] WMS" },
    ]);
    assert.deepEqual(read.screens, [{ route: "/wms/outbound", title: null, observed: false }]);
    assert.equal(read.links.length, 2, "원장 · 인벤토리에 없는 연결도 지운다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mapRead — 연결이 없으면 문서가 비고 화면 인벤토리는 그대로 나간다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    mkdirSync(join(repoRoot, "src/app/home"), { recursive: true });
    writeFileSync(
      join(repoRoot, "src/app/home/page.tsx"),
      "export default function P() { return null; }",
      "utf8",
    );
    const read = await mapRead(fakeDeps(root, repoRoot, "demo", false));
    assert.equal(read.linked, false);
    assert.deepEqual(read.docs, []);
    assert.deepEqual(read.screens, [{ route: "/home", title: null, observed: false }]);
    assert.deepEqual(read.links, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("연결 쓰기 — 잇기를 파일에 남기고 다시 읽힌다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    const links = await writePlanMap(repoRoot, [
      { op: "add", pageId: "102", route: "/wms/packing", note: "포장 절" },
      { op: "add", pageId: "101", route: "http://localhost:5173/wms/outbound-list" },
    ]);
    assert.deepEqual(
      links.map(({ pageId, route, section, note }) => ({ pageId, route, section, note })),
      [
        { pageId: "101", route: "/wms/outbound-list", section: null, note: null },
        { pageId: "102", route: "/wms/packing", section: null, note: "포장 절" },
      ],
      "정렬은 문서 · 화면 순이고 루프백 주소는 경로로 편다",
    );
    assert.ok(links[0]?.createdAt !== null, "만든 날이 찍힌다");
    const again = await readPlanMap(repoRoot);
    assert.equal(again.broken, false);
    assert.equal(again.links.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("연결 쓰기 — 같은 열쇠를 다시 잇으면 메모만 갈아 얹는다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    const first = await writePlanMap(repoRoot, [
      { op: "add", pageId: "101", route: "/wms/outbound-list", note: "처음" },
    ]);
    const second = await writePlanMap(repoRoot, [
      { op: "add", pageId: "101", route: "/wms/outbound-list", note: "바뀐 메모" },
    ]);
    assert.equal(second.length, 1);
    assert.equal(second[0]?.note, "바뀐 메모");
    assert.equal(second[0]?.createdAt, first[0]?.createdAt, "만든 날은 첫 연결을 지킨다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("연결 쓰기 — 끊기는 그 줄만 지우고 없는 끊기는 조용하다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    await writePlanMap(repoRoot, [
      { op: "add", pageId: "101", route: "/wms/outbound-list", section: "기준" },
      { op: "add", pageId: "101", route: "/wms/outbound-list" },
      { op: "add", pageId: "102", route: "/wms/packing" },
    ]);
    const left = await writePlanMap(repoRoot, [
      { op: "remove", pageId: "101", route: "/wms/outbound-list", section: "기준" },
      { op: "remove", pageId: "999", route: "/없는/화면" },
    ]);
    assert.deepEqual(
      left.map(({ pageId, route }) => ({ pageId, route })),
      [
        { pageId: "101", route: "/wms/outbound-list" },
        { pageId: "102", route: "/wms/packing" },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("연결 쓰기 — 모양이 틀린 변경 하나에 요청 전체가 거절되고 파일은 그대로다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    await writePlanMap(repoRoot, [{ op: "add", pageId: "101", route: "/wms/outbound-list" }]);
    const before = await readPlanMap(repoRoot);
    await assert.rejects(
      writePlanMap(repoRoot, [
        { op: "add", pageId: "102", route: "/wms/packing" },
        { op: "add", pageId: "   ", route: "/wms/packing" },
      ]),
      /문서가 비어 있어요/,
    );
    await assert.rejects(writePlanMap(repoRoot, [{ op: "add", pageId: "1", route: "" }]), /.+/);
    const after = await readPlanMap(repoRoot);
    assert.deepEqual(after.links, before.links, "거절된 요청은 파일을 바꾸지 않는다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mapWrite — 활성 프로젝트가 없으면 거절한다", async () => {
  const { root, repoRoot } = makeProject();
  try {
    await assert.rejects(
      mapWrite(fakeDeps(root, repoRoot, null), [{ op: "add", pageId: "1", route: "/a" }]),
      /프로젝트를 먼저 골라 주세요/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
