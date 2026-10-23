import type { DocOpKind, DocOpResult } from "@colonova-design/protocol";
import { Copy, Ellipsis, FolderInput, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { TrashIcon } from "../../ui/icons";
import { Popover } from "../../ui/Popover";
import type { PlanListRow } from "../plans-list";
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

/**
 * 문서 관리 메뉴(2026-10-23 · 최종 구현 계획 F4) — 문서 보기 머리의 `더보기`(⋯). 복제 · 위치 옮기기 ·
 * 휴지통으로 옮기기의 세 줄이고, 고른 일의 확인 창(`DocOpDialog`)을 연다. 영구 삭제는 없다 —
 * 휴지통 이동이 지우기의 끝이다.
 */
export function DocActions({
  daemon,
  pageId,
  rows,
  onApplied,
}: {
  daemon: Daemon;
  pageId: string;
  /** 목록의 줄 — 복제 · 옮기기의 들어갈 자리 고르기가 읽는다. */
  rows: PlanListRow[];
  /** 마쳤음 — 목록을 다시 읽고(copy 면) 새 문서를 여는 일은 부르는 쪽의 몫이다. */
  onApplied: (result: DocOpResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState<DocOpKind | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const pick = (next: DocOpKind) => {
    setOpen(false);
    setOp(next);
  };
  return (
    <span className="nx-da-menu">
      <button
        type="button"
        className="nx-ibtn nx-ibtn--sm"
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
        </Popover>
      )}
      {op !== null && (
        <DocOpDialog
          daemon={daemon}
          op={op}
          pageId={pageId}
          rows={rows}
          onApplied={onApplied}
          onClose={() => setOp(null)}
        />
      )}
    </span>
  );
}
