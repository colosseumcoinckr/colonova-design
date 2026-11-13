import type { RequestHandlers, RouterDeps } from "./types.js";

type DocCommentsDeps = Pick<RouterDeps, "docComments">;

type DocCommentRequest = Extract<
  keyof RequestHandlers,
  "doc.comment.create" | "doc.comment.reply" | "doc.comment.update" | "doc.comment.resolve"
>;

/**
 * 문서 코멘트 요청 — DocComments 로 잇는다(2026-10-23 · 최종 구현 계획 F4 · 작업 D2a).
 * 만들기 · 답글 · 수정 · 해결의 네 문이다. 게이트 · 범위 · 판 대조는 서비스의 몫이다.
 */
export function docCommentHandlers(deps: DocCommentsDeps): RequestHandlers<DocCommentRequest> {
  const comments = deps.docComments;
  return {
    "doc.comment.create": (message) =>
      comments.create({
        pageId: message.pageId,
        commandId: message.commandId,
        text: message.text,
        anchor: message.anchor,
      }),
    "doc.comment.reply": (message) =>
      comments.reply({
        pageId: message.pageId,
        commandId: message.commandId,
        parentId: message.parentId,
        kind: message.kind,
        text: message.text,
      }),
    "doc.comment.update": (message) =>
      comments.update({
        pageId: message.pageId,
        commandId: message.commandId,
        commentId: message.commentId,
        kind: message.kind,
        version: message.version,
        text: message.text,
      }),
    "doc.comment.resolve": (message) =>
      comments.resolve({
        pageId: message.pageId,
        commandId: message.commandId,
        commentId: message.commentId,
        version: message.version,
        resolved: message.resolved,
      }),
  };
}
