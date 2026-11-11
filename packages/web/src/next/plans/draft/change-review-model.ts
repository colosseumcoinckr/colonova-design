import type { DraftBlock } from "@colonova-design/protocol";

export interface DraftChangeRow {
  id: string;
  kind: "same" | "changed" | "inserted" | "deleted";
  before?: DraftBlock;
  after?: DraftBlock;
  moved: boolean;
  beforePosition: number | null;
  afterPosition: number | null;
}

/** 삽입·삭제 때문에 밀린 자리는 이동으로 세지 않는다(2026-11-11 초안 검토 개선). */
export function draftChangeRows(base: DraftBlock[], blocks: DraftBlock[]): DraftChangeRow[] {
  const before = new Map(base.map((block, index) => [block.id, { block, index }]));
  const afterIds = new Set(blocks.map((block) => block.id));
  const sharedBefore = base.filter((block) => afterIds.has(block.id));
  const sharedAfter = blocks.filter((block) => before.has(block.id));
  const oldOrder = new Map(sharedBefore.map((block, index) => [block.id, index]));
  const newOrder = new Map(sharedAfter.map((block, index) => [block.id, index]));
  const rows: DraftChangeRow[] = blocks.map((block, index) => {
    const old = before.get(block.id);
    const moved = old !== undefined && oldOrder.get(block.id) !== newOrder.get(block.id);
    const changed =
      old !== undefined &&
      (block.status !== "same" ||
        JSON.stringify(old.block.view) !== JSON.stringify(block.view) ||
        JSON.stringify(old.block.tokens) !== JSON.stringify(block.tokens));
    return {
      id: block.id,
      kind: old === undefined ? "inserted" : changed || moved ? "changed" : "same",
      before: old?.block,
      after: block,
      moved,
      beforePosition: old === undefined ? null : old.index + 1,
      afterPosition: index + 1,
    };
  });
  for (const [id, old] of before) {
    if (!afterIds.has(id))
      rows.push({
        id,
        kind: "deleted",
        before: old.block,
        moved: false,
        beforePosition: old.index + 1,
        afterPosition: null,
      });
  }
  return rows;
}
