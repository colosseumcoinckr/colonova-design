import type {
  DraftPublishPreview,
  DraftPublishResult,
  DraftRevisionView,
  DraftView,
} from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { linkClick } from "../../../lib/open-link";
import { L } from "../../labels";
import type { ShellNav } from "../../slots";
import { ExternalIcon, InfoIcon, Spin } from "../../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead } from "../../ui/ModalFrame";
import { docUrl } from "../plans-list";
import { DraftChanges } from "./DraftChanges";
import { DRAFT_LIMITS } from "./limits";
import {
  blockerLines,
  newCommandId,
  nextNotation,
  resultLine,
  stageInputNeeded,
} from "./publish-model";
import { loadPublishReview } from "./publish-review";

/**
 * 발행 확인 창(2026-10-23 · 최종 구현 계획 F2) — Confluence 에 반영하기 전에 무엇이 반영되는지
 * 보이는 한 장. 대상 · 제목 · 판 · 바뀜 · 지움 · 단계 표기를 보이고, 막는 이유마다 다음 행동을
 * 세운다. 공식본은 Confluence 다 — 이 창은 그 앞의 마지막 살피기다. 발행은 같은 명령으로 두 번
 * 눌리지 않게 잠그고, 결과를 모르면 창을 거두어 편집기의 `결과 확인 필요` 띠로 넘긴다.
 */

/** 개정 발행의 사유 — 기계 이름을 보내고 사람의 말은 `L.drafts.stageReason*` 이 말한다. */
const REASONS = [
  ["spec", L.drafts.stageReasonSpec],
  ["ops", L.drafts.stageReasonOps],
  ["resource", L.drafts.stageReasonResource],
  ["direct", L.drafts.stageReasonDirect],
] as const;

export function PublishDialog({
  daemon,
  docKey,
  site,
  baseTitle,
  pendingCommandId,
  nav,
  onClose,
  onRefresh,
  keptOps = 0,
  banner = null,
}: {
  daemon: Daemon;
  /** 직접 고를 AI 고침의 수(2026-10-31 F) — 남은 걸음이 있으면 점검 줄이 말한다. */
  keptOps?: number;
  /** 창 머리의 한 줄 안내(2026-11-02 · 같이 고치기 UX 계획 C3) — 곁줄 발행 팝이 같이 고친 것 밖의
   * 바뀐 곳을 말할 때만 쓴다. 확인 창의 절차는 이 줄이 바꾸지 않는다. */
  banner?: string | null;
  docKey: string;
  /** Confluence 사이트 — `Confluence 에서 열기` 링크가 이 주소로 선다. */
  site: string | null;
  /** 바뀌기 전 제목 — 바뀐 제목의 전 · 후를 보이는 데 쓴다. */
  baseTitle: string | null;
  /** 아직 결과를 확인하지 못한 발행 명령 — `결과 다시 확인` 이 이것으로 묻는다. */
  pendingCommandId: string | null;
  nav: ShellNav;
  onClose: () => void;
  /** 다시 읽기 — 맞추기 · 발행 뒤에 편집기가 최신 판을 읽게 한다. */
  onRefresh: () => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [preview, setPreview] = useState<DraftPublishPreview | null>(null);
  // 안 풀린 코멘트의 수(2026-10-31 F) — 기존 문서의 발행에서만 읽는다. 모르면 점검 줄에서 뺀다.
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftPublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 맞추기 · 다시 확인의 잠금 — 두 번 눌러 두 번 보내지 않게. */
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [review, setReview] = useState<{ draft: DraftView; base: DraftRevisionView | null } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [notation, setNotation] = useState("");
  const [reason, setReason] = useState("");

  // 미리보기는 창이 설 때 한 번 읽는다 — 늦게 온 답은 창이 닫혔으면 버린다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt 는 다시 확인의 방아쇠 — 읽지 않고 바뀜에만 반응한다.
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setPreview(null);
    setReview(null);
    setLoadError(null);
    setResult(null);
    setError(null);
    setCommentCount(null);
    loadPublishReview(apiRef.current, docKey)
      .then(({ preview: next, draft, base }) => {
        if (!alive) return;
        setPreview(next);
        setReview({ draft, base });
        setPhase("ready");
        setNotation(stageInputNeeded(next) ? (nextNotation(next.stage.current) ?? "") : "");
        // 안 풀린 코멘트의 수 — 기존 문서의 발행에서만 읽는다(2026-10-31 F). 실패는 조용히 뺀다.
        if (next.pageId !== null) {
          apiRef.current
            .docRead(next.pageId)
            .then((doc) => {
              if (!alive) return;
              setCommentCount((doc.comments ?? []).filter((one) => one.resolved !== true).length);
            })
            .catch(() => {
              if (alive) setCommentCount(null);
            });
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setPhase("failed");
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [docKey, attempt]);

  const rebase = async () => {
    if (busy || sending) return;
    setBusy(true);
    setError(null);
    try {
      await apiRef.current.draftRebase(docKey);
      onRefresh();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const recheck = async (commandId: string) => {
    if (busy || sending) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiRef.current.draftPublishRecheck(commandId);
      setResult(next);
      setBusy(false);
      // 닿았으면 알림 한 줄로 끝내고, 모르면 편집기의 띠로 넘긴다.
      if (next.state === "applied") {
        nav.toast(resultLine(next));
        onRefresh();
        onClose();
      } else if (next.state === "unknown") {
        onRefresh();
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!canPublish || preview === null || sending || busy) return;
    setSending(true);
    setError(null);
    try {
      const next = await apiRef.current.draftPublish(
        docKey,
        newCommandId(),
        preview.draftRevision,
        stageInputNeeded(preview) ? { notation: notation.trim(), reason } : undefined,
      );
      setResult(next);
      if (next.state === "applied") {
        nav.toast(resultLine(next));
        onRefresh();
        onClose();
        return;
      }
      if (next.state === "unknown") {
        onRefresh();
        onClose();
        return;
      }
      // 부딪침 · 못 함 · 실패는 창에 남아 이유와 다음 행동을 보인다.
      setSending(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSending(false);
    }
  };

  const blockers = preview === null ? [] : blockerLines(preview);

  const stageNeeded = preview !== null && stageInputNeeded(preview);
  const link =
    preview !== null && preview.pageId !== null && site !== null
      ? docUrl(site, preview.pageId)
      : null;
  const canPublish =
    phase === "ready" &&
    preview !== null &&
    review !== null &&
    !busy &&
    result === null &&
    blockers.length === 0 &&
    (!stageNeeded || (notation.trim() !== "" && reason !== ""));
  const conflict = result?.state === "conflict";
  /** 창에 남는 실패 결과 — 확정된 결과라 다시 묻지 못하고, 재검토로 다시 발행할 수 있다. */
  const retryByReview = result?.state === "not-applied" || result?.state === "failed";

  return (
    <ModalFrame onClose={onClose} locked={sending} label={L.drafts.publishTitle} className="nx-pb">
      <ModalHead title={L.drafts.publishTitle} sub={L.drafts.publishSub} />
      <ModalBody>
        {phase === "loading" && (
          <p className="nx-pb-note" role="status">
            <Spin /> {L.plans.reading}
          </p>
        )}
        {phase === "failed" && (
          <div>
            <p className="nx-banner nx-banner--red" role="alert">
              {L.drafts.publishReviewFailed}
            </p>
            {loadError !== null && <p className="nx-pb-note">{loadError}</p>}
            <button type="button" className="nx-btn" onClick={() => setAttempt((n) => n + 1)}>
              {L.vocab.retry}
            </button>
          </div>
        )}
        {phase === "ready" && preview !== null && (
          <>
            {banner !== null && (
              <p className="nx-banner nx-banner--amber" role="note">
                {banner}
              </p>
            )}
            <dl className="nx-pb-facts">
              <div className="nx-pb-fact">
                <dt>{L.drafts.previewTarget}</dt>
                <dd>
                  {preview.kind === "create"
                    ? preview.parent === null
                      ? L.drafts.newDoc
                      : `${preview.parent.title} · ${L.drafts.newDoc}`
                    : preview.title}
                </dd>
              </div>
              {preview.kind === "update" && preview.titleChanged && (
                <div className="nx-pb-fact">
                  <dt>{L.drafts.previewTitle}</dt>
                  <dd>
                    <span className="nx-pb-before">{baseTitle ?? "—"}</span>
                    {" → "}
                    {preview.title}
                  </dd>
                </div>
              )}
            </dl>
            {/* 발행 전 점검(2026-10-31 F) — 막지 않고 한 줄씩 알린다. */}
            <section className="nx-pb-precheck" aria-label={L.drafts.precheckHead}>
              <h3 className="nx-pb-sec-t">{L.drafts.precheckHead}</h3>
              <ul className="nx-pb-precheck-list">
                <li>
                  {L.drafts.precheckChanges(
                    preview.changes.changed + preview.changes.inserted + preview.changes.deleted,
                  )}
                </li>
                {keptOps > 0 && <li>{L.drafts.precheckKept(keptOps)}</li>}
                {commentCount !== null && <li>{L.drafts.precheckComments(commentCount)}</li>}
                <li>{L.drafts.precheckScreen}</li>
              </ul>
            </section>
            <section className="nx-pb-changes" aria-label={L.drafts.changeHeading}>
              <h3 className="nx-pb-sec-t">{L.drafts.changeHeading}</h3>
              <p className="nx-pb-counts">
                {L.drafts.changeCounts(
                  preview.changes.changed,
                  preview.changes.inserted,
                  preview.changes.deleted,
                ) ||
                  (preview.kind === "update" && preview.titleChanged
                    ? L.drafts.changeTitleOnly
                    : L.drafts.blocker["nothing-to-publish"])}
              </p>
            </section>
            {review !== null && (
              <DraftChanges
                base={review.base}
                title={review.draft.title}
                blocks={review.draft.blocks}
                api={daemon.api}
                pageId={review.draft.pageId}
              />
            )}
            {preview.changes.protectedRemoved.length > 0 && (
              <section
                className="nx-banner nx-banner--amber"
                aria-label={L.drafts.protectedHeading}
              >
                <div className="nx-banner-body">
                  <b>{L.drafts.protectedHeading}</b>
                  <ul className="nx-pb-change-list">
                    {preview.changes.protectedRemoved.map((machine, at) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 같은 종류의 조각도 각각 보인다.
                      <li key={`${at}-${machine}`}>
                        {L.drafts.protectedRemoved(L.drafts.tokenLabel(machine))}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
            <p className="nx-pb-vers">
              {L.drafts.previewVersions(
                preview.baseVersion,
                preview.remoteVersion,
                preview.draftRevision,
              )}
            </p>
            {stageNeeded && (
              <section className="nx-pb-stage" aria-label={L.drafts.stageNotation}>
                <p className="nx-pb-stage-note">{L.drafts.stageRevision}</p>
                <div className="nx-pb-stage-row">
                  <label className="nx-field">
                    <span className="nx-field-label">{L.drafts.stageNotation}</span>
                    <input
                      className="nx-input nx-pb-stage-in"
                      aria-label={L.drafts.stageNotation}
                      value={notation}
                      disabled={sending}
                      // 선로의 표기 한계 — 데몬의 검사에 부딪치기 전에 칸이 먼저 멈춘다(2026-10-23 화면 확인 · R2 검토 3).
                      maxLength={DRAFT_LIMITS.notationLength}
                      onChange={(event) => setNotation(event.target.value)}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">{L.drafts.stageReason}</span>
                    <select
                      className="nx-input"
                      aria-label={L.drafts.stageReason}
                      value={reason}
                      disabled={sending}
                      onChange={(event) => setReason(event.target.value)}
                    >
                      <option value="">{L.drafts.stageReasonPick}</option>
                      {REASONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {notation.length >= DRAFT_LIMITS.notationLength && (
                  <p className="nx-pb-limit">{L.drafts.limitNotationLength}</p>
                )}
              </section>
            )}
            {blockers.length > 0 && (
              <ul className="nx-pb-blockers">
                {blockers.map((line) => (
                  <li key={line.text} className="nx-banner nx-banner--amber nx-pb-blocker">
                    <InfoIcon />
                    <span className="nx-banner-body">{line.text}</span>
                    {line.action === "rebase" && (
                      <button
                        type="button"
                        className="nx-btn nx-btn--sm"
                        disabled={busy || sending}
                        onClick={() => void rebase()}
                      >
                        {L.drafts.actionRebase}
                      </button>
                    )}
                    {line.action === "open-confluence" && link !== null && (
                      <a
                        className="nx-btn nx-btn--sm"
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={linkClick}
                      >
                        {L.drafts.actionOpen}
                        <ExternalIcon />
                      </a>
                    )}
                    {line.action === "resolve" && (
                      <button type="button" className="nx-btn nx-btn--sm" onClick={onClose}>
                        {L.drafts.actionResolve}
                      </button>
                    )}
                    {line.action === "recheck" && pendingCommandId !== null && (
                      <button
                        type="button"
                        className="nx-btn nx-btn--sm"
                        disabled={busy || sending}
                        onClick={() => void recheck(pendingCommandId)}
                      >
                        {L.drafts.actionRecheck}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {result !== null && (
              <p className="nx-banner nx-banner--blue" role="status">
                {resultLine(result)}
              </p>
            )}
            {error !== null && (
              <p className="nx-banner nx-banner--red" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </ModalBody>
      <ModalFoot className="nx-pb-foot">
        <div className="nx-pb-foot-act">
          <button type="button" className="nx-btn" disabled={busy || sending} onClick={onClose}>
            {L.drafts.backToDraft}
          </button>
          {retryByReview && (
            <button
              type="button"
              className="nx-btn"
              disabled={busy || sending}
              onClick={() => setAttempt((n) => n + 1)}
            >
              {L.drafts.reviewAgain}
            </button>
          )}
          {conflict && (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={busy || sending}
              onClick={() => void rebase()}
            >
              {L.drafts.actionRebase}
            </button>
          )}
        </div>
        <button
          type="button"
          className="nx-btn nx-btn--pri"
          disabled={!canPublish || sending}
          onClick={() => void publish()}
        >
          {sending ? (
            <>
              <Spin /> {L.drafts.publishing}
            </>
          ) : (
            L.drafts.publishConfirm
          )}
        </button>
      </ModalFoot>
    </ModalFrame>
  );
}
