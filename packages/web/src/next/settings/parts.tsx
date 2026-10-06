import { createContext, type KeyboardEvent, type ReactNode, type UIEvent, useContext } from "react";
import { themePeekHalves } from "../onboarding/motion";

/**
 * 낭독 한 곳 — 늘 마운트된 `role="status"` 칸에 문장을 올린다. 내용과 함께 새로 그려지는 상태 칸은
 * 낭독기가 놓치기 쉬워서(2026-10-06 설정 손질), 상태의 변화는 이 길로 말한다. 실패는 눈에 보이는
 * 칸의 `role="alert"` 가 따로 말한다.
 */
export const AnnounceContext = createContext<(text: string) => void>(() => undefined);

export function useAnnounce(): (text: string) => void {
  return useContext(AnnounceContext);
}

/** 한 쪽의 상자 — 줄들이 가는 선으로 나뉜 한 장의 카드다. `danger` 는 되돌릴 수 없는 일의 구역. */
export function SGroup({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div className={`nx-sgroup${danger ? " nx-sgroup--dng" : ""}`}>{children}</div>;
}

/** 쪽 하나 — 탭의 몸이다. 모두 그려 둔 채 고른 쪽만 보이고, 굴리면 머리 아래에 가는 선이 선다. */
export function SPage({
  id,
  active,
  onScroll,
  children,
}: {
  id: string;
  active: boolean;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      className="nx-set-page"
      role="tabpanel"
      id={`nx-set-page-${id}`}
      aria-labelledby={`nx-set-tab-${id}`}
      hidden={!active}
      onScroll={onScroll}
    >
      {children}
    </div>
  );
}

export type BandTone = "plain" | "blue" | "amber" | "green" | "red";

/**
 * 쪽 위의 띠 — 상태를 한눈에 말한다(업데이트 요약 · AI 로그인 만료 · 연결 끊김). 색은 뜻의 보조일
 * 뿐이고 말이 따로 선다. `bar` 는 흐르는 진행 막대, 오른쪽 칸(`children`)은 그 상태의 손이다.
 */
export function SBand({
  tone = "plain",
  icon,
  title,
  sub,
  bar = false,
  role,
  id,
  children,
}: {
  tone?: BandTone;
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  bar?: boolean;
  role?: "alert";
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`nx-sband nx-sband--${tone}`} role={role} id={id}>
      {icon && (
        <span className="nx-sband-ic" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="nx-sband-txt">
        <b className="nx-sband-t">{title}</b>
        {sub && <span className="nx-sband-s">{sub}</span>}
      </div>
      {children && <div className="nx-sband-act">{children}</div>}
      {bar && <div className="nx-upd-bar" aria-hidden="true" />}
    </div>
  );
}

/**
 * 설정 한 줄 — 왼쪽에 이름과 한 줄 설명, 오른쪽에 조절 장치. 이름은 조절 장치의 접근
 * 이름이기도 하다: 칸이면 `htmlFor`(label), 스위치 · 묶음이면 `id`(aria-labelledby 의 과녁).
 */
export function SRow({
  title,
  sub,
  subId,
  id,
  htmlFor,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** 한 줄 설명의 id — 조절 장치가 `aria-describedby` 로 잇는다. */
  subId?: string;
  id?: string;
  htmlFor?: string;
  children?: ReactNode;
}) {
  return (
    <div className="nx-sitem">
      <div className="nx-sitem-txt">
        {htmlFor ? (
          <label className="nx-sitem-title" htmlFor={htmlFor}>
            {title}
          </label>
        ) : (
          <span className="nx-sitem-title" id={id}>
            {title}
          </span>
        )}
        {sub && (
          <span className="nx-sitem-sub" id={subId}>
            {sub}
          </span>
        )}
      </div>
      {children && <div className="nx-sitem-ctl">{children}</div>}
    </div>
  );
}

/** 켜고 끄는 스위치 — 이름은 같은 줄 제목의 `id` 가 붙는다. */
export function Switch({
  on,
  labelledBy,
  onChange,
}: {
  on: boolean;
  labelledBy: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      className={`nx-sw${on ? " nx-sw--on" : ""}`}
      onClick={() => onChange(!on)}
    />
  );
}

/**
 * 라디오 묶음의 탭 순서 — 고른 카드 하나만 서고(나머지는 화살표로 닿는다) 고른 것이 없으면
 * 첫 카드가 선다. 카드 일곱을 Tab 으로 일곱 번 지나지 않게.
 */
export function rovingTab(index: number, checkedAt: number): 0 | -1 {
  return (checkedAt < 0 ? index === 0 : index === checkedAt) ? 0 : -1;
}

/**
 * 화살표 걸음 — 라디오 카드 사이를 옮겨 가며 곧바로 그것을 고른다(AI · 테마 · 알림 시점이
 * 함께 쓴다). 탭 순서에 서는 것이 고른 카드 하나뿐이라 초점도 함께 옮긴다.
 */
export function radioArrowStep(
  event: KeyboardEvent<HTMLElement>,
  checkedAt: number,
  count: number,
  pick: (index: number) => void,
) {
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  if (!forward && event.key !== "ArrowLeft" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const next = (Math.max(0, checkedAt) + (forward ? 1 : -1) + count) % count;
  pick(next);
  event.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='radio']")[next]?.focus();
}

/**
 * 테마 카드의 미리보기 — data-theme 를 입은 진짜 팔레트로 그린 작은 앱 창이다(왼쪽 목록 ·
 * 말풍선 · 글 두 줄 · 입력창). 시스템 따르기는 같은 창을 밝음과 어두움의 반반으로 자른다.
 */
export function ThemePeek({ choice }: { choice: string }) {
  const halves = themePeekHalves(choice);
  return (
    <span className={`nx-tpeek${halves.length > 1 ? " nx-tpeek--split" : ""}`} aria-hidden="true">
      {halves.map((half) => (
        <i key={half} className="nx-tw" data-theme={half}>
          <i className="nx-tw-side">
            <i />
            <i />
            <i />
          </i>
          <i className="nx-tw-main">
            <i className="nx-tw-me" />
            <i className="nx-tw-ln" />
            <i className="nx-tw-ln nx-tw-ln--s" />
            <i className="nx-tw-bar">
              <i />
            </i>
          </i>
        </i>
      ))}
    </span>
  );
}
