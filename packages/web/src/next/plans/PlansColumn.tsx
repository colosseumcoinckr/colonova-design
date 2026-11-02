import type { DraftConversationSummary, ProjectSummary } from "@colonova-design/protocol";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { TrashDialog } from "./doc-actions/TrashDialog";
import { DraftEditor } from "./draft/DraftEditor";
import { NewDraftDialog } from "./draft/NewDraftDialog";
import { PlanChat } from "./draft/PlanChat";
import { pageDraftKey, stashAsk } from "./draft/pending-ask";
import { useDraft } from "./draft/use-draft";
import { useDraftThread } from "./draft/use-draft-thread";
import { escapeOwnedByLayer } from "./escape-layer";
import { PlanDocView } from "./PlanDocView";
import { PlansStatus } from "./PlansEmpty";
import { PlansHeader } from "./PlansHeader";
import { PlansContext, usePlansContext, usePlansWorkspace } from "./PlansWorkspace";

/**
 * 기획서 칸(2026-10-31 기획서 칸 개선 — Claude 앱의 문서 경험) — 왼쪽은 문서 한 장, 오른쪽은 그
 * 문서를 고치는 기획 대화다(2026-10-31 사용자 결정 — 문서 판 왼쪽 · 대화 오른쪽). 말하면 AI 가
 * 초안을 고치고 채택 없이 바로 들어가며, 고친 결과는 문서 판에 칠하고 마음에 안 들면 되돌린다.
 * 읽기 · 고치기의 두 모드는 없다 — 문서 판은 늘 같은 자리다.
 */

/** 대화 칸의 폭 — 300~560px, 처음은 380. 고른 폭은 기억한다(Workspace 의 대화 폭과 같은 계약). */
const CHAT_MIN = 300;
const CHAT_MAX = 560;
const CHAT_DEFAULT = 380;
const CHAT_KEY = "colonova-design.plansChatWidth";

function storedChatWidth(): number {
  try {
    const value = Number(localStorage.getItem(CHAT_KEY));
    return Number.isFinite(value) && value >= CHAT_MIN && value <= CHAT_MAX ? value : CHAT_DEFAULT;
  } catch {
    return CHAT_DEFAULT;
  }
}

/** 문서 · 초안은 같은 본문에 남는다(2026-10-23 화면 전면 재설계 §3.4). */
export function PlansColumn(props: {
  daemon: Daemon;
  project: ProjectSummary | null;
  nav: ShellNav;
  offstage?: boolean;
  onDraftOpen?: (open: boolean) => void;
  /** 셸에서는 문제 줄을 머리 바로 아래에 놓는다. */
  header?: boolean;
  onFocusTree?: () => void;
}) {
  const shared = useContext(PlansContext);
  if (shared === null) return <Standalone {...props} />;
  return <PlansBody {...props} />;
}

/** 기존 단독 호출의 계약도 지킨다. 앱에서는 Workspace 의 공유 상태를 쓴다. */
function Standalone(props: Parameters<typeof PlansColumn>[0]) {
  const plans = usePlansWorkspace({ ...props, active: !props.offstage });
  return (
    <PlansContext.Provider value={plans}>
      <PlansBody {...props} />
    </PlansContext.Provider>
  );
}

function PlansBody({
  daemon,
  nav,
  offstage = false,
  onDraftOpen,
  header = true,
  onFocusTree,
}: Parameters<typeof PlansColumn>[0]) {
  const plans = usePlansContext();
  const {
    state,
    summary,
    rows,
    connected,
    draftKey,
    draftPageId,
    draftSummary,
    editingDraft,
    openRow,
    conversations,
    refreshConversations,
    setActiveThreadId,
    pickedThreadId,
    pickThread,
  } = plans;
  useEffect(() => {
    onDraftOpen?.(editingDraft);
  }, [editingDraft, onDraftOpen]);
  const focusTree = () => {
    onFocusTree?.();
    plans.back();
  };
  // 기획 대화의 판 — 이 칸이 쥔다. 문서 판(남은 걸음 · 바로 반영의 표시)과 대화 칸이 같은 판을 본다.
  // 사이드바 목록에서 골른 대화가 있으면 그 대화를, 없으면 문서의 최신 대화를 읽는다(2026-11-03).
  const thread = useDraftThread(daemon, editingDraft ? draftKey : null, pickedThreadId);
  // 초안의 손 — 같은 이유로 칸이 쥔다(2026-11-02). 문서로 여는 길(첫 고치기 · `draft.open`)과
  // 열쇠로 여는 길을 여기서 갈라 대화 칸에도 내준다 — 편집기가 여는 동안의 「읽는 중」이 같은 손에서 나온다.
  const draftHand = useDraft(
    daemon,
    editingDraft && draftKey !== null
      ? draftPageId !== null
        ? { pageId: draftPageId }
        : { docKey: draftKey }
      : {},
  );
  // 편집기가 초안을 열면 대화를 다시 읽는다(2026-11-01 실사용 관찰 수리) — 초안 없는 문서의 첫
  // `고치기` 에 대화 판이 같은 열쇠로 먼저 물어 「열려 있는 초안이 없습니다」에 죽어 있어도,
  // 초안이 생기면 살아난다(방송이 늦거나 끊긴 뒤에도). 맡겨 둔 첫 말(pending-ask)도 이 다시 읽기에서 풀린다.
  const openedKeyRef = useRef<string | null>(null);
  const reloadThread = thread.reload;
  useEffect(() => {
    if (draftHand.phase !== "ready" || draftHand.view === null) return;
    if (openedKeyRef.current === draftHand.view.docKey) return;
    openedKeyRef.current = draftHand.view.docKey;
    reloadThread();
  }, [draftHand.phase, draftHand.view, reloadThread]);
  // 대화 칸의 입력 칸 — 빈 초안의 `AI 와 시작하기` 가 초점을 옮긴다.
  const threadInputRef = useRef<HTMLTextAreaElement | null>(null);
  // 마지막 AI 고침의 블록 칠하기(2026-10-31 2단계) — 문서 카드의 `문서에서 보기` 가 건네는 잠깐의 칠이다.
  const [flashIds, setFlashIds] = useState<string[] | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showInDoc = useCallback((blockIds: string[]) => {
    if (blockIds.length === 0) return;
    setFlashIds(blockIds);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashIds(null), 2_600);
    const first = document.querySelector(`[data-block-id="${blockIds[0]}"]`);
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  // 판을 넓혀 대화를 접는다(2026-10-31 A — Claude 앱의 판 넓히기). 문서 판의 ⤢ 가 켠다.
  const [chatOff, setChatOff] = useState(false);
  useEffect(() => {
    const onExpand = () => setChatOff((before) => !before);
    window.addEventListener("nx:plans-expand-chat", onExpand);
    return () => window.removeEventListener("nx:plans-expand-chat", onExpand);
  }, []);
  // 좁은 칸의 두 탭(2026-10-31 H — 칸 폭 1100px 미만) — 문서와 대화가 나뉜다.
  const [plTab, setPlTab] = useState<"doc" | "chat">("doc");
  // 대화 칸의 폭 — 끌어 바꾸면 기억한다(Workspace 의 대화 폭과 같은 계약).
  const [chatWidth, setChatWidth] = useState(storedChatWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, String(chatWidth));
    } catch {
      /* 비공개 모드 — 이번 실행에서만 산다 */
    }
  }, [chatWidth]);

  // 읽는 문서의 첫 말(2026-10-30) — 아직 초안이 없는 문서에서 보내면 초안이 열리고 말이 건네진다.
  const startDraft = (pageId: string, text: string) => {
    stashAsk(pageDraftKey(pageId), text);
    plans.editDoc(pageId);
  };

  // 지금 대화 칸이 보는 기획 대화 — 문서에 붙은 대화의 줄이다(2026-10-31 3단계).
  const conversation: DraftConversationSummary | null =
    conversations?.find((one) => one.threadId !== "" && one.threadId === thread.thread?.threadId) ??
    null;
  // 사이드바의 선택 줄이 대화를 따라 켜진다(2026-11-03) — 문서 일치는 두 대화가 한 문서에
  // 붙을 때 갈라 못 하므로, 판이 읽은 대화 이름표를 위로 알린다. 빈 이름표는 아직 읽기 전이다.
  const loadedThreadId = thread.thread?.threadId ?? null;
  useEffect(() => {
    setActiveThreadId(loadedThreadId === "" ? null : loadedThreadId);
  }, [loadedThreadId, setActiveThreadId]);
  // 골른 대화가 목록에 없거나(지워짐) 다른 문서로 옮겨졌으면 고름을 거둔다(2026-11-03) — 판이
  // 실패 문장에 머물지 않고 문서의 최신 대화로 돌아온다. 골른 대화를 지우는 길은 목록을 다시
  // 읽으므로(refreshConversations) 이 효과가 뒤따라 걷는다.
  const openDocKey = editingDraft ? draftKey : null;
  useEffect(() => {
    if (pickedThreadId === null || conversations === null) return;
    const found = conversations.find((one) => one.threadId === pickedThreadId);
    if (found === undefined || (openDocKey !== null && found.docKey !== openDocKey)) {
      pickThread(null);
    }
  }, [pickedThreadId, conversations, openDocKey, pickThread]);

  let body: ReactNode;
  let chatPageId: string | null = null;
  if (editingDraft && draftKey !== null) {
    body = (
      <DraftEditor
        key={draftKey}
        daemon={daemon}
        draft={draftHand}
        pendingChanges={draftSummary?.changedBlocks}
        writable={summary?.writable}
        site={summary?.site ?? null}
        nav={nav}
        onClose={plans.closeDraft}
        thread={thread}
        {...(flashIds !== null ? { flashIds } : {})}
        rows={rows}
        onExpandChat={() => setChatOff(true)}
        onDocApplied={(result) => {
          plans.refreshList();
          if (result.op === "copy" && result.pageId !== null) plans.open(result.pageId);
        }}
      />
    );
  } else if (state.openId !== null && !summary?.expired) {
    const pageId = state.openId;
    chatPageId = pageId;
    body = (
      <PlanDocView
        key={pageId}
        focusTitle={plans.focusDoc}
        pageId={pageId}
        row={openRow}
        site={summary?.site ?? null}
        phase={state.docPhase}
        docError={state.docError}
        doc={state.doc}
        draft={state.drafts.find((one) => one.pageId === pageId) ?? null}
        daemon={daemon}
        nav={nav}
        rows={rows}
        writable={summary?.writable}
        onRetry={() => plans.openDoc(pageId)}
        onBack={focusTree}
        onEdit={plans.editDoc}
        onApplied={plans.onDocApplied}
        onRefresh={plans.refreshDoc}
        onOpenPage={plans.open}
        onSelectionAsk={onSelectionAsk}
      />
    );
  } else {
    body = (
      <div className="nx-pl-state">
        <PlansStatus
          connected={connected}
          expired={summary?.expired === true}
          rooted={summary?.rootTitle != null}
          phase={state.listPhase}
          importing={state.importing}
          onSettings={nav.openSettings}
          onImport={plans.importNow}
          onRetry={plans.refreshList}
        />
      </div>
    );
  }
  // 문서가 열려 있거나 초안이 편집 중일 때만 대화 칸이 선다 — 목록만 볼 때는 자리가 필요 없다.
  const withChat = editingDraft || (state.openId !== null && !summary?.expired);
  const docTitle = editingDraft
    ? (draftSummary?.title ?? (draftPageId ? (openRow?.title ?? null) : null) ?? L.drafts.newDoc)
    : (openRow?.title ?? "");

  /** 고른 글로 묻기(2026-10-31 4단계) — 문서 판의 작은 판이 이 손으로 대화 칸에 칩을 붙인다. */
  function onSelectionAsk(text: string) {
    window.dispatchEvent(new CustomEvent("nx:plan-selection", { detail: { text } }));
    if (narrowTab()) setPlTab("chat");
  }

  return (
    <section
      className={`nx-plans${offstage ? " nx-offstage" : ""}`}
      aria-hidden={offstage}
      inert={offstage}
      aria-label={L.plans.listHeading}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          editingDraft ||
          !plans.docOpen ||
          escapeOwnedByLayer()
        )
          return;
        event.preventDefault();
        focusTree();
      }}
    >
      {header && <PlansHeader daemon={daemon} nav={nav} />}
      {/* 끌어 정한 대화 폭을 칸에 심는다 — plans.css 의 clamp(300px, var(--nx-pl-chat-w), 560px) 가 읽는다. */}
      <div
        className="nx-pl-view"
        data-chat={chatOff ? "off" : "on"}
        data-tab={plTab}
        style={{ "--nx-pl-chat-w": `${chatWidth}px` } as CSSProperties}
      >
        {withChat && (
          <div className="nx-pl-tabs" role="tablist" aria-label={L.plans.viewTabs}>
            <button
              type="button"
              role="tab"
              aria-selected={plTab === "doc"}
              className={plTab === "doc" ? "nx-tab--on" : ""}
              onClick={() => setPlTab("doc")}
            >
              {L.plans.docTab}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={plTab === "chat"}
              className={plTab === "chat" ? "nx-tab--on" : ""}
              onClick={() => setPlTab("chat")}
            >
              {L.plans.chatTab}
            </button>
          </div>
        )}
        <div className="nx-pl-docpane">{body}</div>
        {withChat && chatOff === false && (
          <>
            {/* 문서 판과 대화 칸 사이의 선 — 끌어 폭을 바꾼다(2026-10-31 4. 새 배치). */}
            {/* biome-ignore lint/a11y/useSemanticElements: 두 칸 사이의 끌개라 separator 의 기본 꼴이 어울리지 않는다 */}
            <div
              className="nx-pl-split"
              role="separator"
              aria-orientation="vertical"
              aria-label={L.plans.chatWidth}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                dragRef.current = { startX: event.clientX, startWidth: chatWidth };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (drag === null || event.buttons === 0) return;
                const next = Math.round(drag.startWidth - (event.clientX - drag.startX));
                setChatWidth(Math.min(CHAT_MAX, Math.max(CHAT_MIN, next)));
              }}
              onPointerUp={(event) => {
                dragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
            />
            <PlanChat
              daemon={daemon}
              nav={nav}
              docKey={editingDraft ? draftKey : null}
              {...(chatPageId !== null && editingDraft === false ? { pageId: chatPageId } : {})}
              {...(chatPageId !== null && editingDraft === false
                ? { onStartDraft: startDraft }
                : {})}
              docTitle={docTitle}
              thread={thread}
              draft={editingDraft ? draftHand : null}
              inputRef={threadInputRef}
              conversation={conversation}
              pickedThreadId={pickedThreadId}
              pickThread={pickThread}
              onShowInDoc={(ids) => {
                showInDoc(ids);
                setPlTab("doc");
              }}
              onConversationsChanged={refreshConversations}
            />
          </>
        )}
      </div>
      {plans.newDraftOpen && (
        <NewDraftDialog
          daemon={daemon}
          rows={rows}
          onImport={plans.importNow}
          onClose={() => plans.setNewDraftOpen(false)}
          onCreated={(view) => {
            plans.setNewDraftOpen(false);
            plans.openDraftKey(view.docKey);
          }}
        />
      )}
      {plans.trashOpen && (
        <TrashDialog
          daemon={daemon}
          onApplied={plans.refreshList}
          onClose={() => plans.setTrashOpen(false)}
        />
      )}
    </section>
  );
}

/** 좁은 칸(1100px 미만)인가 — CSS 의 컨테이너 규칙과 같은 눈금이다. */
function narrowTab(): boolean {
  try {
    return (document.querySelector(".nx-plans")?.clientWidth ?? 1440) < 1100;
  } catch {
    return false;
  }
}
