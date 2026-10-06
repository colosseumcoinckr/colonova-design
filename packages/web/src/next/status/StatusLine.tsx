import type { SubmitPreview, SubmitSent } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { openScreenPath } from "../../lib/screen-link";
import { L } from "../labels";
import { keyHint } from "../lib/key-hint";
import { FIRST_TURN_HINT_MS, MAKING_CHECK_MS, makingWordOf } from "../lib/making";
import type { SubmitCopy } from "../lib/submit-copy";
import {
  SUBMIT_SHAKE_MS,
  SUBMIT_STORY_BAR_MS,
  SUBMIT_STORY_POINT_MS,
  submitStoryPhase,
} from "../lib/submit-story";
import { useHeldPhase } from "../lib/use-held-phase";
import { useSubmitReview } from "../lib/use-submit-review";
import type { CycleScreen } from "../lib/work-ledger";
import { openComparison } from "../preview/ComparisonDialog";
import type { StatusLineProps } from "../slots";
import { MenuIcon, PanelIcon, Spin } from "../ui/icons";
import { ConvTitle } from "./ConvTitle";
import { Elapsed } from "./Elapsed";
import { DrawnCheck, FailIcon, LockIcon, SentIcon } from "./parts";
import { SubmitPopover } from "./SubmitPopover";
import type { WorkLedger } from "./use-work-ledger";
import { WorkPopover } from "./WorkPopover";

/** `제출됐어요` · `제출하지 못했어요` 가 버튼에 머무는 시간(U3 · U13). */
const DONE_MS = 2000;
const FAILED_MS = 3000;
/** 이보다 오래된 영수증은 방금 도착한 것이 아니다 — 대화를 다시 읽은 것이다. */
const FRESH_RECEIPT_MS = 30_000;
/** 보내기가 끝난 뒤 제출 단추가 초점을 돌려받아도 잠긴 이유를 띄우지 않는 시간 — 닫는 모션 뒤까지. */
const QUIET_AFTER_SEND_MS = 800;

/**
 * 상태 줄(U2) — 대화와 미리보기 위에 걸친 한 줄. 왼쪽은 대화 제목(눌러서 이름을
 * 바꾼다), 오른쪽은 `프로젝트 이름 · 프로젝트 전체 작업` 과 여정 세 점, 그리고 `제출`.
 * AI 가 도는 동안 여정 앞에 단계 말이 붙는다(단계 10) —
 * 지금 도는 도구의 묶음이 `화면을 살펴보는 중` · `화면 파일을 고치는 중` ·
 * `검사를 돌리는 중` 을 고르고, 첫 보내기가 60초를 넘으면 시계 뒤에
 * `처음은 몇 분 걸려요` 가 붙는다. 좁은 창은 단계 말만.
 * 좁은 창(U16)에서는 제목이 빠지고 지금 점만 글자를 갖는다.
 *
 * 오른쪽 묶음(`nx-project-work`)은 제목이 쓰고 남은 자리를 모두 갖는 컨테이너다 — 자리가
 * 줄면 범위의 말 → 이름 → 앞으로 올 점들의 글자 순으로 접히고, 지금 점의 글자와 `제출` 은
 * 끝까지 남는다(status.css 의 컨테이너 질의). 컨테이너가 제 폭을 갖지 못하면(폭 0)
 * 질의가 늘 가장 좁은 쪽으로 읽혀 `만드는 중` 이 사라지니, 이 묶음의 `flex` 를 지우지 않는다.
 *
 * 제출 버튼은 언제나 그려진다. 잠겼으면 누르거나 포커스가 닿을 때 이유 줄이 버튼
 * 아래 서고(목업 `showWhy` — 포커스가 머무는 동안에는 사라지지 않는다); 열렸으면 확인 한 장(U3, `SubmitPopover`). 버튼은 스스로
 * 답한다 — `제출하는 중…` → `제출됐어요`(2초), `다시 제출하는 중…`, 막히면
 * 3초 붉은 `제출하지 못했어요` 뒤 잠긴다(이유는 `submitCopy`). 막힘의 문제
 * 문장은 대화 칸(단계 2 의 ProblemLine)의 것이라 여기서 그리지 않는다.
 */
export function StatusLine({
  daemon,
  sessions,
  project,
  title,
  onRename,
  journey,
  turnStartedAt,
  makingPhase,
  firstTurn,
  narrow,
  nav,
  onSubmit,
  ledger,
  submitCopy,
  sidebarHidden,
  onOpenSidebar,
}: StatusLineProps & {
  /** 셸이 한 번 부른 `useWorkLedger` — 코멘트 · 작업 기록 · 영수증의 시각. */
  ledger: WorkLedger;
  /** 셸이 여정에 건넨 것과 같은 제출 상태의 문장. */
  submitCopy: SubmitCopy;
  /** 사이드바가 접혀(넓은 창) 있거나 서랍 뒤(좁은 창)에 있다 — 여는 단추가 선다. */
  sidebarHidden: boolean;
  onOpenSidebar: () => void;
}) {
  const live = useSubmitReview(daemon);
  const noteKey = `colonova-design.submit-note:${JSON.stringify([daemon.activeSlug, daemon.repo?.root])}`;
  const [noteDraft, setNoteDraft] = useState({ key: noteKey, text: "" });
  useEffect(() => {
    let text = "";
    try {
      text = localStorage.getItem(noteKey) ?? "";
    } catch {}
    setNoteDraft({ key: noteKey, text });
  }, [noteKey]);
  const setNote = (text: string) => {
    setNoteDraft({ key: noteKey, text });
    try {
      localStorage.setItem(noteKey, text);
    } catch {}
  };
  const [workOpen, setWorkOpen] = useState(false);
  // `이번 작업` 의 한마디 더 — 쓰던 글은 팝이 아니라 여기가 쥔다. Esc 나 바깥 누름으로 팝이 닫혀도 남는다.
  const [workNote, setWorkNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [snapshot, setSnapshot] = useState<SubmitPreview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  // 읽기 실패(목록이 없다)와 보내기 실패(목록은 그대로다)는 다른 일이다 — 한 칸에 섞으면 보내기가
  // 실패할 때 목록이 지워지고 눌리는 것은 `다시 확인` 뿐이었다(2026-10-06 겹판 조사).
  const [readFailed, setReadFailed] = useState(false);
  const [sendError, setSendError] = useState<"failed" | "changed" | null>(null);
  // 보내기가 끝났다 — 값이 올라가면 제출 확인이 닫는 모션으로 물러난다(툭 꺼지지 않게).
  const [leaveToken, setLeaveToken] = useState(0);
  const quietUntil = useRef(0);
  const leaveConfirm = useCallback(() => {
    setLeaveToken((token) => token + 1);
    quietUntil.current = Date.now() + QUIET_AFTER_SEND_MS;
  }, []);
  const reviewRead = useRef(0);
  const projectSlug = useRef(daemon.activeSlug);
  projectSlug.current = daemon.activeSlug;
  const loadSubmission = () => {
    const version = ++reviewRead.current;
    const slug = daemon.activeSlug;
    setReviewLoading(true);
    setReadFailed(false);
    setSendError(null);
    setSnapshot(null);
    void daemon.api
      .submitPreview()
      .then((next) => {
        if (version === reviewRead.current && slug === projectSlug.current) setSnapshot(next);
      })
      .catch(() => {
        if (version === reviewRead.current && slug === projectSlug.current) setReadFailed(true);
      })
      .finally(() => {
        if (version === reviewRead.current && slug === projectSlug.current) setReviewLoading(false);
      });
  };
  useEffect(() => {
    ++reviewRead.current;
    setConfirmOpen(false);
    setSnapshot(null);
    setWorkOpen(false);
    setWorkNote("");
  }, [daemon.activeSlug]);
  // 2026-10-04 ux-review(2차): 제출 잠금은 reviewChanged 에 섞지 않는다 — 잠금만으로
  // 「내용이 바뀌었어요」가 서면 다시 확인을 눌러도 풀리지 않는다. 잠금은 이유 문장을
  // 확인 창의 별도 줄로 건넨다(lockReason).
  const reviewChanged =
    !sending &&
    snapshot !== null &&
    (sendError === "changed" ||
      (live && live.expectedPreview !== snapshot.expectedPreview) ||
      (daemon.repo?.pendingChanges ?? 0) > 0 ||
      JSON.stringify(snapshot.repo.cycleScreens ?? []) !==
        JSON.stringify(daemon.repo?.cycleScreens ?? []));
  const journeyRef = useRef<HTMLButtonElement>(null);
  // 여정 단추의 접근 이름 — 보이는 몸(세 점 · 시계)은 매초 바뀌므로, 이름은
  // `이번 작업 보기` 와 지금 점의 글자만 갖고 몸은 낭독에서 빼 둔다.
  const workName = journey.points[journey.current]?.label
    ? L.journey.openWorkNow(journey.points[journey.current].label)
    : L.journey.openWork;
  // 범위의 말 — 프로젝트를 아직 모르면 앱 이름이 선다.
  const scopeName = project?.name ?? L.sidebar.brand;
  const submitRef = useRef<HTMLButtonElement>(null);
  const [why, setWhy] = useState<string | null>(null);
  // 잠긴 제출의 이유 — 눌러서 본 노출은 3.2초지만 포커스가 머무는 동안은 서 있는다
  // (2026-10-04 ux-review). 버튼은 `aria-describedby` 로 이유 줄을 묶는다.
  const [whyHeld, setWhyHeld] = useState(false);
  // 말풍선을 낭독 칸(`role="status"`)으로 세울지 — 눌러서 띄운 것만이다. 초점이 닿아 뜬 것은 단추가
  // `aria-describedby` 로 이미 읽어 주어, 칸까지 되면 같은 말이 두 번 읽혔다(2026-10-06 겹판 조사).
  const [whyLive, setWhyLive] = useState(false);
  useEffect(() => {
    if (!why || whyHeld) return;
    const timer = setTimeout(() => setWhy(null), 3200);
    return () => clearTimeout(timer);
  }, [why, whyHeld]);
  const { submit } = journey;
  // 제출이 풀리면 이유 줄도 함께 내려온다.
  useEffect(() => {
    if (submit.enabled) {
      setWhy(null);
      setWhyHeld(false);
    }
  }, [submit.enabled]);
  // 답이 끝나면 조각을 곧장 떼지 않는다 — 600ms 체크를 보인 뒤 접는다.
  // 타이머는 동작을 줄이는 탭에서도 돈다(움직임만 줄어든다).
  const [makingState, setMakingState] = useState<"off" | "on" | "check">("off");
  useEffect(() => {
    if (journey.making) {
      setMakingState("on");
      return;
    }
    setMakingState((prev) => (prev === "on" ? "check" : "off"));
  }, [journey.making]);
  useEffect(() => {
    if (makingState !== "check") return;
    const timer = window.setTimeout(() => setMakingState("off"), MAKING_CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [makingState]);

  // 단계 말은 최소 1.5초 산다(use-held-phase.ts) — 몇 초 사이에 묶음이 바뀌어도 알약이
  // 흔들리지 않게. 갈아입는 사이에는 입던 말을 계속 입고, 체크가 보이는 동안도 말은 그대로다.
  const heldWord = useHeldPhase(makingPhase, makingState === "on");
  const makingText = makingWordOf(heldWord, {
    read: L.journey.makingRead,
    file: L.journey.makingFile,
    command: L.journey.makingCheck,
    fallback: L.journey.making,
  });

  // 버튼의 짧은 답 — `done` 은 영수증(cycle.handed)이, `failed` 는 막힘의 시작이 켠다.
  const [flash, setFlash] = useState<"done" | "failed" | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), flash === "done" ? DONE_MS : FAILED_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  const lastHanded = useRef(ledger.handedAt);
  useEffect(() => {
    const previous = lastHanded.current;
    lastHanded.current = ledger.handedAt;
    if (!ledger.handedAt || ledger.handedAt === previous) return;
    if (Date.now() - Date.parse(ledger.handedAt) > FRESH_RECEIPT_MS) return;
    leaveConfirm();
    setSending(false);
    setFlash("done");
  }, [ledger.handedAt, leaveConfirm]);
  const lastPhase = useRef(submitCopy.phase);
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = submitCopy.phase;
    if (submitCopy.phase === previous) return;
    if (submitCopy.phase === "blocked") setFlash("failed");
    // 영수증이 이 창에 닿지 않는 대화로 갔어도 — 도는 제출이 끝나 요청이 섰으면 보냈다.
    else if (
      submitCopy.phase === "idle" &&
      (previous === "running" || previous === "retrying") &&
      daemon.repo?.handoff
    ) {
      leaveConfirm();
      setFlash("done");
    }
  }, [submitCopy.phase, daemon.repo?.handoff, leaveConfirm]);

  // 제출의 성공 이야기 — 순서는 submit-story.ts 의 판정이 정한다: 그려지는
  // 체크 → 첫 막대 → 둘째 점. 타이머만 돌리고 모양은 클래스가 입는다.
  const [story, setStory] = useState<"draw" | "bar" | "point" | null>(null);
  useEffect(() => {
    if (flash !== "done") {
      setStory(null);
      return;
    }
    setStory(submitStoryPhase(0));
    const atBar = window.setTimeout(
      () => setStory(submitStoryPhase(SUBMIT_STORY_BAR_MS)),
      SUBMIT_STORY_BAR_MS,
    );
    const atPoint = window.setTimeout(
      () => setStory(submitStoryPhase(SUBMIT_STORY_POINT_MS)),
      SUBMIT_STORY_POINT_MS,
    );
    return () => {
      window.clearTimeout(atBar);
      window.clearTimeout(atPoint);
    };
  }, [flash]);

  // 실패는 붉어지기 전에 잠깐 흔들린다 — 동작을 줄이는 탭에서는 곧장 붉어진다.
  const [redOn, setRedOn] = useState(false);
  useEffect(() => {
    if (flash !== "failed") {
      setRedOn(false);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setRedOn(true);
      return;
    }
    const timer = window.setTimeout(() => setRedOn(true), SUBMIT_SHAKE_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // 지금 점이 앞으로 오르면 새 점이 한 번 맥동한다 — 점은 국면이 바뀌어도
  // 버려지지 않으므로(key 를 번호로) 전환으로 이어진다.
  const seenCurrent = useRef(journey.current);
  const [pulseAt, setPulseAt] = useState<number | null>(null);
  useEffect(() => {
    const rose = journey.current > seenCurrent.current;
    seenCurrent.current = journey.current;
    if (!rose) return;
    setPulseAt(journey.current);
    const timer = window.setTimeout(() => setPulseAt(null), 700);
    return () => window.clearTimeout(timer);
  }, [journey.current]);

  // 점 전환의 낭독 — 보이는 점들(aria-hidden)은 색만으로는 소리가 없다. 점의
  // 글자가 바뀔 때만 한 문장을 말하고, 첫 마운트는 조용히 지나간다
  // (2026-10-04 ux-review).
  const seenPoint = useRef(journey.points[journey.current]?.label ?? null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    const label = journey.points[journey.current]?.label;
    if (!label || seenPoint.current === null) {
      seenPoint.current = label ?? null;
      return;
    }
    if (label === seenPoint.current) return;
    seenPoint.current = label;
    setAnnounce(L.journey.nowPoint(label));
  }, [journey.current, journey.points]);

  const busy = submit.busy ?? (sending ? "running" : null);
  const reviewers =
    submit.more && daemon.repo?.handoff?.reviewers && daemon.repo.handoff.reviewers.length > 0
      ? daemon.repo.handoff.reviewers
      : (project?.reviewers ?? []);

  // 두 팝이 화면 하나를 여는 길 — 미리보기를 그 화면으로 옮기고, 좁은 창이면 미리보기 탭을 앞에 세운다.
  const openScreen = (screen: CycleScreen) => {
    openScreenPath(screen.route);
    nav.showTab("preview");
  };

  const send = (note: string, head: string, token: string, sent?: SubmitSent) => {
    if (!journey.submit.enabled || sending || reviewChanged) return;
    setSending(true);
    setSendError(null);
    onSubmit();
    daemon.api
      .submit(sessions.activeId, note || undefined, head, token, sent)
      .then(() => {
        leaveConfirm();
        // 보낸 한마디는 다음 제출에 다시 실리지 않게 비운다 — 프로젝트별 로컬
        // 저장은 보내지 못한 초안의 몫이다(2026-10-04 ux-review).
        setNote("");
      })
      .catch((error) => {
        console.error("[colonova-design] submit", error);
        // 내용이 바뀐 것은 목록이 옛것이라는 말이고, 그 밖은 목록 그대로 다시 보내면 된다.
        setSendError(String(error).includes("SUBMIT_CHANGED") ? "changed" : "failed");
      })
      .finally(() => setSending(false));
  };

  return (
    <header
      className={`nx-statusbar nx-cycle--${journey.cycle}${journey.blocked ? " nx-blocked" : ""}`}
    >
      {sidebarHidden && (
        <button
          type="button"
          className="nx-ibtn"
          title={narrow ? L.shell.menu : keyHint(L.sidebar.expand)}
          aria-label={narrow ? L.shell.menu : keyHint(L.sidebar.expand)}
          onClick={onOpenSidebar}
        >
          {narrow ? <MenuIcon /> : <PanelIcon />}
        </button>
      )}
      {!narrow && <ConvTitle key={sessions.activeId ?? "new"} title={title} onRename={onRename} />}
      <div
        className={`nx-anchor nx-project-work${makingState === "on" ? " nx-project-work--making" : ""}`}
      >
        <span className="nx-work-scope" title={L.journey.projectWork(scopeName)}>
          <b>{scopeName}</b>
          <span className="nx-work-scope-rest">{` · ${L.journey.projectScope}`}</span>
        </span>
        <button
          ref={journeyRef}
          type="button"
          className={`nx-journey${makingState === "on" ? " nx-journey--making" : ""}`}
          title={`${L.journey.projectWork(scopeName)} · ${L.journey.openWork}`}
          aria-haspopup="dialog"
          aria-expanded={workOpen}
          aria-label={workName}
          onClick={() => {
            if (!workOpen) ledger.refresh();
            setConfirmOpen(false);
            setWorkOpen((open) => !open);
          }}
        >
          <span
            className={`nx-making${makingState === "off" ? " nx-making--off" : ""}`}
            aria-hidden="true"
          >
            <span className="nx-making-in">
              {makingState === "check" ? (
                <span className="nx-making-check">
                  <SentIcon />
                </span>
              ) : makingState === "on" ? (
                <Spin />
              ) : null}
              <RollingWord text={makingText} />
              {makingState === "on" && turnStartedAt !== null && !narrow && (
                <Elapsed
                  startedAt={turnStartedAt}
                  hintAfterMs={firstTurn ? FIRST_TURN_HINT_MS : undefined}
                  hint={firstTurn ? L.journey.firstTurnHint : undefined}
                />
              )}
            </span>
          </span>
          {journey.points.map((point, index) => {
            // 성공 이야기의 둘째 점 — 지금 점이 되기 전에 잠깐 켜진다.
            const storyLit = story === "point" && index === 1;
            const pulsing = index === (pulseAt ?? -1) || storyLit;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: 점의 자리가 곧 정체다 — 글자를 key 로 쓰면 국면이 바뀔 때 점이 버려져 전환이 끊긴다.
              <span key={index} className="nx-jwrap" aria-hidden="true">
                {index > 0 && (
                  <span
                    className={`nx-jbar${
                      journey.points[index - 1]?.state === "done" || (story !== null && index === 1)
                        ? " nx-jbar--full"
                        : ""
                    }`}
                  />
                )}
                <span
                  className={`nx-jstep nx-jstep--${point.state}${storyLit ? " nx-jstep--lit" : ""}${pulsing ? " nx-jstep--pulse" : ""}${narrow && index !== journey.current ? " nx-jstep--bare" : ""}`}
                >
                  {/* 지난 점은 채움 차이에 그치지 않게 점 안에 체크를 새긴다 —
                      저대비 테마에서도 모양으로 남는다(2026-10-04 ux-review). */}
                  <i aria-hidden="true">{point.state === "done" && <SentIcon />}</i>
                  {(!narrow || index === journey.current) && (
                    <span className="nx-jl" key={point.label}>
                      {point.label}
                    </span>
                  )}
                </span>
              </span>
            );
          })}
        </button>
        {/* 보이지 않는 낭독 칸 — 점의 글자가 바뀔 때만 소리를 낸다. */}
        <span className="nx-sr" role="status">
          {announce}
        </span>
        {workOpen && (
          <WorkPopover
            anchor={journeyRef}
            journey={journey}
            project={project}
            repo={daemon.repo}
            ledger={ledger}
            author={daemon.status?.authorName ?? null}
            since={submitCopy.lastAt}
            noteDraft={workNote}
            onNoteDraft={setWorkNote}
            onNote={async (text) => {
              await daemon.api.noteToDeveloper(text);
            }}
            onOpenScreen={openScreen}
            onToast={nav.toast}
            onClose={() => setWorkOpen(false)}
          />
        )}
      </div>
      <div className="nx-anchor">
        <button
          ref={submitRef}
          type="button"
          className={`nx-submit${
            flash === "done"
              ? " nx-submit--sent"
              : flash === "failed"
                ? redOn
                  ? " nx-submit--failed"
                  : " nx-submit--shaking"
                : busy
                  ? " nx-submit--busy"
                  : submit.enabled
                    ? ""
                    : " nx-submit--locked"
          }`}
          // 말풍선이 떠 있는 동안은 같은 문장이 툴팁으로 또 뜨지 않게 뺀다.
          title={why ? undefined : submit.reason}
          aria-disabled={!submit.enabled || busy !== null}
          aria-describedby={why ? "nx-submit-why" : undefined}
          aria-haspopup="dialog"
          aria-expanded={confirmOpen}
          aria-busy={busy !== null || undefined}
          aria-live="polite"
          onFocus={() => {
            // 제출이 막 끝났다면 닫히는 판이 돌려주는 초점이다 — 잠긴 이유를 `제출됐어요` 위에 띄우지 않는다.
            if (Date.now() < quietUntil.current) return;
            // 잠긴 채로 닿아도 이유가 서고, 포커스가 머무는 동안 사라지지 않는다.
            if (!submit.enabled) {
              setWhyHeld(true);
              setWhyLive(false);
              setWhy(submit.reason);
            }
          }}
          onBlur={() => setWhyHeld(false)}
          onClick={() => {
            if (busy || flash === "done") return;
            if (!submit.enabled) {
              setConfirmOpen(false);
              setWhyLive(true);
              setWhy(submit.reason);
              return;
            }
            setWhy(null);
            setWorkOpen(false);
            if (!confirmOpen) loadSubmission();
            setConfirmOpen((open) => !open);
          }}
        >
          {/* 다섯 얼굴을 한 자리에 겹쳐 둔다 — 단추 폭이 가장 넓은 얼굴에 맞아
              고정되고, 얼굴은 150ms 교차 페이드로 갈아입는다(왼쪽 여정이 밀리지
              않게). 잠긴 얼굴은 쉬는 얼굴과 같은 글자다. 갈아입은 결판은 살아있는 영역이 소리로도 흐른다. */}
          <span className="nx-submit-face" aria-hidden={busy !== null || flash !== null}>
            {L.submit.idle}
          </span>
          <span className="nx-submit-face" aria-hidden={busy !== "running"}>
            <Spin />
            {L.submit.running}
          </span>
          <span className="nx-submit-face" aria-hidden={busy !== "retrying"}>
            <Spin />
            {L.submit.retrying}
          </span>
          <span className="nx-submit-face" aria-hidden={flash !== "done"}>
            <DrawnCheck />
            {L.submit.done}
          </span>
          <span className="nx-submit-face" aria-hidden={flash !== "failed"}>
            <FailIcon />
            {submitCopy.label}
          </span>
        </button>
        {confirmOpen && (
          <SubmitPopover
            anchor={submitRef}
            journey={journey}
            snapshot={snapshot}
            projectName={project?.name ?? L.sidebar.brand}
            loading={reviewLoading}
            readFailed={readFailed}
            sendFailed={sendError === "failed"}
            busy={sending}
            changed={reviewChanged}
            lockReason={submit.enabled ? null : submit.reason}
            since={submitCopy.lastAt}
            loadDraft={() => daemon.api.handoffDraft()}
            openTitle={daemon.repo?.handoff?.title ?? null}
            leaveToken={leaveToken}
            onRefresh={loadSubmission}
            reviewers={reviewers}
            onClose={() => {
              setConfirmOpen(false);
              // 스크림을 눌러 닫으면 누름의 기본 동작이 초점을 허공으로 옮긴다 — 열었던 단추로 되돌린다.
              if (document.activeElement === document.body) submitRef.current?.focus();
            }}
            onConfirm={send}
            note={noteDraft.key === noteKey ? noteDraft.text : ""}
            onNote={setNote}
            onPreview={(screen) => {
              setConfirmOpen(false);
              openScreen(screen);
            }}
            onCompare={(screen) =>
              openComparison({
                route: screen.route,
                title: screen.title,
                requestId: screen.requestId,
                sha: screen.sha,
              })
            }
          />
        )}
        {why && (
          <div id="nx-submit-why" className="nx-why" role={whyLive ? "status" : undefined}>
            <LockIcon />
            <span>{why}</span>
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * 세로로 굴러가는 단어 한 개 — 갈아입는 순간에 나가는 말은 위로, 들어오는
 * 말은 아래에서 온다(status.css 의 `nx-roll`). 잠깐 둘 다 그려지는 동안 폭은
 * 넓은 쪽을 지킨다.
 */
function RollingWord({ text }: { text: string }) {
  const [pair, setPair] = useState<{ cur: string; prev: string | null }>({ cur: text, prev: null });
  useEffect(() => {
    setPair((prev) => (prev.cur === text ? prev : { cur: text, prev: prev.cur }));
  }, [text]);
  useEffect(() => {
    if (pair.prev === null) return;
    const timer = window.setTimeout(() => setPair((prev) => ({ ...prev, prev: null })), 240);
    return () => window.clearTimeout(timer);
  }, [pair]);
  return (
    <span className="nx-roll">
      {pair.prev !== null && (
        <span key={pair.prev} className="nx-roll-word nx-roll-out">
          {pair.prev}
        </span>
      )}
      <span key={pair.cur} className="nx-roll-word nx-roll-in">
        {pair.cur}
      </span>
    </span>
  );
}
