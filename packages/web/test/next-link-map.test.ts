import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-plans.test.ts 와 같은 모양).
import {
  buildMapGraph,
  connectionToAdd,
  docGroupKey,
  edgeIdToChange,
  type MapLink,
  type MapScreen,
  mapEdgeId,
  screenGroupKey,
} from "../src/next/plans/map/map-groups.ts";
import type { PlanDoc } from "../src/next/plans/plans-list.ts";

/**
 * 연결 지도의 순수 조립 시험(F6 2조각 · 계획 §7 ④) — 그림을 세우는 노드 배치와 연결 열쇠,
 * 끌기 잇기의 방향 판정을 리액트 없이 잰다. 컴포넌트 렌더 시험은 만들지 않는다.
 */

const doc = (path: string, title: string, pageId = title): PlanDoc => ({
  path,
  title,
  version: 1,
  pageId,
});

const screen = (route: string, title: string | null): MapScreen => ({
  route,
  title,
  observed: title !== null,
});

const link = (
  pageId: string,
  route: string,
  section: string | null = null,
  note: string | null = null,
): MapLink => ({ pageId, route, section, note, createdAt: null });

test("묶음 이름 — 문서는 path 의 둘째 마디, 화면은 route 의 첫 마디", () => {
  assert.equal(docGroupKey("PROD/[TD] WMS/출고 목록 정책서"), "[TD] WMS");
  // 둘째 마디가 없으면 공간 키 자체가 묶음이다.
  assert.equal(docGroupKey("PROD"), "PROD");
  assert.equal(screenGroupKey("/setting/user-management"), "/setting");
  // 홈(`/`)은 그 자체가 묶음이다.
  assert.equal(screenGroupKey("/"), "/");
});

test("연결 열쇠 — 세 마디를 줄바꿈으로 잇고 되돌린다", () => {
  assert.equal(mapEdgeId("p1", "/wms/outbound", null), "p1\n/wms/outbound\n");
  assert.equal(mapEdgeId("p1", "/wms/outbound", "사용자 등록"), "p1\n/wms/outbound\n사용자 등록");
  assert.deepEqual(edgeIdToChange("p1\n/wms/outbound\n"), {
    op: "remove",
    pageId: "p1",
    route: "/wms/outbound",
  });
  assert.deepEqual(edgeIdToChange("p1\n/wms/outbound\n사용자 등록"), {
    op: "remove",
    pageId: "p1",
    route: "/wms/outbound",
    section: "사용자 등록",
  });
  // 열쇠 말고 다른 그림은 무시한다.
  assert.equal(edgeIdToChange("p1"), null);
  assert.equal(edgeIdToChange("p1\n"), null);
  assert.equal(edgeIdToChange("\n/wms/outbound\n"), null);
});

test("그림 세우기 — 왼쪽 문서 · 오른쪽 화면을 묶음 순서로 세로로 세운다", () => {
  const { nodes, edges } = buildMapGraph({
    docs: [
      doc("PROD/[TD] WMS/입고", "입고", "p2"),
      doc("PROD/[TD] WMS/출고", "출고", "p1"),
      doc("PROD/[TD] 기본/사용자", "사용자", "p3"),
    ],
    screens: [
      screen("/wms/outbound", "출고 목록"),
      screen("/setting/user-management", null),
      screen("/wms/inbound", null),
    ],
    links: [link("p1", "/wms/outbound"), link("p2", "/wms/inbound", "재고 확인", "바코드 표")],
  });
  const ids = nodes.map((node) => node.id);
  // 묶음 이름 순서 — [TD] WMS 묶음이 [TD] 기본 묶음보다 먼저다.
  assert.ok(ids.indexOf("dgroup:[TD] WMS") < ids.indexOf("dgroup:[TD] 기본"));
  // 같은 데이터 → 같은 그림: 두 번 세워도 자리가 같다.
  const again = buildMapGraph({
    docs: [
      doc("PROD/[TD] WMS/입고", "입고", "p2"),
      doc("PROD/[TD] WMS/출고", "출고", "p1"),
      doc("PROD/[TD] 기본/사용자", "사용자", "p3"),
    ],
    screens: [
      screen("/wms/outbound", "출고 목록"),
      screen("/setting/user-management", null),
      screen("/wms/inbound", null),
    ],
    links: [link("p1", "/wms/outbound"), link("p2", "/wms/inbound", "재고 확인", "바코드 표")],
  });
  assert.deepEqual(again.nodes, nodes);
  assert.deepEqual(again.edges, edges);
  // 문서는 왼쪽(DOC_X), 화면은 오른쪽(SCREEN_X) 칸에 선다.
  const docNode = nodes.find((node) => node.id === "doc:p1");
  const screenNode = nodes.find((node) => node.id === "screen:/wms/inbound");
  assert.ok(docNode && docNode.x < (screenNode?.x ?? Infinity));
  // 화면 이름표 — 관찰 제목이 없으면 route 글자 그대로.
  assert.equal(screenNode?.label, "/wms/inbound");
  assert.equal(nodes.find((node) => node.id === "screen:/wms/outbound")?.label, "출고 목록");
  // 제목이 있는 화면 점은 아래 줄에 경로를 적는다(2026-10-24 사용자 요청). 제목이 없으면 경로가 이름표라 줄이 없다.
  assert.equal(nodes.find((node) => node.id === "screen:/wms/outbound")?.sub, "/wms/outbound");
  assert.equal(screenNode?.sub, undefined);
  // 연결의 이름표 — note, 없으면 section.
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  assert.equal(byId.get("p1\n/wms/outbound\n")?.label, null);
  assert.equal(byId.get("p2\n/wms/inbound\n재고 확인")?.label, "바코드 표");
});

test("그림 세우기 — 없어진 끝은 각 칸 맨 아래 점으로 세워 끊는 길을 남긴다", () => {
  const { nodes, edges } = buildMapGraph({
    docs: [doc("PROD/[TD] WMS/출고", "출고", "p1")],
    screens: [screen("/wms/outbound", "출고 목록")],
    links: [link("p9", "/gone/screen"), link("p1", "/wms/outbound")],
  });
  assert.ok(nodes.some((node) => node.id === "gonedoc:p9" && node.kind === "goneDoc"));
  assert.ok(
    nodes.some((node) => node.id === "gonescreen:/gone/screen" && node.kind === "goneScreen"),
  );
  // 없어진 끝으로 선이 닿는다 — 고르면 끊을 수 있다.
  assert.ok(edges.some((edge) => edge.id === "p9\n/gone/screen\n" && edge.source === "gonedoc:p9"));
  // 같은 칸의 맨 아래 — 문서 칸의 어떤 점보다 아래에 선다.
  const docYs = nodes
    .filter((node) => node.kind === "doc" || node.kind === "docGroup")
    .map((node) => node.y);
  const goneY = nodes.find((node) => node.id === "gonedoc:p9")?.y ?? -1;
  assert.ok(docYs.every((y) => goneY >= y));
});

test("빈 지도 — 연결이 0이어도 점은 선다", () => {
  const { nodes, edges } = buildMapGraph({
    docs: [doc("PROD/A/가", "가", "p1")],
    screens: [],
    links: [],
  });
  assert.deepEqual(edges, []);
  assert.ok(nodes.some((node) => node.id === "doc:p1"));
  assert.ok(!nodes.some((node) => node.kind === "goneDoc"));
});

test("끌기 잇기 판정 — 문서에서 화면으로 갈 때만 add 다", () => {
  const { nodes } = buildMapGraph({
    docs: [doc("PROD/[TD] WMS/출고", "출고", "p1")],
    screens: [screen("/wms/outbound", "출고 목록")],
    links: [link("p9", "/gone")],
  });
  // 옳은 방향 — 문서의 오른쪽 손잡이에서 화면의 왼쪽 손잡이로.
  assert.deepEqual(connectionToAdd({ source: "doc:p1", target: "screen:/wms/outbound" }, nodes), {
    op: "add",
    pageId: "p1",
    route: "/wms/outbound",
  });
  // 방향이 반대다.
  assert.equal(connectionToAdd({ source: "screen:/wms/outbound", target: "doc:p1" }, nodes), null);
  // 같은 쪽끼리다.
  assert.equal(connectionToAdd({ source: "doc:p1", target: "doc:p1" }, nodes), null);
  assert.equal(
    connectionToAdd({ source: "screen:/wms/outbound", target: "screen:/wms/outbound" }, nodes),
    null,
  );
  // 없어진 끝이나 묶음 이름표, 모르는 점이다.
  assert.equal(
    connectionToAdd({ source: "gonedoc:p9", target: "screen:/wms/outbound" }, nodes),
    null,
  );
  assert.equal(
    connectionToAdd({ source: "dgroup:[TD] WMS", target: "screen:/wms/outbound" }, nodes),
    null,
  );
  assert.equal(connectionToAdd({ source: null, target: "screen:/wms/outbound" }, nodes), null);
  assert.equal(connectionToAdd({ source: "doc:p1", target: null }, nodes), null);
});
