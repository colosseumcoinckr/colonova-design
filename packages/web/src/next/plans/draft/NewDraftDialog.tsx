import type { DraftView } from "@colonova-design/protocol";
import { useMemo, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { RefreshIcon, Spin } from "../../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead } from "../../ui/ModalFrame";
import type { PlanListRow } from "../plans-list";
import { DRAFT_LIMITS } from "./limits";
import { ParentPicker } from "./ParentPicker";

/**
 * 새 문서 창(2026-10-23 · 최종 구현 계획 F2) — 기획서 목록의 `새 문서` 가 여는 한 장. 제목과
 * 들어갈 자리(목록의 폴더 · 문서), 밑그림이 될 문서를 골라 만들면 그 초안의 편집기를 곧바로
 * 연다. Confluence 에는 아직 문서가 없다 — 발행 때 처음 닿는다.
 */

/** 고른 자리의 값 — `page:<id>` · `folder:<id>` 꼴의 고르기 값을 푼다. */
function parseParent(value: string): { id: string; type: "page" | "folder" } | null {
  const at = value.indexOf(":");
  if (at <= 0) return null;
  const type = value.slice(0, at);
  const id = value.slice(at + 1);
  if (type !== "page" && type !== "folder") return null;
  return { id, type };
}

export function NewDraftDialog({
  daemon,
  rows,
  onImport,
  onClose,
  onCreated,
}: {
  daemon: Daemon;
  /** 목록의 줄 — 폴더 · 문서는 들어갈 자리가 되고, 전용 항목은 고를 수 없다. */
  rows: PlanListRow[];
  /** 새로 가져오기 — 들어갈 자리가 하나도 없을 때 창이 먼저 건네는 길이다(2026-10-23 화면 확인 · R2 검토 10). */
  onImport: () => void;
  onClose: () => void;
  /** 만들어진 초안 — 칸이 그 초안의 편집기를 연다. */
  onCreated: (view: DraftView) => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const selectable = useMemo(() => rows.filter((row) => row.kind !== "unsupported"), [rows]);
  const templates = useMemo(() => rows.filter((row) => row.kind === "doc"), [rows]);
  const [title, setTitle] = useState("");
  const [parent, setParent] = useState("");
  const [template, setTemplate] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const chosen = parseParent(parent);
    const name = title.trim();
    if (chosen === null || name === "" || creating) return;
    setCreating(true);
    setError(null);
    try {
      const view = await apiRef.current.draftCreate({
        title: name,
        parentId: chosen.id,
        parentType: chosen.type,
        ...(template !== "" ? { templatePageId: template } : {}),
      });
      onCreated(view);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} locked={creating} label={L.drafts.newDocTitle} className="nx-nd">
      <ModalHead title={L.drafts.newDocTitle} sub={L.drafts.newDocSub} />
      <ModalBody>
        <div className="nx-nd-fields">
          <label className="nx-field">
            <span className="nx-field-label">{L.drafts.titleField}</span>
            <input
              className="nx-input"
              aria-label={L.drafts.titleField}
              value={title}
              disabled={creating}
              // 선로의 제목 한계 — 데몬의 검사에 부딪치기 전에 칸이 먼저 멈춘다(2026-10-23 화면 확인 · R2 검토 3).
              maxLength={DRAFT_LIMITS.titleLength}
              // biome-ignore lint/a11y/noAutofocus: 창이 서면 곧바로 제목을 쓴다.
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
            {title.length >= DRAFT_LIMITS.titleLength && (
              <span className="nx-nd-limit">{L.drafts.limitTitleLength}</span>
            )}
          </label>
          {selectable.length > 0 ? (
            <>
              <ParentPicker
                rows={selectable}
                label={L.drafts.newDocParent}
                placeholder={L.drafts.newDocParentPick}
                value={parent}
                disabled={creating}
                onChange={setParent}
              />
              <label className="nx-field">
                <span className="nx-field-label">{L.drafts.newDocTemplate}</span>
                <select
                  className="nx-input"
                  aria-label={L.drafts.newDocTemplate}
                  value={template}
                  disabled={creating}
                  onChange={(event) => setTemplate(event.target.value)}
                >
                  <option value="">{L.drafts.newDocTemplateNone}</option>
                  {templates.map((row) => (
                    <option key={row.pageId} value={row.pageId}>
                      {row.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            // 들어갈 자리가 하나도 없다 — 빈 고르기 칸을 세우지 않고 이유와 길을 먼저 보인다(2026-10-23
            // 화면 확인 · R2 검토 10). 만들기 단추는 자리를 고르지 않으면 잠긴 채다.
            <div className="nx-banner nx-banner--amber nx-dr-noplace" role="note">
              <p>{L.drafts.newDocNoPlace}</p>
              <button type="button" className="nx-btn nx-btn--sm" onClick={onImport}>
                <RefreshIcon />
                {L.plans.importNow}
              </button>
            </div>
          )}
        </div>
        {error !== null && (
          <p className="nx-banner nx-banner--red" role="alert">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFoot>
        <button
          type="button"
          className="nx-btn nx-btn--pri"
          disabled={creating || title.trim() === "" || parent === ""}
          onClick={() => void create()}
        >
          {creating ? (
            <>
              <Spin /> {L.drafts.creating}
            </>
          ) : (
            L.drafts.create
          )}
        </button>
      </ModalFoot>
    </ModalFrame>
  );
}
