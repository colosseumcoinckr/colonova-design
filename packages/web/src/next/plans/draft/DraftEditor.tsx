import type {
  DocBlock,
  DocOpResult,
  DraftBlock,
  DraftBlockView,
  DraftEdit,
  DraftRevisionSummary,
  DraftRevisionView,
  DraftTableRow,
} from "@colonova-design/protocol";
import { ArrowDown, ArrowUp, History, type LucideIcon, Maximize2 } from "lucide-react";
import {
  type ClipboardEvent as ReactClipboardEvent,
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
  InfoIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SparkIcon,
  Spin,
  TrashIcon,
} from "../../ui/icons";
import { Popover } from "../../ui/Popover";
import { DocMenu } from "../doc-actions/DocMenu";
import { headingSections } from "../doc-actions/doc-actions-model";
import { SendToScreen } from "../doc-actions/SendToScreen";
import { docUrl, type PlanListRow } from "../plans-list";
import { DocPreview } from "../view/DocView";
import { useBlockPreviews } from "../view/use-block-previews";
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
import { clipboardBlocks, insertEdits, pipeTable, typedShift } from "./markdown-blocks";
import { PublishDialog } from "./PublishDialog";
import { resultLine } from "./publish-model";
import { diffWords } from "./text-diff";
import { opSummary } from "./thread-model";
import type { DraftHand } from "./use-draft";
import type { DraftThreadHand } from "./use-draft-thread";
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
      className="nx-input nx-dr-title-in"
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
        <Markdown
          text={viewToMarkdown(view, tokens)}
          tokens={tokenLabelsOf(tokens)}
          machineTokens={tokens}
        />
      </div>
    </div>
  );
}

/** 견주기의 벗긴 글 — 굵게 · 기울임 · 머리말 · 목록 표지는 견주기의 잡음이라 걷는다(2026-10-31 2단계).
 *  토큰 칩의 다리(`[글](#token-t1)`)도 글로 되돌려 놓는다(2026-11-03 실앱 감사). */
function plainOf(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[-*]\s+/gmu, "")
    .replace(/^\d+\.\s+/gmu, "")
    .replace(/\*\*/gu, "")
    .replace(/\*/gu, "")
    .replace(/\[([^\]]+)\]\(#token-[^)]*\)/gu, "$1")
    .trim();
}

/** 토큰의 사람의 이름표 — ⟦t1⟧ 글자 대신 칩으로 그릴 때 쓴다(2026-10-31 4단계). */
function tokenLabelsOf(tokens: Record<string, string>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [name, machine] of Object.entries(tokens)) {
    labels[name] = L.drafts.tokenLabel(machine);
  }
  return labels;
}

/** Confluence 판과 견주기의 한 면(2026-10-31 2단계) — 지운 글에 취소선, 더한 글에 밑줄. */
function DiffText({ pieces }: { pieces: ReturnType<typeof diffWords> }) {
  return (
    <p className="nx-dr-diff">
      {pieces.map((piece, at) =>
        piece.kind === "same" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 견주기 조각은 자리가 곧 정체다
          <span key={at}>{piece.text}</span>
        ) : piece.kind === "del" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 견주기 조각은 자리가 곧 정체다
          <del key={at}>{piece.text}</del>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 견주기 조각은 자리가 곧 정체다
          <ins key={at}>{piece.text}</ins>
        ),
      )}
    </p>
  );
}

/** Confluence 판과 견주기 판(2026-10-31 2단계) — 발행본 기준 대비 바뀐 곳을 블록마다 보인다.
 *  열려 있는 동안 문서 판 대신 이 판이 선다 — 같은 문서가 두 벌로 겹쳐 보이지 않게(2026-11-03 실앱 감사). */
function ComparePanel({ base, blocks }: { base: DraftRevisionView | null; blocks: DraftBlock[] }) {
  if (base === null) {
    return (
      <p className="nx-dr-compare-load">
        <Spin /> {L.plans.reading}
      </p>
    );
  }
  const baseById = new Map(base.blocks.map((block) => [block.id, block]));
  const deleted = base.blocks.filter((block) => !blocks.some((one) => one.id === block.id));
  const changed = blocks.filter(
    (block) => baseById.has(block.id) && block.status !== "same",
  ).length;
  const inserted = blocks.filter((block) => !baseById.has(block.id)).length;
  return (
    <section className="nx-dr-compare" aria-label={L.drafts.compareTitle}>
      <p className="nx-dr-compare-sub">{L.drafts.compareSub}</p>
      {/* 바뀐 곳이 하나도 없으면 문서를 다시 겹쳐 보이지 않고 한 줄로 답한다(2026-11-03 실앱 감사). */}
      {changed + inserted + deleted.length === 0 ? (
        <p className="nx-dr-compare-sub">{L.drafts.compareNone}</p>
      ) : (
        <ol className="nx-dr-blocks">
          {blocks.map((block) => {
            const before = baseById.get(block.id);
            const tokens = tokenLabelsOf(block.tokens);
            if (before === undefined) {
              return (
                <li key={block.id} className="nx-dr-block nx-dr-compare-ins" data-status="new">
                  <div className="nx-dr-read">
                    <Markdown
                      text={viewToMarkdown(block.view, block.tokens)}
                      tokens={tokens}
                      machineTokens={block.tokens}
                    />
                  </div>
                  <span className="nx-pill nx-pill--accent nx-dr-badge">
                    {L.drafts.compareInserted}
                  </span>
                </li>
              );
            }
            if (block.status === "same") {
              return (
                <li key={block.id} className="nx-dr-block" data-status="same">
                  <div className="nx-dr-read">
                    <Markdown
                      text={viewToMarkdown(block.view, block.tokens)}
                      tokens={tokens}
                      machineTokens={block.tokens}
                    />
                  </div>
                </li>
              );
            }
            return (
              <li
                key={block.id}
                className="nx-dr-block nx-dr-compare-changed"
                data-status="changed"
              >
                <DiffText
                  pieces={diffWords(
                    plainOf(viewToMarkdown(before.view, before.tokens)),
                    plainOf(viewToMarkdown(block.view, block.tokens)),
                  )}
                />
              </li>
            );
          })}
          {deleted.map((block) => (
            <li key={block.id} className="nx-dr-block nx-dr-compare-del" data-status="changed">
              <p className="nx-dr-diff">
                <del>{viewToMarkdown(block.view, block.tokens)}</del>
              </p>
              <span className="nx-pill nx-pill--red nx-dr-badge">{L.drafts.compareDeleted}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** 제자리 고치기(2026-10-31 4단계 · C) — 블록을 두 번 누르면 그 자리에서 고친다. 본문 글꼴 · 폭 그대로.
 *  마크다운 길(2026-11-02 사용자 지시) — 문단에서 `- ` · `* ` · `1. ` · `# ` ~ `###### ` 를 치면 그 자리에서
 *  목록 · 제목으로 바뀌고, 막대 모양(`|`)의 표는 적용할 때 표가 된다. 서식 있는 붙여넣기는 같은 종류면
 *  커서 자리에 끼우고, 여러 블록이면 지금 글을 마저 넣고 뒤에 잇는다. */
function InlineEdit({
  block,
  busy,
  onApply,
  onApplyEdits,
  onCancel,
}: {
  block: DraftBlock;
  busy: boolean;
  onApply: (view: DraftBlockView) => void;
  /** 여러 블록을 한 요청에 싣는 길(붙여넣기) — 성공하면 칸은 닫힌다. 없으면 기본 붙여넣기. */
  onApplyEdits?: (edits: DraftEdit[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const view = block.view;
  // 종류가 바뀌는 동안의 모양 — 표식을 치면 문단이 목록 · 제목 모양으로 옮겨 앉는다.
  const [shape, setShape] = useState<DraftBlockView>(view);
  const initial =
    view.kind === "paragraph"
      ? view.text
      : view.kind === "heading"
        ? view.text
        : view.kind === "list"
          ? listToText(view.items)
          : "";
  const [value, setValue] = useState(initial);
  /** 지금 모양의 뷰 — 글은 칸의 값으로. */
  const viewOf = (text: string): DraftBlockView => {
    if (shape.kind === "heading") return { ...shape, text };
    if (shape.kind === "list") return { ...shape, items: textToList(text) };
    return { kind: "paragraph", text };
  };
  // 막대 모양의 표는 적용할 때 표가 된다 — 표식을 치는 순간이 아니라 다 쓴 뒤에.
  const currentView = (): DraftBlockView => {
    if (shape.kind === "paragraph") {
      const rows = pipeTable(value);
      if (rows !== null) return { kind: "table", rows };
    }
    return viewOf(value);
  };
  const commit = () => {
    if (value.trim() === "" || (value === initial && shape.kind === view.kind)) {
      onCancel();
      return;
    }
    onApply(currentView());
  };
  // 표식을 친 순간 — 종류만 바꾸고 글은 표식 뒤의 글로 이어 받는다.
  const onValue = (next: string) => {
    const shift = typedShift(value, next);
    if (shift !== null) {
      setShape(
        shift.kind === "heading"
          ? { kind: "heading", level: shift.level ?? 2, text: "" }
          : { kind: "list", ordered: shift.ordered ?? false, items: [] },
      );
      setValue(shift.rest);
      return;
    }
    setValue(next);
  };
  // 서식 있는 붙여넣기(2026-11-02) — 서식이 없으면(HTML 이 없으면) 브라우저의 기본 길.
  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const html = event.clipboardData.getData("text/html");
    if (html === "") return;
    const views = clipboardBlocks(html);
    if (views === null || views.length === 0) return;
    const area = event.currentTarget;
    const at = area.selectionStart ?? value.length;
    const end = area.selectionEnd ?? at;
    const piece = (text: string) => value.slice(0, at) + text + value.slice(end);
    const single = views.length === 1 ? (views[0] ?? null) : null;
    if (
      single !== null &&
      (single.kind === "paragraph" || single.kind === "heading" || single.kind === "list") &&
      single.kind === shape.kind
    ) {
      event.preventDefault();
      const text = single.kind === "list" ? listToText(single.items) : single.text;
      setValue(piece(text));
      requestAnimationFrame(() => {
        area.selectionStart = area.selectionEnd = at + text.length;
      });
      return;
    }
    if (onApplyEdits === undefined) return;
    event.preventDefault();
    // 첫 조각이 흐르는 글이면 커서 자리에 끼우고, 나머지는 뒤에 잇는다.
    let head = value;
    let extra: DraftBlockView[] = views;
    if (
      single !== null &&
      (single.kind === "paragraph" || single.kind === "heading") &&
      (shape.kind === "paragraph" || shape.kind === "heading")
    ) {
      head = piece(single.text);
      extra = views.slice(1);
    }
    void onApplyEdits([
      { type: "set", blockId: block.id, view: viewOf(head) },
      ...insertEdits(block.id, extra),
    ]);
  };
  return (
    <div className="nx-dr-inline">
      <textarea
        className="nx-dr-inline-area"
        // biome-ignore lint/a11y/noAutofocus: 두 번 누른 자리가 곧 쓸 자리다.
        autoFocus
        aria-label={L.drafts.blockEdit}
        value={value}
        disabled={busy}
        rows={Math.max(2, value.split("\n").length)}
        onChange={(event) => onValue(event.target.value)}
        onPaste={onPaste}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !escapeOwnedByLayer()) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      <p className="nx-dr-inline-hint" aria-hidden="true">
        {L.drafts.inlineApplyHint}
      </p>
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
  /** 한 칸의 글을 바꾼다 — 고침과 붙여넣기(2026-11-02)가 같은 길로 쓴다. */
  const setCell = (rowAt: number, cellAt: number, text: string) =>
    onRows(
      rows.map((one, rr) =>
        rr === rowAt
          ? {
              cells: one.cells.map((piece, cc) => (cc === cellAt ? { ...piece, text } : piece)),
            }
          : one,
      ),
    );
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
                className={
                  cell.header
                    ? "nx-input nx-input--area nx-dr-cell nx-dr-cell--head"
                    : "nx-input nx-input--area nx-dr-cell"
                }
                aria-label={L.drafts.cellLabel(r + 1, c + 1)}
                rows={2}
                value={cell.text}
                disabled={busy}
                onChange={(event) => setCell(r, c, event.target.value)}
                onPaste={(event) => {
                  // 서식 있는 붙여넣기(2026-11-02) — 흐르는 글 한 조각이면 서식을 살려 끼운다.
                  // 여러 조각은 셀에 담지 못하니 기본 길로 글이라도 전부 담는다.
                  const html = event.clipboardData.getData("text/html");
                  if (html === "") return;
                  const views = clipboardBlocks(html);
                  if (views === null || views.length !== 1) return;
                  const one = views[0];
                  if (one === undefined || one.kind === "table" || one.kind === "preserved") return;
                  event.preventDefault();
                  const text = one.kind === "list" ? listToText(one.items) : one.text;
                  const area = event.currentTarget;
                  const at = area.selectionStart ?? cell.text.length;
                  const end = area.selectionEnd ?? at;
                  setCell(r, c, cell.text.slice(0, at) + text + cell.text.slice(end));
                }}
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

/** 블록 하나의 고치는 칸 — 종류마다 다른 칸과 토큰 안내, 적용 · 취소. 마크다운 길(2026-11-02)은
 *  문단 칸의 표식 변환과 서식 있는 붙여넣기로 들어온다(제자리 고치기와 같은 길). */
function BlockEdit({
  block,
  busy,
  onApply,
  onApplyEdits,
  onCancel,
}: {
  block: DraftBlock;
  busy: boolean;
  onApply: (view: DraftBlockView) => void;
  /** 여러 블록을 한 요청에 싣는 길(붙여넣기) — 성공하면 칸은 닫힌다. 없으면 기본 붙여넣기. */
  onApplyEdits?: (edits: DraftEdit[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DraftBlockView>(block.view);
  const legend = useMemo(() => tokenLegend(paneText(draft), block.tokens), [draft, block.tokens]);
  // 서식 있는 붙여넣기 — 칸의 값(`field` 로 읽고 쓰는 글)에 커서 자리로 끼우고 남는 조각을 뒤에 잇는다.
  const onPaste = (
    event: ReactClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    field: (text: string) => DraftBlockView,
    current: string,
  ) => {
    const html = event.clipboardData.getData("text/html");
    if (html === "") return;
    const views = clipboardBlocks(html);
    if (views === null || views.length === 0) return;
    event.preventDefault();
    const area = event.currentTarget;
    const at = area.selectionStart ?? current.length;
    const end = area.selectionEnd ?? at;
    const first = views[0] ?? null;
    const inline =
      first !== null &&
      (first.kind === "paragraph" || first.kind === "heading" || first.kind === "list")
        ? first.kind === "list"
          ? listToText(first.items)
          : first.text
        : null;
    const merged = inline === null ? current : current.slice(0, at) + inline + current.slice(end);
    const extra = inline === null ? views : views.slice(1);
    setDraft(field(merged));
    if (extra.length > 0 && onApplyEdits !== undefined) {
      void onApplyEdits([
        { type: "set", blockId: block.id, view: field(merged) },
        ...insertEdits(block.id, extra),
      ]);
    }
  };
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
            className="nx-input nx-dr-level"
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
            className="nx-input nx-dr-line"
            aria-label={L.drafts.headingField}
            value={draft.text}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            onPaste={(event) => onPaste(event, (text) => ({ ...draft, text }), draft.text)}
          />
        </div>
      )}
      {draft.kind === "paragraph" && (
        <textarea
          className="nx-input nx-input--area nx-dr-area"
          aria-label={L.drafts.bodyField}
          rows={4}
          value={draft.text}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            // 표식을 친 순간 — 문단이 목록 · 제목 모양으로 옮겨 앉는다(2026-11-02 마크다운 길).
            const shift = typedShift(draft.text, next);
            if (shift !== null) {
              setDraft(
                shift.kind === "heading"
                  ? { kind: "heading", level: shift.level ?? 2, text: shift.rest }
                  : {
                      kind: "list",
                      ordered: shift.ordered ?? false,
                      items: textToList(shift.rest),
                    },
              );
              return;
            }
            setDraft({ ...draft, text: next });
          }}
          onPaste={(event) => onPaste(event, (text) => ({ kind: "paragraph", text }), draft.text)}
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
            className="nx-input nx-input--area nx-dr-area"
            aria-label={L.drafts.listField}
            rows={4}
            value={listToText(draft.items)}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, items: textToList(event.target.value) })}
            onPaste={(event) =>
              onPaste(
                event,
                (text) => ({ ...draft, items: textToList(text) }),
                listToText(draft.items),
              )
            }
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
  flash,
  onEdit,
  onAddToggle,
  onInsert,
  onMoveUp,
  onMoveDown,
  onDelete,
  onRevert,
  onResolve,
  onApplySet,
  onTokenRemove,
  onInlineApply,
  onApplyEdits,
  onCancelEdit,
  keptStep,
  onKeptApply,
  onKeptDrop,
  preview,
  daemon,
  pageId,
}: {
  block: DraftBlock;
  at: number;
  count: number;
  locked: boolean;
  busy: boolean;
  editing: boolean;
  adding: boolean;
  /** 마지막 AI 고침의 블록 — 잠깐 칠한다(2026-10-31 2단계). */
  flash: boolean;
  onEdit: () => void;
  onAddToggle: () => void;
  onInsert: (kind: NewKind) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onRevert: () => void;
  onResolve: (blockId: string, choice: "mine" | "theirs") => void;
  onApplySet: (view: DraftBlockView) => void;
  /** 토큰 칩을 지운다 — 그 조각을 지우는 것이다(2026-10-31 4단계). */
  onTokenRemove: (name: string) => void;
  /** 제자리 고치기의 적용(2026-10-31 4단계 · C). */
  onInlineApply: (view: DraftBlockView) => void;
  /** 여러 블록을 한 요청에 싣는 길(붙여넣기 · 2026-11-02 마크다운 길) — 성공하면 고치는 칸은 닫힌다. */
  onApplyEdits?: (edits: DraftEdit[]) => Promise<boolean>;
  onCancelEdit: () => void;
  /** 사람이 고친 블록에 남은 AI 걸음(2026-10-31 2단계) — 없으면 null. */
  keptStep: { proposalId: string; opId: string; summary: string } | null;
  onKeptApply: () => void;
  onKeptDrop: () => void;
  /** 보존 블록의 읽기 전용 그림(2026-10-30 사용자 요청) — 없으면 자리 표시만 선다. */
  preview?: DocBlock[];
  daemon: Daemon;
  pageId: string | null;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  // 좁힌 값 — JSX 안에서 다시 좁히지 않게 처지와 원격 쪽을 미리 가린다.
  const preserved = block.view.kind === "preserved" ? block.view : null;
  const theirs = block.status === "conflict" && block.theirs !== undefined ? block.theirs : null;
  // 제자리 고치기(2026-10-31 4단계) — 두 번 누르거나 연필로 연다. 표는 모양이 있어 기존의 고치는 칸이 이긴다.
  const inline =
    editing &&
    theirs === null &&
    (block.view.kind === "paragraph" ||
      block.view.kind === "heading" ||
      block.view.kind === "list");
  const tokens = tokenLabelsOf(block.tokens);
  return (
    <li
      className="nx-dr-block"
      data-status={block.status}
      data-block-id={block.id}
      data-flash={flash || undefined}
    >
      {preserved !== null ? (
        <div className="nx-dr-keep">
          <p className="nx-dr-keep-t">
            {L.drafts.preservedBox(L.drafts.tokenLabel(preserved.label))}
          </p>
          <p className="nx-dr-keep-b">{L.drafts.preservedNote}</p>
          {preview !== undefined && preview.length > 0 && (
            <DocPreview blocks={preview} api={daemon.api} pageId={pageId ?? ""} />
          )}
        </div>
      ) : theirs !== null ? (
        <div className="nx-dr-conflict">
          <ConflictSide label={L.drafts.conflictMine} view={block.view} tokens={block.tokens} />
          <ConflictSide label={L.drafts.conflictTheirs} view={theirs} tokens={block.tokens} />
        </div>
      ) : inline ? (
        <InlineEdit
          block={block}
          busy={busy}
          onApply={onInlineApply}
          onApplyEdits={onApplyEdits}
          onCancel={onCancelEdit}
        />
      ) : (
        // 배지가 서는 블록은 글이 배지 밑으로 들어가지 않게 오른쪽을 비운다(`nx-dr-read--badged`).
        // 두 번 누르기의 손은 블록 전체가 받는다 — 제자리 고치기(2026-10-31 4단계)의 문이다.
        // biome-ignore lint/a11y/noStaticElementInteractions: 블록을 두 번 누르는 손이다
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 블록을 두 번 누르는 손이다
        <div
          className={`nx-dr-read${block.status !== "same" ? " nx-dr-read--badged" : ""}`}
          onDoubleClick={() => {
            // 제자리 고치기 — 두 번 누르면 그 자리에서 고친다(2026-10-31 4단계 · C).
            if (!locked && !busy) onEdit();
          }}
          title={L.drafts.inlineEdit}
        >
          <Markdown
            text={viewToMarkdown(block.view, block.tokens)}
            tokens={tokens}
            machineTokens={block.tokens}
            onTokenRemove={onTokenRemove}
          />
        </div>
      )}
      {/* 사람이 고친 블록 위의 남은 걸음(2026-10-31 2단계) — AI 의 고침 · 버리기가 그 자리에 선다. */}
      {keptStep !== null && theirs === null && !inline && (
        // biome-ignore lint/a11y/useSemanticElements: 블록 위에 붙는 작은 손잡이 묶음이라 group 의 기본 꼴이 어울리지 않는다
        <div className="nx-dr-kept" role="group" aria-label={keptStep.summary}>
          <p className="nx-dr-kept-t">{keptStep.summary}</p>
          <div className="nx-dr-kept-acts">
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={busy}
              onClick={onKeptApply}
            >
              {L.drafts.keptApply}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost"
              disabled={busy}
              onClick={onKeptDrop}
            >
              {L.drafts.keptDrop}
            </button>
          </div>
        </div>
      )}
      {theirs === null && block.status !== "same" && (
        <span
          className={`nx-pill nx-dr-badge nx-pill--${block.status === "changed" ? "blue" : block.status === "new" ? "accent" : "red"}`}
          data-status={block.status}
        >
          {blockStatusLabel(block.status)}
        </span>
      )}
      {theirs !== null && (
        <div className="nx-dr-conflict-act">
          <span className="nx-pill nx-pill--red nx-dr-badge" data-status="conflict">
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
      <div className="nx-dr-acts" data-open={adding || editing || undefined}>
        {preserved === null && theirs === null && (
          <button
            type="button"
            className="nx-ibtn nx-ibtn--sm"
            title={L.drafts.blockEdit}
            aria-label={L.drafts.blockEdit}
            disabled={locked || busy}
            onClick={onEdit}
          >
            <PencilIcon />
          </button>
        )}
        {theirs === null && (
          <button
            type="button"
            className="nx-ibtn nx-ibtn--sm"
            title={L.drafts.addBelow}
            aria-label={L.drafts.addBelow}
            aria-expanded={adding}
            disabled={locked || busy}
            onClick={onAddToggle}
          >
            <PlusIcon />
          </button>
        )}
        <button
          type="button"
          className="nx-ibtn nx-ibtn--sm"
          title={L.drafts.moveUp}
          aria-label={L.drafts.moveUp}
          disabled={locked || busy || at === 0}
          onClick={onMoveUp}
        >
          <UpIcon />
        </button>
        <button
          type="button"
          className="nx-ibtn nx-ibtn--sm"
          title={L.drafts.moveDown}
          aria-label={L.drafts.moveDown}
          disabled={locked || busy || at === count - 1}
          onClick={onMoveDown}
        >
          <DownIcon />
        </button>
        <button
          type="button"
          className="nx-ibtn nx-ibtn--sm"
          title={L.drafts.remove}
          aria-label={L.drafts.remove}
          disabled={locked || busy}
          onClick={() => (preserved !== null ? setConfirmRemove(true) : onDelete())}
        >
          <TrashIcon />
        </button>
        {block.status === "changed" && (
          <button
            type="button"
            className="nx-ibtn nx-ibtn--sm"
            title={L.drafts.revert}
            aria-label={L.drafts.revert}
            disabled={locked || busy}
            onClick={onRevert}
          >
            <RefreshIcon />
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
      {/* 표는 모양이 있어 기존의 고치는 칸이 이긴다 — 문단 · 제목 · 목록은 제자리 고치기가 앞선다. */}
      {editing && theirs === null && !inline && (
        <BlockEdit
          block={block}
          busy={busy}
          onApply={onApplySet}
          onApplyEdits={onApplyEdits}
          onCancel={onCancelEdit}
        />
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
  thread,
  flashIds,
  rows,
  onExpandChat,
  onDocApplied,
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
  /** 이 앱이 Confluence 에 쓸 수 있는가(발행 게이트) — 쓰기 꺼짐 칩이 한 곳에서 말한다. 모르면 없다. */
  writable?: boolean;
  /** 기획 대화의 판 — 남은 걸음(사람이 고친 블록)의 고르기와 바로 반영의 표시가 같은 판을 본다. */
  thread?: DraftThreadHand;
  /** 마지막 AI 고침의 블록 — 문서 판에서 잠깐 칠한다(2026-10-31 2단계). */
  flashIds?: readonly string[];
  /** 목록의 줄 — `⋯` 의 문서 관리가 읽는다. */
  rows: PlanListRow[];
  /** 판을 넓혀 대화를 접는다(2026-10-31 A — Claude 앱의 판 넓히기). */
  onExpandChat?: () => void;
  /** 문서 관리가 마쳤음 — 목록 갱신과 열기는 칸의 몫이다. */
  onDocApplied?: (result: DocOpResult) => void;
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
  // 판 고르기(2026-10-31 2단계) — 머리의 `초안 판 N ▾` 가 목록을 열고, 옛 판을 읽기로 보인다.
  const [revOpen, setRevOpen] = useState(false);
  const [revisions, setRevisions] = useState<DraftRevisionSummary[] | null>(null);
  const [viewing, setViewing] = useState<DraftRevisionView | null>(null);
  const revAnchor = useRef<HTMLButtonElement>(null);
  // Confluence 판과 견주기(2026-10-31 2단계) — 발행본 기준과 지금 초안의 낱말 견주기.
  const [compareOpen, setCompareOpen] = useState(false);
  // 다른 창 · 대화에서 초안이 바뀌어 다시 읽은 판 — 고치는 칸이 열려 있으면 한 줄로 알린다. 칸의 글은
  // 지우지 않는다(2026-10-23 화면 확인 · R2 검토 의심 완화). 제 손으로 바꾼 개정은 알림을 세우지 않는다.
  const editingRef = useRef(false);
  editingRef.current = editingId !== null;
  const seenRevision = useRef<number | null>(null);
  // 보존 블록의 읽기 전용 그림(2026-10-30 사용자 요청) — 상자 · 표 · 그림을 자리 표시 대신 보인다.
  const previews = useBlockPreviews(
    daemon,
    draft.view?.docKey ?? null,
    draft.view?.revision ?? null,
    draft.view?.blocks.some((block) => block.view.kind === "preserved") ?? false,
  );
  useEffect(() => {
    const revision = draft.view?.revision ?? null;
    if (revision === null || revision === seenRevision.current) return;
    const first = seenRevision.current === null;
    seenRevision.current = revision;
    // 개정 어긋남의 한 줄(staleReloaded)이 서 있으면 그것으로 족하다.
    if (!first && draft.notice === null && editingRef.current) nav.toast(L.drafts.reloadedOutside);
  }, [draft.view, draft.notice, nav]);

  // 판 고르기의 목록(2026-10-31 2단계) — 개정이 오를 때마다 조용히 다시 읽는다.
  const viewDocKey = draft.view?.docKey ?? null;
  const viewRevision = draft.view?.revision ?? null;
  useEffect(() => {
    if (viewDocKey === null || viewRevision === null) return;
    let live = true;
    daemon.api
      .draftRevisions(viewDocKey)
      .then((rows) => {
        if (live) setRevisions(rows);
      })
      .catch(() => {
        if (live) setRevisions(null);
      });
    return () => {
      live = false;
    };
  }, [daemon.api, viewDocKey, viewRevision]);

  // 옛 판의 읽기(2026-10-31 2단계) — 판 고르기에서 고른 판을 읽기로 내려 놓는다.
  const openRevision = async (revision: number) => {
    setRevOpen(false);
    if (viewDocKey === null) return;
    try {
      const old = await daemon.api.draftRevision(viewDocKey, revision);
      setViewing(old);
    } catch (err: unknown) {
      nav.toast(err instanceof Error ? err.message : String(err));
    }
  };

  // Confluence 판과 견주기(2026-10-31 2단계) — 출발점(판 0)을 읽어 낱말 견주기의 앞쪽으로 쓴다.
  const [compareBase, setCompareBase] = useState<DraftRevisionView | null>(null);
  // 발행 뒤의 대화 카드(2026-10-31 F) — 대화 칸이 `Confluence 판 N 로 발행했어요` 를 잠깐 세운다.
  const publishedSeen = useRef<number | null>(null);
  const publishedVersion =
    draft.view?.state === "published" ? (draft.view.baseVersion ?? null) : null;
  useEffect(() => {
    if (publishedVersion === null || publishedVersion === publishedSeen.current) return;
    publishedSeen.current = publishedVersion;
    window.dispatchEvent(
      new CustomEvent("nx:plan-published", {
        detail: { docKey: draft.view?.docKey ?? null, version: publishedVersion },
      }),
    );
  }, [publishedVersion, draft.view?.docKey]);
  useEffect(() => {
    if (!compareOpen || viewDocKey === null) return;
    let live = true;
    setCompareBase(null);
    daemon.api
      .draftRevision(viewDocKey, 0)
      .then((base) => {
        if (live) setCompareBase(base);
      })
      .catch(() => {
        if (live) setCompareBase(null);
      });
    return () => {
      live = false;
    };
  }, [compareOpen, daemon.api, viewDocKey]);

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

  // 붙여넣기의 여러 블록(2026-11-02 마크다운 길) — 한 요청에 싣고 성공하면 고치는 칸을 닫는다.
  const pasteEdits = useCallback(
    async (edits: DraftEdit[]) => {
      const next = await applyEdits(edits);
      if (next !== null) setEditingId(null);
      return next !== null;
    },
    [applyEdits],
  );

  // 편집기의 Esc — 고치는 칸 · 입력 칸의 Esc 는 제 자리에서 멈추고, 여기까지 오면 읽는 화면으로 돌아간다.
  const onEscape = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // 발행 창 · 근거 보내기 · 메뉴의 Esc 는 그것들이 닫는다 — 편집기까지 닫지 않는다(2026-10-23 화면 확인).
    if (escapeOwnedByLayer()) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  // 판 고르기 줄의 만든 이 말 — 종류의 사람의 말이다(2026-10-31 2단계).
  const revisionOriginLabel = (row: DraftRevisionSummary): string => {
    switch (row.origin) {
      case "ai":
        return L.drafts.revAi(row.label);
      case "screen":
        return L.drafts.revScreen;
      case "person":
        return L.drafts.revPerson;
      default:
        return L.drafts.revSystem;
    }
  };

  // 고른 옛 판으로 되돌리기 — 스냅숏의 모습을 그대로 붙인다(2026-10-31 2단계).
  const restoreTo = async (revision: number) => {
    if (viewDocKey === null) return;
    try {
      const next = await daemon.api.draftRevisionRestore(viewDocKey, revision);
      setViewing(null);
      seenRevision.current = next.revision;
      nav.toast(L.drafts.revRestoreDone(revision));
      draft.reload();
    } catch (err: unknown) {
      nav.toast(err instanceof Error ? err.message : String(err));
    }
  };

  // 토큰 칩의 지우기(2026-10-31 4단계) — 그 조각을 지우는 것이다. 열림 · 닫힘 표시를 함께 걷는다.
  const removeToken = async (
    blockId: string,
    view: DraftBlockView,
    name: string,
  ): Promise<void> => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(`⟦/?${escaped}⟧`, "gu");
    const strip = (text: string): string =>
      text.replace(pattern, "").replace(/ {2,}/gu, " ").trim();
    let next: DraftBlockView | null = null;
    if (view.kind === "paragraph") next = { kind: "paragraph", text: strip(view.text) };
    else if (view.kind === "heading") next = { ...view, text: strip(view.text) };
    else if (view.kind === "list") next = { ...view, items: view.items.map(strip) };
    else if (view.kind === "table")
      next = {
        kind: "table",
        rows: view.rows.map((row) => ({
          cells: row.cells.map((cell) => ({ ...cell, text: strip(cell.text) })),
        })),
      };
    if (next === null) return;
    const reply = await applyEdits([{ type: "set", blockId, view: next }]);
    if (reply !== null) setEditingId(null);
  };

  // 사람이 고친 블록에 남은 AI 걸음(2026-10-31 2단계) — 대화의 변경안 가운데 이 블록을 겨눈 열린 걸음.
  const keptStepOf = (
    blockId: string,
  ): { proposalId: string; opId: string; summary: string; type: string } | null => {
    const currentBlocks = draft.view?.blocks ?? [];
    for (const proposal of thread?.thread?.proposals ?? []) {
      for (const op of proposal.ops) {
        if (op.state !== "stale") continue;
        if (
          (op.type === "replace" || op.type === "delete" || op.type === "insert") &&
          "blockId" in op
        ) {
          if (op.blockId === blockId) {
            return {
              proposalId: proposal.proposalId,
              opId: op.opId,
              summary: opSummary(op, currentBlocks),
              type: op.type,
            };
          }
        }
      }
    }
    return null;
  };

  // 남은 걸음의 AI 의 고침 — 사람이 고른 덮어쓰기라 직접 고침의 길(edit)로 들어가고, 걸음은 거절로 닫는다.
  const applyKeptStep = async (blockId: string): Promise<void> => {
    const step = keptStepOf(blockId);
    if (step === null) return;
    const op = (thread?.thread?.proposals ?? [])
      .find((one) => one.proposalId === step.proposalId)
      ?.ops.find((one) => one.opId === step.opId);
    if (op === undefined) return;
    if (op.type === "replace") {
      const next = await applyEdits([{ type: "set", blockId, view: op.view }]);
      if (next !== null) void thread?.reject(step.proposalId, [op.opId]);
      return;
    }
    if (op.type === "title") {
      const next = await applyEdits([{ type: "title", title: op.title }]);
      if (next !== null) void thread?.reject(step.proposalId, [op.opId]);
      return;
    }
    if (op.type === "delete") {
      const next = await applyEdits([{ type: "delete", blockId }]);
      if (next !== null) void thread?.reject(step.proposalId, [op.opId]);
    }
  };

  // 남은 걸음의 버리기 — 걸음만 거절로 닫는다. 초안은 그대로다.
  const dropKeptStep = (blockId: string): void => {
    const step = keptStepOf(blockId);
    if (step === null) return;
    void thread?.reject(step.proposalId, [step.opId]);
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
        <p className="nx-banner nx-banner--red nx-dr-fail" role={failed ? "alert" : "status"}>
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
            {/* 판 고르기(2026-10-31 2단계) — 문서 판 머리의 `초안 판 N ▾`. 옛 판을 읽고 있는 동안에는
                그 판의 이름이 서고 눌러 지금 판으로 돌아온다. */}
            {viewing !== null ? (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-dr-revpick"
                onClick={() => setViewing(null)}
              >
                {L.drafts.revOldTitle(viewing.revision)}
                <CloseIcon />
              </button>
            ) : (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-dr-revpick"
                ref={revAnchor}
                aria-expanded={revOpen}
                aria-haspopup="menu"
                aria-label={L.drafts.revMenu}
                onClick={() => setRevOpen((before) => !before)}
              >
                <History className="nx-i" size={13} aria-hidden="true" />
                {L.drafts.revPicker(view.revision)}
              </button>
            )}
            {revOpen && viewing === null && (
              <Popover
                anchor={revAnchor}
                role="menu"
                label={L.drafts.revMenu}
                align="start"
                float
                onClose={() => setRevOpen(false)}
              >
                {view.baseVersion !== null && (
                  <button
                    type="button"
                    role="menuitem"
                    className="nx-mi"
                    onClick={() => void openRevision(0)}
                  >
                    <span className="nx-mi-t">{L.drafts.revConfluence(view.baseVersion)}</span>
                    <span className="nx-mi-s">{L.drafts.revStart}</span>
                  </button>
                )}
                {(revisions ?? []).map((row) => (
                  <button
                    key={row.revision}
                    type="button"
                    role="menuitem"
                    className="nx-mi"
                    onClick={() => void openRevision(row.revision)}
                  >
                    <span className="nx-mi-t">
                      {L.drafts.revPicker(row.revision)}
                      {row.revision === view.revision && (
                        <span className="nx-mi-s"> · {L.drafts.revCurrent}</span>
                      )}
                    </span>
                    <span className="nx-mi-s">
                      {revisionOriginLabel(row)} ·{" "}
                      {L.drafts.revChanges(
                        row.changes.changed,
                        row.changes.inserted,
                        row.changes.deleted,
                      )}
                    </span>
                  </button>
                ))}
              </Popover>
            )}
            <span>{L.drafts.metaLine(view.baseVersion, changed, inserted)}</span>
            {unpublished && <span className="nx-pill">{L.drafts.unpublished}</span>}
            {view.stage.notation !== null && (
              <span className="nx-pill nx-pill--accent" title={L.drafts.stageClosed}>
                v{view.stage.notation}
                {view.stage.closed && (
                  <span className="nx-dr-stage-note">{L.drafts.stageClosed}</span>
                )}
              </span>
            )}
          </div>
          <div className="nx-dr-acts-hd">
            {view.baseVersion !== null && (
              <button
                type="button"
                className="nx-btn"
                aria-expanded={compareOpen}
                onClick={() => setCompareOpen((before) => !before)}
              >
                {L.drafts.compareConfluence}
              </button>
            )}
            <button type="button" className="nx-btn" onClick={() => setSendOpen(true)}>
              {L.drafts.sendToScreen}
            </button>
            {/* 으뜸 단추는 `발행` 하나다 — 쓰기가 꺼져 있으면(게이트) 이 자리만 보통 단추가 되고
                옆의 칩 하나가 잠긴 것을 한 번에 말한다(2026-10-31 E · 쓰기 꺼짐은 한 곳). */}
            {writable === false && (
              <span className="nx-pill nx-dr-writeoff" title={L.drafts.writeOffHint} role="note">
                {L.drafts.writeOff}
              </span>
            )}
            <button
              type="button"
              className={`nx-btn${writable === false ? "" : " nx-btn--pri"}`}
              disabled={locked || applying}
              onClick={() => setPublishOpen(true)}
            >
              {L.drafts.publish}
            </button>
            {onExpandChat !== undefined && (
              <button
                type="button"
                className="nx-ibtn"
                title={L.drafts.threadExpand}
                aria-label={L.drafts.threadExpand}
                onClick={onExpandChat}
              >
                <Maximize2 className="nx-i" size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            <DocMenu
              daemon={daemon}
              site={site}
              pageId={view.pageId}
              rows={rows}
              draft
              locked={locked}
              onApplied={onDocApplied}
              onDiscard={() => setConfirmDiscard(true)}
            />
          </div>
        </div>
      </header>
      {/* 옛 판의 읽기 띠(2026-10-31 2단계) — 판 고르기에서 앞 판을 열면 읽기만 한다. */}
      {viewing !== null && (
        <div className="nx-banner nx-banner--blue nx-dr-oldrev" role="status">
          <InfoIcon />
          <span className="nx-banner-body">{L.drafts.revOldBanner(viewing.revision)}</span>
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-banner-act"
            onClick={() => void restoreTo(viewing.revision)}
          >
            {L.drafts.revRestore(viewing.revision)}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--ghost nx-banner-act"
            onClick={() => setViewing(null)}
          >
            {L.drafts.revBack}
          </button>
        </div>
      )}
      {/* 잠금의 한 줄 — 결과 확인 필요 띠가 서면 그 띠가 함께 말한다(띠 둘이 겹쳐 서지 않게 · 2026-10-23 기획자 화면 손질). */}
      {locked && !(view.state === "result-unknown" && view.pendingCommandId !== null) && (
        <p className="nx-banner nx-banner--amber nx-dr-lock" role="status">
          <InfoIcon />
          {L.drafts.locked}
        </p>
      )}
      {view.state === "result-unknown" && view.pendingCommandId !== null && (
        <div className="nx-dr-bandwrap">
          {/* 띠(role="status")는 상태 문장만 읽힌다 — 단추와 확인판은 띠 밖 같은 자리 아래에 선다
              (2026-10-23 화면 확인 · R2 검토 9). */}
          <div className="nx-banner nx-banner--amber nx-dr-band--warn" role="status">
            <InfoIcon />
            <div className="nx-banner-body">
              <b>{L.drafts.resultUnknownTitle}</b>
              <span className="nx-dr-band-s">{L.drafts.resultUnknownBody}</span>
              <span className="nx-dr-band-s">{L.drafts.locked}</span>
            </div>
          </div>
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
        <p className="nx-banner nx-banner--green" role="status">
          {L.drafts.publishedNote}
        </p>
      )}
      {view.state === "conflict" && (
        <p className="nx-banner nx-banner--red" role="status">
          <InfoIcon />
          {L.drafts.conflictNote}
        </p>
      )}
      {draft.error !== null && (
        <p className="nx-banner nx-banner--red nx-dr-fail" role="alert">
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
      {/* Confluence 판과 견주기(2026-10-31 2단계) — 발행본 기준 대비 바뀐 곳을 모두 보인다.
        열려 있는 동안 문서 판은 견주기로 바뀐다 — 같은 문서 두 벌을 겹쳐 보이지 않게(2026-11-03 실앱 감사). */}
      {viewing !== null ? (
        // 옛 판의 읽기(2026-10-31 2단계) — 판 고르기에서 고른 판을 읽기로만 보인다.
        <ol className="nx-dr-blocks" aria-label={L.drafts.revOldTitle(viewing.revision)}>
          {viewing.blocks.map((block) => (
            <li key={block.id} className="nx-dr-block" data-status={block.status}>
              <div className="nx-dr-read">
                <Markdown
                  text={viewToMarkdown(block.view, block.tokens)}
                  tokens={tokenLabelsOf(block.tokens)}
                  machineTokens={block.tokens}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : compareOpen ? (
        <ComparePanel base={compareBase} blocks={blocks} />
      ) : blocks.length === 0 ? (
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
              flash={flashIds?.includes(block.id) === true}
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
              onTokenRemove={(name) => void removeToken(block.id, block.view, name)}
              onInlineApply={(next) => void setBlock(block.id, next)}
              onApplyEdits={pasteEdits}
              onCancelEdit={() => setEditingId(null)}
              keptStep={keptStepOf(block.id)}
              onKeptApply={() => void applyKeptStep(block.id)}
              onKeptDrop={() => void dropKeptStep(block.id)}
              preview={previews[block.id]}
              daemon={daemon}
              pageId={view.pageId}
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
/**
 * 초안 편집기 — 문서의 초안을 블록 단위로 읽고 고친다. 문서 판의 몸이다 — 기획 대화 칸(PlanChat)은
 * 2026-10-31 기획서 칸 개선부터 위(PlansColumn)가 나란히 세운다. 연결과 남은 손의 건네기만 맡는
 * 얇은 껍데기다.
 */
export function DraftEditor({
  daemon,
  draft,
  site,
  nav,
  onClose,
  pendingChanges,
  writable,
  thread,
  flashIds,
  rows,
  onExpandChat,
  onDocApplied,
}: {
  daemon: Daemon;
  /** 초안의 손 — 칸(PlansColumn)이 쥔다. 문서 판과 대화 칸이 같은 손을 보아 첫 고치기의 「읽는 중」과 회복이 한곳에서 흐른다(2026-11-02). */
  draft: DraftHand;
  /** Confluence 사이트 — 발행의 `Confluence 에서 보기` 링크가 쓴다. */
  site: string | null;
  nav: ShellNav;
  onClose: () => void;
  /** 초안 요약의 바뀐 블록 수(지움 포함) — 머리의 `아직 발행 전` 이 함께 본다. */
  pendingChanges?: number;
  /** 이 앱이 Confluence 에 쓸 수 있는가(발행 게이트 · 2026-10-23 U2). */
  writable?: boolean;
  /** 기획 대화의 판 — 남은 걸음의 고르기가 쓴다(2026-10-31 2단계). */
  thread?: DraftThreadHand;
  /** 마지막 AI 고침의 블록 — 잠깐 칠한다(2026-10-31 2단계). */
  flashIds?: readonly string[];
  /** 목록의 줄 — `⋯` 의 문서 관리가 읽는다. */
  rows: PlanListRow[];
  /** 판을 넓혀 대화를 접는다(2026-10-31 A). */
  onExpandChat?: () => void;
  /** 문서 관리가 마쳤음 — 목록 갱신은 칸의 몫이다. */
  onDocApplied?: (result: DocOpResult) => void;
}) {
  return (
    <DraftEditorSurface
      draft={draft}
      daemon={daemon}
      site={site}
      nav={nav}
      onClose={onClose}
      startWithAi={() => window.dispatchEvent(new Event("nx:plan-focus-input"))}
      pendingChanges={pendingChanges}
      writable={writable}
      {...(thread !== undefined ? { thread } : {})}
      {...(flashIds !== undefined ? { flashIds } : {})}
      rows={rows}
      {...(onExpandChat !== undefined ? { onExpandChat } : {})}
      {...(onDocApplied !== undefined ? { onDocApplied } : {})}
    />
  );
}
