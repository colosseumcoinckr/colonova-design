import { readTurn } from "@colonova-design/protocol";
import type { Attachment } from "../../lib/attachment";
import type { Block, SessionView } from "../../lib/daemon-client";

export interface OutgoingSend {
  block: Extract<Block, { type: "user" }>;
  sessionId: string | null;
  slug: string | null;
  seen: number;
  bound: boolean;
}

// 옛 핀 본문에는 파일 후보가 붙을 수 있다. 화면에 보이는 표식만 견준다.
function sameSend(left: string, right: string): boolean {
  if (left === right) return true;
  const a = readTurn(left).marker;
  const b = readTurn(right).marker;
  return a?.kind === "comments" && b?.kind === "comments" && JSON.stringify(a) === JSON.stringify(b);
}

/** 같은 말을 연이어 보내도 지난 기록을 이번 수락으로 세지 않는다. */
export function countSend(view: SessionView | null | undefined, text: string): number {
  if (!view) return 0;
  return (
    view.blocks.filter((block) => block.type === "user" && sameSend(block.text, text)).length +
    view.queue.filter((item) => sameSend(item.text, text)).length
  );
}

export function outgoingBlock(
  id: string,
  text: string,
  attachments: readonly Pick<Attachment, "name" | "mediaType" | "data">[],
): OutgoingSend["block"] {
  return {
    type: "user",
    id,
    text,
    images: attachments.filter((part) => part.mediaType.startsWith("image/")).length,
    files: attachments.filter((part) => !part.mediaType.startsWith("image/")).map((part) => part.name),
    thumbs: attachments
      .filter((part) => part.mediaType === "image/jpeg")
      .slice(0, 6)
      .map((part) => part.data),
  };
}

/** 실제 기록이나 대기 줄이 오면 같은 그림에서 임시 말풍선을 거둔다(2026-10-20 사용자 제보). */
export function outgoingArrived(send: OutgoingSend, view: SessionView | null | undefined): boolean {
  return send.bound && countSend(view, send.block.text) > send.seen;
}
