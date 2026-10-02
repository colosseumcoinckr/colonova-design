import {
  FEATURE_CONTEXT_MAX,
  FEATURE_REQUEST_MAX,
  type FeatureRequestInput,
  type FeatureRequestResult,
  RELEASES_REPO,
} from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import { useModalEscape, useModalFocus } from "../../hooks/use-modal-focus";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { CloseIcon } from "../onboarding/icons";
import { modalCloseMs } from "../onboarding/motion";
import "./feedback.css";
import {
  clearDraft,
  contextError,
  type FeedbackDraft,
  loadDraft,
  mintCommandId,
  requestError,
  restoresUncertain,
  saveDraft,
} from "./lib";

type Phase = "edit" | "review" | "sending" | "sent" | "browser" | "failed" | "uncertain";

interface SentInfo {
  number: number;
  url: string;
}

interface BrowserInfo {
  url: string;
  title: string;
  body: string;
}

/** 고정 접수 대상의 게시판 — 확인 불가 때에도 같은 곳을 가리킨다(임의 저장소 없음). */
const ISSUES_LIST_URL = `https://github.com/${RELEASES_REPO}/issues`;
const ISSUES_NEW_URL = `https://github.com/${RELEASES_REPO}/issues/new`;

type CopyTarget = "title" | "body" | "submitted";

/**
 * 기능 제안 대화상자(PLAN-FEEDBACK) — 사이드바 바닥의 `기능 제안`이 여는 한 장.
 * 작성 → 확인 → 전송 중 → 접수 · 브라우저 필요 · 거절 · 확인 불가까지의 상태를
 * 전부 이 판이 쥔다. 마운트는 셸이 늘 유지하고 `open` 만 그린다 — 전송이 도는
 * 동안 닫았다 다시 열어도 약속이 죽지 않고, 늦게 도착한 접수 확인이 초안을
 * 지울 수 있다(PLAN-FEEDBACK). 초안과 전송 시작 표시의 주인은 `./lib` 이다.
 */
export function FeedbackDialog({
  daemon,
  open,
  onClose,
}: {
  daemon: Daemon;
  open: boolean;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const closeTimer = useRef<number | null>(null);
  // 전송 시작의 문지기 — 같은 틱의 두 이벤트가 상태만으로는 못 막는다(ref 병행).
  const attemptedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("edit");
  // 저장된 초안을 다 읽은 뒤에만 초안을 적는다 — 마운트 첫 판정이 저장된
  // 확인 불가 표시를 빈 폼으로 지워 버리는 일을 막는 문지기다.
  const [hydrated, setHydrated] = useState(false);
  const [request, setRequest] = useState("");
  const [context, setContext] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [requestErr, setRequestErr] = useState<"empty" | "too-long" | null>(null);
  const [contextErr, setContextErr] = useState(false);
  const [sent, setSent] = useState<SentInfo | null>(null);
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [uncertainUrl, setUncertainUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<{ target: CopyTarget; state: "ok" | "failed" } | null>(null);
  const [closing, setClosing] = useState(false);

  const markAttempted = (id: string | null) => {
    attemptedRef.current = true;
    setAttempted(true);
    saveDraft({ request, context, attempted: true, commandId: id });
  };

  const releaseAttempted = () => {
    attemptedRef.current = false;
    setAttempted(false);
    saveDraft({ request, context, attempted: false, commandId: null });
  };

  /** 접수 여부를 알 수 없는 끝 — 확인 불가 화면으로만 간다(자동 재전송 없음). */
  const goUncertain = (url: string | null) => {
    setUncertainUrl(url);
    setPhase("uncertain");
  };

  // 닫힘의 층 판정과 초점 가두리 — 판이 열려 있을 때만 단다(훅의 open 인수).
  // requestClose 는 early return 앞에서도 안전하게 불리게 여기서 정의한다.
  const requestClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    const finish = () => {
      closeTimer.current = null;
      setClosing(false);
      // 접수가 확인된 판을 닫으면 다시 열 때는 빈 작성 폼이다 — 영수증이 남지 않는다.
      if (phase === "sent") {
        setSent(null);
        setRequest("");
        setContext("");
        setRequestErr(null);
        setContextErr(false);
        setPhase("edit");
      }
      onClose();
    };
    if (modalCloseMs(reduced) === 0) {
      finish();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(finish, modalCloseMs(reduced));
  };
  useModalFocus(panel, open);
  useModalEscape(panel, requestClose, open);

  // 다시 열림 — 창을 닫았다 열어도 도는 전송의 상태가 그대로고, 창을 새로
  // 연 실행 뒤에는 남은 초안을 읽는다. 전송 시작 표시가 있으면 확인 불가 화면이다.
  useEffect(() => {
    const restored = loadDraft();
    if (restored === null) {
      setHydrated(true);
      return;
    }
    setRequest(restored.request);
    setContext(restored.context);
    setAttempted(restored.attempted);
    attemptedRef.current = restored.attempted;
    if (restoresUncertain(restored)) setPhase("uncertain");
    setHydrated(true);
  }, []);

  // 열림과 상태 전환의 초점 — 작성 폼이면 첫 입력란으로 시딩하고, 사라진 단추가
  // 초점을 데고 나가면 판이 받아 전역 단축키와 판 뒤의 조작이 초점을 훔치지 않게 한다.
  useEffect(() => {
    if (!open) return;
    if (phase === "edit") {
      requestRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && panel.current?.contains(active)) return;
    panel.current?.focus();
    // 초점은 열림과 상태가 함께 정한다.
  }, [open, phase]);

  // 고치는 동안의 초안 — 저장된 초안을 다 읽은 뒤에만 적는다. 작성과 확인
  // 화면에서만 적고, 전송 시작 표시가 서면 손을 대지 않으며, 끝난 상태의
  // 화면에서도 다시 쓰지 않는다. 빈 폼은 저장 값을 지운다 — 지워진 초안이
  // 다시 열림에 되살아나지 않게(마운트 첫 판정은 위의 문지기가 막는다).
  useEffect(() => {
    if (!hydrated || attempted || (phase !== "edit" && phase !== "review")) return;
    const draft: FeedbackDraft = { request, context, attempted: false, commandId: null };
    if (request.trim() || context.trim()) saveDraft(draft);
    else clearDraft();
  }, [request, context, attempted, phase, hydrated]);

  // 닫힘 애니메이션의 타이머 뒷정리 — 판이 사라져도 타이머가 남지 않게.
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  if (!open) return null;

  const requestTrimmed = request.trim();
  const contextTrimmed = context.trim();

  const validate = (): boolean => {
    const reqErr = requestError(request);
    const ctxErr = contextError(context);
    setRequestErr(reqErr);
    setContextErr(ctxErr !== null);
    return reqErr === null && ctxErr === null;
  };

  const send = () => {
    // 전송 중의 두 번째 누름과 이미 시작한 같은 내용 — 상태와 ref 로 이중 등록의
    // 두 문을 다 닫는다(같은 틱의 두 이벤트는 상태만으로 못 막는다).
    if (phase === "sending" || attemptedRef.current || attempted) return;
    const id = mintCommandId();
    const input: FeatureRequestInput = {
      request: requestTrimmed,
      ...(contextTrimmed ? { context: contextTrimmed } : {}),
    };
    // 표시는 약속보다 먼저 적는다 — 전송 시작 뒤의 단절도 확인 불가로 복원되게.
    markAttempted(id);
    setPhase("sending");
    // 약속은 판이 살아 있는 동안 쥔다 — 닫았다 다시 열어도 끝나면 화면이 옮겨 앉는다.
    try {
      daemon.api
        .feedbackSubmit(input, id)
        .then((result: FeatureRequestResult) => {
          if (result.kind === "sent") {
            // 확인된 접수만 초안을 비운다 — 나머지의 끝은 아직 알 수 없다.
            clearDraft();
            attemptedRef.current = false;
            setAttempted(false);
            setSent({ number: result.number, url: result.url });
            setPhase("sent");
          } else if (result.kind === "browser") {
            // 브라우저 답 자체는 접수가 아니었다 — 표시를 걷어 다시 열 때
            // 확인 불가로 잘못 복원되지 않게 한다. 링크를 누르면 다시 표시한다.
            releaseAttempted();
            setBrowser({ url: result.url, title: result.title, body: result.body });
            setPhase("browser");
          } else if (result.kind === "failed") {
            // 분명한 거절 — 표시를 걷어 새로 고친 내용의 다시 시도를 허용한다.
            releaseAttempted();
            setPhase("failed");
          } else {
            goUncertain(result.url);
          }
        })
        .catch(() => {
          // 답을 못 받았다 — 등록 여부를 알 수 없으니 확인 불가 화면으로만 간다.
          goUncertain(null);
        });
    } catch {
      // API 가 동기로 던져도 같은 끝이다 — 등록 여부를 알 수 없다.
      goUncertain(null);
    }
  };

  /**
   * 브라우저 경로의 활성화 — 채워진 URL 이든 빈 작성 페이지든, 사용자가 링크를
   * 누르는 시점부터 등록 여부는 확인 불가다(PLAN-FEEDBACK). 복사는 여기에 끼지
   * 않는다 — 내용을 복사하는 것만으로 접수가 시작되지 않는다.
   */
  const openBrowserLink = () => {
    markAttempted(null);
    goUncertain(null);
  };

  const copyText = (target: CopyTarget, text: string) => {
    setCopy(null);
    let write: Promise<void> | undefined;
    try {
      write = navigator.clipboard?.writeText(text);
    } catch {
      write = undefined;
    }
    if (!write) {
      // 클립보드가 없는 실행도 조용히 넘어가지 않는다 — 실패를 보이고 내용을
      // 직접 고를 수 있게 남긴다.
      setCopy({ target, state: "failed" });
      selectPre();
      return;
    }
    write
      .then(() => setCopy({ target, state: "ok" }))
      .catch(() => {
        setCopy({ target, state: "failed" });
        selectPre();
      });
  };

  /** 복사 실패의 대체품 — pre 요소에는 select() 가 없으므로 Range 로 고른다.
   * 고르기 전에 pre 에 초점을 준다 — 초점 없는 선택은 화면 낭독기와 붙여넣기가
   * 놓치고, 키보드로도 다시 고를 수 있게 pre 가 초점을 받는다. */
  const selectPre = () => {
    const pre = preRef.current;
    if (pre === null) return;
    pre.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(pre);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  /** 확인 불가의 끝 — 목록을 확인했다는 사람의 표시만 빈 새 제안을 연다. */
  const acknowledgeList = () => {
    clearDraft();
    attemptedRef.current = false;
    setAttempted(false);
    setUncertainUrl(null);
    setRequest("");
    setContext("");
    setRequestErr(null);
    setContextErr(false);
    setPhase("edit");
  };

  const fieldError = requestErr !== null || contextErr;
  const submittedText = contextTrimmed
    ? `${L.feedback.requestHeading}: ${requestTrimmed}\n${L.feedback.contextHeading}: ${contextTrimmed}`
    : `${L.feedback.requestHeading}: ${requestTrimmed}`;

  return (
    <div className={`nx-modal-back${closing ? " nx-modal-back--out" : ""}`} role="presentation">
      <div
        ref={panel}
        className="nx-modal nx-fb"
        role="dialog"
        aria-modal="true"
        aria-label={L.feedback.title}
        tabIndex={-1}
      >
        <div className="nx-mhd">
          <h2>{L.feedback.title}</h2>
          <button
            type="button"
            className="nx-ibtn"
            aria-label={L.feedback.close}
            onClick={requestClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="nx-mbody nx-fb-body">
          {phase === "edit" && (
            <>
              <label className="nx-fb-label" htmlFor="nx-fb-request">
                {L.feedback.requestLabel}
              </label>
              <textarea
                id="nx-fb-request"
                ref={requestRef}
                className={`nx-fb-field${requestErr !== null ? " nx-fb-field--err" : ""}`}
                rows={5}
                value={request}
                placeholder={L.feedback.requestPlaceholder}
                aria-invalid={requestErr !== null}
                aria-describedby={requestErr !== null ? "nx-fb-request-err" : undefined}
                onChange={(event) => {
                  setRequest(event.target.value);
                  if (requestErr !== null) setRequestErr(requestError(event.target.value));
                }}
              />
              <div className="nx-fb-count">
                {fieldError && requestErr !== null && (
                  <p id="nx-fb-request-err" className="nx-fb-err" role="alert">
                    {requestErr === "empty"
                      ? L.feedback.requestEmpty
                      : L.feedback.requestTooLong(FEATURE_REQUEST_MAX)}
                  </p>
                )}
                <span aria-hidden="true">
                  {L.feedback.count(request.length, FEATURE_REQUEST_MAX)}
                </span>
              </div>
              <label className="nx-fb-label" htmlFor="nx-fb-context">
                {L.feedback.contextLabel}
              </label>
              <textarea
                id="nx-fb-context"
                className={`nx-fb-field${contextErr ? " nx-fb-field--err" : ""}`}
                rows={3}
                value={context}
                placeholder={L.feedback.contextPlaceholder}
                aria-invalid={contextErr}
                aria-describedby={contextErr ? "nx-fb-context-err" : undefined}
                onChange={(event) => {
                  setContext(event.target.value);
                  if (contextErr) setContextErr(contextError(event.target.value) !== null);
                }}
              />
              <div className="nx-fb-count">
                {contextErr && (
                  <p id="nx-fb-context-err" className="nx-fb-err" role="alert">
                    {L.feedback.contextTooLong(FEATURE_CONTEXT_MAX)}
                  </p>
                )}
                <span aria-hidden="true">
                  {L.feedback.count(context.length, FEATURE_CONTEXT_MAX)}
                </span>
              </div>
              <div className="nx-mfoot">
                <button
                  type="button"
                  className="nx-btn nx-btn--pri"
                  disabled={fieldError}
                  onClick={() => {
                    if (validate()) setPhase("review");
                  }}
                >
                  {L.feedback.toReview}
                </button>
              </div>
            </>
          )}

          {phase === "review" && (
            <>
              <p className="nx-fb-head">{L.feedback.requestHeading}</p>
              <p className="nx-fb-quote">{requestTrimmed}</p>
              {contextTrimmed && (
                <>
                  <p className="nx-fb-head">{L.feedback.contextHeading}</p>
                  <p className="nx-fb-quote">{contextTrimmed}</p>
                </>
              )}
              <p className="nx-fb-head">{L.feedback.destinationLabel}</p>
              <p className="nx-fb-dest">{L.feedback.destination}</p>
              <p className="nx-snote">{L.feedback.disclosure}</p>
              <p className="nx-snote">{L.feedback.notAttached}</p>
              <div className="nx-mfoot">
                <button type="button" className="nx-btn" onClick={() => setPhase("edit")}>
                  {L.feedback.edit}
                </button>
                <button type="button" className="nx-btn nx-btn--pri" onClick={send}>
                  {L.feedback.submit}
                </button>
              </div>
            </>
          )}

          {phase === "sending" && (
            <>
              <p className="nx-snote" role="status" aria-live="polite">
                {L.feedback.sending}
              </p>
              <div className="nx-fb-bar" aria-hidden="true">
                <i />
              </div>
            </>
          )}

          {phase === "sent" && sent !== null && (
            <>
              <p role="status" aria-live="polite">
                {L.feedback.sentTitle}
              </p>
              <div className="nx-mfoot">
                <a className="nx-btn" href={sent.url} target="_blank" rel="noopener noreferrer">
                  {L.feedback.sentLink}
                </a>
                <button type="button" className="nx-btn nx-btn--pri" onClick={requestClose}>
                  {L.feedback.close}
                </button>
              </div>
            </>
          )}

          {phase === "browser" && browser !== null && (
            <>
              <p className="nx-fb-state" role="alert">
                {L.feedback.browserTitle}
              </p>
              <p className="nx-snote">{L.feedback.browserNote}</p>
              {/* 클립보드가 막힌 실행의 대체품 — 실패하면 이 내용을 통째로 골라 준다. */}
              <pre ref={preRef} tabIndex={-1} className="nx-fb-pre">
                {`${browser.title}\n\n${browser.body}`}
              </pre>
              {copy !== null && copy.target !== "submitted" && (
                <p
                  className={copy.state === "ok" ? "nx-snote" : "nx-fb-err"}
                  role={copy.state === "ok" ? "status" : "alert"}
                  aria-live="polite"
                >
                  {copy.state === "ok" ? L.feedback.copied : L.feedback.copyFailed}
                </p>
              )}
              <div className="nx-mfoot">
                <a
                  className="nx-btn nx-btn--pri"
                  href={browser.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={openBrowserLink}
                >
                  {L.feedback.openBrowser}
                </a>
                <button
                  type="button"
                  className="nx-btn"
                  onClick={() => copyText("title", browser.title)}
                >
                  {L.feedback.copyTitle}
                </button>
                <button
                  type="button"
                  className="nx-btn"
                  onClick={() => copyText("body", browser.body)}
                >
                  {L.feedback.copyBody}
                </button>
                <a
                  className="nx-fb-link"
                  href={ISSUES_NEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={openBrowserLink}
                >
                  {L.feedback.newIssueLink}
                </a>
              </div>
            </>
          )}

          {phase === "failed" && (
            <>
              <p className="nx-fb-state" role="alert">
                {L.feedback.failedTitle}
              </p>
              <p className="nx-snote">{L.feedback.failedNote}</p>
              <div className="nx-mfoot">
                <button type="button" className="nx-btn" onClick={() => setPhase("edit")}>
                  {L.feedback.edit}
                </button>
                <button type="button" className="nx-btn nx-btn--pri" onClick={send}>
                  {L.feedback.retry}
                </button>
              </div>
            </>
          )}

          {phase === "uncertain" && (
            <>
              <p className="nx-fb-state" role="alert">
                {L.feedback.uncertainTitle}
              </p>
              <p className="nx-snote">{L.feedback.uncertainNote}</p>
              {/* 보낸 내용 — 다시 보내는 단추는 없다. 목록 확인이 먼저다. */}
              <pre ref={preRef} tabIndex={-1} className="nx-fb-pre">
                {submittedText}
              </pre>
              {copy !== null && copy.target === "submitted" && (
                <p
                  className={copy.state === "ok" ? "nx-snote" : "nx-fb-err"}
                  role={copy.state === "ok" ? "status" : "alert"}
                  aria-live="polite"
                >
                  {copy.state === "ok" ? L.feedback.copied : L.feedback.copyFailed}
                </p>
              )}
              <div className="nx-mfoot">
                <a
                  className="nx-btn nx-btn--pri"
                  href={uncertainUrl ?? ISSUES_LIST_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {L.feedback.checkList}
                </a>
                <button
                  type="button"
                  className="nx-btn"
                  onClick={() => copyText("submitted", submittedText)}
                >
                  {L.feedback.copySubmitted}
                </button>
                <button type="button" className="nx-btn" onClick={acknowledgeList}>
                  {L.feedback.acknowledgeList}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
