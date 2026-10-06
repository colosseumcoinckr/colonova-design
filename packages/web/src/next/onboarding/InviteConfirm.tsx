import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import type { InviteImportState } from "../../hooks/use-invite-import";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { connectionLock } from "../lib/connection-copy";
import {
  applyingLine,
  type InviteTone,
  inviteFailures,
  inviteLockLine,
  inviteOutcome,
  inviteRowsCopy,
  inviteTitle,
  inviteUntil,
  tokenFailureText,
} from "../lib/invite-rows";
import { Spin } from "../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead, useModalClose } from "../ui/ModalFrame";
import {
  BigCheckIcon,
  InviteAlertIcon,
  InviteCheckIcon,
  InviteMailIcon,
  TrashIcon,
} from "./invite-icons";
import "./onboarding.css";
import "./invite.css";
import { inviteProgress } from "./motion";

/**
 * 초대 파일 가져오기의 확인판(U11) — 첫 실행과 다시 받기가 같은 몸통을 쓴다.
 * 셸(NextShell)이 창 어디에 떨어뜨린 파일 · 설정의 열기 · 문제 문장의 안내를
 * 모두 컨트롤러(use-invite-import)로 모으고, 이 판은 그 상태를 줄 세운다:
 * 읽는 중 → 확인(새로 · 바뀜 · 그대로) → 적용 → 결과. 상태와 행동의 주인은
 * 컨트롤러다 — 이 판은 그림만 담는다(옛 InviteCard 와 같은 계약).
 *
 * 2026-10-06 겹판 손질 — 겹판 뼈대(`ModalFrame`)로 옮기고 **제목이 단계의 시제를 따르게** 했다:
 * 확인은 「가져올까요?」(아직 아무것도 안 바뀌었다), 끝난 뒤에야 「가져왔어요」이며 실패 위에는
 * 성공의 말을 걸지 않는다. 푸터의 `가져오기` 가 단 하나의 주 단추고, 파일 정리(OS 휴지통)는
 * 가져온 뒤의 일이라 결과에 선다. 날것의 오류는 「자세히」 안에 접는다. 판정은 `lib/invite-rows`.
 */

/** 판을 닫는 단추 — ✕ · Esc · 스크림과 같은 길(닫는 모션)을 지난다. 적용 중에는 판이 잠겨 눌리지 않는다. */
function CloseButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const close = useModalClose();
  return (
    <button
      type="button"
      className={`nx-btn${primary ? " nx-btn--pri" : " nx-btn--ghost"}`}
      onClick={close}
    >
      {label}
    </button>
  );
}

/** 머리의 그림 — 단계의 기운(안내 · 성공 · 주의 · 실패)을 따른다. 색만으로 말하지 않는다(제목이 함께 말한다). */
function HeadIcon({ tone }: { tone: InviteTone }) {
  return (
    <span className={`nx-inv-ic nx-inv-ic--${tone}`}>
      {tone === "ok" ? (
        <InviteCheckIcon />
      ) : tone === "info" ? (
        <InviteMailIcon />
      ) : (
        <InviteAlertIcon />
      )}
    </span>
  );
}

/** 날것의 이유를 접어 두는 자리 — 사람 말 한 줄이 먼저 서고, 개발자에게 전할 때만 펼친다. */
function Fold({ detail }: { detail: string }) {
  return (
    <details className="nx-inv-fold">
      <summary>{L.invite.detail}</summary>
      <p className="nx-inv-raw">{detail}</p>
    </details>
  );
}

/** 단계의 몸과 바닥 — 몸만 굴러가고 바닥은 선다. 단계가 바뀌면 `key` 로 새로 서서 살짝 내려앉는다. */
function Stage({
  stageRef,
  foot,
  children,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <ModalBody>
        <div className="nx-inv-stage" ref={stageRef}>
          {children}
        </div>
      </ModalBody>
      {foot && <ModalFoot className="nx-inv-foot">{foot}</ModalFoot>}
    </>
  );
}

export function InviteConfirm({
  daemon,
  state,
  onApply,
  onRetry,
  onClose,
  onOpenPicker,
  onDiscarded,
}: {
  daemon: Daemon;
  state: InviteImportState;
  /** 확인판의 `가져오기` — 이름 칸 초안과, `가져와서 열기` 를 누른 행의 주소를 함께. */
  onApply: (authorDraft: string, openRepoUrl?: string) => void;
  /** 다시 시도 — 이름 칸 초안을 함께(코드가 거절된 시도는 이름을 저장하기 전에 끝났다). */
  onRetry: (authorDraft: string) => void;
  onClose: () => void;
  onOpenPicker: () => void;
  /** 사용자가 이 판에서 초대 파일을 휴지통에 넣었다 — 셸이 `파일 지우기` 줄을 세우지 않는다. */
  onDiscarded: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [authorDraft, setAuthorDraft] = useState("");
  const [trash, setTrash] = useState<"idle" | "busy" | "done" | "failed">("idle");
  // 읽는 중이 아주 짧으면 판이 번쩍였다 사라진다 — 오래 걸릴 때만 보인다(대부분은 확인으로 곧장 뜬다).
  const [slowRead, setSlowRead] = useState(false);
  // 확인 단계에서 본 「만료된 연결을 다시 잇는 초대」인가 — 적용이 끝나면 데몬이 그 표시를 거두니 기억한다.
  const reconnectedRef = useRef(false);

  useEffect(() => {
    if (state.phase !== "reading") {
      setSlowRead(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowRead(true), 250);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  // 새 확인판이 열리면 지난 판의 흔적을 지운다.
  useEffect(() => {
    if (state.phase !== "confirm") return;
    setTrash("idle");
    setAuthorDraft("");
  }, [state.phase]);

  const shown = state.phase !== "idle" && (state.phase !== "reading" || slowRead);

  // 단계가 바뀌면 초점은 새 제목으로 — 누른 단추가 사라지면 초점이 body 로 떨어져 낭독이 맥락을 잃는다.
  // 제목(질문)에 두니 Enter 가 엉뚱하게 가져오지 않는다. 한 번 Tab 이면 단추 쪽이다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 단계(`state.phase`)가 바뀔 때마다 다시 옮긴다 — 본문이 읽지 않아도 이 효과의 열쇠다.
  useEffect(() => {
    if (!shown) return;
    const heading = stageRef.current
      ?.closest('[role="dialog"]')
      ?.querySelector<HTMLElement>(".nx-mhd h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [shown, state.phase]);

  if (!shown) {
    // 판이 닫혀 있는 동안 지난 초대의 「다시 잇는 초대」 표시를 들고 있지 않는다.
    reconnectedRef.current = false;
    return null;
  }

  const lock = connectionLock(daemon.connection, L);
  const lockLine = inviteLockLine(lock, L);
  const attention = daemon.repo?.attention ?? daemon.status?.attention ?? null;
  if (state.phase === "confirm") {
    reconnectedRef.current = attention?.kind === "reconnect" && attention.what === "github";
  }
  const copy = state.phase === "confirm" ? inviteRowsCopy(state.rows, L, daemon.projects) : null;
  const added = copy?.rows.filter((row) => row.action === "add") ?? [];
  // 머리 줄의 잇는 수 — 지금 있는 프로젝트에 새로 오는 수만 더한다(바뀜 · 그대로는 셈이 아니라 값).
  const reach =
    state.phase === "confirm" ? daemon.projects.length + added.length : daemon.projects.length;
  const head = inviteTitle(state, L, { reach, reconnected: reconnectedRef.current });
  const locked = state.phase === "applying";

  const lockNote = lockLine !== null && (
    <p id="nx-inv-lock" className="nx-inv-footnote" role="status">
      {lockLine}
    </p>
  );
  const lockProps = lock !== null ? { disabled: true, "aria-describedby": "nx-inv-lock" } : {};

  let body: ReactNode = null;
  let foot: ReactNode = null;

  if (state.phase === "reading") {
    body = (
      <p className="nx-inv-working" role="status">
        <Spin />
        {L.onboarding.inviteOpening}
      </p>
    );
  }

  if (state.phase === "error") {
    // 첫 실행에서도 판이 오류를 직접 말한다 — 판이 체크리스트 위를 덮어 그 뒤의 오류 줄은 안 보인다.
    body = (
      <>
        <p className="nx-inv-callout nx-inv-callout--bad" role="alert">
          {state.error}
        </p>
        {state.detail && <Fold detail={state.detail} />}
      </>
    );
    foot = (
      <>
        <CloseButton label={L.onboarding.close} />
        <button type="button" className="nx-btn nx-btn--pri" onClick={onOpenPicker}>
          {L.invite.otherFile}
        </button>
      </>
    );
  }

  if (state.phase === "confirm" && copy) {
    const savedAuthor = daemon.status?.authorName ?? null;
    const askAuthor = !state.invite.authorName && !savedAuthor;
    body = (
      <>
        {copy.nothingChanged && <p className="nx-inv-callout">{L.invite.nothingChanged}</p>}
        <h3 className="nx-inv-listhd">{L.invite.listHead(copy.rows.length)}</h3>
        <ul className="nx-inv-list">
          {copy.rows.map((row) => (
            <li key={row.repoUrl} className={`nx-inv-row nx-inv-row--${row.action}`}>
              <span className={`nx-inv-chip nx-inv-chip--${row.action}`}>{row.chip}</span>
              <div className="nx-inv-main">
                <b>{row.name}</b>
                {(row.detail ?? row.sub) && <small>{row.detail ?? row.sub}</small>}
              </div>
              {row.action === "add" && (
                // 보조 단추다 — 주 단추는 푸터의 `가져오기` 하나. 가져온 뒤에 이 프로젝트를 연다.
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--ghost"
                  onClick={() => onApply(authorDraft, row.repoUrl)}
                  {...lockProps}
                >
                  {L.invite.openNow}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="nx-inv-fine">
          {L.invite.mine} {L.invite.keptNote}
        </p>
        {state.invite.readme && (
          <figure className="nx-inv-readme">
            <figcaption>{L.invite.readmeLabel}</figcaption>
            <p>{state.invite.readme}</p>
          </figure>
        )}
        {askAuthor && (
          <div className="nx-inv-author">
            <label htmlFor="nx-invite-author">{L.invite.authorLabel}</label>
            <input
              id="nx-invite-author"
              value={authorDraft}
              maxLength={80}
              onChange={(event) => setAuthorDraft(event.target.value)}
            />
          </div>
        )}
      </>
    );
    foot = (
      <>
        {lockNote}
        {/* 그만두기는 아무것도 가져오지 않는다 — 확인판만 물러난다. */}
        <CloseButton label={L.invite.cancel} />
        <button
          type="button"
          className="nx-btn nx-btn--pri"
          onClick={() => onApply(authorDraft)}
          {...lockProps}
        >
          {L.invite.apply}
        </button>
      </>
    );
  }

  if (state.phase === "applying") {
    body = (
      <>
        {/* 끝없는 막대가 아니라 진행기가 아는 만큼만 채운다. */}
        <div
          className="nx-fill"
          role="progressbar"
          aria-label={L.invite.applyingTitle}
          aria-valuemin={0}
          aria-valuemax={state.rows.length}
          aria-valuenow={state.done}
        >
          <i style={{ width: `${inviteProgress(state.done, state.rows.length)}%` }} />
        </div>
        <p className="nx-inv-working" role="status">
          <Spin />
          {applyingLine(state.rows, state.done, L)}
        </p>
        <p className="nx-inv-fine">{L.invite.progressing(state.done, state.rows.length)}</p>
      </>
    );
  }

  if (state.phase === "done") {
    const { result } = state;
    const outcome = inviteOutcome(result);
    const warnings = result.reachWarnings.map((warning) => (
      <p key={warning} className="nx-inv-callout nx-inv-callout--warn" role="alert">
        {warning}
      </p>
    ));

    if (outcome === "token") {
      // 연결 코드가 거절됐으면 프로젝트는 하나도 건드리지 않은 상태다.
      body = (
        <>
          <p className="nx-inv-callout nx-inv-callout--bad" role="alert">
            {tokenFailureText(lock, L)}
          </p>
          {result.tokenError && <Fold detail={result.tokenError} />}
        </>
      );
      foot = (
        <>
          {lockNote}
          <CloseButton label={L.onboarding.close} />
          <button type="button" className="nx-btn" onClick={onOpenPicker}>
            {L.invite.otherFile}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--pri"
            onClick={() => onRetry(authorDraft)}
            {...lockProps}
          >
            {L.vocab.retry}
          </button>
        </>
      );
    } else if (outcome === "failed" || outcome === "partial") {
      body = (
        <>
          {/* 목록의 의미를 지키려 알림은 감싸는 상자가 맡는다 — 한꺼번에 한 번 읽힌다. */}
          <div role="alert">
            <ul className="nx-inv-fails">
              {inviteFailures(result.results).map((failure) => (
                <li key={failure.repoUrl} className="nx-inv-fail">
                  <b>{failure.name}</b>
                  <span>{L.invite.rowFailed}</span>
                  {failure.detail && <Fold detail={failure.detail} />}
                </li>
              ))}
            </ul>
          </div>
          {warnings}
        </>
      );
      foot = (
        <>
          {lockNote}
          <CloseButton label={L.onboarding.close} />
          <button
            type="button"
            className="nx-btn nx-btn--pri"
            onClick={() => onRetry(authorDraft)}
            {...lockProps}
          >
            {L.vocab.retry}
          </button>
        </>
      );
    } else {
      const addedCount = result.results.filter((entry) => entry.row.action === "add").length;
      const until = inviteUntil(daemon.status?.githubTokenExpiresAt, Date.now(), L);
      const discard = window.colonovaDesignDesktop?.invite?.discard;
      const trashable = Boolean(state.path && discard);
      body = (
        <>
          <div className="nx-inv-done" role="status">
            <span className="nx-inv-ok" aria-hidden="true">
              <BigCheckIcon />
            </span>
            {until && <b>{until}</b>}
            {addedCount > 0 && <p>{L.invite.addedNote}</p>}
          </div>
          {warnings}
          {/* 파일 정리는 가져온 뒤의 일이다 — 가져오기 전에 치우면 그만두거나 코드가 거절돼도 파일이 없다. */}
          {trashable && state.path ? (
            <div className={`nx-inv-cleanup${trash === "done" ? " nx-inv-cleanup--done" : ""}`}>
              <span className="nx-inv-cleanup-ic" aria-hidden="true">
                {trash === "done" ? <InviteCheckIcon /> : <TrashIcon />}
              </span>
              <p role={trash === "failed" ? "alert" : "status"}>
                {trash === "done"
                  ? L.invite.trashed
                  : trash === "failed"
                    ? L.invite.trashFailed
                    : L.invite.warnTrash}
              </p>
              {trash !== "done" && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={trash === "busy"}
                  onClick={() => {
                    const path = state.path;
                    if (!path || !discard) return;
                    setTrash("busy");
                    discard(path).then(
                      () => {
                        setTrash("done");
                        onDiscarded();
                      },
                      () => setTrash("failed"),
                    );
                  }}
                >
                  {L.invite.trashFile}
                </button>
              )}
            </div>
          ) : (
            <p className="nx-inv-fine">{L.invite.warn}</p>
          )}
        </>
      );
      foot = <CloseButton label={L.invite.ok} primary />;
    }
  }

  return (
    <div className="nx nx-modal-host">
      <ModalFrame open locked={locked} onClose={onClose} className="nx-inv">
        <ModalHead title={head.title} sub={head.sub} icon={<HeadIcon tone={head.tone} />} />
        <Stage key={state.phase} stageRef={stageRef} foot={foot}>
          {body}
        </Stage>
      </ModalFrame>
    </div>
  );
}
