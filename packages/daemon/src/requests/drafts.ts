import { join } from "node:path";
import { PLAN_REFS_LIMIT, readPlanRefs, recentPlanRefs } from "../plan-refs.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type DraftDeps = Pick<RouterDeps, "drafts" | "registry">;

type DraftRequest = Extract<keyof RequestHandlers, `draft.${string}`>;

/**
 * 기획 초안 요청 — 초안 서비스로 잇는다(2026-10-23 · 최종 구현 계획 F1 · 작업 B2). 개정이
 * 어긋난 저장 시도는 DraftStaleError 로 서버까지 그대로 오르고, 서버의 오류 답이 실은 코드
 * `draft.stale` 를 실어 나른다. `draft.refs` 만 서비스를 건너뛰고 plan-refs 의 기록을 곧장
 * 읽는다(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b).
 */
export function draftHandlers(deps: DraftDeps): RequestHandlers<DraftRequest> {
  const drafts = deps.drafts;
  return {
    "draft.list": () => drafts.list(),
    "draft.open": (message) => drafts.open(message.pageId),
    "draft.create": (message) =>
      drafts.create({
        title: message.title,
        parentId: message.parentId,
        parentType: message.parentType,
        ...(message.templatePageId !== undefined ? { templatePageId: message.templatePageId } : {}),
      }),
    "draft.get": (message) => drafts.get(message.docKey),
    "draft.edit": (message) => drafts.edit(message.docKey, message.expectedRevision, message.edits),
    "draft.discard": (message) => drafts.discard(message.docKey),
    "draft.ask": (message) =>
      drafts.ask(message.docKey, message.text, message.refs, {
        ...(message.model !== undefined ? { model: message.model } : {}),
        ...(message.effort !== undefined ? { effort: message.effort } : {}),
      }),
    "draft.cancel": (message) => drafts.cancel(message.docKey),
    "draft.thread": (message) => drafts.thread(message.docKey),
    "draft.adopt": (message) =>
      drafts.adopt(message.docKey, message.proposalId, message.opIds, message.expectedRevision),
    "draft.reject": (message) =>
      message.opIds === undefined
        ? drafts.reject(message.docKey, message.proposalId)
        : drafts.reject(message.docKey, message.proposalId, message.opIds),
    "draft.publish.preview": (message) => drafts.publishPreview(message.docKey),
    "draft.publish": (message) =>
      drafts.publish({
        docKey: message.docKey,
        commandId: message.commandId,
        expectedRevision: message.expectedRevision,
        ...(message.stage !== undefined ? { stage: message.stage } : {}),
      }),
    "draft.publish.recheck": (message) => drafts.publishRecheck(message.commandId),
    "draft.publish.close": (message) => drafts.publishClose(message.commandId),
    "draft.rebase": (message) => drafts.rebase(message.docKey),
    "draft.resolve": (message) => drafts.resolve(message.docKey, message.blockId, message.choice),
    "draft.snapshot": (message) =>
      drafts.snapshot({
        ...(message.pageId !== undefined ? { pageId: message.pageId } : {}),
        ...(message.docKey !== undefined ? { docKey: message.docKey } : {}),
        ...(message.sections !== undefined ? { sections: message.sections } : {}),
      }),
    "draft.refs": (message) => {
      // 화면 대화가 삼은 근거(2026-10-23 · 최종 구현 계획 F3) — 활성 프로젝트의 기록에서 그
      // 대화의 것만 최근 것이 앞으로. 기록이 없거나 깨진 줄은 빈 목록 — 돌아가는 안내가 목적이라
      // 던지지 않는다. 제목 · 판 · 절뿐이고 본문은 실리지 않는다.
      const slug = deps.registry.activeSlug();
      if (slug === null || slug === "") return { refs: [] };
      const file = join(deps.registry.paths(slug).root, "plans", "refs.jsonl");
      return { refs: recentPlanRefs(readPlanRefs(file, null), message.sessionId, PLAN_REFS_LIMIT) };
    },
  };
}
