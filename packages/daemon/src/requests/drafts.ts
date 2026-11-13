import { join } from "node:path";
import { appendCompareDecline } from "../plan-compare.js";
import { PLAN_REFS_LIMIT, readPlanRefs, recentPlanRefs } from "../plan-refs.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type DraftDeps = Pick<RouterDeps, "drafts" | "registry" | "screenSync" | "fleet">;

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
    // 같이 고치기(2026-10-30) — 되돌리기는 활성 프로젝트의 기록, 문서 고르기는 그 대화의 프로젝트다.
    "draft.syncUndo": (message) => {
      const slug = deps.registry.activeSlug();
      if (slug === null) throw new Error("프로젝트를 먼저 골라 주세요.");
      return deps.screenSync.undo(slug, message.entryId);
    },
    "draft.syncPick": (message) => {
      const slug = deps.fleet.workspaceOfSession(message.sessionId)?.slug ?? null;
      if (slug === null)
        throw new Error("이 대화의 프로젝트를 찾지 못했어요 — 대화를 다시 열어 주세요.");
      return deps.screenSync.pick(slug, message.sessionId, message.requestId, message.pageId);
    },
    // 같이 고치기 게이트(2026-11-03 A안 1A-1 · 1A-2) — 곁줄 카드의 고치기 · 건너뛰기 · 다시 시도. 그 대화의 프로젝트다.
    "draft.syncApply": (message) =>
      deps.screenSync.apply(
        sessionSlug(deps, message.sessionId),
        message.sessionId,
        message.requestId,
        message.docKey,
      ),
    "draft.syncSkip": (message) =>
      deps.screenSync.skip(
        sessionSlug(deps, message.sessionId),
        message.sessionId,
        message.requestId,
        message.docKey,
      ),
    "draft.syncRetry": (message) =>
      deps.screenSync.retry(
        sessionSlug(deps, message.sessionId),
        message.sessionId,
        message.requestId,
      ),
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
      drafts.ask(
        message.docKey,
        message.text,
        message.refs,
        {
          ...(message.model !== undefined ? { model: message.model } : {}),
          ...(message.effort !== undefined ? { effort: message.effort } : {}),
        },
        message.threadId,
      ),
    "draft.cancel": (message) => drafts.cancel(message.docKey),
    // 골라 읽는 대화(2026-11-03) — 목록 줄이 옛 대화를 다시 연다.
    "draft.thread": (message) => drafts.thread(message.docKey, message.threadId),
    // 기획 대화 목록 · 옮기기 · 지우기 · 이름 바꾸기(2026-10-31 3단계 · 2026-11-03 이름) — 사이드바 위 묶음이 쓴다.
    "draft.threads": () => drafts.threadsList(),
    "draft.threadMove": (message) => drafts.moveThread(message.threadId, message.docKey),
    "draft.threadDelete": (message) => drafts.deleteThread(message.threadId),
    "draft.threadRename": (message) => drafts.renameThread(message.threadId, message.title),
    "draft.adopt": (message) =>
      drafts.adopt(message.docKey, message.proposalId, message.opIds, message.expectedRevision),
    "draft.reject": (message) =>
      message.opIds === undefined
        ? drafts.reject(message.docKey, message.proposalId)
        : drafts.reject(message.docKey, message.proposalId, message.opIds),
    // 바로 반영의 되돌리기와 판 고르기(2026-10-31 2단계).
    "draft.undo": (message) => drafts.undoProposal(message.docKey, message.proposalId),
    "draft.revisions": (message) => drafts.revisions(message.docKey),
    "draft.revision": (message) => drafts.revision(message.docKey, message.revision),
    "draft.revisionRestore": (message) => drafts.restoreRevision(message.docKey, message.revision),
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
    // 화면과 맞춰 보기(2026-11-02 · 같이 고치기 UX 계획 C7 · C8) — 판정만 돌고 어디에도 쓰지 않는다.
    "draft.compare": (message) => drafts.compare(message.pageId),
    "draft.compareDecline": (message) => {
      const slug = deps.registry.activeSlug();
      if (slug === null) throw new Error("프로젝트를 먼저 골라 주세요.");
      appendCompareDecline(
        deps.registry.paths(slug).root,
        message.pageId,
        message.screenName,
        new Date().toISOString(),
      );
      return { ok: true };
    },
    "draft.syncDocs": (message) => drafts.syncDocs(message.sessionId),
    // 화면 제안 판정의 다시 시도(2026-11-03 A안 1A-2).
    "draft.mismatchRetry": (message) => drafts.mismatchRetry(message.docKey, message.messageId),
    "draft.syncScreens": (message) => drafts.syncScreens(message.pageId),
  };
}

/** 그 대화의 프로젝트 — 없으면 사람 말로 거절한다(문서 고르기와 같은 규칙). */
function sessionSlug(deps: DraftDeps, sessionId: string): string {
  const slug = deps.fleet.workspaceOfSession(sessionId)?.slug ?? null;
  if (slug === null)
    throw new Error("이 대화의 프로젝트를 찾지 못했어요 — 대화를 다시 열어 주세요.");
  return slug;
}
