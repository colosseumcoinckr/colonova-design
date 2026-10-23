import type {
  DraftBlock,
  DraftBlockView,
  DraftEdit,
  DraftTableRow,
} from "@colonova-design/protocol";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Markdown } from "../../../components/Markdown";
import type { Daemon } from "../../../lib/daemon-client";
import { linkClick } from "../../../lib/open-link";
import { L } from "../../labels";
import type { ShellNav } from "../../slots";
import { InlineConfirm } from "../../ui/InlineConfirm";
import {
  CloseIcon,
  ExternalIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SparkIcon,
  Spin,
  TrashIcon,
} from "../../ui/icons";
import { headingSections } from "../doc-actions/doc-actions-model";
import { SendToScreen } from "../doc-actions/SendToScreen";
import { docUrl } from "../plans-list";
import { DraftThread } from "./DraftThread";
import {
  blockStatusLabel,
  listToText,
  tableAddColumn,
  tableAddRow,
  tableRemoveColumn,
  tableRemoveRow,
  textToList,
  tokenLegend,
  viewToMarkdown,
} from "./draft-model";
import { PublishDialog } from "./PublishDialog";
import { resultLine } from "./publish-model";
import { type DraftHand, useDraft } from "./use-draft";
import "./draft.css";
import { escapeOwnedByLayer } from "../escape-layer";

/**
 * 초안 편집기(2026-10-23 · 최종 구현 계획 F1) — 기획서 칸의 고치기 얼굴. 읽던 문서 대신 서서 블록 단위로
 * 고친다. 초안은 이 컴퓨터에 보관되고, 발행은 확인 창(`PublishDialog`)을 거쳐 Confluence 에 닿는다.
 * 이 컴퓨터의 말은 전부 `L.drafts` 이고, 클래스는 `nx-dr-*` 로만 산다.
 */

// 위 · 아래 옮기기의 그림 — `ui/icons.tsx` 의 make 와 같은 모양으로 이 칸에서만 찍는다.
function glyph(Glyph: LucideIcon) {
  return function Icon() {
    return <Glyph className="nx-i" size={13} strokeWidth={1.8} aria-hidden="true" />;
  };
}

const UpIcon = glyph(ArrowUp);
const DownIcon = glyph(ArrowDown);

/** 더하기가 고르는 새 블록의 종류 — preserved 는 여기서 만들지 않는다. */
type NewKind = "heading" | "paragraph" | "list" | "table";

/** 더하기가 처음 놓는 빈 블록 — 놓인 뒤 곧바로 고치는 칸을 열어 글을 채우게 한다. */
function blankView(kind: NewKind): DraftBlockView {
  if (kind === "heading") return { kind, level: 2, text: "" };
  if (kind === "paragraph") return { kind, text: "" };
  if (kind === "list") return { kind, ordered: false, items: [""] };
  return {
    kind,
    rows: [
      {
        cells: [
          { header: true, text: "" },
          { header: true, text: "" },
        ],
      },
      {
        cells: [
          { header: false, text: "" },
          { header: false, text: "" },
        ],
      },
    ],
  };
}

/** 고치는 칸 안의 글 — 토큰 안내는 이 글에 나타난 토큰만 열거한다. */
function paneText(view: DraftBlockView): string {
  if (view.kind === "heading" || view.kind === "paragraph") return view.text;
  if (view.kind === "list") return view.items.join("\n");
  if (view.kind === "table") {
    return view.rows.map((row) => row.cells.map((cell) => cell.text).join("\n")).join("\n");
  }
  return "";
}

/** 제목 — 눌러 고치고, Enter · 떠남으로 적용하고, Esc 로 그만둔다. */
function TitleField({
  title,
  locked,
  busy,
  onApply,
}: {
  title: string;
  locked: boolean;
  busy: boolean;
  onApply: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);
  if (!editing) {
    return (
      <button
        type="button"
        className="nx-dr-title"
        disabled={locked}
        title={L.drafts.blockEdit}
        onClick={() => {
          setValue(title);
          setEditing(true);
        }}
      >
        {title}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next !== "" && next !== title) onApply(next);
  };
  return (
    <input
      className="nx-dr-title-in"
      aria-label={L.drafts.titleField}
      value={value}
      disabled={busy}
      // biome-ignore lint/a11y/noAutofocus: 제목을 누른 손이 곧 쓸 자리다.
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === "Escape") {
          // 창 · 메뉴(겹판 · 팝)가 열려 있으면 그것의 Esc 다 — 고치던 제목은 버리지 않는다(2026-10-23 · R3 발견 3).
          if (escapeOwnedByLayer()) return;
          event.preventDefault();
          event.stopPropagation();
          setEditing(false);
          setValue(title);
        }
      }}
    />
  );
}

/** 충돌의 한쪽 — 내 것 아니면 Confluence 것. */
function ConflictSide({
  label,
  view,
  tokens,
}: {
  label: string;
  view: DraftBlockView;
  tokens: Record<string, string>;
}) {
  return (
    <div className="nx-dr-side">
      <p className="nx-dr-side-t">{label}</p>
      <div className="nx-dr-read">
        <Markdown text={viewToMarkdown(view, tokens)} />
      </div>
    </div>
  );
}

/** 표 고치는 칸 — 셀마다 작은 칸, 좁은 창에서는 가로로 스크롤된다. */
function TableEdit({
  rows,
  busy,
  onRows,
}: {
  rows: DraftTableRow[];
  busy: boolean;
  onRows: (rows: DraftTableRow[]) => void;
}) {
  return (
    <div className="nx-dr-sheet-wrap">
      {/* biome-ignore lint/a11y/useSemanticElements: fieldset 의 기본 꼴은 표 고치는 칸의 옷과 맞지 않는다 */}
      <div className="nx-dr-sheet" role="group" aria-label={L.drafts.addTable}>
        {rows.map((row, r) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 표의 줄은 자리가 곧 정체다
          <div key={r} className="nx-dr-sheet-row">
            {row.cells.map((cell, c) => (
              <textarea
                // biome-ignore lint/suspicious/noArrayIndexKey: 표의 칸도 자리가 곧 정체다
                key={c}
                className={cell.header ? "nx-dr-cell nx-dr-cell--head" : "nx-dr-cell"}
                aria-label={L.drafts.cellLabel(r + 1, c + 1)}
                rows={2}
                value={cell.text}
                disabled={busy}
                onChange={(event) =>
                  onRows(
                    rows.map((one, rr) =>
                      rr === r
                        ? {
                            cells: one.cells.map((piece, cc) =>
                              cc === c ? { ...piece, text: event.target.value } : piece,
                            ),
                          }
                        : one,
                    ),
                  )
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className="nx-dr-sheet-act">
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          disabled={busy}
          onClick={() => onRows(tableAddRow(rows, rows.length))}
        >
          {L.drafts.addRow}
        </button>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          disabled={busy}
          onClick={() => onRows(tableRemoveRow(rows, rows.length - 1))}
        >
          {L.drafts.removeRow}
        </button>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          disabled={busy}
          onClick={() => onRows(tableAddColumn(rows))}
        >
          {L.drafts.addColumn}
        </button>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          disabled={busy}
          onClick={() => onRows(tableRemoveColumn(rows, (rows[0]?.cells.length ?? 1) - 1))}
        >
          {L.drafts.removeColumn}
        </button>
      </div>
    </div>
  );
}

/** 블록 하나의 고치는 칸 — 종류마다 다른 칸과 토큰 안내, 적용 · 취소. */
function BlockEdit({
  block,
  busy,
  onApply,
  onCancel,
}: {
  block: DraftBlock;
  busy: boolean;
  onApply: (view: DraftBlockView) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DraftBlockView>(block.view);
  const legend = useMemo(() => tokenLegend(paneText(draft), block.tokens), [draft, block.tokens]);
  // ⌘/Ctrl+Enter 로 적용하고, Esc 는 제 자리에서만 멈춘다(편집기 닫기로 새지 않게). 창 · 메뉴(겹판 · 팝)가
  // 열려 있으면 그것의 Esc 다 — 고치던 블록을 취소하지 않는다(2026-10-23 · R3 발견 3).
  const onPaneKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      if (escapeOwnedByLayer()) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onApply(draft);
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: 칸 전체에서 ⌘/Ctrl+Enter 와 Esc 를 받는다
    <div className="nx-dr-pane" onKeyDown={onPaneKey}>
      {draft.kind === "heading" && (
        <div className="nx-dr-pane-row">
          <select
            className="nx-dr-level"
            aria-label={L.drafts.levelLabel}
            value={draft.level}
            disabled={busy}
            onChange={(event) => {
              // select 의 값은 문자 — 계약의 수준(1–6)으로 되돌린다.
              const level = Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6;
              setDraft({ ...draft, level });
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <input
            className="nx-dr-line"
            aria-label={L.drafts.headingField}
            value={draft.text}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          />
        </div>
      )}
      {draft.kind === "paragraph" && (
        <textarea
          className="nx-dr-area"
          aria-label={L.drafts.bodyField}
          rows={4}
          value={draft.text}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        />
      )}
      {draft.kind === "list" && (
        <>
          <label className="nx-dr-check">
            <input
              type="checkbox"
              checked={draft.ordered}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, ordered: event.target.checked })}
            />
            {L.drafts.orderedLabel}
          </label>
          <textarea
            className="nx-dr-area"
            aria-label={L.drafts.listField}
            rows={4}
            value={listToText(draft.items)}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, items: textToList(event.target.value) })}
          />
        </>
      )}
      {draft.kind === "table" && (
        <TableEdit rows={draft.rows} busy={busy} onRows={(rows) => setDraft({ ...draft, rows })} />
      )}
      {legend.length > 0 && (
        <p className="nx-dr-legend">
          {legend.map((item) => (
            <span key={item.name} className="nx-dr-legend-item">
              {L.drafts.legendItem(item.name, item.label)}
            </span>
          ))}
          <span className="nx-dr-legend-note">{L.drafts.legendNote}</span>
        </p>
      )}
      <div className="nx-dr-pane-act">
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          disabled={busy}
          onClick={() => onApply(draft)}
        >
          {L.drafts.apply}
        </button>
        <button type="button" className="nx-btn nx-btn--sm nx-btn--ghost" onClick={onCancel}>
          {L.drafts.editCancel}
        </button>
      </div>
    </div>
  );
}

/** 블록 한 칸 — 읽기 화면 · 처지 배지 · 손잡이 단추 · 충돌 고르기 · 고치는 칸. */
function BlockCard({
  block,
  at,
  count,
  locked,
  busy,
  editing,
  adding,
  onEdit,
  onAddToggle,
  onInsert,
  onMoveUp,
  onMoveDown,
  onDelete,
  onRevert,
  onResolve,
  onApplySet,
  onCancelEdit,
}: {
  block: DraftBlock;
  at: number;
  count: number;
  locked: boolean;
  busy: boolean;
  editing: boolean;
  adding: boolean;
  onEdit: () => void;
  onAddToggle: () => void;
  onInsert: (kind: NewKind) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onRevert: () => void;
  onResolve: (blockId: string, choice: "mine" | "theirs") => void;
  onApplySet: (view: DraftBlockView) => void;
  onCancelEdit: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  // 좁힌 값 — JSX 안에서 다시 좁히지 않게 처지와 원격 쪽을 미리 가린다.
  const preserved = block.view.kind === "preserved" ? block.view : null;
  const theirs = block.status === "conflict" && block.theirs !== undefined ? block.theirs : null;
  return (
    <li className="nx-dr-block" data-status={block.status}>
      {preserved !== null ? (
        <div className="nx-dr-keep">
          <p className="nx-dr-keep-t">
            {L.drafts.preservedBox(L.drafts.tokenLabel(preserved.label))}
          </p>
          <p className="nx-dr-keep-b">{L.drafts.preservedNote}</p>
        </div>
      ) : theirs !== null ? (
        <div className="nx-dr-conflict">
          <ConflictSide label={L.drafts.conflictMine} view={block.view} tokens={block.tokens} />
          <ConflictSide label={L.drafts.conflictTheirs} view={theirs} tokens={block.tokens} />
        </div>
      ) : (
        // 배지가 서는 블록은 글이 배지 밑으로 들어가지 않게 오른쪽을 비운다(`nx-dr-read--badged`).
        <div className={`nx-dr-read${block.status !== "same" ? " nx-dr-read--badged" : ""}`}>
          <Markdown text={viewToMarkdown(block.view, block.tokens)} />
        </div>
      )}
      {theirs === null && block.status !== "same" && (
        <span className="nx-dr-badge" data-status={block.status}>
          {blockStatusLabel(block.status)}
        </span>
      )}
      {theirs !== null && (
        <div className="nx-dr-conflict-act">
          <span className="nx-dr-badge" data-status="conflict">
            {blockStatusLabel("conflict")}
          </span>
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={busy}
            onClick={() => onResolve(block.id, "mine")}
          >
            {L.drafts.useMine}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={busy}
            onClick={() => onResolve(block.id, "theirs")}
          >
            {L.drafts.useTheirs}
          </button>
        </div>
      )}
      <div className="nx-dr-acts">
        {preserved === null && theirs === null && (
          <button type="button" className="nx-dr-act" disabled={locked || busy} onClick={onEdit}>
            <PencilIcon />
            {L.drafts.blockEdit}
          </button>
        )}
        {theirs === null && (
          <button
            type="button"
            className="nx-dr-act"
            aria-expanded={adding}
            disabled={locked || busy}
            onClick={onAddToggle}
          >
            <PlusIcon />
            {L.drafts.addBelow}
          </button>
        )}
        <button
          type="button"
          className="nx-dr-act"
          disabled={locked || busy || at === 0}
          onClick={onMoveUp}
        >
          <UpIcon />
          {L.drafts.moveUp}
        </button>
        <button
          type="button"
          className="nx-dr-act"
          disabled={locked || busy || at === count - 1}
          onClick={onMoveDown}
        >
          <DownIcon />
          {L.drafts.moveDown}
        </button>
        <button
          type="button"
          className="nx-dr-act"
          disabled={locked || busy}
          onClick={() => (preserved !== null ? setConfirmRemove(true) : onDelete())}
        >
          <TrashIcon />
          {L.drafts.remove}
        </button>
        {block.status === "changed" && (
          <button type="button" className="nx-dr-act" disabled={locked || busy} onClick={onRevert}>
            <RefreshIcon />
            {L.drafts.revert}
          </button>
        )}
      </div>
      {adding && theirs === null && (
        // biome-ignore lint/a11y/useSemanticElements: 문단 · 제목 · 목록 · 표를 고르는 자리라 fieldset 의 기본 꼴이 어울리지 않는다
        <div className="nx-dr-add" role="group" aria-label={L.drafts.addBelow}>
          {(
            [
              ["paragraph", L.drafts.addParagraph],
              ["heading", L.drafts.addHeading],
              ["list", L.drafts.addList],
              ["table", L.drafts.addTable],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost"
              disabled={locked || busy}
              onClick={() => onInsert(kind)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {confirmRemove && (
        <InlineConfirm
          className="nx-dr-confirm"
          title={L.drafts.removePreservedTitle}
          body={L.drafts.removePreservedBody}
          confirmLabel={L.drafts.removeConfirm}
          cancelLabel={L.drafts.cancel}
          tone="danger"
          onConfirm={() => {
            setConfirmRemove(false);
            onDelete();
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
      {editing && theirs === null && (
        <BlockEdit block={block} busy={busy} onApply={onApplySet} onCancel={onCancelEdit} />
      )}
    </li>
  );
}

/**
 * 초안 편집기의 몸통 — 판(useDraft 의 결과)이 건네진 뒤의 모양. 연결은 `DraftEditor` 가 맡고,
 * 여기는 문장과 손길만 산다 — 시험 · 견본이 판을 넣어 그림을 볼 수 있는 자리다.
 */
export function DraftEditorSurface({
  daemon,
  draft,
  site,
  nav,
  onClose,
  startWithAi,
  pendingChanges,
  writable,
}: {
  daemon: Daemon;
  draft: DraftHand;
  /** Confluence 사이트 — 발행의 `Confluence 에서 보기` 링크가 쓴다. */
  site: string | null;
  nav: ShellNav;
  onClose: () => void;
  /** 빈 초안의 `AI 와 시작하기` — 대화 칸의 입력 칸으로 초점을 옮긴다. 대화 칸이 없으면 없다. */
  startWithAi?: () => void;
  /** 초안 요약의 바뀐 블록 수(지움 포함) — 머리의 `아직 발행 전` 이 함께 본다. 모르면 없다. */
  pendingChanges?: number;
  /** 이 앱이 Confluence 에 쓸 수 있는가(발행 게이트) — 발행 단추가 누르기 전에 꺼짐을 말한다. 모르면 없다. */
  writable?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [applying, setApplying] = useState(false);
  // 발행 확인 창과 결과 띠의 손(2026-10-23 · 최종 구현 계획 F2).
  const [publishOpen, setPublishOpen] = useState(false);
  const [bandBusy, setBandBusy] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  // 근거 보내기 판(2026-10-23 · 최종 구현 계획 F3) — 머리의 단추가 연다.
  const [sendOpen, setSendOpen] = useState(false);
  // 다른 창 · 대화에서 초안이 바뀌어 다시 읽은 판 — 고치는 칸이 열려 있으면 한 줄로 알린다. 칸의 글은
  // 지우지 않는다(2026-10-23 화면 확인 · R2 검토 의심 완화). 제 손으로 바꾼 개정은 알림을 세우지 않는다.
  const editingRef = useRef(false);
  editingRef.current = editingId !== null;
  const seenRevision = useRef<number | null>(null);
  useEffect(() => {
    const revision = draft.view?.revision ?? null;
    if (revision === null || revision === seenRevision.current) return;
    const first = seenRevision.current === null;
    seenRevision.current = revision;
    // 개정 어긋남의 한 줄(staleReloaded)이 서 있으면 그것으로 족하다.
    if (!first && draft.notice === null && editingRef.current) nav.toast(L.drafts.reloadedOutside);
  }, [draft.view, draft.notice, nav]);

  // 결과를 못 받은 발행을 다시 묻는다 — 자동 재전송은 없다.
  const recheckPending = async () => {
    const id = draft.view?.pendingCommandId ?? null;
    if (id === null || bandBusy) return;
    setBandBusy(true);
    try {
      const result = await daemon.api.draftPublishRecheck(id);
      nav.toast(resultLine(result));
      draft.reload();
    } catch (err: unknown) {
      nav.toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBandBusy(false);
    }
  };

  // 재전송 없이 종료 — 확인 한 번을 더 거쳐 처지를 닫는다.
  const closePending = async () => {
    const id = draft.view?.pendingCommandId ?? null;
    if (id === null || bandBusy) return;
    setBandBusy(true);
    try {
      await daemon.api.draftPublishClose(id);
      draft.reload();
    } catch (err: unknown) {
      nav.toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBandBusy(false);
      setCloseConfirm(false);
    }
  };

  // 다시 읽었음의 한 줄 — 셸의 토스트로 옮기고 거둔다.
  useEffect(() => {
    if (draft.notice === null) return;
    nav.toast(draft.notice);
    draft.clearNotice();
  }, [draft, nav]);

  const applyEdits = useCallback(
    async (edits: DraftEdit[]) => {
      setApplying(true);
      const next = await draft.apply(edits);
      // 제 손으로 바꾼 개정은 다시 읽음 알림을 세우지 않는다 — 판이 이미 새것이다.
      if (next !== null) seenRevision.current = next.revision;
      setApplying(false);
      return next;
    },
    [draft.apply],
  );

  // 더하기 — 꽂은 자리 바로 다음의 새 블록을 고치는 칸으로 연다.
  const insertBelow = async (afterId: string | null, kind: NewKind) => {
    setAddingFor(null);
    const next = await applyEdits([
      { type: "insert", afterBlockId: afterId, view: blankView(kind) },
    ]);
    if (next === null) return;
    const at = afterId === null ? 0 : next.blocks.findIndex((block) => block.id === afterId) + 1;
    const fresh = next.blocks[at];
    if (fresh !== undefined) setEditingId(fresh.id);
  };

  const setBlock = async (blockId: string, next: DraftBlockView) => {
    const reply = await applyEdits([{ type: "set", blockId, view: next }]);
    if (reply !== null) setEditingId(null);
  };

  // 편집기의 Esc — 고치는 칸 · 입력 칸의 Esc 는 제 자리에서 멈추고, 여기까지 오면 읽는 화면으로 돌아간다.
  const onEscape = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // 발행 창 · 근거 보내기 · 메뉴의 Esc 는 그것들이 닫는다 — 편집기까지 닫지 않는다(2026-10-23 화면 확인).
    if (escapeOwnedByLayer()) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  if (draft.phase !== "ready" || draft.view === null) {
    const failed = draft.phase === "failed";
    return (
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 편집기의 Esc 는 읽는 화면으로 돌아오는 길이다
      <article className="nx-dr" aria-busy={!failed} onKeyDown={onEscape}>
        {!failed && (
          <div className="nx-dr-skel" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        <p className="nx-dr-fail" role={failed ? "alert" : "status"}>
          {failed ? (
            (draft.error ?? L.drafts.loadFailed)
          ) : (
            <>
              <Spin /> {L.plans.reading}
            </>
          )}
          {failed && (
            <button type="button" className="nx-btn nx-btn--sm" onClick={draft.retry}>
              {L.plans.retry}
            </button>
          )}
        </p>
      </article>
    );
  }

  const view = draft.view;
  const blocks = view.blocks;
  const locked = view.state === "publishing" || view.state === "result-unknown";
  const viewLink = site !== null && view.pageId !== null ? docUrl(site, view.pageId) : null;
  // 머리의 한 줄 상태 — 기계의 개정 번호 대신 어디서 시작했고 무엇이 바뀌었는지를 말한다(2026-10-23 기획자
  // 화면 손질 D3). 개정 번호는 툴팁에 남는다 — 기획 근거 칩의 `개정 N` 과 맞춰 볼 때 쓴다.
  const changed = blocks.filter((block) => block.status === "changed").length;
  const inserted = blocks.filter((block) => block.status === "new").length;
  // 지운 블록은 초안에 보이지 않는다 — 요약의 수(지움 포함)와 견주어 큰 쪽으로 바뀐 곳이 있는지 본다.
  const pending = Math.max(
    changed + inserted + blocks.filter((block) => block.status === "conflict").length,
    pendingChanges ?? 0,
  );
  const unpublished =
    (view.state === "editing" || view.state === "conflict") &&
    (pending > 0 || view.baseVersion === null);
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 편집기의 Esc 는 읽는 화면으로 돌아오는 길이다
    <article className="nx-dr" aria-busy={applying} onKeyDown={onEscape}>
      {/* 머리는 두 줄이다 — 제목이 첫 줄을 다 쓰고, 상태와 단추가 둘째 줄에 선다. 단추가 제목과 한 줄을 나누면
          제목이 낱말마다 꺾였다(2026-10-23 기획자 화면 손질 F4). */}
      <header className="nx-dr-hd">
        <div className="nx-dr-heading">
          <TitleField
            title={view.title}
            locked={locked}
            busy={applying}
            onApply={(title) => void applyEdits([{ type: "title", title }])}
          />
        </div>
        <div className="nx-dr-hd-row">
          <div className="nx-dr-meta" title={L.drafts.meta(view.revision, view.baseVersion)}>
            <span>{L.drafts.metaLine(view.baseVersion, changed, inserted)}</span>
            {unpublished && <span className="nx-dr-unpub">{L.drafts.unpublished}</span>}
            {view.stage.notation !== null && (
              <span className="nx-dr-stage" title={L.drafts.stageClosed}>
                v{view.stage.notation}
                {view.stage.closed && (
                  <span className="nx-dr-stage-note">{L.drafts.stageClosed}</span>
                )}
              </span>
            )}
          </div>
          <div className="nx-dr-acts-hd">
            <button type="button" className="nx-btn nx-btn--sm" onClick={() => setSendOpen(true)}>
              {L.drafts.sendToScreen}
            </button>
            {/* 발행이 꺼져 있으면(게이트) 누르기 전에 말한다 — 으뜸 단추의 옷을 벗고 `꺼짐` 이 붙는다. 눌러서 반영할
                내용은 그대로 미리 본다(확인 창이 막는 이유를 말한다 · 2026-10-23 기획자 화면 손질 U2). */}
            <button
              type="button"
              className={`nx-btn nx-btn--sm${writable === false ? "" : " nx-btn--pri"}`}
              disabled={locked || applying}
              title={writable === false ? L.drafts.publishOffHint : undefined}
              onClick={() => setPublishOpen(true)}
            >
              {L.drafts.publish}
              {writable === false && <span className="nx-dr-off">{L.drafts.publishOff}</span>}
            </button>
            <button type="button" className="nx-btn nx-btn--sm" onClick={onClose}>
              <CloseIcon />
              {L.drafts.close}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost"
              // 결과 확인 필요 중에 버리면 남은 발행 의도를 화면에서 정리할 길이 없어진다 — 다른
              // 손잡이와 같은 잠금이다(2026-10-23 화면 확인 · R2 검토 4).
              disabled={locked}
              title={locked ? L.drafts.locked : undefined}
              onClick={() => setConfirmDiscard(true)}
            >
              <TrashIcon />
              {L.drafts.discard}
            </button>
          </div>
        </div>
      </header>
      {/* 잠금의 한 줄 — 결과 확인 필요 띠가 서면 그 띠가 함께 말한다(띠 둘이 겹쳐 서지 않게 · 2026-10-23 기획자 화면 손질). */}
      {locked && !(view.state === "result-unknown" && view.pendingCommandId !== null) && (
        <p className="nx-dr-lock" role="status">
          {L.drafts.locked}
        </p>
      )}
      {view.state === "result-unknown" && view.pendingCommandId !== null && (
        <div className="nx-dr-bandwrap">
          {/* 띠(role="status")는 상태 문장만 읽힌다 — 단추와 확인판은 띠 밖 같은 자리 아래에 선다
              (2026-10-23 화면 확인 · R2 검토 9). */}
          <p className="nx-dr-band nx-dr-band--warn nx-dr-band--stack" role="status">
            <b>{L.drafts.resultUnknownTitle}</b>
            <span className="nx-dr-band-s">{L.drafts.resultUnknownBody}</span>
            <span className="nx-dr-band-s">{L.drafts.locked}</span>
          </p>
          <div className="nx-dr-band-act">
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={bandBusy}
              onClick={() => void recheckPending()}
            >
              {L.drafts.actionRecheck}
            </button>
            {viewLink !== null && (
              <a
                className="nx-btn nx-btn--sm"
                href={viewLink}
                target="_blank"
                rel="noreferrer"
                onClick={linkClick}
              >
                {L.drafts.viewInConfluence}
                <ExternalIcon />
              </a>
            )}
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost"
              disabled={bandBusy}
              onClick={() => setCloseConfirm(true)}
            >
              {L.drafts.closeNoResend}
            </button>
          </div>
          {closeConfirm && (
            <InlineConfirm
              className="nx-dr-confirm"
              title={L.drafts.closeNoResendTitle}
              body={L.drafts.closeNoResendBody}
              confirmLabel={L.drafts.closeNoResendConfirm}
              cancelLabel={L.drafts.cancel}
              tone="danger"
              onConfirm={() => void closePending()}
              onCancel={() => setCloseConfirm(false)}
            />
          )}
        </div>
      )}
      {view.state === "published" && (
        <p className="nx-dr-band nx-dr-band--ok" role="status">
          {L.drafts.publishedNote}
        </p>
      )}
      {view.state === "conflict" && (
        <p className="nx-dr-band nx-dr-band--conflict" role="status">
          {L.drafts.conflictNote}
        </p>
      )}
      {draft.error !== null && (
        <p className="nx-dr-fail" role="alert">
          {draft.error}
        </p>
      )}
      {confirmDiscard && (
        <InlineConfirm
          className="nx-dr-confirm"
          title={L.drafts.discardTitle}
          body={L.drafts.discardBody}
          confirmLabel={L.drafts.discardConfirm}
          cancelLabel={L.drafts.cancel}
          tone="danger"
          onConfirm={() => {
            setConfirmDiscard(false);
            void draft.discard().then((ok) => {
              if (ok) onClose();
            });
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
      {blocks.length === 0 ? (
        <div className="nx-dr-empty">
          <p>{L.drafts.emptyGuide}</p>
          <div className="nx-dr-empty-acts">
            {startWithAi !== undefined && (
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={locked || applying}
                onClick={startWithAi}
              >
                <SparkIcon />
                {L.drafts.startWithAi}
              </button>
            )}
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={locked || applying}
              onClick={() => void insertBelow(null, "paragraph")}
            >
              <PlusIcon />
              {L.drafts.writeDirectly}
            </button>
          </div>
        </div>
      ) : (
        <ol className="nx-dr-blocks">
          {blocks.map((block, at) => (
            <BlockCard
              key={block.id}
              block={block}
              at={at}
              count={blocks.length}
              locked={locked}
              busy={applying}
              editing={editingId === block.id}
              adding={addingFor === block.id}
              onEdit={() => setEditingId(block.id)}
              onAddToggle={() => setAddingFor((before) => (before === block.id ? null : block.id))}
              onInsert={(kind) => void insertBelow(block.id, kind)}
              onMoveUp={() =>
                void applyEdits([
                  { type: "move", blockId: block.id, afterBlockId: blocks[at - 2]?.id ?? null },
                ])
              }
              onMoveDown={() => {
                const next = blocks[at + 1];
                if (next === undefined) return;
                void applyEdits([{ type: "move", blockId: block.id, afterBlockId: next.id }]);
              }}
              onDelete={() => void applyEdits([{ type: "delete", blockId: block.id }])}
              onRevert={() => void applyEdits([{ type: "revert", blockId: block.id }])}
              onResolve={draft.resolve}
              onApplySet={(next) => void setBlock(block.id, next)}
              onCancelEdit={() => setEditingId(null)}
            />
          ))}
        </ol>
      )}
      {publishOpen && (
        <PublishDialog
          daemon={daemon}
          docKey={view.docKey}
          site={site}
          baseTitle={view.baseTitle}
          pendingCommandId={view.pendingCommandId}
          nav={nav}
          onClose={() => setPublishOpen(false)}
          onRefresh={draft.reload}
        />
      )}
      {sendOpen && (
        <SendToScreen
          daemon={daemon}
          nav={nav}
          target={{ docKey: view.docKey }}
          sections={headingSections(blocks)}
          isDraft
          // 초안을 고치는 동안 화면 대화 칸은 비켜서 있다(집중 배치) — 담았으면 미리보기와 화면 대화를 앞에 세워
          // 말을 붙여 보낼 자리를 연다(2026-10-23 기획자 화면 손질 D2). 초안은 기획서 칸에 열린 채 남는다.
          onSent={() => nav.showPane("preview")}
          onClose={() => setSendOpen(false)}
        />
      )}
    </article>
  );
}

/** 초안 편집기 — 문서의 초안을 블록 단위로 읽고 고친다. 연결만 맡는 얇은 껍질이다. */
export function DraftEditor({
  daemon,
  pageId,
  docKey,
  site,
  nav,
  onClose,
  pendingChanges,
  writable,
}: {
  daemon: Daemon;
  /** 기존 문서 — 문서 보기의 고치기 · 이어 쓰기로 열 때. */
  pageId?: string;
  /** 초안의 열쇠 — 목록의 새 문서 초안 줄로 바로 열 때. */
  docKey?: string;
  /** Confluence 사이트 — 발행의 `Confluence 에서 보기` 링크가 쓴다. */
  site: string | null;
  nav: ShellNav;
  onClose: () => void;
  /** 초안 요약의 바뀐 블록 수(지움 포함) — 머리의 `아직 발행 전` 이 함께 본다. */
  pendingChanges?: number;
  /** 이 앱이 Confluence 에 쓸 수 있는가(발행 게이트 · 2026-10-23 U2). */
  writable?: boolean;
}) {
  const draft = useDraft(daemon, pageId !== undefined ? { pageId } : { docKey });
  // 기획 대화(2026-10-23 · 최종 구현 계획 F1) — 편집기 곁의 대화 칸. 빈 초안의 `AI 와 시작하기` 가
  // 이 입력 칸으로 초점을 옮긴다.
  const threadInputRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    // 넓은 칸에서는 문서와 기획 대화가 나란히 서서 따로 구른다 — 문서를 내려 읽어도 AI 의 입력이 바닥에 남는다
    // (2026-10-23 기획자 화면 손질 D2 · @container nxpl). 좁은 칸에서는 위아래로 서고 칸 하나가 구른다.
    <div className="nx-dr-with">
      <div className="nx-dr-main">
        <DraftEditorSurface
          draft={draft}
          daemon={daemon}
          site={site}
          nav={nav}
          onClose={onClose}
          startWithAi={() => threadInputRef.current?.focus()}
          pendingChanges={pendingChanges}
          writable={writable}
        />
      </div>
      <DraftThread
        daemon={daemon}
        docKey={draft.view?.docKey ?? null}
        draft={draft}
        nav={nav}
        inputRef={threadInputRef}
      />
    </div>
  );
}
