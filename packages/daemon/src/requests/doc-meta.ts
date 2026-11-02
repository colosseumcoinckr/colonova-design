import { DocMeta } from "../doc-meta.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type DocMetaDeps = Pick<RouterDeps, "registry" | "machineSetting" | "credentials" | "logger">;

type DocMetaRequest = Extract<
  keyof RequestHandlers,
  | "doc.attachment.read"
  | "doc.label.add"
  | "doc.label.remove"
  | "doc.versions"
  | "doc.version.read"
  | "doc.search"
  | "doc.blockPreview"
>;

/**
 * 문서의 곁 요청 — 첨부 읽기 · 라벨 · 판 기록 · 본문 찾기 · 보존 블록 그림(2026-10-30 사용자 요청).
 * 서비스는 라우터와 함께 한 번 만든다 — 첨부 목록의 짧은 기억이 요청 사이에 산다. 게이트 · 범위 ·
 * 기록은 서비스의 몫이다.
 */
export function docMetaHandlers(deps: DocMetaDeps): RequestHandlers<DocMetaRequest> {
  const meta = new DocMeta({
    registry: deps.registry,
    machineSetting: deps.machineSetting,
    credentials: deps.credentials,
    logger: deps.logger,
  });
  return {
    "doc.attachment.read": (message) => meta.attachment(message.pageId, message.filename),
    "doc.label.add": (message) =>
      meta.labelAdd({ pageId: message.pageId, commandId: message.commandId, label: message.label }),
    "doc.label.remove": (message) =>
      meta.labelRemove({
        pageId: message.pageId,
        commandId: message.commandId,
        label: message.label,
      }),
    "doc.versions": (message) => meta.versions(message.pageId),
    "doc.version.read": (message) => meta.versionRead(message.pageId, message.version),
    "doc.search": (message) => meta.search(message.query),
    "doc.blockPreview": (message) => meta.blockPreviews(message.docKey),
  };
}
