import { useId } from "react";
import { L } from "../labels";
import type { HandoffPreview } from "../lib/handoff-preview";
import { Spin } from "../ui/icons";

/**
 * 제출 확인의 「개발자에게는 이렇게 보여요」(2026-10-07 UX 점검 3단계) — 개발자가 처음 읽는 제목과 설명. AI 가 쓴 글이라
 * 사용자가 고칠 길은 아래의 `한마디` 뿐이고, 상자의 마지막 줄이 그 길을 가리킨다. 이미 열린 요청에 더하는 제출은
 * 제목과 설명이 개발자의 것이라 바뀌지 않으므로 지금의 제목만 말한다.
 *
 * 읽는 중에는 줄 하나가 서고 제출을 막지 않는다. 보여 줄 글이 없으면 아무것도 서지 않는다.
 */
export function HandoffPreviewBox({
  more,
  openTitle,
  loading,
  preview,
}: {
  more: boolean;
  /** 이미 열린 요청의 지금 제목(종류 접두어를 뗀 것) — 모르면 null. */
  openTitle: string | null;
  loading: boolean;
  preview: HandoffPreview | null;
}) {
  const headId = useId();
  if (more) {
    if (openTitle === null || openTitle === "") return null;
    return (
      <section className="nx-sub-preview" aria-labelledby={headId}>
        <h3 className="nx-sub-h" id={headId}>
          {L.submitConfirm.previewMoreHead}
        </h3>
        <p className="nx-sub-pt">{openTitle}</p>
        <p className="nx-sub-pm">{L.submitConfirm.previewMoreHint}</p>
      </section>
    );
  }
  if (loading) {
    return (
      <div role="status" aria-busy="true" className="nx-sub-preview nx-sub-preview--load">
        <p className="nx-st-loadtext">
          <Spin />
          {L.submitConfirm.previewLoading}
        </p>
      </div>
    );
  }
  if (preview === null) return null;
  return (
    <section className="nx-sub-preview" aria-labelledby={headId}>
      <h3 className="nx-sub-h" id={headId}>
        {L.submitConfirm.previewHead}
      </h3>
      {preview.title !== "" && <p className="nx-sub-pt">{preview.title}</p>}
      {preview.summary !== null && <p className="nx-sub-ps">{preview.summary}</p>}
      <p className="nx-sub-pm">
        {preview.photos > 0 && `${L.submitConfirm.previewPhotos(preview.photos)} · `}
        {preview.by === "ai" ? L.submitConfirm.previewHint : L.submitConfirm.previewHintRequest}
      </p>
    </section>
  );
}
