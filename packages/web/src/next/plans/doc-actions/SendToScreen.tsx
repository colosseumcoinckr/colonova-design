import { useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { COMPOSER_ATTACH_EVENT } from "../../preview/PreviewColumn";
import type { ShellNav } from "../../slots";
import { Spin } from "../../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead } from "../../ui/ModalFrame";
import { attachEventDetail } from "./doc-actions-model";
import "./doc-actions.css";

/**
 * 근거 보내기 판(2026-10-23 · 최종 구현 계획 F3) — 문서 보기 · 초안 편집기 머리의 단추가 여는 한 장.
 * 절을 골라 스냅샷을 만들고 입력창 첨부로 담는다. 입력창이 받으면(preventDefault) 사람이 말을 붙여
 * 보내고, 받는 입력창이 없으면 그렇게 말한다 — 스스로 보내지 않는다.
 */
export function SendToScreen({
  daemon,
  nav,
  target,
  sections,
  isDraft = false,
  onSent,
  onClose,
}: {
  daemon: Daemon;
  nav: ShellNav;
  /** 스냅샷의 대상 — 가져온 문서는 pageId, 초안은 docKey 다. */
  target: { pageId: string } | { docKey: string };
  /** 절 머리말 — 문서 보기는 읽은 절, 초안은 제목 블록의 글. 빈 목록이면 문서 전체만 담는다. */
  sections: string[];
  /** 초안의 근거 — 아직 발행하지 않았다는 안내를 더한다. */
  isDraft?: boolean;
  /**
   * 입력창이 받은 뒤의 한 손 — 초안 편집기는 비켜선 화면 대화를 앞에 세운다(2026-10-23 기획자 화면 손질 D2). 그다음
   * 입력창에 초점을 다시 청한다 — 받을 때는 숨어 있어 초점이 앉지 못했다.
   */
  onSent?: () => void;
  onClose: () => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = await apiRef.current.draftSnapshot({
        ...target,
        ...(scope === "" ? {} : { sections: [scope] }),
      });
      // 먼저 입력창에 담는다 — 입력창이 받으면(답의 preventDefault) 사람이 말을 붙여 보낸다.
      const offer = new CustomEvent(COMPOSER_ATTACH_EVENT, {
        cancelable: true,
        detail: attachEventDetail(snapshot),
      });
      if (window.dispatchEvent(offer)) {
        setError(L.drafts.noComposer);
        setBusy(false);
        return;
      }
      nav.toast(L.drafts.sentToComposer);
      // 좁은 창은 대화 칸이 뒤에 숨어 있다 — 담았으니 앞에 세운다(넓은 창에서는 아무 일도 없다).
      nav.showTab("chat");
      if (onSent !== undefined) {
        onSent();
        // 칸이 앞에 선 다음 박자에 입력창이 초점을 받는다(`nx:composer:focus` — 홈에서 대화로 넘어올 때와 같은 길).
        requestAnimationFrame(() => window.dispatchEvent(new Event("nx:composer:focus")));
      }
      onClose();
    } catch (err: unknown) {
      // 데몬이 말해 준 문장(절을 찾지 못한 것 등)을 그대로 보인다 — 받은 문장이 없을 때만
      // 뭉뚱그린 실패 문장을 쓰고, 문서 전체로 대신 담는 일은 없다(2026-10-23 화면 확인 · R2 검토 1).
      const message = err instanceof Error ? err.message.trim() : "";
      setError(message !== "" ? message : L.drafts.sendFailed);
      setBusy(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} locked={busy} label={L.drafts.sendTitle} className="nx-da">
      <ModalHead title={L.drafts.sendTitle} sub={L.drafts.sendSub} />
      <ModalBody>
        {isDraft && (
          <p className="nx-banner nx-banner--amber" role="note">
            {L.drafts.sendDraftNote}
          </p>
        )}
        <label className="nx-field">
          <span className="nx-field-label">{L.drafts.sendScope}</span>
          <select
            className="nx-input"
            aria-label={L.drafts.sendScope}
            value={scope}
            disabled={busy}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="">{L.drafts.sendWhole}</option>
            {sections.map((heading, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 같은 제목의 절이 이어질 수 있다 — 자리가 열쇠다
              <option key={`${at}-${heading}`} value={heading}>
                {heading}
              </option>
            ))}
          </select>
        </label>
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
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? (
            <>
              <Spin /> {L.drafts.sendGo}
            </>
          ) : (
            L.drafts.sendGo
          )}
        </button>
      </ModalFoot>
    </ModalFrame>
  );
}
