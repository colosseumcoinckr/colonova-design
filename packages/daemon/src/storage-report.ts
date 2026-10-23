/**
 * G2 읽기 판정 보고(2026-10-23 · 최종 구현 계획 G2) — 저장 포맷 문서 하나 · 폴더를 블록 엔진으로
 * 재어 숫자만 낸다. 본문 글 · 제목 · 사람 이름은 결과에 담지 않고, 예외는 삼켜 사유 이름으로
 * 남긴다(던지지 않는다). 사람이 scripts/plans-g2-check.mjs 로 직접 돌리는 몫이다.
 */
import { type DraftBlockView, draftStageOf } from "@colonova-design/protocol";
import {
  parseStorage,
  projectBlock,
  renderBlock,
  type StorageBlock,
  type StorageBlockKind,
  type StorageDoc,
  serializeStorage,
} from "./storage-blocks.js";

/** 검사 한 줄 — 통과 여부와 실패 사유 이름만 둔다. */
export interface ReportCheck {
  ok: boolean;
  /** 실패했을 때만 사유 이름(엔진의 거절 사유 · 예외 이름) — 통과면 null. */
  reason: string | null;
}

/** 문서 하나의 판정 — 종류 · 사유 · 토큰 · 매크로는 숫자와 기계 이름뿐이다. */
export interface StorageReport {
  bytes: number;
  blocks: number;
  byKind: Record<StorageBlockKind, number>;
  /** 보존 전용 블록 수와 사유별 수(macro:info · table:merged · list:nested …) — 엔진의 라벨 그대로. */
  preserved: { total: number; byReason: Record<string, number> };
  /** 레이아웃 섹션 수 — ac:layout 의 칸 묶음을 문서 전체로 센다. */
  layoutSections: number;
  /** 인라인 토큰 라벨별 수(macro:info · image · link:page · comment-anchor …). */
  tokens: Record<string, number>;
  /** 매크로 이름별 수 — 보존 블록 · 인라인 토큰 모두. 이름 없는 매크로는 element:ac:structured-macro 로 센다. */
  macros: Record<string, number>;
  /** parse → serialize 가 원문과 바이트까지 같은가. */
  roundTrip: ReportCheck;
  /** 편집 가능한 블록마다 투영 그대로 되돌리면 원문과 같은가 — 실패한 블록 수를 센다. */
  noopRender: { ok: boolean; failed: number; reason: string | null };
  /** 편집 가능한 문단 하나 끝에 합성 글자를 더하면 그 블록만 바뀌는가. */
  isolatedEdit: ReportCheck;
}

/** 폴더 보고서의 문서 한 줄 — titles 를 끄면 제목 · 표기 자리가 null 이 된다. */
export interface FolderDocumentReport {
  pageId: string;
  title: string | null;
  /** 제목의 업무 단계 표기(draftStageOf 의 notation) — 못 읽으면 null. */
  stage: string | null;
  report: StorageReport;
}

export interface FolderReport {
  documents: FolderDocumentReport[];
  totals: {
    documents: number;
    bytes: number;
    blocks: number;
    byKind: Record<StorageBlockKind, number>;
    preserved: { total: number; byReason: Record<string, number> };
    tokens: Record<string, number>;
    macros: Record<string, number>;
    /** 검사 통과 문서 수 — 문서 수와 같으면 전부 통과다. */
    checks: { roundTrip: number; noopRender: number; isolatedEdit: number };
    /** 큰 문서 상위 5개 — 크기만 비교한다. */
    largest: Array<{ pageId: string; title: string | null; bytes: number }>;
  };
}

/** 격리 편집 검사에 더하는 합성 글자 — 문서의 글이 아니다. */
const EDIT_MARK = "Z";

const KINDS: StorageBlockKind[] = ["heading", "paragraph", "list", "table", "preserved"];

const emptyKindCounts = (): Record<StorageBlockKind, number> => ({
  heading: 0,
  paragraph: 0,
  list: 0,
  table: 0,
  preserved: 0,
});

/** 예외를 사유 이름으로 바꾼다 — 예외 문구(글이 들어 있다)는 남기지 않는다. 세 검사가 같은 길을 간다. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : "unknown-error";
}

/** 매크로 라벨의 이름 앞표지 — 보존 라벨 · 토큰 라벨의 모양이 같다. */
const MACRO_LABEL = "macro:";
/** 이름 없는 매크로의 기계 라벨 — 이름 대신 이 라벨로 센다. */
const UNNAMED_MACRO_LABEL = "element:ac:structured-macro";

export function reportStorage(xml: string): StorageReport {
  const byKind = emptyKindCounts();
  const preservedByReason: Record<string, number> = {};
  const tokens: Record<string, number> = {};
  const macros: Record<string, number> = {};
  const sectionIds: Record<string, true> = {};
  let blocks = 0;

  let doc: StorageDoc | null = null;
  let roundTrip: ReportCheck;
  try {
    doc = parseStorage(xml);
    roundTrip =
      serializeStorage(doc) === xml
        ? { ok: true, reason: null }
        : { ok: false, reason: "round-trip-mismatch" };
  } catch (error) {
    roundTrip = { ok: false, reason: reasonOf(error) };
  }

  let noopFailures = 0;
  let noopReason: string | null = null;
  if (doc !== null) {
    for (const block of doc.blocks) {
      blocks += 1;
      byKind[block.kind] += 1;
      const section = /^L(\d+)\./.exec(block.slot)?.[1];
      if (section !== undefined) sectionIds[section] = true;
      const labels: string[] = []; // 보존 사유 · 토큰 라벨 — 매크로 이름은 이 가운데서 고른다
      try {
        const proj = projectBlock(block);
        if (!proj.editable) {
          const label = proj.view.kind === "preserved" ? proj.view.label : "preserved";
          preservedByReason[label] = (preservedByReason[label] ?? 0) + 1;
          labels.push(label);
        }
        for (const label of Object.values(proj.tokens)) {
          tokens[label] = (tokens[label] ?? 0) + 1;
          labels.push(label);
        }
        if (proj.editable) {
          const rendered = renderBlock(block, proj.view);
          if (!rendered.ok) {
            noopFailures += 1;
            noopReason ??= rendered.reason;
          } else if (rendered.xml !== block.xml) {
            noopFailures += 1;
            noopReason ??= "render-mismatch";
          }
        }
        for (const label of labels) {
          const macro = label.startsWith(MACRO_LABEL)
            ? label.slice(MACRO_LABEL.length)
            : label === UNNAMED_MACRO_LABEL
              ? UNNAMED_MACRO_LABEL
              : null;
          if (macro !== null) macros[macro] = (macros[macro] ?? 0) + 1;
        }
      } catch (error) {
        noopFailures += 1;
        noopReason ??= reasonOf(error);
      }
    }
    // 칸 자리는 frame 에도 있다 — 블록이 없는 빈 칸의 섹션도 센다(2026-10-23 · G2).
    for (const piece of doc.frame) {
      if (!("slot" in piece)) continue;
      const section = /^L(\d+)\./.exec(piece.slot)?.[1];
      if (section !== undefined) sectionIds[section] = true;
    }
  }

  return {
    bytes: Buffer.byteLength(xml, "utf8"),
    blocks,
    byKind,
    preserved: {
      total: Object.values(preservedByReason).reduce((sum, count) => sum + count, 0),
      byReason: preservedByReason,
    },
    layoutSections: Object.keys(sectionIds).length,
    tokens,
    macros,
    roundTrip,
    noopRender: { ok: noopFailures === 0, failed: noopFailures, reason: noopReason },
    isolatedEdit: isolatedEditCheck(doc),
  };
}

/** 편집 가능한 문단 하나 끝에 합성 글자를 더해 다른 블록의 바이트가 그대로인지 본다. */
function isolatedEditCheck(doc: StorageDoc | null): ReportCheck {
  if (doc === null) return { ok: false, reason: "parse-failed" };
  let target: StorageBlock | null = null;
  let textView: Extract<DraftBlockView, { kind: "paragraph" }> | null = null;
  for (const block of doc.blocks) {
    try {
      const proj = projectBlock(block);
      if (proj.editable && proj.view.kind === "paragraph") {
        target = block;
        textView = proj.view;
        break;
      }
    } catch {}
  }
  if (target === null || textView === null) {
    return { ok: false, reason: "no-editable-paragraph" };
  }
  const edited: DraftBlockView = { kind: "paragraph", text: textView.text + EDIT_MARK };
  try {
    const rendered = renderBlock(target, edited);
    if (!rendered.ok) return { ok: false, reason: rendered.reason };
    if (rendered.xml === target.xml) return { ok: false, reason: "isolated-edit-inert" };
    const after: StorageDoc = {
      frame: doc.frame,
      blocks: doc.blocks.map((block) =>
        block.id === target.id ? { ...block, xml: rendered.xml } : block,
      ),
    };
    const reparsed = parseStorage(serializeStorage(after));
    const changedOnly =
      reparsed.blocks.length === doc.blocks.length &&
      reparsed.blocks.every((block, i) => {
        const before = doc.blocks[i];
        if (before === undefined) return false;
        if (block.id !== before.id || block.slot !== before.slot || block.kind !== before.kind) {
          return false;
        }
        return block.id === target.id ? block.xml === rendered.xml : block.xml === before.xml;
      });
    return changedOnly ? { ok: true, reason: null } : { ok: false, reason: "isolated-edit-leak" };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

export function reportFolder(
  entries: Array<{ pageId: string; title: string; xml: string }>,
  opts: { titles: boolean },
): FolderReport {
  const documents: FolderDocumentReport[] = entries.map((entry) => ({
    pageId: entry.pageId,
    title: opts.titles ? entry.title : null,
    stage: opts.titles ? draftStageOf(entry.title).notation : null,
    report: reportStorage(entry.xml),
  }));
  const totals: FolderReport["totals"] = {
    documents: documents.length,
    bytes: 0,
    blocks: 0,
    byKind: emptyKindCounts(),
    preserved: { total: 0, byReason: {} },
    tokens: {},
    macros: {},
    checks: { roundTrip: 0, noopRender: 0, isolatedEdit: 0 },
    largest: [],
  };
  for (const document of documents) {
    const report = document.report;
    totals.bytes += report.bytes;
    totals.blocks += report.blocks;
    for (const kind of KINDS) totals.byKind[kind] += report.byKind[kind];
    totals.preserved.total += report.preserved.total;
    for (const [reason, count] of Object.entries(report.preserved.byReason)) {
      totals.preserved.byReason[reason] = (totals.preserved.byReason[reason] ?? 0) + count;
    }
    for (const [label, count] of Object.entries(report.tokens)) {
      totals.tokens[label] = (totals.tokens[label] ?? 0) + count;
    }
    for (const [name, count] of Object.entries(report.macros)) {
      totals.macros[name] = (totals.macros[name] ?? 0) + count;
    }
    if (report.roundTrip.ok) totals.checks.roundTrip += 1;
    if (report.noopRender.ok) totals.checks.noopRender += 1;
    if (report.isolatedEdit.ok) totals.checks.isolatedEdit += 1;
  }
  totals.largest = [...documents]
    .sort((a, b) => b.report.bytes - a.report.bytes)
    .slice(0, 5)
    .map((document) => ({
      pageId: document.pageId,
      title: document.title,
      bytes: document.report.bytes,
    }));
  return { documents, totals };
}
