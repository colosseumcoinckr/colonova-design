import type { DocOpKind, DocOpResult } from "@colonova-design/protocol";
import { Copy, Ellipsis, FolderInput, History, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { linkClick } from "../../../lib/open-link";
import { L } from "../../labels";
import { CloseIcon, ExternalIcon, TrashIcon } from "../../ui/icons";
import { Popover } from "../../ui/Popover";
import type { PlanListRow } from "../plans-list";
import { docUrl } from "../plans-list";
import { DocOpDialog } from "./DocOpDialog";
import "./doc-actions.css";

// 메뉴 줄의 그림 — `ui/icons.tsx` 의 make 와 같은 모양으로 이 폴더에서만 찍는다.
function glyph(Glyph: LucideIcon) {
  return function Icon() {
    return <Glyph className="nx-i" size={14} strokeWidth={1.8} aria-hidden="true" />;
  };
}

const MoreIcon = glyph(Ellipsis);
const CopyIcon = glyph(Copy);
const MoveIcon = glyph(FolderInput);
const HistoryGlyph = glyph(History);

/**
 * 문서 판의 한 меню(2026-10-31 기획서 칸 개선 C · P5) — 읽기 · 초안의 머리가 같은 `⋯` 를 쓴다.
 * Confluence 에서 열기 · 판 기록 · 복제 · 위치 옮기기 · 휴지통으로 옮기기가 늘 서고, 초안이 있으면
 * 구분선 아래 초안 버리기가 선다. 영구 삭제는 없다 — 휴지통 이동이 지우기의 끝이다.
 */
export function DocMenu({
  daemon,
  site,
  pageId,
  rows,
  draft,
  locked,
  onApplied,
  onHistory,
  onDiscard,
}: {
  daemon: Daemon;
  /** Confluence 사이트 — 있으면 `Confluence 에서 열기` 가 선다. */
  site: string | null;
  /** 기존 문서의 페이지 id — 새 문서 초안은 null 이고 문서 관리 줄이 서지 않는다. */
  pageId: string | null;
  /** 목록의 줄 — 복제 · 옮기기의 들어갈 자리 고르기가 읽는다. */
  rows: PlanListRow[];
  /** 초안이 있으면 구분선 아래 초안 버리기가 선다. */
  draft?: boolean;
  /** 발행이 도는 동안엔 초안 버리기가 잠긴다. */
  locked?: boolean;
  /** 문서 관리가 마쳤음 — 목록을 다시 읽는 일은 부르는 쪽의 몫이다. */
  onApplied?: (result: DocOpResult) => void;
  /** 판 기록 — 문서 판의 서랍을 연다. */
  onHistory?: () => void;
  /** 초안 버리기의 확인 — 확인 창은 부르는 쪽의 몫이다. */
  onDiscard?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState<DocOpKind | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const link = pageId !== null && site ? docUrl(site, pageId) : null;
  const pick = (next: DocOpKind) => {
    setOpen(false);
    setOp(next);
  };
  return (
    <span className="nx-da-menu">
      <button
        type="button"
        className="nx-ibtn"
        aria-label={L.docOps.menu}
        title={L.docOps.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        ref={anchor}
        onClick={() => setOpen((before) => !before)}
      >
        <MoreIcon />
      </button>
      {open && (
        <Popover
          anchor={anchor}
          role="menu"
          label={L.docOps.menu}
          align="end"
          float
          onClose={() => setOpen(false)}
        >
          {link !== null && (
            <a
              role="menuitem"
              className="nx-mi"
              href={link}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                linkClick(event);
                setOpen(false);
              }}
            >
              <ExternalIcon />
              {L.plans.openInConfluence}
            </a>
          )}
          {onHistory !== undefined && (
            <button
              type="button"
              role="menuitem"
              className="nx-mi"
              onClick={() => {
                setOpen(false);
                onHistory();
              }}
            >
              <HistoryGlyph />
              {L.confluence.history}
            </button>
          )}
          {pageId !== null && (
            <>
              <button type="button" role="menuitem" className="nx-mi" onClick={() => pick("copy")}>
                <CopyIcon />
                {L.docOps.copy}
              </button>
              <button type="button" role="menuitem" className="nx-mi" onClick={() => pick("move")}>
                <MoveIcon />
                {L.docOps.move}
              </button>
              <button
                type="button"
                role="menuitem"
                className="nx-mi nx-mi--dng"
                onClick={() => pick("trash")}
              >
                <TrashIcon />
                {L.docOps.trash}
              </button>
            </>
          )}
          {draft === true && (
            <>
              <hr className="nx-mi-sep" />
              <button
                type="button"
                role="menuitem"
                className="nx-mi nx-mi--dng"
                disabled={locked === true}
                title={locked === true ? L.drafts.locked : undefined}
                onClick={() => {
                  setOpen(false);
                  onDiscard?.();
                }}
              >
                <CloseIcon />
                {L.drafts.discard}
              </button>
            </>
          )}
        </Popover>
      )}
      {op !== null && pageId !== null && (
        <DocOpDialog
          daemon={daemon}
          op={op}
          pageId={pageId}
          rows={rows}
          onApplied={onApplied ?? (() => undefined)}
          onClose={() => setOp(null)}
        />
      )}
    </span>
  );
}
