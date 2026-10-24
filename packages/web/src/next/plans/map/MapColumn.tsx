import { L } from "../../labels";
import { keyHint } from "../../lib/key-hint";
import type { ShellNav } from "../../slots";
import { MenuIcon, PanelIcon } from "../../ui/icons";
import { openPlanTarget } from "../open-plan";
import type { LinkMapHand } from "../use-link-map";
import { PlansMap } from "./PlansMap";

/**
 * 연결 지도의 머리(2026-10-24 사용자 결정) — 칸 제목과 다시 읽기. 기획서 칸의 머리
 *(`PlansHeader`)와 같은 자리(작업 틀의 막대)에 선다. 상태는 셸이 한 번만 쥔다.
 */
export function MapBar({
  hand,
  narrow,
  sidebarHidden,
  onOpenSidebar,
}: {
  hand: LinkMapHand;
  narrow: boolean;
  sidebarHidden: boolean;
  onOpenSidebar: () => void;
}) {
  return (
    <header className="nx-topbar nx-pl-bar">
      {sidebarHidden && (
        <button
          type="button"
          className="nx-ibtn"
          onClick={onOpenSidebar}
          title={narrow ? L.shell.menu : keyHint(L.sidebar.expand)}
          aria-label={narrow ? L.shell.menu : keyHint(L.sidebar.expand)}
        >
          {narrow ? <MenuIcon /> : <PanelIcon />}
        </button>
      )}
      <h2 className="nx-map-col-title">{L.plans.mapView}</h2>
      <span className="nx-grow" />
      <button type="button" className="nx-map-retry" onClick={hand.refresh}>
        {L.plans.mapRefresh}
      </button>
    </header>
  );
}

/**
 * 연결 지도 칸(2026-10-24 사용자 결정) — 기획서 칸의 보기 전환에서 사이드바 자리로 옮겨
 * 왔다. 칸은 마운트된 채 숨는다(Workspace 의 칸 관례). 문서 노드를 누르면 기획서 자리로
 * 가 그 문서를 연다(근거 칩과 같은 이음 — `openPlanTarget`).
 */
export function MapColumn({
  hand,
  nav,
  offstage = false,
}: {
  hand: LinkMapHand;
  nav: ShellNav;
  offstage?: boolean;
}) {
  return (
    <section
      className={`nx-map-col${offstage ? " nx-offstage" : ""}`}
      aria-hidden={offstage}
      inert={offstage}
      aria-label={L.plans.mapView}
    >
      <div className="nx-pl-state nx-pl-state--map">
        <PlansMap
          result={hand.state.result}
          phase={hand.state.phase}
          onRefresh={hand.refresh}
          onWrite={hand.write}
          onOpenDoc={(pageId) => openPlanTarget({ pageId }, nav)}
        />
      </div>
    </section>
  );
}
