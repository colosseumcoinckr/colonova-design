/**
 * 기획서 원장 (2026-10-18 기획서 동기화 · 계획 항목 9) — `docs/plans/confluence.json` 이
 * 사는 모양과 읽기 · 쓰기. 설계 문서(docs/confluence-sync-design-2026-10-18.md)의
 * 예시 그대로다.
 *
 * 어디서 끊겨도 다음 시작이 이어받는다(cycle-ledger.ts 계약): parse 는 절대 던지지
 * 않고, 모르는 필드는 무시하고, 깨진 값은 버린다. 쓰기는 원자적이다 — 반쯤 적힌
 * 원장이 온전한 것으로 서면 안 된다(machine-setting.ts 의 set 과 같은 규칙).
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConfluenceSection } from "./confluence-markdown.js";

export interface ConfluenceLedgerPage {
  /** docs/plans 아래 상대 경로 — 트리 걷기마다 다시 계산된다(id 는 불변 · 실측). 이동은 시작 걷기가 잡는다. */
  path: string;
  title: string;
  version: number;
  sections: ConfluenceSection[];
  comments: { unresolved: number } | null;
}

/** Confluence 폴더 — 본문 없는 계층. 경로와 제목만 산다(2026-10-23 최종 구현 계획 F0). */
export interface ConfluenceLedgerFolder {
  path: string;
  title: string;
}

/** 앱이 본문을 읽지 않는 종류 — 화이트보드 · 데이터베이스 · 임베드 · 모르는 종류(2026-10-23 최종 구현 계획 F0). */
export interface ConfluenceLedgerUnsupported {
  path: string;
  title: string;
  type: string;
}

export interface ConfluenceLedger {
  site: string;
  roots: string[];
  lastSyncAt: string | null;
  pages: Record<string, ConfluenceLedgerPage>;
  /** Confluence 폴더 — 본문 없는 계층(2026-10-23 최종 구현 계획 F0). */
  folders: Record<string, ConfluenceLedgerFolder>;
  /** 본문을 읽지 않는 종류 — 화이트보드 · 데이터베이스 · 임베드 · 모르는 종류. */
  unsupported: Record<string, ConfluenceLedgerUnsupported>;
}

/** 빈 원장 — 사이트를 아직 모르면 빈 문자열이다. */
export function emptyConfluenceLedger(site?: string): ConfluenceLedger {
  return { site: site ?? "", roots: [], lastSyncAt: null, pages: {}, folders: {}, unsupported: {} };
}

// ————— 관용 읽기 도우미 — 깨진 값은 버리고, 절대 던지지 않는다 —————

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

/** 절 목록 — 제목이 문자열이고 매크로 표식이 참 · 거짓인 것만 산다. */
function parseSections(raw: unknown): ConfluenceSection[] {
  if (!Array.isArray(raw)) return [];
  const sections: ConfluenceSection[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (record === null) continue;
    const heading = asString(record.heading);
    if (heading === null || typeof record.macro !== "boolean") continue;
    sections.push({ heading, macro: record.macro });
  }
  return sections;
}

/** 안 풀린 코멘트 수 — 모양이 아니면 없는 것이다(null). */
function parseComments(raw: unknown): { unresolved: number } | null {
  const record = asRecord(raw);
  const unresolved = record === null ? null : asInt(record.unresolved);
  if (record === null || unresolved === null || unresolved < 0) return null;
  return { unresolved };
}

/** 문서 한 항목 — 경로와 판이 신원이다. 하나라도 깨졌으면 항목 전체를 버린다. */
function parsePage(raw: unknown): ConfluenceLedgerPage | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const path = asString(record.path);
  const version = asInt(record.version);
  if (path === null || path === "" || version === null) return null;
  return {
    path,
    title: asString(record.title) ?? "",
    version,
    sections: parseSections(record.sections),
    comments: parseComments(record.comments),
  };
}

/** 폴더 한 항목 — 경로가 신원이다. 경로가 빈 글이면 버린다(2026-10-23 최종 구현 계획 F0). */
function parseFolder(raw: unknown): ConfluenceLedgerFolder | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const path = asString(record.path);
  if (path === null || path === "") return null;
  return { path, title: asString(record.title) ?? "" };
}

/** 미지원 종류 한 항목 — 경로와 종류가 신원이다. 하나라도 빈 글이면 버린다. */
function parseUnsupported(raw: unknown): ConfluenceLedgerUnsupported | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const path = asString(record.path);
  const type = asString(record.type);
  if (path === null || path === "" || type === null || type === "") return null;
  return { path, title: asString(record.title) ?? "", type };
}

/** 모르는 모양 · 깨진 필드는 버리고 나머지를 살린다 — 절대 던지지 않는다. */
export function parseConfluenceLedger(raw: unknown): ConfluenceLedger {
  const record = asRecord(raw);
  if (record === null) return emptyConfluenceLedger();
  const pages: Record<string, ConfluenceLedgerPage> = {};
  const rawPages = asRecord(record.pages);
  if (rawPages !== null) {
    for (const [id, value] of Object.entries(rawPages)) {
      if (id === "") continue;
      const page = parsePage(value);
      if (page !== null) pages[id] = page;
    }
  }
  // 옛 원장은 두 맵이 없다 — 없거나 깨져도 빈 맵으로 내려앉는다(2026-10-23 최종 구현 계획 F0).
  const parseEntries = <T>(raw: unknown, pick: (value: unknown) => T | null) => {
    const entries: Record<string, T> = {};
    const source = asRecord(raw);
    if (source === null) return entries;
    for (const [id, value] of Object.entries(source)) {
      if (id === "") continue;
      const entry = pick(value);
      if (entry !== null) entries[id] = entry;
    }
    return entries;
  };
  const lastSyncAt = asString(record.lastSyncAt);
  return {
    site: asString(record.site) ?? "",
    roots: Array.isArray(record.roots)
      ? record.roots.filter((root): root is string => typeof root === "string")
      : [],
    lastSyncAt: lastSyncAt !== null && lastSyncAt !== "" ? lastSyncAt : null,
    pages,
    folders: parseEntries(record.folders, parseFolder),
    unsupported: parseEntries(record.unsupported, parseUnsupported),
  };
}

/** 없거나 깨진 파일은 빈 원장 — 시작이 실패할 이유가 아니다(cycle-ledger 와 같은 길). */
export function readConfluenceLedger(file: string): ConfluenceLedger {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return emptyConfluenceLedger();
  }
  try {
    return parseConfluenceLedger(JSON.parse(raw));
  } catch {
    return emptyConfluenceLedger();
  }
}

/** 원자 쓰기 — 임시 파일을 쓰고 바꿔치기 한다. 실패하면 임시 파일을 지운다. */
export function writeConfluenceLedger(file: string, ledger: ConfluenceLedger): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.colonova-design-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
