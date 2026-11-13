import type { DraftBlock } from "@colonova-design/protocol";
import { Markdown } from "../../../components/Markdown";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { DocPreview } from "../view/DocView";
import { viewToMarkdown } from "./draft-model";

/** 초안 검토와 화면 곁 읽기가 보존 블록 · 토큰을 같은 방식으로 보여 준다. */
export function DraftReadBlock({
  block,
  api,
  pageId,
}: {
  block: DraftBlock;
  api: Daemon["api"];
  pageId: string | null;
}) {
  if (block.view.kind === "preserved") {
    return (
      <>
        <p>{L.drafts.tokenLabel(block.view.label)}</p>
        {block.preview !== undefined && block.preview.length > 0 && (
          <DocPreview blocks={block.preview} api={api} pageId={pageId ?? ""} />
        )}
      </>
    );
  }
  const tokens = Object.fromEntries(
    Object.entries(block.tokens).map(([key, value]) => [key, L.drafts.tokenLabel(value)]),
  );
  return (
    <Markdown
      text={viewToMarkdown(block.view, block.tokens)}
      tokens={tokens}
      machineTokens={block.tokens}
    />
  );
}
