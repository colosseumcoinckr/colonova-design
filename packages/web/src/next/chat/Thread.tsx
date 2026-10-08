import {
  alignThumbs,
  type LostSend,
  type QueuedSend,
  type RepoStatus,
  readTurn,
} from "@colonova-design/protocol";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Tip } from "../../components/Tip";
import { ActivitySummary, groupActivity } from "../../components/transcript/activity";
import { ThinkingBlock, ToolBlock } from "../../components/transcript/blocks";
import { TodoCard } from "../../components/transcript/todo";
import type { Block } from "../../lib/daemon-client";
import { previewPathOf, screenPath } from "../../lib/screen-link";
import { blockOnTape, mergeThinking } from "../../lib/tape-visibility";
import { turnAnswerText, turnBlockNumbers } from "../../lib/turn-numbering";
import { type TurnScreen, withoutTrailingScreenLinks } from "../../lib/turn-screens";
import { L } from "../labels";
import { assistantDisplay } from "../lib/assistant-display";
import { hasLandedFacts, landedIsFresh } from "../lib/landed";
import { shownPinLabel } from "../lib/pin-name";
import { requestResults } from "../lib/request-results";
import {
  failureCards,
  failWhy,
  noticeKind,
  plainExcerpt,
  promptNumbers,
  rawErrorLine,
  retryCount,
  screenTitle,
  textRoles,
} from "../lib/thread";
import { openComparison } from "../preview/ComparisonDialog";
import {
  BriefCard,
  CiCard,
  FailCard,
  GateCard,
  NoticeCard,
  ReceiptCard,
  ReviewCard,
  reviewParts,
} from "./cards";
import {
  CheckIcon,
  ClockIcon,
  EditIcon,
  FwdIcon,
  InfoIcon,
  ScreenIcon,
  SparkIcon,
  UndoIcon,
} from "./icons";
import { LandedCard } from "./LandedCard";
import { type LoadComparison, ResultScreen } from "./ResultScreens";
import { SettleLine } from "./SettleLine";

/** CLI 가 사람의 말이나 답인 척 내려놓는 살림 줄 — 사람의 말이 아니다. */
const INTERRUPTED = "[Request interrupted by user]";
const NO_RESPONSE = "No response requested.";

type TurnBlock = Extract<Block, { type: "turn" }>;
type Row = ReturnType<typeof groupActivity>[number];

function failed(block: TurnBlock): boolean {
  return block.isError || (block.subtype !== "" && block.subtype !== "success");
}

/** 사람의 마지막 보내기(기계 턴 말고, 핀 묶음은 살려) — `다시 시도` 가 다시 보내는 말과 몫. */
function lastOwnSend(blocks: readonly Block[]): Extract<Block, { type: "user" }> | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type !== "user") continue;
    const { marker } = readTurn(block.text);
    if (marker === null || marker.kind === "comments") return block;
  }
  return null;
}

function Note({ children, tone }: { children: ReactNode; tone?: "red" }) {
  return (
    <div className={`nx-m-note${tone === "red" ? " nx-tone--red" : ""}`}>
      <ClockIcon />
      <span>{children}</span>
    </div>
  );
}

export interface ThreadProps {
  blocks: Block[];
  /** 이 대화의 답이 도는 중인가. */
  live: boolean;
  showThinking: boolean;
  showTools: boolean;
  /** 미리보기 서버의 주소 — 답의 링크가 이 미리보기의 화면인지 가른다. */
  previewUrl: string | null;
  /** 이번 작업의 화면 이름 — 제목 없는 `고친 화면` 카드가 여기서 제목을 찾는다. */
  cycleScreens: RepoStatus["cycleScreens"];
  handoff: RepoStatus["handoff"];
  /** 이 프로젝트에서 AI 가 도는가 — 코멘트 카드의 `AI가 반영하는 중`. */
  projectWorking: boolean;
  /** 갈래를 낼 수 있는 AI 인가 — 여기서 새 대화 · 고쳐서 다시 보내기(2번째 말부터). */
  canBranch: boolean;
  queue: QueuedSend[];
  /** 준비 중에 보낸 말인가 — 대기 줄의 한 줄이 달라진다(U8). */
  preparing: boolean;
  /** 이 대화가 잃은 말(데몬의 회복 방) — 실패 카드가 된다(W8). */
  dropped: LostSend[];
  onFork: (turn: number) => void;
  onEditResend: (prompt: number, send: Extract<Block, { type: "user" }>) => void;
  onRetry: (send: Extract<Block, { type: "user" }>) => void;
  /** 잃은 말의 `다시 시도` — 되살려 다시 보낸다(입력창이 쓰던 길). */
  onRetryDropped: (itemId: string) => void;
  /** 계정류 실패 카드의 `다른 계정으로 로그인` — 이미 있는 AI 로그인 길(`onboarding.fix`)을 연다. 없으면 단추도 없다. */
  onLogin?: () => void;
  onOpenScreen: (screen: TurnScreen) => void;
  onAdditionalEdit: (screen: TurnScreen) => void;
  loadComparison: LoadComparison;
  onOpenHistory: () => void;
  /**
   * `방금 한 것 되돌리기` — 마지막 결과(그 요청의 보관이 프로젝트 기록의 맨 위일 때)에만 선다. 없으면 단추도 없고
   * 작업 기록이 맡는다(`lib/undo-last.ts`).
   */
  undoLast?: { requestId: string; onUndo: () => void } | null;
  onReply: (id: number, text: string) => Promise<void>;
  /** 영수증의 `한마디 더`(U20) — 열린 요청에 코멘트로 남긴다. */
  onNote: (text: string) => Promise<void>;
  onToast: (text: string) => void;
  onQueueEdit: (itemId: string) => void;
  onQueueNow: (itemId: string) => void;
  onBackgroundTask: (toolUseId: string) => void;
  onStopTask: (taskId: string) => void;
}

/**
 * 대화록(PLAN-UI 단계 2) — 블록 그리기는 옛 대화록의 부품(활동 · 생각 · 도구 ·
 * 할 일 · 마크다운)을 그대로 빌리고, 사람의 말 · AI 답 · 카드 · 정산 줄은 목업의
 * 모양으로 새로 선다. 답마다 그 답이 말한 화면의 `고친 화면` 카드(U5)가 정산 줄
 * 위에 선다.
 */
export function Thread(props: ThreadProps) {
  const { blocks, live, showThinking, showTools } = props;
  const tape = mergeThinking(blocks.filter((block) => blockOnTape(block, showThinking, showTools)));
  const rows: Row[] = groupActivity(
    live
      ? tape
      : tape.map((block) =>
          block.type === "thinking" && block.streaming ? { ...block, streaming: false } : block,
        ),
  );

  // 끝난 턴의 할 일만 대화록에 남는다 — 도는 턴의 목차는 입력창 위의 몫이다.
  const endedTodos = new Set<string>();
  let todosSoFar: string[] = [];
  for (const block of blocks) {
    if (block.type === "tool" && block.name === "TodoWrite") todosSoFar.push(block.id);
    else if (block.type === "turn") {
      for (const id of todosSoFar) endedTodos.add(id);
      todosSoFar = [];
    }
  }

  // 한 답 묶음(사람의 말 뒤부터 답이 끝날 때까지)에서 마지막 말이 답이고 그 앞의
  // 말은 과정이다 — 과정은 타임라인으로 그리고(A) 답이 끝나면 한 줄로 접는다.
  // 도는 중에도 마지막 말은 처음부터 답 모양으로 선다: 답이 끝나는 순간 모양이
  // 바뀌며 다시 마운트되어 글의 크기 · 자리 · 색이 한꺼번에 바뀌는 일이 없게.
  // 뒤에 이어 온 글이 답 자리를 받으면 앞의 글은 과정으로 내려간다.
  const roles = textRoles(tape, live);
  const [openSteps, setOpenSteps] = useState<ReadonlySet<string>>(new Set());
  const toggleSteps = (key: string) =>
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 이번 창에서 펼쳐져 본 과정 — 접힘의 높이 애니메이션은 이 묶음에만 돈다.
  // 처음부터 접힌 채로 불려 온 옛 대화는 그리지도 않는다(펼치면 그때 올라온다).
  const openedSteps = useRef<ReadonlySet<string>>(new Set());
  // 답 자리였다가 과정으로 내려간 글 — 그 내려갬을 한 번 부드럽게 한다. 표식은
  // 강등된 뒤로도 남는다(흐르는 이어 렌더 사이에서 애니메이션이 끊기지 않게).
  const answerSeen = useRef<ReadonlySet<string>>(new Set());
  const demotedEver = useRef<ReadonlySet<string>>(new Set());
  const demoteNow = new Set<string>();
  for (const id of answerSeen.current) if (!roles.answers.has(id)) demoteNow.add(id);
  if (demoteNow.size > 0) demotedEver.current = new Set([...demotedEver.current, ...demoteNow]);
  answerSeen.current = roles.answers;
  // 이번 창에서 살아 있던 답 — 첫 그림에 없던 마감(턴)은 이 창에서 막 끝난 답이다.
  // 끝난 답의 보상(고친 화면 카드 · 체크)은 이 답에만 한 번.
  const historyTurns = useRef<ReadonlySet<string> | null>(null);
  if (historyTurns.current === null) {
    historyTurns.current = new Set(
      blocks.filter((block) => block.type === "turn").map((block) => block.id),
    );
  }
  answerSeen.current = roles.answers;
  // 이번 창에서 막 도착한 반영 — 성취 카드의 체크는 이때 한 번 그려진다(첫 그림에 있던 카드는 이미 끝난 일이다).
  const historyMiles = useRef<ReadonlySet<string> | null>(null);
  if (historyMiles.current === null) {
    historyMiles.current = new Set(
      blocks.filter((block) => block.type === "milestone").map((block) => block.id),
    );
  }

  const prompts = promptNumbers(blocks);
  const turnNumbers = turnBlockNumbers(blocks);
  const turnAnswers = turnAnswerText(blocks);
  const toPath = (href: string) => previewPathOf(href, props.previewUrl);

  const plainAnswer = (text: string) =>
    assistantDisplay(withoutTrailingScreenLinks(text, toPath), {
      heading: L.chat.technicalHeading,
      references: L.chat.technicalReferences,
      screenCheckTool: L.chat.screenCheckTool,
      browserFindTool: L.chat.browserFindTool,
      browserInspectTool: L.chat.browserInspectTool,
      screenFilesTool: L.chat.screenFilesTool,
      diagnosticsTool: L.chat.diagnosticsTool,
      elementReference: L.chat.elementReference,
      fileReference: L.chat.fileReference,
    }).answer;
  // 턴 끝마다: 그 턴이 말한 화면과 마지막 답 한 조각.
  const results = requestResults(blocks, props.cycleScreens);
  const screensByTurn = new Map<string, TurnScreen[]>();
  const lastAnswerByTurn = new Map<string, string>();
  const requestByTurn = new Map<string, string>();
  // `고친 화면` 카드가 서는 답의 글 — 끝의 화면 링크 줄은 카드와 같은 말이라 글에서 뺀다.
  const cardedTexts = new Set<string>();
  let segmentStart = 0;
  let lastText: string | null = null;
  blocks.forEach((block, index) => {
    if (block.type === "user") {
      segmentStart = index + 1;
      lastText = null;
    } else if (block.type === "text" && block.agentId === null) {
      lastText = block.text;
    } else if (block.type === "turn") {
      {
        const result = results.get(block.id);
        const screens = (result?.screens ?? []).map((screen) => ({
          path: screen.route,
          title: screen.title,
        }));
        if (result) requestByTurn.set(block.id, result.requestId);
        screensByTurn.set(block.id, screens);
        if (screens.length > 0 && !failed(block)) {
          for (const earlier of blocks.slice(segmentStart, index)) {
            if (earlier.type === "text" && earlier.agentId === null) cardedTexts.add(earlier.id);
          }
        }
      }
      if (lastText !== null) lastAnswerByTurn.set(block.id, lastText);
    }
  });

  let lastUserId: string | null = null;
  let lastFailedId: string | null = null;
  let lastHumanId: string | null = null;
  for (const block of blocks) {
    if (block.type === "user") lastUserId = block.id;
    if (block.type === "turn" && failed(block)) lastFailedId = block.id;
    if (block.type === "human") lastHumanId = block.id;
  }
  const ownSend = lastOwnSend(blocks);
  // 잃은 말의 실패 카드(W8) — 대화록이 이미 말하는 실패와 겹치면 하나만 선다.
  const lost = failureCards(props.dropped, blocks);
  const handedPrs = new Set<number>();

  const isRetryRow = (row: Row | undefined): boolean =>
    row?.kind === "block" &&
    row.block.type === "notice" &&
    noticeKind(row.block.text, L.daemonNotice) === "retry";

  // 한 사람 말 뒤의 첫 AI 답에만 얼굴이 선다 — 이어지는 조각은 그 아래로 줄을 맞춘다.
  let aiOpened = false;

  const render = (row: Row, index: number): ReactNode => {
    if (row.kind === "activity") {
      return (
        <div className="nx-m-work">
          <ActivitySummary
            steps={row.steps}
            controls={{ onBackgroundTask: props.onBackgroundTask, onStopTask: props.onStopTask }}
          />
        </div>
      );
    }
    if (row.kind === "todo") {
      if (live && !endedTodos.has(row.block.id)) return null;
      return (
        <div className="nx-m-work">
          <TodoCard block={row.block} />
        </div>
      );
    }
    const block = row.block;
    switch (block.type) {
      case "user": {
        aiOpened = false;
        const { marker, body } = readTurn(block.text);
        const running = live && block.id === lastUserId;
        if (marker?.kind === "gate" || marker?.kind === "error") {
          return (
            <GateCard marker={marker} body={body} fixing={running} result={block.gateResult} />
          );
        }
        if (marker?.kind === "brief") return <BriefCard marker={marker} body={body} />;
        if (marker?.kind === "notice") return <NoticeCard marker={marker} body={body} />;
        if (marker?.kind === "ci") return <CiCard marker={marker} body={body} fixing={running} />;
        if (marker?.kind === "review") {
          return (
            <ReviewCard
              author={marker.author}
              at={null}
              texts={[{ key: "brief", text: L.chat.reviewText }]}
              replyId={marker.id ?? null}
              fixing={running}
              body={body}
              onReply={props.onReply}
              onToast={props.onToast}
            />
          );
        }
        if (block.text.trim() === INTERRUPTED) return <Note>{L.transcript.stopped}</Note>;
        if (block.text.trim() === NO_RESPONSE) return null;
        const prompt = prompts.get(block.id) ?? 1;
        // 핀 묶음도 고쳐서 보내기의 길에 선다 — 문장만 입력창에서 고치고 몫은
        // 원래 턴에서 온다(2026-10-04 ux-plan PR1).
        const own = marker === null || marker.kind === "comments";
        const canResend = own && block.text.trim() !== "" && (prompt === 1 || props.canBranch);
        const thumbs = marker?.kind === "comments" ? alignThumbs(marker.items, block.thumbs) : [];
        return (
          <div className="nx-m-user">
            <div className="nx-bub">
              {(block.images > 0 || (block.files?.length ?? 0) > 0) && marker === null && (
                <div className="nx-batts">
                  {block.images > 0 && (
                    <span className="nx-tag">{L.chat.images(block.images)}</span>
                  )}
                  {block.files?.map((name) => (
                    <span key={name} className="nx-tag">
                      {name}
                    </span>
                  ))}
                </div>
              )}
              {marker?.kind === "comments" && (
                <div className="nx-bpins">
                  {marker.items.map((item, at) => (
                    <div key={item.id ?? at} className="nx-bpin">
                      {/* 번호는 사진이 있어도 선다 — 미리보기에서 찍은 번호와 이어 읽힌다. */}
                      <span className={`nx-bpin-lead${thumbs[at] ? " nx-bpin-lead--shot" : ""}`}>
                        {thumbs[at] && (
                          <img
                            className="nx-bpin-shot"
                            src={`data:image/jpeg;base64,${thumbs[at]}`}
                            alt=""
                          />
                        )}
                        <span className="nx-pnum nx-pnum--sent">{at + 1}</span>
                      </span>
                      <span className="nx-bpin-text">
                        {/* 긴 이름은 한 줄로 줄어들므로 전체 이름은 title 에 둔다 — 잘린 글을 보여 주는 자리다. */}
                        <b className="nx-bpin-name" title={shownPinLabel(item.label, L.pin.point)}>
                          {shownPinLabel(item.label, L.pin.point)}
                        </b>
                        {item.comment && <span className="nx-bpin-note">{item.comment}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {marker?.kind === "comments" ? (
                marker.note && <div className="nx-btxt">{marker.note}</div>
              ) : (
                <div className="nx-btxt">{block.text}</div>
              )}
              {/* 고쳐서 다시 보내기 — 말풍선의 왼쪽 아래 옆자리에 매달려 세로 자리를 먹지 않는다.
                  이름은 aria-label 이, 뜻(새 대화로 갈라서 고친다 · 화면은 그대로)은 툴팁이 맡는다. */}
              {canResend && (
                <Tip
                  label={L.transcript.editResendTip}
                  side="top"
                  align="start"
                  className="nx-bub-edit"
                >
                  <button
                    type="button"
                    // 마지막 말의 것만 늘 연하게 보인다 — AI 가 엉뚱할 때 가장 먼저 찾는 탈출구다.
                    className={`nx-bub-editbtn${block.id === lastUserId ? " nx-bub-editbtn--last" : ""}`}
                    aria-label={L.transcript.editResend}
                    onClick={() => props.onEditResend(prompt, block)}
                  >
                    <EditIcon />
                  </button>
                </Tip>
              )}
            </div>
          </div>
        );
      }
      case "text": {
        const trimmed = block.text.trim();
        if (trimmed === NO_RESPONSE) return null;
        if (trimmed === INTERRUPTED) return <Note>{L.transcript.stopped}</Note>;
        const step = roles.steps.get(block.id);
        if (step) {
          // 과정 문장 — 답이 끝나면 한 줄로 접힌다(A). 이번 창에서 펼쳐져 본
          // 묶음은 높이를 줄이며 부드럽게 접히고, 처음부터 접힌 옛 대화는
          // 그리지 않는다(펼치면 그때 올라온다). 얼굴은 답에만 선다.
          const open = !step.settled || openSteps.has(step.key);
          if (open) {
            const next = new Set(openedSteps.current);
            next.add(step.key);
            openedSteps.current = next;
          }
          const seen = openedSteps.current.has(step.key);
          if (!open && !seen && !step.head) return null;
          const demoted = demotedEver.current.has(block.id);
          return (
            <>
              {step.settled && step.head && (
                <button
                  type="button"
                  className={`nx-m-fold${open ? " nx-m-fold--on" : ""}`}
                  aria-expanded={open}
                  onClick={() => toggleSteps(step.key)}
                >
                  <FwdIcon />
                  {L.transcript.stepsFold}
                </button>
              )}
              {seen && (
                <div
                  className={`nx-m-stepwrap${open ? "" : " nx-m-stepwrap--gone"}${
                    demoted ? " nx-m-stepwrap--was" : ""
                  }`}
                  inert={!open}
                >
                  <div className={`nx-m-step${demoted ? " nx-m-step--was" : ""}`}>
                    <Markdown text={block.text} />
                  </div>
                </div>
              )}
            </>
          );
        }
        const first = !aiOpened;
        aiOpened = true;
        const shown = cardedTexts.has(block.id)
          ? withoutTrailingScreenLinks(block.text, toPath)
          : block.text;
        const display = assistantDisplay(shown, {
          heading: L.chat.technicalHeading,
          references: L.chat.technicalReferences,
          screenCheckTool: L.chat.screenCheckTool,
          browserFindTool: L.chat.browserFindTool,
          browserInspectTool: L.chat.browserInspectTool,
          screenFilesTool: L.chat.screenFilesTool,
          diagnosticsTool: L.chat.diagnosticsTool,
          elementReference: L.chat.elementReference,
          fileReference: L.chat.fileReference,
        });
        return (
          <div
            className={`nx-m-ai${first ? "" : " nx-m-ai--cont"}${
              first && block.streaming ? " nx-m-ai--live" : ""
            }`}
          >
            <div className="nx-av" aria-hidden="true">
              {first && (
                <span className="nx-av-spark">
                  <SparkIcon />
                </span>
              )}
            </div>
            <div className={`nx-m-body${block.streaming ? " nx-m-live" : ""}`}>
              <Markdown text={display.answer} />
              {display.technical !== null && (
                <details className="nx-card-fold nx-answer-details">
                  <summary>{L.chat.technicalDetails}</summary>
                  <div className="nx-answer-details-body">
                    <Markdown text={display.technical} />
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      }
      case "thinking":
        return (
          <div className="nx-m-work">
            <ThinkingBlock block={block} />
          </div>
        );
      case "tool":
        return (
          <div className="nx-m-work">
            <ToolBlock
              block={block}
              onBackgroundTask={props.onBackgroundTask}
              onStopTask={props.onStopTask}
            />
          </div>
        );
      case "turn": {
        if (failed(block)) {
          if (block.subtype === "interrupted") return <Note>{L.transcript.stopped}</Note>;
          const why = failWhy(block, L);
          const retrySend = block.id === lastFailedId ? ownSend : null;
          return (
            <FailCard
              why={why}
              notified={block.escalated === true}
              live={live}
              retry={retrySend ? () => props.onRetry(retrySend) : null}
              // 계정류 실패(2026-10-07)만 다시 로그인하는 길을 든다 — 계정을 바꾸고 다시 시도한다.
              onLogin={block.failure === "account" ? (props.onLogin ?? null) : null}
            />
          );
        }
        const turnNo = turnNumbers.get(block.id) ?? 1;
        const whole = turnAnswers.get(block.id) ?? block.resultText ?? null;
        const screens = screensByTurn.get(block.id) ?? [];
        const result = results.get(block.id);
        const requestText = result?.prompt.trim() ?? "";
        const excerpt =
          screens.length > 0 ? plainExcerpt(plainAnswer(result?.explanation ?? ""), 200) : "";
        // 요청과 설명은 화면 확인이 문제를 찾아 AI 가 스스로 고친 요청에서만 다시 적는다 — 그때는 카드와 원래 요청 ·
        // 답 사이에 고침 카드가 끼어 어느 요청의 카드인지 멀어진다. 끼지 않았으면 카드 바로 위가 그 요청의 답이다.
        const showContext = result?.repaired === true && (requestText !== "" || excerpt !== "");
        // 이번 창에서 막 끝난 답 — 보상(카드 · 체크)은 이 답에만 한 번.
        const fresh = !historyTurns.current?.has(block.id);
        return (
          <>
            {screens.length > 0 && (
              <section
                className={`nx-results${fresh ? " nx-results--new" : ""}`}
                aria-label={L.transcript.shotLabel}
              >
                <div className="nx-results-heading">
                  <ScreenIcon />
                  <span>{L.transcript.shotLabel}</span>
                  <span className="nx-results-count">{screens.length}</span>
                </div>
                {showContext && (
                  <dl className="nx-result-context">
                    {requestText !== "" && (
                      <div>
                        <dt>{L.requestResult.request}</dt>
                        <dd>{requestText}</dd>
                      </div>
                    )}
                    {excerpt !== "" && (
                      <div>
                        <dt>{L.requestResult.explanation}</dt>
                        <dd>{excerpt}</dd>
                      </div>
                    )}
                  </dl>
                )}
                <div className="nx-results-grid">
                  {screens.map((screen) => (
                    <ResultScreen
                      key={`${requestByTurn.get(block.id) ?? block.id}:${screen.path}`}
                      route={screenPath(screen.path)}
                      requestId={requestByTurn.get(block.id)}
                      loadComparison={props.loadComparison}
                      onToast={props.onToast}
                      title={screenTitle(screen, props.cycleScreens, {
                        homeScreen: L.preview.homeScreen,
                        unknownScreen: L.transcript.unknownScreen,
                      })}
                      onEdit={() => props.onAdditionalEdit(screen)}
                      onOpen={() => props.onOpenScreen(screen)}
                      onCompare={() =>
                        openComparison({
                          route: screen.path,
                          title: screen.title ?? L.transcript.unknownScreen,
                          ...(requestByTurn.get(block.id)
                            ? { requestId: requestByTurn.get(block.id) }
                            : {}),
                        })
                      }
                    />
                  ))}
                </div>
                {/* 사진이 어느 때의 모습인지는 카드마다 되풀이하지 않고 한 번만 말한다. */}
                {/* 턴 끝의 자동 확인이 문제 없이 지나갔을 때만 — 무엇을 열어 봤는지 실제로 본 것만 말한다. */}
                {result?.checked && (
                  <p className="nx-results-checked">
                    <CheckIcon />
                    <span>
                      {L.requestResult.checked(result.checked.screens, result.checked.phone)}
                    </span>
                  </p>
                )}
                <p className="nx-results-note">
                  <InfoIcon />
                  <span>{L.requestResult.historical}</span>
                </p>
                {props.undoLast != null &&
                  props.undoLast.requestId === requestByTurn.get(block.id) &&
                  !live && (
                    <div className="nx-results-undo">
                      <button
                        type="button"
                        className="nx-btn nx-btn--sm nx-btn--ghost"
                        title={L.requestResult.undoTip}
                        onClick={props.undoLast.onUndo}
                      >
                        <UndoIcon />
                        {L.requestResult.undo}
                      </button>
                    </div>
                  )}
              </section>
            )}
            <SettleLine
              durationMs={block.durationMs}
              whole={whole}
              lastAnswer={lastAnswerByTurn.get(block.id) ?? null}
              reward={fresh === true}
              onFork={props.canBranch && whole !== null ? () => props.onFork(turnNo) : null}
              onOpenHistory={props.onOpenHistory}
              onToast={props.onToast}
            />
          </>
        );
      }
      case "notice": {
        const kind = noticeKind(block.text, L.daemonNotice);
        if (kind === "retry") {
          // 스스로 다시 묻기는 한 줄로 접는다 — 줄의 끝에서만 말한다.
          const next = rows[index + 1];
          if (isRetryRow(next)) return null;
          const count = retryCount(block.text);
          if (!next) {
            return live && count ? <Note>{L.chat.retrying(count.n, count.of)}</Note> : null;
          }
          const exhausted = count !== null && count.n >= count.of;
          const nextFailed =
            next.kind === "block" && next.block.type === "turn" && failed(next.block);
          return nextFailed && exhausted ? <Note>{L.vocab.retriedFive}</Note> : null;
        }
        if (kind === "wait") return <Note>{L.chat.waitingLimit}</Note>;
        if (kind === "revive") return <Note>{L.transcript.revived}</Note>;
        // 데몬은 한국어 한 줄을 앞에 세우고 원문을 빈 줄 뒤에 붙인다 — 앞의 한 줄만 보인다.
        const cut = block.text.search(/\n[ \t]*\n/);
        const lead = (cut === -1 ? block.text : block.text.slice(0, cut)).trim();
        return <Note tone={block.level === "error" ? "red" : undefined}>{lead}</Note>;
      }
      case "save":
        // 보관은 답마다 도구가 스스로 한다 — 대화록에 남길 일이 아니다(작업 기록이 그 자리).
        return null;
      case "saveBlocked": {
        // 원문은 그대로 보이지 않는다(W3) — 한국어 고지만 지나가고, 나머지는
        // 받은 문장 아래 접힌다(cards.tsx 의 접힌 글과 같은 모양).
        const line = rawErrorLine(block.detail, L);
        return (
          <div>
            <Note tone="red">{line.title}</Note>
            {line.raw !== null && (
              <details className="nx-card-fold">
                <summary>{L.cards.detailFold}</summary>
                <pre>{line.raw}</pre>
              </details>
            )}
          </div>
        );
      }
      case "milestone": {
        if (block.subtype === "handed") {
          const more = handedPrs.has(block.pr);
          handedPrs.add(block.pr);
          return (
            <ReceiptCard
              block={block}
              more={more}
              handoff={props.handoff}
              onNote={props.onNote}
              onToast={props.onToast}
            />
          );
        }
        // 반영이 제목 · 며칠 · 화면 수를 알면 성취 카드로 선다 — 필드 없는 옛 사건은 얇은 한 줄 그대로다.
        if (block.subtype === "merged" && hasLandedFacts(block)) {
          return (
            <LandedCard
              block={block}
              fresh={!historyMiles.current?.has(block.id) && landedIsFresh(block.at, Date.now())}
            />
          );
        }
        return (
          <div className={`nx-mile${block.subtype === "closed" ? " nx-mile--red" : ""}`}>
            <span />
            <b>
              <CheckIcon />
              {block.subtype === "merged" ? L.cards.milestoneMerged : L.chat.closed}
            </b>
            <span />
          </div>
        );
      }
      case "human": {
        const parts = reviewParts(block.reviews);
        return (
          <ReviewCard
            {...parts}
            fixing={props.projectWorking && block.id === lastHumanId}
            onReply={props.onReply}
            onToast={props.onToast}
          />
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="nx-thread">
      {rows.map((row, index) => {
        const content = render(row, index);
        if (content === null) return null;
        return <Fragment key={row.kind === "block" ? row.block.id : row.id}>{content}</Fragment>;
      })}
      {lost.map((card) => (
        <Fragment key={card.id}>
          <div className="nx-m-user">
            <div className="nx-bub">
              <div className="nx-btxt">{card.text}</div>
              {(card.images > 0 || card.files > 0) && (
                <div className="nx-batts">
                  {card.images > 0 && <span className="nx-tag">{L.chat.images(card.images)}</span>}
                  {card.files > 0 && <span className="nx-tag">{L.chat.files(card.files)}</span>}
                </div>
              )}
            </div>
          </div>
          <FailCard
            why={L.chat.lostWhy}
            notified={false}
            retry={() => props.onRetryDropped(card.id)}
            live={live}
          />
        </Fragment>
      ))}
      {props.queue.map((item) => (
        <div key={item.id} className="nx-m-user">
          <div className="nx-bub">
            {item.text && <div className="nx-btxt">{item.text}</div>}
            <div className="nx-bq">
              <ClockIcon />
              {props.preparing ? L.transcript.queued : L.chat.queuedAfter}
            </div>
          </div>
          <div className="nx-bq-acts">
            <button
              type="button"
              className="nx-ue nx-ue--on"
              onClick={() => props.onQueueEdit(item.id)}
            >
              {L.chat.queueEdit}
            </button>
            {!props.preparing && (
              <button
                type="button"
                className="nx-ue nx-ue--on"
                onClick={() => props.onQueueNow(item.id)}
              >
                {L.chat.queueNow}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
