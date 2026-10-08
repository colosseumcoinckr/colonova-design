import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { requestInvitePicker } from "../../lib/invite-bus";
import { AlertIcon, MailIcon, PlugIcon, XIcon } from "../chat/icons";
import { L } from "../labels";
import {
  dismissedProblems,
  dismissProblem,
  hiddenProblemCount,
  type ProblemLineBody,
  problemFor,
  problemLineId,
} from "../lib/problem";
import { useCopied } from "../lib/use-copied";
import { blockedHelpText, SentIcon } from "./parts";

/**
 * 문제 문장 한 줄(README「화면의 문제 문장은 셋이다」) — 상태 줄 바로 아래, 대화와
 * 미리보기에 걸친 한 줄(목업의 `.problem`). 셋째(`다시 연결이 필요해요`)만 사람의 손이 필요하고 버튼이 선다.
 * 문제 문장이 없으면 방금 가져온 초대 파일의 `파일 지우기 · 나중에` 줄(U11)이
 * 그 자리를 쓴다.
 *
 * 감싸개는 한 번 뜬 뒤에는 자리를 지킨다 — 들어올 때 · 저절로 풀릴 때 모두
 * grid 줄(1fr ↔ 0fr)로 부드럽게 열리고 접힌다(problem.css). 마지막으로 보던
 * 줄을 기억해 접히는 동안 몸통으로 쓰고, `AI가 고치는 중` 이 풀리면 초록 체크를
 * 잠깐 보인 뒤 접는다.
 */
export function ProblemLine({
  daemon,
  invitePath,
  onClearInvite,
  onToast,
}: {
  daemon: Daemon;
  /** 지울 수 있는 초대 파일의 자리 — 셸의 이동 상태가 쥔다. */
  invitePath: string | null;
  onClearInvite: () => void;
  onToast: (text: string) => void;
}) {
  const problem = problemFor(daemon.status, daemon.repo, L);
  // 줄은 하나뿐이라 나머지 열린 문제는 끝의 `+N` 이 대신 말한다(2026-10-04 ux-review).
  const hidden = problem === null ? 0 : hiddenProblemCount(daemon.status, daemon.repo);
  const [login, setLogin] = useState<"idle" | "busy" | "started">("idle");
  // 닫은 문제의 신원 — 이 탭이 사는 동안 같은 문제의 줄은 다시 서지 않는다.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(dismissedProblems()));

  // 지금 보여야 할 것 — 문제가 먼저고, 없으면 초대 파일 줄. 몸통은 렌더마다
  // 새로 지어지므로 효과는 신원 문자열(problem.ts 의 problemLineId)에만 기대고,
  // 몸통은 같은 신원이면 갈아 끼우지 않는다.
  const shown: ProblemLineBody | null =
    problem && !(problem.dismissId !== null && closed.has(problem.dismissId))
      ? { kind: "problem", problem }
      : invitePath !== null
        ? { kind: "invite", path: invitePath }
        : null;
  const shownId = problemLineId(shown);

  // 마지막으로 보인 줄과 접힘 — 들고 날 때의 몸통과 grid 줄의 상태. 효과 안에서
  // 읽는 몸통은 ref 로 — 상태를 의존성에 넣으면 같은 고리로 다시 돈다.
  const [held, setHeld] = useState<ProblemLineBody | null>(shown);
  const heldRef = useRef(held);
  heldRef.current = held;
  const [open, setOpen] = useState(false);
  // 복사했다는 답은 1.5초 뒤 돌아온다 — 옛 단추는 `복사했어요` 로 영영 남았다(2026-10-06 겹판 조사).
  const { copied, copy } = useCopied(() => onToast(L.chat.somethingWrong));
  // 고침이 저절로 풀린 뒤의 체크 단계 — 접히기 전에 잠깐 선다.
  const [fixed, setFixed] = useState(false);
  const timers = useRef<number[]>([]);
  const later = useCallback((ms: number, after: () => void) => {
    timers.current.push(window.setTimeout(after, ms));
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) window.clearTimeout(t);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 몸통 객체는 렌더마다 새로 지어진다 — 신원 문자열이 곧 의존성이고 몸통은 그 회차의 것을 쓴다.
  useEffect(() => {
    if (shown !== null && shownId !== null) {
      setFixed(false);
      if (problemLineId(heldRef.current) !== shownId) setHeld(shown);
      // 처음 그려지는 감싸개는 접힌 채 시작 — 한 칸 늦게 열어야 0fr → 1fr 이
      // 움직인다.
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    // 저절로 풀린 고침 — 초록 체크를 잠깐 보이고 접는다. 동작을 줄이는 탭에서는
    // 움직임이 없으니 곧장 접는다.
    const wasFixing =
      heldRef.current !== null &&
      heldRef.current.kind === "problem" &&
      heldRef.current.problem.kind === "fixing" &&
      heldRef.current.problem.settles !== false;
    if (wasFixing && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setFixed(true);
      later(600, () => {
        setFixed(false);
        setOpen(false);
      });
      return;
    }
    setOpen(false);
    // 신원만 본다 — 몸통 객체는 렌더마다 새로 지어진다.
  }, [shownId, later]);

  if (held === null) return null;

  if (held.kind === "problem") {
    const { problem: line } = held;
    const icon =
      line.kind === "fixing" ? (
        fixed ? (
          <span className="nx-problem-fixed">
            <SentIcon />
          </span>
        ) : (
          <i className="nx-spin" aria-hidden="true" />
        )
      ) : line.kind === "notified" ? (
        <MailIcon />
      ) : line.kind === "blocked" ? (
        <AlertIcon />
      ) : (
        <PlugIcon />
      );
    return (
      <div className={`nx-problem-wrap${open ? "" : " nx-problem-wrap--closed"}`}>
        {/* 손이 필요한 줄(다시 로그인 · 막힘)은 밀어 알리고 나머지는 공손히 알린다. */}
        <div
          className={`nx-problem nx-problem--${line.kind}`}
          role={line.kind === "blocked" || line.kind === "reconnect" ? "alert" : "status"}
        >
          {icon}
          <b>{fixed ? L.problem.fixed : line.title}</b>
          {/* 브라우저 로그인을 열고 난 뒤에는 무엇을 기다리는지 말한다 — 단추만 `다시 확인` 으로 바뀌던 것. */}
          <span>
            {line.action === "login" && login === "started" ? L.problem.loginWaiting : line.body}
          </span>
          {!fixed && line.action === "copy" && (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => {
                const project = daemon.projects.find((item) => item.slug === daemon.activeSlug);
                copy(blockedHelpText(project?.name, line.body, daemon.repo?.submit?.lastError));
              }}
            >
              {copied ? L.problem.copiedHelp : L.problem.copyHelp}
            </button>
          )}
          {/* 복사했다는 답은 눈이 아니라 낭독으로도 한 번 말한다. */}
          {line.action === "copy" && (
            <span className="nx-sr" role="status">
              {copied ? L.problem.copiedHelp : ""}
            </span>
          )}
          {!fixed && line.action === "invite" && (
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--pri"
              onClick={() => requestInvitePicker()}
            >
              {L.problem.openInvite}
            </button>
          )}
          {!fixed && line.action === "login" && (
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--pri"
              disabled={login === "busy"}
              onClick={() => {
                // 처음은 브라우저 로그인을 몰고, 그 뒤는 다시 확인이다.
                const first = login === "idle";
                setLogin("busy");
                void (first ? daemon.api.onboardingFix("login-claude") : daemon.api.refreshStatus())
                  .then(() => setLogin("started"))
                  .catch(() => setLogin(first ? "idle" : "started"));
              }}
            >
              {login === "busy"
                ? L.chat.checking
                : login === "started"
                  ? L.chat.recheck
                  : L.problem.loginInBrowser}
            </button>
          )}
          {!fixed && line.dismissId !== null && (
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost nx-problem-close"
              aria-label={L.problem.dismiss}
              title={L.problem.dismiss}
              onClick={() => {
                const id = line.dismissId;
                if (id === null) return;
                setOpen(false);
                later(240, () => {
                  dismissProblem(id);
                  setClosed((prev) => new Set(prev).add(id));
                });
              }}
            >
              <XIcon />
            </button>
          )}
          {!fixed && hidden > 0 && (
            // 누르지 않는 표시다 — 줄에 선 문제 외에 열린 문제의 수.
            <span className="nx-problem-more" title={L.problem.moreCount(hidden)}>
              {L.problem.more(hidden)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 초대 파일 지우기 — 감싸개가 접히는 동안에도 몸통은 지울 경로를 기억한다.
  const discardable = (() => {
    const discard = window.colonovaDesignDesktop?.invite?.discard;
    return discard !== undefined && invitePath !== null ? { discard, path: invitePath } : null;
  })();
  return (
    <div className={`nx-problem-wrap${open ? "" : " nx-problem-wrap--closed"}`}>
      <div className="nx-problem nx-problem--notified" role="status">
        <AlertIcon />
        <b>{L.inviteCleanup.title}</b>
        <span>{L.inviteCleanup.body}</span>
        {discardable && (
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--pri"
            onClick={() => {
              void discardable
                .discard(discardable.path)
                .then(() => onToast(L.inviteCleanup.removed))
                .catch(() => onToast(L.inviteCleanup.removeFailed))
                .finally(onClearInvite);
            }}
          >
            {L.inviteCleanup.remove}
          </button>
        )}
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          onClick={() => {
            setOpen(false);
            later(240, onClearInvite);
          }}
        >
          {L.inviteCleanup.later}
        </button>
      </div>
    </div>
  );
}
