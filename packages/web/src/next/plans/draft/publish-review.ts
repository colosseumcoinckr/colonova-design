import type { DraftPublishPreview, DraftRevisionView, DraftView } from "@colonova-design/protocol";
import { L } from "../../labels.ts";

interface ReviewApi {
  draftPublishPreview: (docKey: string) => Promise<DraftPublishPreview>;
  draftRevision: (docKey: string, revision: number) => Promise<DraftRevisionView>;
  draftGet: (docKey: string) => Promise<DraftView>;
}

/** 기준을 읽은 뒤 현재 개정을 대조한다. 확인 도중 바뀐 초안은 발행 대상으로 내보내지 않는다. */
export async function loadPublishReview(api: ReviewApi, docKey: string) {
  const preview = await api.draftPublishPreview(docKey);
  const base = preview.kind === "create" ? null : await api.draftRevision(docKey, 0);
  const draft = await api.draftGet(docKey);
  if (
    preview.docKey !== docKey ||
    draft.docKey !== docKey ||
    (base !== null && base.docKey !== docKey) ||
    draft.revision !== preview.draftRevision ||
    draft.baseVersion !== preview.baseVersion
  ) {
    throw new Error(L.drafts.publishReviewChanged);
  }
  return { preview, base, draft };
}
