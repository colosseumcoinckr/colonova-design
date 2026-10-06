import type { RepoHandoffDraft, SubmitPreview, SubmitSent } from "@colonova-design/protocol";
import { type CSSProperties, type RefObject, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { composing } from "../../lib/ime";
import { L } from "../labels";
import { firstSubjectOf, handoffPreviewOf, previewTitle } from "../lib/handoff-preview";
import type { Journey } from "../lib/journey";
import { sentOf } from "../lib/receipt";
import { type SubmitNotice, submitView } from "../lib/submit-view";
import { useHandoffDraft } from "../lib/use-handoff-draft";
import type { CycleScreen } from "../lib/work-ledger";
import { finalOutgoingChanges, outgoingScreens } from "../lib/work-ledger";
import { ChevronRightIcon, Spin } from "../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead, useModalClose } from "../ui/ModalFrame";
import { HandoffPreviewBox } from "./HandoffPreviewBox";
import { FailIcon, LockIcon, ScreenRow, SentIcon, SubmitIcon } from "./parts";

interface SubmitPopoverProps {
  anchor: RefObject<HTMLElement | null>;
  journey: Journey;
  snapshot: SubmitPreview | null;
  projectName: string;
  reviewers: string[];
  loading: boolean;
  /** 제출할 내용을 읽지 못했다 — 목록이 없다. */
  readFailed: boolean;
  /** 보내는 길이 실패했다 — 목록은 그대로고 다시 제출할 수 있다. */
  sendFailed: boolean;
  busy: boolean;
  changed: boolean;
  /** 제출이 잠긴 이유(`journey.submit.reason`) — 경고가 아니라 상태 줄로 서게. */
  lockReason: string | null;
  /** 마지막 제출의 시각 — 이번에 새로 바뀐 화면을 앞에 세우는 기준(2026-10-04 ux-plan PR1). */
  since: string | null;
  /** 요청의 초안(제목 · 설명)을 읽는 길 — 개발자에게 보이는 모습의 재료. */
  loadDraft: () => Promise<RepoHandoffDraft>;
  /** 이미 열린 요청의 지금 제목 — 더해 제출하면 이 제목이 그대로 남는다. 없으면 null. */
  openTitle: string | null;
  /** 보내기가 끝났다 — 값이 올라가면 판이 닫는 모션으로 물러난다(잠금도 풀린다). */
  leaveToken: number;
  onRefresh: () => void;
  onClose: () => void;
  /** `sent` 는 이번에 제출하는 화면 — 영수증이 되읽는다. 화면이 없으면 없다. */
  onConfirm: (note: string, head: string, token: string, sent?: SubmitSent) => void;
  note: string;
  onNote: (note: string) => void;
  onPreview: (screen: CycleScreen) => void;
  onCompare: (screen: CycleScreen) => void;
}

/**
 * 제출 확인 — 되돌릴 수 없는 외부 행동 앞의 겹판(2026-10-06 겹판 손질: 자체 `createPortal` 이던 것을
 * `ModalFrame` 으로 편입했다. 스크림 · 판의 옷 · 들어옴/나감 · 초점 가두기/복귀 · Esc · 스크림 누름이
 * 모두 뼈대의 것이다). 위계는 `무엇이 가는가`(한 줄 요약 · 화면 목록) → `한마디` → 주 단추다. 한마디와
 * 단추는 바닥에 서서 목록이 길어도 늘 보인다. 읽는 중 · 읽기 실패 · 내용이 바뀜 · 보내기 실패가 모두
 * 같은 틀 안에서 바뀌고 목록은 사라지지 않는다 — 판정은 `lib/submit-view.ts`.
 *
 * 앱 뿌리(`.nx`)로 옮겨 그린다 — 상태 줄은 제 쌓임 맥락(z-index 20)을 가져 안에서 그리면 스크림이
 * 대화 칸 아래에 깔린다.
 */
export function SubmitPopover(props: SubmitPopoverProps) {
  const { anchor, journey, busy, leaveToken, onClose } = props;
  // 마운트 때의 값에서 올라가면 보내기가 끝난 것이다 — 닫는 모션으로 물러나고, 그 사이 잠금은 푼다.
  const mountToken = useRef(leaveToken);
  const leaving = leaveToken !== mountToken.current;
  const summaryId = useId();
  const more = journey.submit.more;
  return createPortal(
    <ModalFrame
      onClose={onClose}
      locked={busy && !leaving}
      returnRef={anchor}
      describedBy={summaryId}
      className="nx-submit-review"
      backClassName="nx-submit-review-back"
    >
      <ModalHead
        title={more ? L.submitConfirm.titleMore : L.submitConfirm.title}
        sub={more ? L.submitConfirm.subMore : L.submitConfirm.sub}
        icon={<SubmitIcon />}
      />
      <SubmitBody {...props} leaving={leaving} summaryId={summaryId} />
    </ModalFrame>,
    document.querySelector(".nx") ?? document.body,
  );
}

function SubmitBody({
  journey,
  snapshot,
  projectName,
  reviewers,
  loading,
  readFailed,
  sendFailed,
  busy,
  changed,
  lockReason,
  since,
  loadDraft,
  openTitle,
  leaving,
  summaryId,
  onRefresh,
  onConfirm,
  note,
  onNote,
  onPreview,
  onCompare,
}: SubmitPopoverProps & { leaving: boolean; summaryId: string }) {
  const close = useModalClose();
  const closeNow = useRef(close);
  closeNow.current = close;
  useEffect(() => {
    if (leaving) closeNow.current();
  }, [leaving]);

  const more = journey.submit.more;
  const names = reviewers.join(" · ");
  const { screens, outside } = finalOutgoingChanges(
    snapshot?.history.entries ?? [],
    snapshot?.repo.cycleScreens,
    snapshot?.finalFiles ?? [],
  );
  const outsideFiles = outside.reduce((sum, item) => sum + item.files, 0);
  // 이번에 새로 바뀐 화면을 앞에 세운다 — 상태 줄의 `제출한 뒤 N곳 더` 와 같은 계산(`outgoingScreens` +
  // 마지막 제출의 시각)으로 가른다(2026-10-04 ux-plan PR1). 그 앞에 이미 제출한 화면은 접힌 목록에 둔다.
  const lead = outgoingScreens(screens, since);
  const leadRoutes = new Set(lead.map((screen) => screen.route));
  const rest = screens.filter((screen) => !leadRoutes.has(screen.route));
  const view = submitView({
    hasSnapshot: snapshot !== null,
    files: snapshot?.finalFiles.length ?? 0,
    loading,
    readFailed,
    sendFailed,
    changed,
    busy,
    lockReason,
  });
  // `제출한 뒤` 라고 말하려면 마지막 제출의 시각을 알아야 한다 — 열린 요청이 있어도 모르면 처음처럼 말한다.
  const summary = !view.showList
    ? null
    : lead.length > 0
      ? more && since !== null
        ? L.submitConfirm.summaryMore(lead.length, names)
        : L.submitConfirm.summary(lead.length, names)
      : outsideFiles > 0
        ? L.submitConfirm.summaryOutside(outsideFiles, names)
        : null;

  // 개발자가 처음 읽는 제목과 설명 — 첫 제출에만 읽는다(더하는 제출은 개발자의 글이 그대로다). 데몬의 초안은
  // 짧은 AI 한 번이라 제출을 붙잡지 않고 따로 읽으며, 작업이 달라져 목록을 다시 읽으면(보관의 끝 표식이 바뀜) 함께 다시 읽는다.
  const draft = useHandoffDraft(
    loadDraft,
    view.showList && !more && !leaving && snapshot !== null,
    snapshot?.head ?? null,
  );
  const preview =
    draft.status === "ready"
      ? handoffPreviewOf(draft.draft, firstSubjectOf(snapshot?.history.entries ?? []))
      : null;

  // 눌렸는데 조건이 안 맞을 때의 목적지 — 알림 줄이다. 조용히 끝내지 않는다(2026-10-04 ux-review).
  const notices = useRef<HTMLDivElement>(null);
  const noticesId = useId();
  const noteId = useId();
  const confirm = () => {
    if (view.enabled && snapshot) {
      onConfirm(note.trim(), snapshot.head, snapshot.expectedPreview, sentOf(lead));
      return;
    }
    if (busy) return;
    notices.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    notices.current?.focus();
  };
  // 보내는 동안 단추가 잠기면 초점이 허공으로 떨어진다 — 끝난 뒤 다음에 누를 것으로 되돌린다: 실패했으면
  // 다시 제출, 내용이 바뀌었으면 알림 줄의 다시 확인.
  const go = useRef<HTMLButtonElement>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      if (sendFailed) go.current?.focus();
      else if (changed) notices.current?.querySelector("button")?.focus();
    }
    wasBusy.current = busy;
  }, [busy, sendFailed, changed]);

  const noticeRow = (kind: SubmitNotice) => {
    switch (kind) {
      case "send":
        return (
          <div key={kind} role="alert" className="nx-st-note nx-st-note--red">
            <FailIcon />
            <span className="nx-st-note-t">{L.submitConfirm.sendFailed}</span>
          </div>
        );
      case "read":
        return (
          <div key={kind} role="alert" className="nx-st-note nx-st-note--red">
            <FailIcon />
            <span className="nx-st-note-t">{L.submitConfirm.readFailed}</span>
            <button type="button" className="nx-btn nx-btn--sm" onClick={onRefresh} disabled={busy}>
              {L.submitConfirm.refresh}
            </button>
          </div>
        );
      case "changed":
        return (
          <div key={kind} role="status" className="nx-st-note nx-st-note--amber">
            <FailIcon />
            <span className="nx-st-note-t">{L.submitConfirm.changed}</span>
            <button type="button" className="nx-btn nx-btn--sm" onClick={onRefresh} disabled={busy}>
              {L.submitConfirm.refresh}
            </button>
          </div>
        );
      case "empty":
        return (
          <div key={kind} role="status" className="nx-st-note">
            <span className="nx-st-note-t">{L.submitConfirm.empty}</span>
          </div>
        );
      case "lock":
        // 2026-10-04 ux-review(2차): 잠금은 사실의 안내다 — 경고색 줄이 아니라 상태 줄로. 풀리는 길은
        // 다시 확인이 아니라 잠금의 이유에 있다.
        return (
          <div key={kind} role="status" className="nx-st-note">
            <LockIcon />
            <span className="nx-st-note-t">{lockReason}</span>
          </div>
        );
    }
  };

  // 읽는 중이 끝나고 목록이 서는 순간 줄이 위에서 아래로 차례로 내려앉는다 — 여덟째 줄부터는 함께.
  const screenRow = (screen: CycleScreen, index: number) => (
    <li
      key={screen.route}
      className="nx-submit-screen"
      style={{ "--i": Math.min(index, 7) } as CSSProperties}
    >
      <ScreenRow screen={screen} />
      <div className="nx-submit-screen-actions">
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          disabled={busy}
          onClick={() => onPreview(screen)}
        >
          {L.requestResult.latest}
        </button>
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          disabled={busy}
          onClick={() => onCompare(screen)}
        >
          {L.compare.open}
        </button>
      </div>
    </li>
  );

  return (
    <>
      <ModalBody className="nx-sub-body">
        {summary && (
          <p id={summaryId} className="nx-sub-summary">
            {summary}
          </p>
        )}
        <details className="nx-sub-scope">
          <summary>
            <span className="nx-sub-caret">
              <ChevronRightIcon />
            </span>
            {L.submitConfirm.scopeMore}
          </summary>
          <p>
            <b>{L.submitConfirm.project(projectName)}</b>
          </p>
          <p>{L.submitConfirm.shared}</p>
          <p>{L.submitConfirm.follows}</p>
        </details>

        {(view.notices.length > 0 || view.skeleton) && (
          <div ref={notices} id={noticesId} tabIndex={-1} className="nx-sub-notices">
            {view.skeleton && (
              <div role="status" aria-busy="true" className="nx-st-load">
                <p className="nx-st-loadtext">
                  <Spin />
                  {L.submitConfirm.loading}
                </p>
                <div className="nx-st-skel" aria-hidden="true">
                  <div />
                  <div />
                  <div />
                </div>
              </div>
            )}
            {view.notices.map(noticeRow)}
          </div>
        )}

        {view.showList && (
          <HandoffPreviewBox
            more={more}
            openTitle={openTitle === null ? null : previewTitle(openTitle)}
            loading={draft.status === "loading"}
            preview={preview}
          />
        )}

        {view.showList && screens.length > 0 && (
          <section className="nx-sub-list">
            <h3 className="nx-sub-h">
              {L.submitConfirm.screens(screens.length)}
              {journey.cycle === "review" && since !== null && lead.length > 0 && (
                <span className="nx-sub-hr">{L.work.changedSince(lead.length)}</span>
              )}
            </h3>
            <ul>{lead.map((screen, index) => screenRow(screen, index))}</ul>
            {rest.length > 0 && (
              // 이번에 새로 바뀐 화면이 먼저이고, 앞서 제출한 화면은 접힌다(2026-10-04 ux-plan PR1).
              <details className="nx-sub-fold">
                <summary>
                  <span className="nx-sub-caret">
                    <ChevronRightIcon />
                  </span>
                  {L.submitConfirm.earlierScreens(rest.length)}
                </summary>
                <ul>{rest.map((screen, index) => screenRow(screen, index))}</ul>
              </details>
            )}
          </section>
        )}
        {view.showList && outsideFiles > 0 && (
          <details className="nx-sub-fold">
            <summary>
              <span className="nx-sub-caret">
                <ChevronRightIcon />
              </span>
              {L.submitConfirm.outsideScreens(outsideFiles)}
            </summary>
            <p>{L.submitConfirm.outsideDetail}</p>
            {outside.map((item) => (
              <p key={item.key}>
                {item.note
                  ? L.submitConfirm.relatedRequest(item.note.split(/\r?\n/, 1)[0] ?? "", item.files)
                  : L.submitConfirm.unassociated(item.files)}
              </p>
            ))}
          </details>
        )}
      </ModalBody>

      <ModalFoot className="nx-sub-foot">
        <div className="nx-st-notehead">
          <label htmlFor={noteId}>{L.submitConfirm.note}</label>
          <span>{L.submitConfirm.optional}</span>
        </div>
        <input
          id={noteId}
          className="nx-note-input"
          value={note}
          maxLength={500}
          readOnly={busy || leaving}
          placeholder={L.submitConfirm.notePlaceholder}
          onChange={(event) => onNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || composing(event)) return;
            event.preventDefault();
            confirm();
          }}
        />
        <div className="nx-sub-act">
          {names && <span className="nx-snote">{L.submitConfirm.reviewers(names)}</span>}
          <button
            type="button"
            className="nx-btn nx-btn--ghost"
            onClick={close}
            disabled={busy && !leaving}
          >
            {L.submitConfirm.cancel}
          </button>
          <button
            ref={go}
            type="button"
            className="nx-btn nx-btn--pri nx-sub-go"
            // 막힌 단추도 눌린다 — 눌러서 막힌 이유 줄로 데려간다. 보내는 중에만 정말로 잠근다.
            aria-disabled={!view.enabled}
            aria-describedby={!view.enabled && view.notices.length > 0 ? noticesId : undefined}
            disabled={busy}
            onClick={confirm}
          >
            {leaving ? (
              <>
                <SentIcon />
                {L.submit.done}
              </>
            ) : view.action === "running" ? (
              <>
                <Spin />
                {L.submit.running}
              </>
            ) : view.action === "retry" ? (
              L.submitConfirm.retrySubmit
            ) : (
              L.submitConfirm.confirm
            )}
          </button>
        </div>
      </ModalFoot>
    </>
  );
}
