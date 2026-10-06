import {
  FEATURE_CONTEXT_MAX,
  FEATURE_REQUEST_MAX,
  type FeatureRequestInput,
  type FeatureRequestResult,
  RELEASES_REPO,
} from "@colonova-design/protocol";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { connectionLock } from "../lib/connection-copy";
import { keyHint } from "../lib/key-hint";
import { LightbulbIcon, Spin } from "../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead, useModalClose } from "../ui/ModalFrame";
import "./feedback.css";
import {
  type Counter,
  closedArrival,
  counterState,
  type Phase,
  rejectedBeforeSend,
  sendLockLine,
  stageCopy,
  stepStates,
} from "./gate";
import { BigCheckIcon, CopyIcon, GlobeIcon, LinkOutIcon, StepCheckIcon } from "./icons";
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

/** 세 점 — 쓰기 · 확인 · 접수. 지금 어디쯤인지 한눈에, 낭독에는 `aria-current` 로. */
function Steps({ phase }: { phase: Phase }) {
  const states = stepStates(phase);
  const labels = [L.feedback.stepWrite, L.feedback.stepReview, L.feedback.stepSend];
  return (
    <ol className="nx-fb-steps" aria-label={L.feedback.stepsLabel}>
      {labels.map((label, index) => (
        <li
          key={label}
          className={`nx-fb-step nx-fb-step--${states[index]}`}
          aria-current={states[index] === "now" ? "step" : undefined}
        >
          <span className="nx-fb-dot" aria-hidden="true">
            {states[index] === "done" && <StepCheckIcon />}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** 판을 닫는 단추 — ✕ 와 같은 길(닫는 모션 · 닫기 알림)을 지난다. */
function CloseButton({ primary = false }: { primary?: boolean }) {
  const close = useModalClose();
  return (
    <button
      type="button"
      className={`nx-btn${primary ? " nx-btn--pri" : " nx-btn--ghost"}`}
      onClick={close}
    >
      {L.feedback.close}
    </button>
  );
}

/** 입력칸 아래 한 줄 — 왼쪽은 오류, 오른쪽은 글자 수(80% 부터). */
function FieldNote({
  id,
  error,
  counter,
  max,
}: {
  id: string;
  error: string | null;
  counter: Counter;
  max: number;
}) {
  return (
    <div className="nx-fb-count">
      {error !== null && (
        <p id={id} className="nx-fb-err" role="alert">
          {error}
        </p>
      )}
      {counter.shown && (
        <span className={`nx-fb-n nx-fb-n--${counter.tone}`} aria-hidden="true">
          {L.feedback.count(counter.used, max)}
        </span>
      )}
    </div>
  );
}

/**
 * 기능 제안 대화상자(PLAN-FEEDBACK) — 사이드바 바닥의 `기능 제안`이 여는 한 장.
 * 작성 → 확인 → 전송 중 → 접수 · 브라우저 필요 · 거절 · 확인 불가까지의 상태를
 * 전부 이 판이 쥔다. 마운트는 셸이 늘 유지하고 `open` 만 그린다 — 전송이 도는
 * 동안 닫았다 다시 열어도 약속이 죽지 않고, 늦게 도착한 접수 확인이 초안을
 * 지울 수 있다(PLAN-FEEDBACK). 초안과 전송 시작 표시의 주인은 `./lib` 이다.
 *
 * 2026-10-06 겹판 손질 — 겹판 뼈대(`ModalFrame`)로 옮겼다: 스크림을 눌러도 닫히고(초안은 늘
 * 남는다), 머리 · 바닥은 서고 몸만 굴러간다. 세 점(쓰기 · 확인 · 접수)과 단계마다 바뀌는 제목이
 * 지금 무엇을 하는지 말하고, 연결이 없으면 보내기가 잠긴다. 판정은 `./gate`(순수).
 */
export function FeedbackDialog({
  daemon,
  open,
  onClose,
  onToast,
}: {
  daemon: Daemon;
  open: boolean;
  onClose: () => void;
  /** 닫은 사이에 소식이 오거나 전송 중에 닫을 때의 한 줄 — 없으면 알리지 않는다. */
  onToast?: (text: string) => void;
}) {
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // 전송 시작의 문지기 — 같은 틱의 두 이벤트가 상태만으로는 못 막는다(ref 병행).
  const attemptedRef = useRef(false);
  // 늦게 도착한 답이 판이 닫혀 있는지 · 알릴 손이 무엇인지 본다 — 오래 산 약속의 클로저는 낡는다.
  const openRef = useRef(open);
  openRef.current = open;
  const toastRef = useRef(onToast);
  toastRef.current = onToast;
  const [phase, setPhase] = useState<Phase>("edit");
  // 저장된 초안을 다 읽은 뒤에만 초안을 적는다 — 마운트 첫 판정이 저장된
  // 확인 불가 표시를 빈 폼으로 지워 버리는 일을 막는 문지기다.
  const [hydrated, setHydrated] = useState(false);
  const [request, setRequest] = useState("");
  const [context, setContext] = useState("");
  const [attempted, setAttempted] = useState(false);
  // 비어 있는 채로 확인을 눌렀다 — 한도를 넘은 것은 글자를 칠 때 곧바로 보이니 상태가 아니다.
  const [emptyAsked, setEmptyAsked] = useState(false);
  const [sent, setSent] = useState<SentInfo | null>(null);
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [uncertainUrl, setUncertainUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<{ target: CopyTarget; state: "ok" | "failed" } | null>(null);
  // 요청이 나가기도 전에 막혔다 — 확인 단계에 되돌아와 그 말을 한다.
  const [notSent, setNotSent] = useState(false);

  // 연결이 없으면 보내기를 잠근다 — 보내지도 못할 요청에 전송 시작 표시를 남기지 않는다.
  const lock = connectionLock(daemon.connection, L);
  const lockLine = sendLockLine(lock, L);

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

  /** 판이 닫힌 사이에 답이 왔다 — 닫힌 판은 아무것도 그리지 않으니 토스트로 알린다. */
  const arrive = (accepted: boolean) => {
    if (!openRef.current) toastRef.current?.(closedArrival(accepted, L));
  };

  /** 닫기를 청한 순간 — 전송 중이면 닫아도 계속 보낸다고 알린다(약속은 판 밖에서도 산다). */
  const onRequestClose = () => {
    if (phase === "sending") onToast?.(L.feedback.closeWhileSending);
  };

  /** 닫는 모션이 끝난 뒤 — 접수가 확인된 판을 닫으면 다시 열 때는 빈 작성 폼이다(영수증이 남지 않는다). */
  const finishClose = () => {
    // 닫은 판을 다시 열 때 지난 시도의 「보내지 못했어요」가 묵은 채 남지 않게 한다.
    setNotSent(false);
    if (phase === "sent") {
      setSent(null);
      setRequest("");
      setContext("");
      setEmptyAsked(false);
      setPhase("edit");
    }
    onClose();
  };

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

  // 열림과 단계 전환의 초점 — 작성은 첫 입력란으로, 나머지는 새 제목으로 옮긴다: 누른 단추가
  // 사라지면 초점이 body 로 떨어져 낭독이 맥락을 잃고, 키보드는 처음부터 다시 걸어야 한다.
  // 제목에서 한 번 Tab 이면 단추 쪽이다. 안전한 쪽(제목)에 두니 Enter 가 엉뚱한 일을 하지 않는다.
  useEffect(() => {
    if (!open) return;
    if (phase === "edit") {
      requestRef.current?.focus();
      return;
    }
    const heading = stageRef.current
      ?.closest('[role="dialog"]')
      ?.querySelector<HTMLElement>(".nx-mhd h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
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

  const requestTrimmed = request.trim();
  const contextTrimmed = context.trim();
  const requestCounter = counterState(request, FEATURE_REQUEST_MAX);
  const contextCounter = counterState(context, FEATURE_CONTEXT_MAX);
  // 한도를 넘은 것은 검증을 누르기 전에도 곧바로 말한다.
  const requestMessage =
    requestCounter.tone === "over"
      ? L.feedback.requestTooLong(FEATURE_REQUEST_MAX)
      : emptyAsked
        ? L.feedback.requestEmpty
        : null;
  const contextMessage =
    contextCounter.tone === "over" ? L.feedback.contextTooLong(FEATURE_CONTEXT_MAX) : null;
  const fieldError = requestMessage !== null || contextMessage !== null;

  const toReview = () => {
    const requestProblem = requestError(request);
    if (requestProblem !== null || contextError(context) !== null) {
      setEmptyAsked(requestProblem === "empty");
      return;
    }
    setNotSent(false);
    setPhase("review");
  };

  /** ⌘↵ — 작성 중에 손을 떼지 않고 확인으로. 한글 조합 중의 Enter 는 글자를 맺는 키다. */
  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!fieldError) toReview();
  };

  const send = () => {
    // 전송 중의 두 번째 누름과 이미 시작한 같은 내용 — 상태와 ref 로 이중 등록의
    // 두 문을 다 닫는다(같은 틱의 두 이벤트는 상태만으로 못 막는다).
    if (phase === "sending" || attemptedRef.current || attempted) return;
    // 연결이 없으면 나가지 않는다 — 단추도 같은 이유로 잠겨 있다.
    if (lock !== null) return;
    const id = mintCommandId();
    const input: FeatureRequestInput = {
      request: requestTrimmed,
      ...(contextTrimmed ? { context: contextTrimmed } : {}),
    };
    // 표시는 약속보다 먼저 적는다 — 전송 시작 뒤의 단절도 확인 불가로 복원되게.
    markAttempted(id);
    setNotSent(false);
    setPhase("sending");
    // 약속은 판이 살아 있는 동안 쥔다 — 닫았다 다시 열어도 끝나면 화면이 옮겨 앉는다.
    let call: Promise<FeatureRequestResult>;
    try {
      call = daemon.api.feedbackSubmit(input, id);
    } catch {
      // API 가 동기로 던져도 같은 끝이다 — 등록 여부를 알 수 없다.
      goUncertain(null);
      arrive(false);
      return;
    }
    // 나가기도 전에 거절됐는지 — 소켓이 열려 있지 않으면 `call` 은 보내지 않고 곧바로 거절한다.
    const neverLeft = rejectedBeforeSend(call);
    call.then(
      (result: FeatureRequestResult) => {
        if (result.kind === "sent") {
          // 확인된 접수만 초안을 비운다 — 나머지의 끝은 아직 알 수 없다.
          clearDraft();
          attemptedRef.current = false;
          setAttempted(false);
          setSent({ number: result.number, url: result.url });
          setPhase("sent");
          arrive(true);
        } else if (result.kind === "browser") {
          // 브라우저 답 자체는 접수가 아니었다 — 표시를 걷어 다시 열 때
          // 확인 불가로 잘못 복원되지 않게 한다. 링크를 누르면 다시 표시한다.
          releaseAttempted();
          setBrowser({ url: result.url, title: result.title, body: result.body });
          setPhase("browser");
          arrive(false);
        } else if (result.kind === "failed") {
          // 분명한 거절 — 표시를 걷어 새로 고친 내용의 다시 시도를 허용한다.
          releaseAttempted();
          setPhase("failed");
          arrive(false);
        } else {
          goUncertain(result.url);
          arrive(false);
        }
      },
      async () => {
        if (await neverLeft) {
          // 아무것도 나가지 않았다 — 확인 불가가 아니다. 표시를 걷고 확인 단계로 돌아가
          // 쓴 내용 그대로 다시 보내게 한다(두 번 올라갈 일이 없다).
          releaseAttempted();
          setNotSent(true);
          setPhase("review");
          return;
        }
        // 보낸 뒤 답을 못 받았다 — 등록 여부를 알 수 없으니 확인 불가 화면으로만 간다.
        goUncertain(null);
        arrive(false);
      },
    );
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
    setEmptyAsked(false);
    setPhase("edit");
  };

  const submittedText = contextTrimmed
    ? `${L.feedback.requestHeading}: ${requestTrimmed}\n${L.feedback.contextHeading}: ${contextTrimmed}`
    : `${L.feedback.requestHeading}: ${requestTrimmed}`;
  const stage = stageCopy(phase, L);
  const copyLine = (target: CopyTarget) =>
    copy !== null && copy.target === target ? (
      <p
        className={copy.state === "ok" ? "nx-snote" : "nx-fb-err"}
        role={copy.state === "ok" ? "status" : "alert"}
        aria-live="polite"
      >
        {copy.state === "ok" ? L.feedback.copied : L.feedback.copyFailed}
      </p>
    ) : null;

  return (
    <ModalFrame open={open} onClose={finishClose} onRequestClose={onRequestClose} className="nx-fb">
      <ModalHead title={stage.title} sub={stage.sub} icon={<LightbulbIcon />} />
      <Steps phase={phase} />
      <ModalBody>
        <div className="nx-fb-stage" ref={stageRef} key={phase}>
          {phase === "edit" && (
            <>
              <label className="nx-fb-label" htmlFor="nx-fb-request">
                {L.feedback.requestLabel}
              </label>
              <textarea
                id="nx-fb-request"
                ref={requestRef}
                className={`nx-fb-field${requestMessage !== null ? " nx-fb-field--err" : ""}`}
                rows={5}
                value={request}
                placeholder={L.feedback.requestPlaceholder}
                aria-invalid={requestMessage !== null}
                aria-describedby={requestMessage !== null ? "nx-fb-request-err" : undefined}
                onKeyDown={onFieldKey}
                onChange={(event) => {
                  setRequest(event.target.value);
                  if (emptyAsked && event.target.value.trim() !== "") setEmptyAsked(false);
                }}
              />
              <FieldNote
                id="nx-fb-request-err"
                error={requestMessage}
                counter={requestCounter}
                max={FEATURE_REQUEST_MAX}
              />
              <label className="nx-fb-label" htmlFor="nx-fb-context">
                {L.feedback.contextLabel}
              </label>
              <textarea
                id="nx-fb-context"
                className={`nx-fb-field${contextMessage !== null ? " nx-fb-field--err" : ""}`}
                rows={3}
                value={context}
                placeholder={L.feedback.contextPlaceholder}
                aria-invalid={contextMessage !== null}
                aria-describedby={contextMessage !== null ? "nx-fb-context-err" : undefined}
                onKeyDown={onFieldKey}
                onChange={(event) => setContext(event.target.value)}
              />
              <FieldNote
                id="nx-fb-context-err"
                error={contextMessage}
                counter={contextCounter}
                max={FEATURE_CONTEXT_MAX}
              />
            </>
          )}

          {phase === "review" && (
            <>
              <h3 className="nx-fb-head">{L.feedback.requestHeading}</h3>
              <p className="nx-fb-quote">{requestTrimmed}</p>
              {contextTrimmed && (
                <>
                  <h3 className="nx-fb-head">{L.feedback.contextHeading}</h3>
                  <p className="nx-fb-quote">{contextTrimmed}</p>
                </>
              )}
              <h3 className="nx-fb-head">{L.feedback.destinationLabel}</h3>
              <p className="nx-fb-dest">{L.feedback.destination}</p>
              {/* 되돌릴 수 없는 공개 — 12px 회색 덧말이 아니라 이 판에서 가장 눈에 띄는 줄이다. */}
              <div className="nx-fb-notice">
                <span className="nx-fb-notice-ic">
                  <GlobeIcon />
                </span>
                <div className="nx-fb-notice-t">
                  <b>{L.feedback.publicTitle}</b>
                  <p>{L.feedback.publicBody}</p>
                  <details className="nx-fb-fold">
                    <summary>{L.feedback.notAttachedTitle}</summary>
                    <p>{L.feedback.notAttached}</p>
                  </details>
                </div>
              </div>
              {notSent && (
                <p className="nx-fb-err nx-fb-err--block" role="alert">
                  {L.feedback.notSent}
                </p>
              )}
            </>
          )}

          {phase === "sending" && (
            <>
              <p className="nx-fb-working" role="status" aria-live="polite">
                <Spin />
                {L.feedback.sendingNote}
              </p>
              <div className="nx-fb-bar" aria-hidden="true">
                <i />
              </div>
            </>
          )}

          {phase === "sent" && sent !== null && (
            <div className="nx-fb-done" role="status" aria-live="polite">
              <span className="nx-fb-ok" aria-hidden="true">
                <BigCheckIcon />
              </span>
              <b>{L.feedback.sentHero(sent.number)}</b>
              <p>{L.feedback.sentThanks}</p>
            </div>
          )}

          {phase === "browser" && browser !== null && (
            <>
              <p className="nx-fb-note" role="alert">
                {L.feedback.browserNote}
              </p>
              {/* 클립보드가 막힌 실행의 대체품 — 실패하면 이 내용을 통째로 골라 준다. */}
              <pre ref={preRef} tabIndex={-1} className="nx-fb-pre">
                {`${browser.title}\n\n${browser.body}`}
              </pre>
              <details className="nx-fb-fold nx-fb-fold--lone">
                <summary>{L.feedback.browserFold}</summary>
                <p>{L.feedback.browserFoldNote}</p>
                <div className="nx-fb-acts">
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm"
                    onClick={() => copyText("title", browser.title)}
                  >
                    <CopyIcon />
                    {L.feedback.copyTitle}
                  </button>
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm"
                    onClick={() => copyText("body", browser.body)}
                  >
                    <CopyIcon />
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
                    <LinkOutIcon />
                  </a>
                </div>
                {copyLine("title") ?? copyLine("body")}
              </details>
            </>
          )}

          {phase === "failed" && (
            <p className="nx-fb-note" role="alert">
              {L.feedback.failedNote}
            </p>
          )}

          {phase === "uncertain" && (
            <>
              <p className="nx-fb-note" role="alert">
                {L.feedback.uncertainNote}
              </p>
              {/* 보낸 내용 — 다시 보내는 단추는 없다. 목록 확인이 먼저다. */}
              <div className="nx-fb-prehd">
                <h3 className="nx-fb-head">{L.feedback.submittedHeading}</h3>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--ghost"
                  onClick={() => copyText("submitted", submittedText)}
                >
                  <CopyIcon />
                  {L.feedback.copySubmitted}
                </button>
              </div>
              <pre ref={preRef} tabIndex={-1} className="nx-fb-pre">
                {submittedText}
              </pre>
              {copyLine("submitted")}
            </>
          )}
        </div>
      </ModalBody>

      <ModalFoot className="nx-fb-foot">
        {phase === "edit" && (
          <>
            <span className="nx-fb-footnote">{L.feedback.footNote}</span>
            <button
              type="button"
              className="nx-btn nx-btn--pri"
              disabled={fieldError}
              onClick={toReview}
            >
              {L.feedback.toReview}
              <kbd className="nx-fb-kbd">{keyHint(L.feedback.toReviewKeys)}</kbd>
            </button>
          </>
        )}

        {phase === "review" && (
          <>
            {lockLine !== null && (
              <p id="nx-fb-lock" className="nx-fb-footnote nx-fb-footnote--lock" role="status">
                {lockLine}
              </p>
            )}
            <button type="button" className="nx-btn" onClick={() => setPhase("edit")}>
              {L.feedback.edit}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--pri"
              disabled={lock !== null}
              aria-describedby={lock !== null ? "nx-fb-lock" : undefined}
              onClick={send}
            >
              {L.feedback.submit}
            </button>
          </>
        )}

        {phase === "sending" && <CloseButton />}

        {phase === "sent" && sent !== null && (
          <>
            <a className="nx-btn" href={sent.url} target="_blank" rel="noopener noreferrer">
              {L.feedback.sentLink}
              <LinkOutIcon />
            </a>
            <CloseButton primary />
          </>
        )}

        {phase === "browser" && browser !== null && (
          <a
            className="nx-btn nx-btn--pri"
            href={browser.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openBrowserLink}
          >
            {L.feedback.openBrowser}
            <LinkOutIcon />
          </a>
        )}

        {phase === "failed" && (
          <>
            {lockLine !== null && (
              <p id="nx-fb-lock" className="nx-fb-footnote nx-fb-footnote--lock" role="status">
                {lockLine}
              </p>
            )}
            <button type="button" className="nx-btn" onClick={() => setPhase("edit")}>
              {L.feedback.edit}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--pri"
              disabled={lock !== null}
              aria-describedby={lock !== null ? "nx-fb-lock" : undefined}
              onClick={send}
            >
              {L.feedback.retry}
            </button>
          </>
        )}

        {phase === "uncertain" && (
          <>
            <button type="button" className="nx-btn" onClick={acknowledgeList}>
              {L.feedback.acknowledgeList}
            </button>
            <a
              className="nx-btn nx-btn--pri"
              href={uncertainUrl ?? ISSUES_LIST_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {L.feedback.checkList}
              <LinkOutIcon />
            </a>
          </>
        )}
      </ModalFoot>
    </ModalFrame>
  );
}
