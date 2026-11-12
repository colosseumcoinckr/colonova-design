import type {
  DocBlock,
  DraftBlock,
  DraftCompareResult,
  DraftSnapshot,
} from "@colonova-design/protocol";
import type { Daemon } from "../../lib/daemon-client.ts";
import { routePath } from "../lib/follow-edit.ts";

export type PlanSource = "linked" | "refs" | "changed";

export interface PlanRow {
  key: string;
  source: PlanSource;
  pageId: string | null;
  docKey: string | null;
  title: string;
  section: string | null;
  synced?: { changes: number; sections: string[] };
}

export type PlanBody =
  | { kind: "draft"; pageId: string | null; title: string; blocks: DraftBlock[] }
  | { kind: "imported"; pageId: string; blocks: readonly DocBlock[] | null; markdown: string };

/** 최신 초안과 가져온 본문은 서로 대신하지 않는다(2026-11-11 화면 탭 검토). */
export function planTarget(
  row: Pick<PlanRow, "docKey" | "pageId">,
): { docKey: string } | { pageId: string } {
  if (row.docKey !== null) return { docKey: row.docKey };
  if (row.pageId !== null) return { pageId: row.pageId };
  throw new Error("Missing document target");
}

/** 비교에 쓴 초안이 연결 줄의 원문보다 우선한다. */
export function comparePlanTarget(
  row: Pick<PlanRow, "docKey" | "pageId">,
  comparedDocKey: string | null,
): { docKey: string } | { pageId: string } {
  return planTarget({ docKey: comparedDocKey ?? row.docKey, pageId: row.pageId });
}

/** 찾을 문서가 아직 없으면 기다리고, 열린 뒤 같은 보기 요청을 재소비하지 않는다. */
export function createPlanFocusConsumer() {
  let consumed: number | null = null;
  return {
    consume(nonce: number, found: boolean) {
      if (!found || (consumed !== null && nonce <= consumed)) return false;
      consumed = nonce;
      return true;
    },
  };
}

export async function readPlanBody(
  api: Pick<Daemon["api"], "draftGet" | "docRead">,
  row: Pick<PlanRow, "docKey" | "pageId">,
): Promise<PlanBody> {
  const target = planTarget(row);
  if ("docKey" in target) {
    const draft = await api.draftGet(target.docKey);
    return { kind: "draft", pageId: draft.pageId, title: draft.title, blocks: draft.blocks };
  }
  const read = await api.docRead(target.pageId);
  return {
    kind: "imported",
    pageId: target.pageId,
    blocks: read.view ?? null,
    markdown: read.markdown,
  };
}

/** 성공한 출처는 남기고 실패한 출처를 따로 알린다. 화면을 모르면 연결은 읽지 않는다. */
export async function readPlanSources(
  api: Pick<Daemon["api"], "mapRead" | "draftRefs" | "draftSyncDocs">,
  screenRoute: string | null,
  sessionId: string | null,
): Promise<{ rows: PlanRow[]; failed: PlanSource[] }> {
  const [map, refs, synced] = await Promise.allSettled([
    screenRoute === null ? Promise.resolve(null) : api.mapRead(),
    sessionId === null ? Promise.resolve({ refs: [] }) : api.draftRefs(sessionId),
    sessionId === null ? Promise.resolve({ docs: [] }) : api.draftSyncDocs(sessionId),
  ]);
  const rows: PlanRow[] = [];
  const failed: PlanSource[] = [];
  const seen = new Set<string>();
  const push = (row: PlanRow) => {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    rows.push(row);
  };
  if (synced.status === "rejected") failed.push("changed");
  else {
    for (const doc of synced.value.docs) {
      push({
        key: `sync:${doc.docKey}`,
        source: "changed",
        pageId: doc.pageId,
        docKey: doc.docKey,
        title: doc.title,
        section: doc.sections[0] ?? null,
        synced: { changes: doc.changes, sections: doc.sections },
      });
    }
  }
  if (map.status === "rejected") failed.push("linked");
  else if (map.value !== null && screenRoute !== null) {
    const here = routePath(screenRoute);
    for (const link of map.value.links) {
      if (routePath(link.route) !== here) continue;
      push({
        key: `map:${link.pageId}:${link.route}:${link.section ?? ""}`,
        source: "linked",
        pageId: link.pageId,
        docKey: null,
        title: map.value.docs.find((doc) => doc.pageId === link.pageId)?.title ?? link.pageId,
        section: link.section,
      });
    }
  }
  if (refs.status === "rejected") failed.push("refs");
  else {
    for (const entry of refs.value.refs) {
      push({
        key: `ref:${entry.ref.pageId ?? ""}:${entry.ref.docKey ?? ""}`,
        source: "refs",
        pageId: entry.ref.pageId,
        docKey: entry.ref.docKey,
        title: entry.ref.title,
        section: entry.ref.sections[0] ?? null,
      });
    }
  }
  return { rows, failed };
}

/** 새 요청과 취소는 이전 요청의 성공 · 실패를 모두 무효로 만든다. */
export function createPlanRequest() {
  let generation = 0;
  return {
    begin() {
      const started = ++generation;
      return () => started === generation;
    },
    cancel() {
      generation++;
    },
  };
}

/** 비교 시작부터 대상 초안을 추적한다. 기존 문서의 열쇠는 데몬의 compare와 같은 p-pageId다. */
export function createPlanComparison() {
  const request = createPlanRequest();
  let target: Pick<PlanRow, "docKey" | "pageId"> | null = null;
  let comparedDocKey: string | null = null;
  const cancel = () => {
    request.cancel();
    target = null;
    comparedDocKey = null;
  };
  return {
    cancel,
    begin(row: Pick<PlanRow, "docKey" | "pageId">) {
      const isCurrent = request.begin();
      target = row;
      comparedDocKey = null;
      return {
        isCurrent,
        async read(read: () => Promise<DraftCompareResult>) {
          const result = await read();
          if (!isCurrent()) return null;
          comparedDocKey = result.docKey;
          return result;
        },
      };
    },
    onDraftChanged(docKey: string) {
      if (
        target === null ||
        (target.docKey !== docKey &&
          comparedDocKey !== docKey &&
          (target.pageId === null || docKey !== `p-${target.pageId}`))
      )
        return false;
      cancel();
      return true;
    },
  };
}

/** 받는 입력창의 수신 확인 뒤에만 성공이다. 기다리는 동안 자리를 옮겼으면 보내지 않는다. */
export async function sendPlanReference({
  api,
  row,
  isCurrent,
  offer,
}: {
  api: Pick<Daemon["api"], "draftSnapshot">;
  row: Pick<PlanRow, "docKey" | "pageId">;
  isCurrent: () => boolean;
  offer: (snapshot: DraftSnapshot) => boolean;
}): Promise<"attached" | "unavailable" | "failed" | "stale"> {
  try {
    const snapshot = await api.draftSnapshot(planTarget(row));
    if (!isCurrent()) return "stale";
    return offer(snapshot) ? "attached" : "unavailable";
  } catch {
    return isCurrent() ? "failed" : "stale";
  }
}
