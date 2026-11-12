/**
 * 어긋남 카드의 순수 재료(2026-11-02 · 같이 고치기 UX 계획 C7 · C8) — 사람이 읽는 말은 labels 의
 * `L.compare` 에만 둔다(문장 시험 `next-labels` · `vocab-sweep`). 여기는 줄의 열쇠와 손의 조립만 있다.
 */
import type { DraftMismatchRow } from "@colonova-design/protocol";
import type { Daemon } from "../../lib/daemon-client.ts";
import { attachEventDetail } from "../plans/doc-actions/doc-actions-model.ts";
import { COMPOSER_ATTACH_EVENT } from "./composer-attach.ts";

/** 어긋남 줄의 열쇠 — 카드가 줄을 지울 때 쓴다(절 · 화면 이름의 짝). */
export function mismatchRowKey(row: DraftMismatchRow): string {
  return `${row.section}\n${row.screenName}`;
}

/** 화면을 기획서대로의 손(C8 · C7 · `고쳐서 보내기`) — 문서를 근거로 붙이고 브리프를 입력창에
 * 미리 채운다. 받는 입력창이 없으면 false 를 돌려준다(보내기는 사람이다 — 여기서 보내지 않는다). */
export function offerMismatchToComposer(input: {
  api: Pick<Daemon["api"], "draftSnapshot">;
  brief: string;
  target: { pageId: string } | { docKey: string };
  /** 기다리는 동안 대화 · 프로젝트 · 화면을 옮겼으면 전달하지 않는다. */
  isCurrent?: () => boolean;
}): Promise<boolean> {
  return input.api
    .draftSnapshot(input.target)
    .then((snapshot) => {
      if (input.isCurrent?.() === false) return false;
      const offer = new CustomEvent(COMPOSER_ATTACH_EVENT, {
        cancelable: true,
        detail: { ...attachEventDetail(snapshot), text: input.brief },
      });
      // 받았다고 알리면(preventDefault) 이쪽에서는 끝 — 실제 보내기는 사람의 몫이다.
      return !window.dispatchEvent(offer);
    })
    .catch(() => false);
}

/** 누름=보내기의 결과 — `sent`: 입력창이 비어 브리프를 곧바로 보냄 · `prefilled`: 쓰던 말/첨부/핀이
 * 있어 미리 채우기로 떨어짐 · false: 받는 입력창이 없거나 근거 읽기 실패. */
export type MismatchSendResult = "sent" | "prefilled" | false;

/** 화면을 기획서대로의 누름=보내기(2026-11-03 A안 1A-1(b)) — 같은 길에 `send: true` 를 실어 보낸다.
 * 입력창이 완전히 비었을 때만 즉시 보내고(도는 중이면 대기 줄), 쓰던 말 · 첨부 · 핀이 있으면
 * 미리 채우기로 떨어진다 — 어느 쪽이 일어났는지는 입력창이 detail.sent 에 적어 돌려준다. */
export function sendMismatchNow(input: {
  api: Pick<Daemon["api"], "draftSnapshot">;
  brief: string;
  target: { pageId: string } | { docKey: string };
  isCurrent?: () => boolean;
}): Promise<MismatchSendResult> {
  return input.api
    .draftSnapshot(input.target)
    .then((snapshot) => {
      if (input.isCurrent?.() === false) return false;
      const detail: {
        attachments: Array<{ kind: "file"; name: string; mediaType: string; data: string }>;
        text: string;
        send: boolean;
        sent?: boolean;
      } = { ...attachEventDetail(snapshot), text: input.brief, send: true };
      const offer = new CustomEvent(COMPOSER_ATTACH_EVENT, {
        cancelable: true,
        detail,
      });
      // 받았다고 알리면(preventDefault) 처리기가 detail.sent 에 결과를 적어 돌려준다.
      if (window.dispatchEvent(offer)) return false;
      return detail.sent === true ? "sent" : "prefilled";
    })
    .catch(() => false);
}

/** 기획서를 화면대로의 손(C7) — 초안이 없으면 먼저 열고, 기획 대화로 브리프를 보낸다(바로 반영 · 되돌리기 가능). */
export async function applyMismatchToDraft(input: {
  api: Daemon["api"];
  brief: string;
  pageId: string;
  docKey: string | null;
}): Promise<void> {
  let docKey = input.docKey;
  if (docKey === null) {
    const opened = await input.api.draftOpen(input.pageId);
    docKey = opened.docKey;
  }
  await input.api.draftAsk(docKey, input.brief, []);
}
