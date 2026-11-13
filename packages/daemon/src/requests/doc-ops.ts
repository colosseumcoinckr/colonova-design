import type { RequestHandlers, RouterDeps } from "./types.js";

type DocOpsDeps = Pick<RouterDeps, "docOps">;

type DocOpRequest = Extract<
  keyof RequestHandlers,
  "doc.op.preview" | "doc.trash" | "doc.restore" | "doc.copy" | "doc.move" | "doc.trashed"
>;

/**
 * 문서 관리 요청 — DocOps 로 잇는다(2026-10-23 · 최종 구현 계획 F4 · 작업 D1a).
 * 목록 복구 · 복제 · 위치 변경 · 휴지통 이동의 여섯 문이다.
 */
export function docOpHandlers(deps: DocOpsDeps): RequestHandlers<DocOpRequest> {
  const docOps = deps.docOps;
  return {
    "doc.op.preview": (message) =>
      message.parentId === undefined
        ? docOps.preview(message.op, message.pageId)
        : docOps.preview(message.op, message.pageId, message.parentId),
    "doc.trash": (message) =>
      docOps.trash({ pageId: message.pageId, commandId: message.commandId }),
    "doc.restore": (message) =>
      docOps.restore({ pageId: message.pageId, commandId: message.commandId }),
    "doc.copy": (message) =>
      docOps.copy({
        pageId: message.pageId,
        commandId: message.commandId,
        title: message.title,
        parentId: message.parentId,
      }),
    "doc.move": (message) =>
      docOps.move({
        pageId: message.pageId,
        commandId: message.commandId,
        parentId: message.parentId,
      }),
    "doc.trashed": () => ({ entries: docOps.trashed() }),
  };
}
