import type { KeyboardEvent } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { composing } from "../../lib/ime";
import { linkClick } from "../../lib/open-link";
import { L } from "../labels";
import { Spin } from "../ui/icons";
import { TOKEN_PAGE_URL } from "./confluence-form";
import { SGroup, SRow } from "./parts";
import { useConfluenceConnect } from "./use-confluence-connect";

/**
 * 기획서 연결(2026-10-18 기획서 동기화 1단계, 같은 날 개선 패스) — 사이트 · 이메일 · 토큰 · 기준 페이지.
 * 이메일과 토큰은 일회성 입력이다: 제출 뒤에는 값이 어디에도 남지 않는다(모델의 걸음이 지운다). 연결된 뒤에는
 * 입력 칸이 접히고(`다시 연결하기` 로 다시 연다) 사이트 · 기준 페이지가 줄로 서며, 기준 페이지는 `바꾸기` 로 다시
 * 고를 수 있다 — 찾기는 저장된 자격으로 돈다.
 */
export function ConfluenceConnect({ daemon, locked }: { daemon: Daemon; locked: boolean }) {
  const model = useConfluenceConnect(daemon);
  const { state, summary } = model;
  const busy = state.phase === "connecting";
  const linked = state.linked !== null || summary?.connected === true;
  const expired = summary?.expired === true;
  const rootTitle = state.linked?.rootTitle ?? summary?.rootTitle ?? null;
  // 입력 칸 — 연결이 안 섰거나 끊겼거나(만료) 사용자가 다시 연결하러 연 동안.
  const showCreds = !linked || expired || state.reconnecting;
  // 기준 페이지 찾기 — 아직 못 정했거나 바꾸러 연 동안. 연결이 끊기면 찾기도 못 돌므로 서지 않는다.
  const finder = linked && !expired && (rootTitle === null || state.changingRoot);
  const chip =
    model.tone === "ok" ? "" : model.tone === "warn" ? " nx-schip--amber" : " nx-schip--plain";
  const submitOnEnter = (event: KeyboardEvent) => {
    if (composing(event)) return;
    if (event.key === "Enter" && model.ready && !busy) model.connect();
  };

  return (
    <SGroup>
      <SRow title={L.plans.title} sub={L.plans.titleSub}>
        <span className={`nx-schip${chip}`}>{model.status}</span>
      </SRow>

      {linked && !showCreds && (
        <SRow title={L.plans.site}>
          <span className="nx-sval">{model.site}</span>
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={locked}
            onClick={model.startReconnect}
          >
            {L.plans.reconnect}
          </button>
        </SRow>
      )}

      {showCreds && (
        <>
          <SRow title={L.plans.site} htmlFor="nx-conf-site">
            <span className="nx-sfield">
              <input
                id="nx-conf-site"
                className="nx-sinput"
                type="text"
                value={state.site}
                maxLength={200}
                placeholder={L.plans.sitePlaceholder}
                autoComplete="off"
                spellCheck={false}
                disabled={locked}
                onChange={(event) => model.setSite(event.target.value)}
              />
            </span>
          </SRow>
          <SRow title={L.plans.email} htmlFor="nx-conf-email">
            <span className="nx-sfield">
              <input
                id="nx-conf-email"
                className="nx-sinput"
                type="email"
                value={state.email}
                maxLength={200}
                placeholder={L.plans.emailPlaceholder}
                autoComplete="off"
                spellCheck={false}
                disabled={locked}
                onChange={(event) => model.setEmail(event.target.value)}
                onKeyDown={submitOnEnter}
              />
            </span>
          </SRow>
          <SRow title={L.plans.token} sub={L.plans.tokenNote} htmlFor="nx-conf-token">
            <span className="nx-sfield">
              <input
                id="nx-conf-token"
                className="nx-sinput"
                type="password"
                value={state.token}
                maxLength={400}
                placeholder={L.plans.tokenPlaceholder}
                autoComplete="new-password"
                disabled={locked}
                onChange={(event) => model.setToken(event.target.value)}
                onKeyDown={submitOnEnter}
              />
            </span>
            {state.reconnecting && !busy && (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                onClick={model.cancelReconnect}
              >
                {L.plans.cancel}
              </button>
            )}
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--pri"
              disabled={locked || busy || !model.ready}
              onClick={model.connect}
            >
              {busy ? (
                <>
                  <Spin /> {L.plans.connecting}
                </>
              ) : linked ? (
                L.plans.reconnect
              ) : (
                L.plans.connect
              )}
            </button>
          </SRow>
          <p className="nx-snote nx-snote--row">
            {L.plans.tokenHelp}
            <a
              className="nx-slink"
              href={TOKEN_PAGE_URL}
              target="_blank"
              rel="noreferrer"
              onClick={linkClick}
            >
              {L.plans.tokenHelpLink}
            </a>
          </p>
        </>
      )}

      {linked && !expired && (
        <SRow
          title={L.plans.rootQuery}
          sub={L.plans.rootSub}
          htmlFor={finder ? "nx-conf-root" : undefined}
        >
          {finder ? (
            <>
              <span className="nx-sfield">
                <input
                  id="nx-conf-root"
                  className="nx-sinput"
                  type="text"
                  value={state.rootQuery}
                  maxLength={200}
                  placeholder={L.plans.rootPlaceholder}
                  autoComplete="off"
                  disabled={locked}
                  onChange={(event) => model.setRootQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (composing(event)) return;
                    if (event.key === "Enter" && state.rootQuery !== "") model.findRoots();
                  }}
                />
              </span>
              {state.changingRoot && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--ghost"
                  onClick={model.cancelChangeRoot}
                >
                  {L.plans.cancel}
                </button>
              )}
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={locked || state.finding || state.rootQuery === ""}
                onClick={model.findRoots}
              >
                {state.finding ? (
                  <>
                    <Spin /> {L.plans.finding}
                  </>
                ) : (
                  L.plans.findRoots
                )}
              </button>
            </>
          ) : (
            <>
              <span className="nx-schip">{rootTitle}</span>
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={locked}
                onClick={model.startChangeRoot}
              >
                {L.plans.changeRoot}
              </button>
            </>
          )}
        </SRow>
      )}

      {linked && !expired && state.roots !== null && (
        <div className="nx-sroots">
          {state.roots.length === 0 ? (
            <p className="nx-snote">{L.plans.rootsEmpty}</p>
          ) : (
            <>
              <p className="nx-sroots-hd">{L.plans.rootsHeading(state.roots.length)}</p>
              <ul className="nx-sroots-list">
                {state.roots.map((root) => (
                  <li key={root.id} className="nx-sroots-row">
                    <span className="nx-sroots-t" title={root.title}>
                      {root.title}
                    </span>
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm"
                      disabled={locked || state.picking !== null}
                      onClick={() => model.pickRoot(root.id)}
                    >
                      {state.picking === root.id ? (
                        <>
                          <Spin /> {L.plans.picking}
                        </>
                      ) : (
                        L.plans.pickRoot
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {state.failure !== null && (
        <p className="nx-snote nx-snote--row nx-snote--red nx-row--new" role="alert">
          {state.failure}
        </p>
      )}
    </SGroup>
  );
}
