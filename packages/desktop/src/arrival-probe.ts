/**
 * 열기가 어디에 닿았는지를 페이지 안에서 재는 자기완결 함수 (2026-10-07 베타 준비 분석).
 *
 * overflow-probe.ts · element-identity.ts 와 같은 결이다 — 드라이버가 이 함수의 **소스**(toString)를 페이지의
 * 메인 월드에서 돌리므로 모듈 스코프 참조가 없어야 한다. 부품은 전부 몸 안에 들어 있고 import 는 type 만이다.
 *
 * 재는 것은 셋이다: 문서가 다 로드된 뒤의 전체 주소(리다이렉트를 따라간 자리), 눈에 보이는 비밀번호 입력칸의 수,
 * 눈에 보이는 상호작용 요소의 수. 로그인 화면으로 튕겼는가의 판정은 데몬의 것이다(login-wall.ts) — 여기는 페이지가
 * 아는 것만 말한다. 눈에 보이는 것만 센다: 접힌 메뉴 · 숨은 폼은 사용자가 보는 화면이 아니다.
 */
import type { PreviewArrival } from "@colonova-design/daemon/server";

export function probeArrivalInPage(): PreviewArrival {
  /** 눈에 보이는가 — 크기가 있고 감춰지지 않았다. */
  const visible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  /** 보이는 것의 수 — 판정의 문턱(몇 개 이하인가)보다 한참 큰 `cap` 에서 멈추고, 거대한 문서는 3000개까지만 훑는다. */
  const count = (selector: string, cap: number): number => {
    let seen = 0;
    let scanned = 0;
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (seen >= cap || scanned >= 3000) break;
      scanned += 1;
      if (visible(el)) seen += 1;
    }
    return seen;
  };
  return {
    url: location.href,
    passwordFields: count('input[type="password" i]', 20),
    interactive: count(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="combobox"], [contenteditable=""], [contenteditable="true"]',
      50,
    ),
  };
}
