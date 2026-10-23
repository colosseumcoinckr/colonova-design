import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type ConfluenceLedger,
  emptyConfluenceLedger,
  parseConfluenceLedger,
  readConfluenceLedger,
  writeConfluenceLedger,
} from "../dist/confluence-ledger.js";

/**
 * 기획서 원장 (2026-10-18 기획서 동기화 · 계획 항목 9) — 절반만 적힌 원장 · 잘못된
 * 타입 · 빈 파일을 읽어도 시작이 막히지 않고 아는 것만 살린다(cycle-ledger 계약).
 * 파일은 임시 폴더에서만 왕복한다.
 */

test("절반만 적힌 원장 — 아는 것부터 이어받는다", () => {
  const parsed = parseConfluenceLedger({
    site: "https://colosseum.atlassian.net",
    roots: ["933068815"],
    pages: { "1818591273": { path: "COLO/8.8-ColoNova/SSoT", version: 1 } },
  });
  assert.equal(parsed.site, "https://colosseum.atlassian.net");
  assert.deepEqual(parsed.roots, ["933068815"]);
  assert.equal(parsed.lastSyncAt, null);
  // 두 맵이 없는 옛 원장 — 빈 맵으로 내려앉는다(2026-10-23 최종 구현 계획 F0).
  assert.deepEqual(parsed.folders, {});
  assert.deepEqual(parsed.unsupported, {});
  assert.deepEqual(parsed.pages, {
    "1818591273": {
      path: "COLO/8.8-ColoNova/SSoT",
      title: "",
      version: 1,
      sections: [],
      comments: null,
    },
  });
});

test("잘못된 타입 필드 — 깨진 값은 버리고 나머지는 산다", () => {
  const parsed = parseConfluenceLedger({
    site: 7,
    roots: ["933068815", 12, null],
    lastSyncAt: 99,
    미래: { 아무거나: true },
    pages: {
      하나: {
        path: "COLO/루트",
        title: "제목",
        version: 2,
        sections: [
          { heading: "절", macro: false },
          { heading: 3, macro: false },
          { heading: "깨진", macro: "예" },
        ],
        comments: { unresolved: 2 },
      },
      판이문자열: { path: "a/b", title: "제목", version: "3" },
      모양아님: "그냥 문자열",
      길없음: { version: 4 },
    },
    // 폴더 · 미지원 종류 — 경로 · 종류가 빈 글이거나 모양이 아니면 버린다(2026-10-23 최종 구현 계획 F0).
    folders: {
      살아남은: { path: "COLO/루트/화면 목록", title: "화면 목록" },
      길없는: { title: "제목만" },
      빈길: { path: "", title: "빈 길" },
      모양아님: "문자열",
    },
    unsupported: {
      살아남은보드: { path: "COLO/루트/보드", title: "보드", type: "whiteboard" },
      종류없는: { path: "COLO/루트/몰라", title: "몰라" },
      빈종류: { path: "COLO/루트/몰라", title: "몰라", type: "" },
      모양아님: 7,
    },
  });
  assert.equal(parsed.site, "");
  assert.deepEqual(parsed.roots, ["933068815"]);
  assert.equal(parsed.lastSyncAt, null);
  assert.deepEqual(parsed.pages, {
    하나: {
      path: "COLO/루트",
      title: "제목",
      version: 2,
      sections: [{ heading: "절", macro: false }],
      comments: { unresolved: 2 },
    },
  });
  assert.deepEqual(parsed.folders, {
    살아남은: { path: "COLO/루트/화면 목록", title: "화면 목록" },
  });
  assert.deepEqual(parsed.unsupported, {
    살아남은보드: { path: "COLO/루트/보드", title: "보드", type: "whiteboard" },
  });
});

test("사본 밖 경로 — 절대 경로와 `..` · `.` 조각은 조용히 버린다", () => {
  const parsed = parseConfluenceLedger({
    site: "https://colosseum.atlassian.net",
    roots: ["933068815"],
    lastSyncAt: "2026-10-18T00:40:00Z",
    pages: {
      산다: { path: "COLO/8.8 ColoNova/SSoT", title: "SSoT", version: 1 },
      상위로: { path: "../바깥", title: "바깥", version: 1 },
      절대: { path: "/etc/passwd", title: "절대", version: 1 },
      온점조각: { path: "COLO/./루트", title: "온점", version: 1 },
    },
    folders: {
      산다폴더: { path: "COLO/루트/화면 목록", title: "화면 목록" },
      역슬래시: { path: "..\\바깥폴더", title: "바깥" },
    },
    unsupported: {
      산다보드: { path: "COLO/루트/보드", title: "보드", type: "whiteboard" },
      절대보드: { path: "\\Windows\\보드", title: "보드", type: "whiteboard" },
    },
  });
  // 증분 쓰기와 거두기가 원장의 path 를 그대로 join 하므로 읽을 때 걸러낸다
  // (2026-10-23 · 기획서 사본 이동 계획 · 오케스트레이터 검토 R2).
  assert.deepEqual(Object.keys(parsed.pages), ["산다"]);
  assert.deepEqual(parsed.folders, {
    산다폴더: { path: "COLO/루트/화면 목록", title: "화면 목록" },
  });
  assert.deepEqual(parsed.unsupported, {
    산다보드: { path: "COLO/루트/보드", title: "보드", type: "whiteboard" },
  });
});

test("빈 값 · 널 · 배열 — 모두 빈 원장으로 내려앉는다", () => {
  for (const raw of [null, undefined, "", "문자열", [], 0, true]) {
    assert.deepEqual(parseConfluenceLedger(raw), emptyConfluenceLedger());
  }
  assert.equal(emptyConfluenceLedger("https://x.atlassian.net").site, "https://x.atlassian.net");
});

test("lastSyncAt — 유효한 문자열이면 그대로 산다(이어받기)", () => {
  assert.equal(
    parseConfluenceLedger({ lastSyncAt: "2026-10-18T00:40:00Z" }).lastSyncAt,
    "2026-10-18T00:40:00Z",
  );
  // 빈 문자열은 이어받을 시각이 아니다.
  assert.equal(parseConfluenceLedger({ lastSyncAt: "" }).lastSyncAt, null);
});

test("왕복 — 쓴 원장을 그대로 읽는다(깊은 폴더도 만든다)", () => {
  const dir = mkdtempSync(join(tmpdir(), "confluence-ledger-"));
  try {
    const file = join(dir, "docs", "plans", "confluence.json");
    const ledger: ConfluenceLedger = {
      site: "https://colosseum.atlassian.net",
      roots: ["933068815"],
      lastSyncAt: "2026-10-18T00:40:00Z",
      pages: {
        "1818591273": {
          path: "COLO/8.8-ColoNova/SSoT",
          title: "콜로노바 데이터 모델",
          version: 1,
          sections: [{ heading: "도메인 지도", macro: false }],
          comments: { unresolved: 2 },
        },
      },
      // 폴더 · 미지원 종류도 원장의 한 몸이다(2026-10-23 최종 구현 계획 F0).
      folders: {
        F: { path: "COLO/8.8-ColoNova/화면 목록", title: "화면 목록" },
      },
      unsupported: {
        B: { path: "COLO/8.8-ColoNova/보드", title: "흐름 보드", type: "whiteboard" },
      },
    };
    writeConfluenceLedger(file, ledger);
    assert.deepEqual(readConfluenceLedger(file), ledger);
    // 원자 쓰기 — 임시 파일 권한 그대로 바꿔치기 된 흔적이다.
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("없는 파일 · 깨진 JSON · 빈 파일 — 빈 원장으로 시작한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "confluence-ledger-"));
  try {
    assert.deepEqual(readConfluenceLedger(join(dir, "confluence.json")), emptyConfluenceLedger());
    const broken = join(dir, "broken.json");
    writeFileSync(broken, '{ "site": "https://x", "roo'); // 반쯤 적힌 원장
    assert.deepEqual(readConfluenceLedger(broken), emptyConfluenceLedger());
    const empty = join(dir, "empty.json");
    writeFileSync(empty, "");
    assert.deepEqual(readConfluenceLedger(empty), emptyConfluenceLedger());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
