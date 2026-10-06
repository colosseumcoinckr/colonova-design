import { type ReactNode, useRef } from "react";

/**
 * 카드 한 칸의 한 상태 몸통 — 열리면 자라고 닫히면 접힌다(onboarding.css 의 `nx-ob-foldaway`,
 * grid-template-rows 1fr ↔ 0fr). 닫히는 동안에는 마지막으로 그린 내용을 붙들어 높이가 한
 * 프레임에 사라지지 않게 하고, 닫힌 몸통은 `inert` 라 초점도 낭독도 받지 않는다. 처음부터 닫혀
 * 있으면 붙들 내용이 없어 비어 있다(2026-10-06 온보딩 손질 — 상태가 바뀌어도 카드가 튀지 않는다).
 */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const kept = useRef<ReactNode>(null);
  if (open) kept.current = children;
  return (
    <div className={`nx-ob-foldaway${open ? "" : " nx-ob-foldaway--closed"}`} inert={!open}>
      <div className="nx-ob-foldaway-i">{open ? children : kept.current}</div>
    </div>
  );
}
