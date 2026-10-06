import { type UIEvent, useEffect, useRef } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { composing } from "../../lib/ime";
import { L } from "../labels";
import type { ConnectionCopy } from "../lib/connection-copy";
import { resetScope } from "../lib/reset-scope";
import { nameEscape } from "../lib/settings-shell";
import { CheckIcon, Spin } from "../ui/icons";
import { BandAlertIcon } from "./icons";
import { SBand, SGroup, SPage, SRow, useAnnounce } from "./parts";
import type { AuthorModel } from "./use-author";
import type { ResetModel } from "./use-reset";

/** 이름 칸에 들어가는 글자 수 — 선로(`machine.author.set`)의 한도와 같다. */
const AUTHOR_MAX = 80;
/** 연결이 잠그는 단추의 이유가 선 띠 — 잠긴 단추가 이 줄을 `aria-describedby` 로 잇는다. */
const LOCK_ID = "nx-conn-lock";

/**
 * 연결 쪽 — 작업에 적을 이름 · 연결 코드의 상태 · 초대 파일, 그리고 맨 아래의 위험 구역(전체 초기화).
 * 연결이 끊기면 두 단추가 말없이 잠기던 것을 띠 하나가 이유로 말한다(2026-10-06 설정 손질 · S5 · S6).
 */
export function ConnectionPage({
  active,
  daemon,
  author,
  reset,
  connection,
  lockReason,
  focusSignal,
  onOpenInvite,
  onScroll,
}: {
  active: boolean;
  daemon: Daemon;
  author: AuthorModel;
  reset: ResetModel;
  connection: ConnectionCopy;
  /** 연결이 열려 있지 않은 이유 — 열려 있으면 null. */
  lockReason: string | null;
  /** 값이 오르면 이름 칸에 초점을 둔다(닫기 보호가 저장 실패를 보이려 부른다). */
  focusSignal: number;
  onOpenInvite: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const announce = useAnnounce();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSignal > 0) input.current?.focus();
  }, [focusSignal]);
  // 저장이 되면 한 번 말한다 — ✓ 는 눈으로만 보인다.
  useEffect(() => {
    if (author.phase === "saved") announce(L.settings.saved);
  }, [author.phase, announce]);

  const scope = resetScope(daemon.projects);
  const locked = lockReason !== null;
  const lockDesc = locked ? LOCK_ID : undefined;
  return (
    <SPage id="connection" active={active} onScroll={onScroll}>
      {lockReason && (
        <SBand id={LOCK_ID} tone="amber" icon={<BandAlertIcon />} title={lockReason} />
      )}
      <SGroup>
        <SRow title={L.settings.authorName} sub={L.settings.authorNameSub} htmlFor="nx-author">
          <span className="nx-sfield">
            <input
              id="nx-author"
              ref={input}
              className="nx-sinput"
              type="text"
              value={author.draft}
              maxLength={AUTHOR_MAX}
              placeholder={L.settings.authorPlaceholder}
              onChange={(event) => author.setDraft(event.target.value)}
              onBlur={() => void author.commit()}
              onKeyDown={(event) => {
                // 한글 조합 중의 Enter 는 글자를 맺는 키다 — 저장이 아니다.
                if (composing(event)) return;
                if (event.key === "Enter") void author.commit();
                // 바뀐 글이 있으면 첫 Esc 는 되돌리기 — 창은 둘째 Esc 가 닫는다.
                else if (event.key === "Escape" && nameEscape(author.dirty) === "revert") {
                  event.stopPropagation();
                  author.revert();
                }
              }}
            />
            <span
              className={`nx-sfield-ok${author.phase === "saved" ? " nx-sfield-ok--on" : ""}`}
              aria-hidden="true"
            >
              <CheckIcon />
            </span>
          </span>
        </SRow>
        {author.phase === "saving" && (
          <p className="nx-snote nx-snote--row nx-snote--wait">
            <Spin /> {L.settings.nameSaving}
          </p>
        )}
        {author.phase === "failed" && (
          <p className="nx-snote nx-snote--row nx-snote--red nx-row--new" role="alert">
            {L.settings.nameSaveFailed}
          </p>
        )}
        <SRow title={L.settings.connectionCode}>
          <span className={`nx-schip nx-schip--${connection.dot}`}>
            <i className={`nx-dot nx-dot--${connection.dot}`} />
            {connection.text}
          </span>
          {/* 곧 끝나거나 끝난 연결은 해결의 손이 같은 줄에 선다 — 초대 파일을 새로 여는 것이 그 길이다. */}
          {connection.dot !== "green" && (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={locked}
              aria-describedby={lockDesc}
              onClick={onOpenInvite}
            >
              {L.settings.openInvite}
            </button>
          )}
        </SRow>
        <SRow title={L.settings.inviteRow} sub={L.settings.inviteRowSub}>
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={locked}
            aria-describedby={lockDesc}
            onClick={onOpenInvite}
          >
            {L.settings.openInvite}
          </button>
        </SRow>
      </SGroup>
      {reset.available && (
        <SGroup danger>
          <SRow title={L.settings.resetTitle} sub={L.settings.resetSub}>
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--dng"
              disabled={reset.phase !== "idle" || locked}
              aria-describedby={lockDesc}
              onClick={reset.run}
            >
              {reset.phase === "idle" ? (
                L.settings.resetAction
              ) : (
                <>
                  <Spin />{" "}
                  {reset.phase === "asking" ? L.settings.resetAsking : L.settings.resetBusy}
                </>
              )}
            </button>
          </SRow>
          {/* 무엇이 몇 개 지워지고 무엇이 남는지 — 확인 시트가 뜨기 전에 먼저 크기를 말한다. */}
          <p className="nx-snote nx-snote--row nx-sdng-scope">
            {L.settings.resetCount(scope.projects, scope.unsubmitted)}
          </p>
          {reset.failure && (
            <div className="nx-snote-block nx-row--new">
              <p className="nx-snote nx-snote--red" role="alert">
                {L.settings.resetFailed}
              </p>
              {reset.failure.detail && (
                <details className="nx-sdet">
                  <summary>{L.settings.detail}</summary>
                  <p className="nx-sdet-b">{reset.failure.detail}</p>
                </details>
              )}
            </div>
          )}
        </SGroup>
      )}
    </SPage>
  );
}
