import type { SessionPinHint } from "@colonova-design/protocol";
import type { Attachment } from "../../lib/attachment";

/**
 * `다시 시도` 가 첨부를 되살리는 판정(2026-10-06 UX 점검). 대화 기록의 사용자 턴에는 첨부의 바이트가
 * 없다 — 그림은 개수(`images`), 파일은 이름(`files`)뿐이고 핀의 찍은 그림만 라이브 에코로 남는다.
 * 그래서 다시 시도가 말만 다시 보내면, 사진을 붙여 보낸 말이 사진 없이 가서 AI 가 없는 그림을
 * 어림짐작했다. 보낸 쪽이 원본을 쥐고 있다가(`useSessions.sentOriginal`) 짝이 맞으면 그대로 다시 보내고,
 * 짝이 없는데 되살릴 수 없는 첨부가 있으면 말만 입력창에 돌려주고 다시 붙이게 한다.
 */

/** 보낼 때의 원본 — 글 · 첨부(바이트) · 핀. 세션마다 마지막 하나만 쥔다. */
export interface SentOriginal {
  text: string;
  attachments: Attachment[];
  pins?: Array<{ screen: string }>;
  pinHints?: SessionPinHint[];
}

/** 대화 기록의 사용자 턴에서 판정이 읽는 몫. */
export interface SendShape {
  text: string;
  images: number;
  files?: string[];
}

export type RetryPlan =
  /** 보낼 때의 원본이 짝이 맞는다 — 글 · 첨부 · 핀을 그대로 다시 보낸다. */
  | { kind: "replay"; original: SentOriginal }
  /** 잃는 첨부가 없다 — 기록이 가진 몫(핀의 찍은 그림 · 표식)으로 다시 짠다. */
  | { kind: "rebuild" }
  /** 되살릴 수 없는 첨부가 `lost` 개 있다 — 말은 입력창으로 돌려주고 다시 붙이게 한다. */
  | { kind: "putBack"; lost: number };

/** 첫 줄 — 데몬이 핀 턴 가운데에 `파일 후보:` 를 얹어도 표식이 있는 첫 줄은 그대로다. */
function firstLine(text: string): string {
  return text.trimStart().split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function imageCount(attachments: readonly Attachment[]): number {
  return attachments.filter((attachment) => attachment.kind === "image").length;
}

/** 쥐고 있는 원본이 이 보내기의 것인가 — 첨부 개수와 첫 줄이 같아야 한다(다른 창이 같은 대화에 보낸 말을 막는다). */
function matches(send: SendShape, original: SentOriginal): boolean {
  return (
    imageCount(original.attachments) === send.images &&
    original.attachments.length - imageCount(original.attachments) === (send.files?.length ?? 0) &&
    firstLine(original.text) === firstLine(send.text)
  );
}

/**
 * 다시 시도의 길. `restoredShots` 는 기록이 되살릴 수 있는 그림의 수(핀의 찍은 그림) —
 * 원본이 없을 때 이만큼은 잃지 않는다.
 */
export function planRetry(
  send: SendShape,
  original: SentOriginal | null,
  restoredShots: number,
): RetryPlan {
  if (original !== null && matches(send, original)) return { kind: "replay", original };
  const lost = Math.max(0, send.images - restoredShots) + (send.files?.length ?? 0);
  return lost > 0 ? { kind: "putBack", lost } : { kind: "rebuild" };
}

/** 쥐는 원본의 바이트 상한 — 넘으면 쥐지 않는다(되살리기가 입력창으로 돌려주는 길로 물러난다). */
export const SENT_ORIGINAL_MAX_BYTES = 40 * 1024 * 1024;

/** 원본의 크기 — base64 글자 수가 곧 메모리다. */
export function sentOriginalBytes(original: SentOriginal): number {
  return original.attachments.reduce((sum, attachment) => sum + attachment.data.length, 0);
}
