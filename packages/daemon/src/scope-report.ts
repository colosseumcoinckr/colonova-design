/**
 * G0 실측의 순수 대조(2026-10-23 · 계획 §13 G0) — 트리 걷기 · 뿌리 아래 CQL · 원장의
 * id · 종류 · 부모 관계를 맞대본다. 제목 · 본문은 여기까지 오지 않는다 — 보고에 남는
 * 것은 id 와 종류 · 수뿐이다. 걷기의 문서 중 CQL 에 빠진 것은 조상 사슬에 폴더가
 * 있는지로 가른다 — 「폴더 아래 문서가 뿌리 아래로 좁힌 CQL 증분에 잡히는가」 가 이
 * 대조의 질문이다. GET 이 아닌 요청을 보내기 전에 던지는 감싸개도 여기 산다 — 실측
 * 껍데기(scripts/plans-g0-check.mjs)가 읽기 전용임을 코드로 보이게 하려는 것이다.
 */

import type { RestTransport } from "./rest-transport.js";

/** 걷기의 한 줄 — 목록의 id · 종류 · 부모. 뿌리의 부모는 없다(null). */
export interface ScopeWalkEntry {
  id: string;
  type: string;
  parentId: string | null;
}

/** CQL 결과의 한 줄 — 검색이 부모를 알려주지 않으면 parentId 는 없다. */
export interface ScopeCqlEntry {
  id: string;
  parentId?: string;
}

/** 원장의 한 줄 — 원장의 경로는 대조에 쓰지 않는다(보고에 경로도 남지 않는다). */
export interface ScopeLedgerEntry {
  id: string;
  path: string;
}

/** 종류별 수 — 걷기가 본 다섯 종류와 그 밖. */
export interface ScopeWalkCounts {
  page: number;
  folder: number;
  whiteboard: number;
  database: number;
  embed: number;
  other: number;
}

/** 대조 보고 — id 와 종류 · 수만 있다(제목 · 본문 · 경로 없음). */
export interface ScopeReport {
  /** 걷기가 빠짐없이 끝났는가 — 못 읽은 갈래 · 모르는 종류가 하나라도 있으면 거짓이다. */
  walkComplete: boolean;
  /** CQL 페이지네이션이 따라가는 쪽 상한에 닿았는가 — 닿으면 CQL 쪽 수가 적을 수 있다. */
  pagesTruncated: boolean;
  /** 걷기가 본 문서의 종류별 수. */
  walkCounts: ScopeWalkCounts;
  /**
   * 걷기의 페이지 중 CQL 에 없는 것(걷기 순서). underFolder — 조상 사슬에 폴더가 있다.
   * 폴더 아래인데 CQL 에 없는 문서가 증분의 사각지대 후보다(§13 G0 의 질문).
   */
  missingFromCql: Array<{ id: string; underFolder: boolean }>;
  /** 폴더 아래인데 CQL 에 없는 페이지 수. */
  missingUnderFolder: number;
  /** 폴더 아래가 아닌데(뿌리 자신 · 뿌리 바로 아래) CQL 에 없는 페이지 수. */
  missingDirect: number;
  /** CQL 에만 있는 페이지 — 걷기가 못 본 것(이동 · 권한 · 범위 밖의 후보). parentInWalk — CQL 행이 부모를 알려줄 때 그 부모가 걷기에 있는가. */
  cqlOnly: Array<{ id: string; parentInWalk: boolean | null }>;
  /** 원장에만 있는 항목 — 걷기에 없다. 이동 · 삭제 · 권한 변화의 후보(원장 순서). */
  onlyInLedger: string[];
  /** 걷기에만 있는 항목 — 원장에 없다. 아직 가져오지 못한 문서(걷기 순서). */
  onlyInWalk: string[];
  /** 원장을 받아 대조했는가 — 원장 없이 돌면 거짓이고 두 차이는 빈 배열이다. */
  ledgerCompared: boolean;
}

/**
 * 세 벌의 목록을 맞대본다. CQL 은 `type=page` 의 답이므로 CQL 대소는 페이지만 친다 —
 * 폴더 · 화이트보드가 CQL 에 없는 것은 예상한 것이다. 원장은 문서 id 만 맞대본다
 * (페이지 · 폴더 · 미지원 종류를 묶어 넘겨도 좋다).
 */
export function compareScope(input: {
  walk: ScopeWalkEntry[];
  cql: ScopeCqlEntry[];
  ledger: ScopeLedgerEntry[] | null;
  walkComplete: boolean;
  pagesTruncated: boolean;
}): ScopeReport {
  const walkCounts: ScopeWalkCounts = {
    page: 0,
    folder: 0,
    whiteboard: 0,
    database: 0,
    embed: 0,
    other: 0,
  };
  const parents = new Map<string, string | null>();
  const types = new Map<string, string>();
  const walkIds = new Set<string>();
  for (const entry of input.walk) {
    walkIds.add(entry.id);
    parents.set(entry.id, entry.parentId);
    types.set(entry.id, entry.type);
    if (entry.type === "page") walkCounts.page += 1;
    else if (entry.type === "folder") walkCounts.folder += 1;
    else if (entry.type === "whiteboard") walkCounts.whiteboard += 1;
    else if (entry.type === "database") walkCounts.database += 1;
    else if (entry.type === "embed") walkCounts.embed += 1;
    else walkCounts.other += 1;
  }
  // 조상 사슬에 폴더가 있는지 — 부모를 뿌리까지 거슬러 본다. 사슬이 고리에 빠지는
  // 잘못된 목록에도 멈추지 않게 본 사이는 다시 보지 않는다.
  const underFolder = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let parent = parents.get(id) ?? null;
    while (parent !== null && !seen.has(parent)) {
      seen.add(parent);
      if (types.get(parent) === "folder") return true;
      parent = parents.get(parent) ?? null;
    }
    return false;
  };
  const cqlIds = new Set(input.cql.map((entry) => entry.id));
  const missingFromCql: Array<{ id: string; underFolder: boolean }> = [];
  let missingUnderFolder = 0;
  let missingDirect = 0;
  for (const entry of input.walk) {
    if (entry.type !== "page" || cqlIds.has(entry.id)) continue;
    const folderBelow = underFolder(entry.id);
    missingFromCql.push({ id: entry.id, underFolder: folderBelow });
    if (folderBelow) missingUnderFolder += 1;
    else missingDirect += 1;
  }
  const cqlOnly = input.cql
    .filter((entry) => !walkIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      parentInWalk: entry.parentId === undefined ? null : walkIds.has(entry.parentId),
    }));
  const ledger = input.ledger;
  // 원장이 없으면 대조한 것이 아니다 — 두 차이도 없는 것이다.
  const ledgerIds = new Set((ledger ?? []).map((entry) => entry.id));
  const onlyInLedger =
    ledger === null
      ? []
      : ledger.filter((entry) => !walkIds.has(entry.id)).map((entry) => entry.id);
  const onlyInWalk =
    ledger === null
      ? []
      : input.walk.filter((entry) => !ledgerIds.has(entry.id)).map((entry) => entry.id);
  return {
    walkComplete: input.walkComplete,
    pagesTruncated: input.pagesTruncated,
    walkCounts,
    missingFromCql,
    missingUnderFolder,
    missingDirect,
    cqlOnly,
    onlyInLedger,
    onlyInWalk,
    ledgerCompared: ledger !== null,
  };
}

/**
 * GET 전용 감싸개 — GET 이 아닌 요청은 상대에게 보내기 전에 던진다. 실측 껍데기가
 * 어떤 일이 있어도 쓰기를 보내지 않음을 코드로 보이는 장치다(§13 G0 — 읽기만 한다).
 */
export function getOnlyTransport(transport: RestTransport): RestTransport {
  return {
    async request(input) {
      if (input.method !== "GET") {
        throw new Error(`읽기 전용 전송입니다 — ${input.method} 요청은 보내지 않습니다.`);
      }
      return await transport.request(input);
    },
  };
}
