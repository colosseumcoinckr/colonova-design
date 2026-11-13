import assert from "node:assert/strict";
import { test } from "node:test";
import { compareScope, getOnlyTransport } from "../dist/scope-report.js";

/**
 * G0 실측 대조의 순수 시험(2026-10-23 · 계획 §13 G0) — 합성 id · 합성 종류만 쓴다.
 * 폴더 아래 문서의 CQL 빠짐 · 원장 차이 · 종류별 수 · 미완 · 상한 표시와 GET 전용
 * 감싸개, 보고에 제목이 남지 않음을 본다.
 */

test("폴더 아래 문서가 CQL 에 없으면 폴더 아래 · CQL 빠짐으로 센다", () => {
  const report = compareScope({
    walk: [
      { id: "100", type: "page", parentId: null },
      { id: "101", type: "page", parentId: "100" },
      { id: "200", type: "folder", parentId: "100" },
      { id: "210", type: "folder", parentId: "200" },
      { id: "102", type: "page", parentId: "200" },
      { id: "103", type: "page", parentId: "210" },
      { id: "104", type: "page", parentId: "100" },
    ],
    cql: [{ id: "100" }, { id: "101" }],
    ledger: null,
    walkComplete: true,
    pagesTruncated: false,
  });
  // 폴더 아래 폴더 아래의 문서(103)도 조상 사슬의 폴더로 잡힌다.
  assert.deepEqual(report.missingFromCql, [
    { id: "102", underFolder: true },
    { id: "103", underFolder: true },
    { id: "104", underFolder: false },
  ]);
  assert.equal(report.missingUnderFolder, 2);
  assert.equal(report.missingDirect, 1);
  assert.equal(report.ledgerCompared, false);
  assert.deepEqual(report.onlyInLedger, []);
  assert.deepEqual(report.onlyInWalk, []);
});

test("걷기의 종류별 수 — 다섯 종류와 그 밖을 센다", () => {
  const report = compareScope({
    walk: [
      { id: "1", type: "page", parentId: null },
      { id: "2", type: "folder", parentId: "1" },
      { id: "3", type: "whiteboard", parentId: "1" },
      { id: "4", type: "database", parentId: "1" },
      { id: "5", type: "embed", parentId: "1" },
      { id: "6", type: "widget", parentId: "1" },
    ],
    cql: [],
    ledger: null,
    walkComplete: false,
    pagesTruncated: true,
  });
  assert.deepEqual(report.walkCounts, {
    page: 1,
    folder: 1,
    whiteboard: 1,
    database: 1,
    embed: 1,
    other: 1,
  });
  // 모르는 종류는 그 밖으로 세기도 하고, 미완 · 상한 표시는 그대로 실린다.
  assert.equal(report.walkComplete, false);
  assert.equal(report.pagesTruncated, true);
});

test("원장과 걷기의 차이 — 원장에만 · 걷기에만으로 갈라진다", () => {
  const report = compareScope({
    walk: [
      { id: "1", type: "page", parentId: null },
      { id: "2", type: "page", parentId: "1" },
      { id: "3", type: "folder", parentId: "1" },
    ],
    cql: [{ id: "1" }, { id: "2" }],
    ledger: [
      { id: "1", path: "SYN/1" },
      { id: "9", path: "SYN/9" },
    ],
    walkComplete: true,
    pagesTruncated: false,
  });
  assert.equal(report.ledgerCompared, true);
  assert.deepEqual(report.onlyInLedger, ["9"]);
  assert.deepEqual(report.onlyInWalk, ["2", "3"]);
});

test("CQL 에만 있는 문서 — 부모가 걷기에 있는지 함께 적는다", () => {
  const report = compareScope({
    walk: [
      { id: "1", type: "page", parentId: null },
      { id: "2", type: "page", parentId: "1" },
    ],
    cql: [{ id: "2" }, { id: "7" }, { id: "8", parentId: "1" }, { id: "9", parentId: "40" }],
    ledger: null,
    walkComplete: true,
    pagesTruncated: false,
  });
  // 걷기에 있는 2 는 CQL 에만 있는 것이 아니다. 부모를 알려주지 않은 7 은 모름(null)이다.
  assert.deepEqual(report.cqlOnly, [
    { id: "7", parentInWalk: null },
    { id: "8", parentInWalk: true },
    { id: "9", parentInWalk: false },
  ]);
});

test("보고에 합성 제목 · 원장 경로의 글자가 남지 않는다", () => {
  const report = compareScope({
    walk: [{ id: "1", type: "page", parentId: null }],
    cql: [{ id: "1" }],
    ledger: [{ id: "1", path: "SYN/합성-문서-이름-가나다" }],
    walkComplete: true,
    pagesTruncated: false,
  });
  const text = JSON.stringify(report);
  assert.equal(text.includes("합성-문서-이름-가나다"), false);
  assert.equal(text.includes("SYN"), false);
});

test("GET 전용 감싸개 — PUT · POST · DELETE 는 보내기 전에 던지고 GET 은 통과한다", async () => {
  const sentUrls = [];
  const inner = {
    request: async (input) => {
      sentUrls.push(input.url);
      return { status: 200, body: new Uint8Array(0) };
    },
  };
  const guarded = getOnlyTransport(inner);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    await assert.rejects(
      guarded.request({ method, url: "/wiki/api/v2/pages/1", headers: {} }),
      /읽기 전용 전송/,
    );
  }
  // 보내기 전에 던진다 — 상대에는 아무것도 나가지 않았다.
  assert.deepEqual(sentUrls, []);
  const response = await guarded.request({
    method: "GET",
    url: "/wiki/rest/api/user/current",
    headers: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(sentUrls, ["/wiki/rest/api/user/current"]);
});
