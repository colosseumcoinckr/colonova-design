import type { SubmitSent } from "@colonova-design/protocol";

/**
 * 제출 영수증이 말하는 것(2026-10-07 UX 점검 3단계) — 무엇을 보냈는가 · 누가 받는가. 영수증은 모르는 것을 말하지
 * 않는다: 대화로 낸 제출에는 확인 창이 없어 보낸 화면을 모르고, 옛 영수증에는 지금 요청이 없어 받을 개발자를
 * 가려 말할 수 없다.
 *
 * 순수 함수만 산다 — 단위 시험이 src 에서 곧장 읽는다(형제 모듈을 부르지 않는다). 문장은 부르는 쪽(`labels.ts`)의 것이다.
 */

/** 앞선 화면의 제목을 몇 개까지 싣는가 — 영수증의 한 줄에 이름이 서는 만큼. */
export const SENT_TITLES_MAX = 3;
/** 제목 하나의 글자 수 상한 — 선로가 막는 길이(60자)와 같다. */
const TITLE_MAX_CHARS = 60;

/**
 * 제출 확인의 「이번에 제출하는 화면」 을 사건에 실을 모양으로 — 사용자가 확인한 목록이 곧 영수증이 되읽는 것이다.
 * 화면이 없으면(화면에 드러나지 않은 변경만 가는 제출) 말할 화면이 없으니 undefined.
 */
export function sentOf(screens: ReadonlyArray<{ title: string }>): SubmitSent | undefined {
  if (screens.length === 0) return undefined;
  const titles = screens
    .map((screen) => screen.title.trim())
    .filter((title) => title !== "")
    .slice(0, SENT_TITLES_MAX)
    .map((title) => Array.from(title).slice(0, TITLE_MAX_CHARS).join(""));
  return { screens: Math.min(screens.length, 999), titles };
}

export interface ReceiptFacts {
  /** 받을 개발자 — 지금 요청이 아는 사람이 먼저, 없으면 영수증이 적은 첫 한 명. */
  reviewers: string[];
  /** 보낸 화면 — `names` 는 앞선 제목을 ` · ` 로 이은 것, `rest` 는 제목이 닿지 않은 화면 수. 모르면 null. */
  sent: { screens: number; names: string; rest: number } | null;
  /**
   * 첫 제출인데 지금 요청에 적힌 개발자가 없다 — 알림이 갔는지 확인하지 못했으니 링크를 직접 전해야 한다. 요청이 지금의
   * 것이 아니거나 받을 개발자를 모르면(undefined) 말하지 않는다. 「없다」 는 요청의 `requested_reviewers` 가 비었다는
   * 뜻일 뿐이라(팀 단위 코드 소유자나 늦게 채워지는 지정은 닿지 않는다), 문장은 「확인하지 못했다」 를 말한다.
   */
  nobody: boolean;
}

export function receiptFacts(
  block: { reviewer?: string; sent?: SubmitSent },
  same: { reviewers?: string[] } | null,
  more: boolean,
): ReceiptFacts {
  const reviewers = same?.reviewers?.length
    ? same.reviewers
    : block.reviewer
      ? [block.reviewer]
      : [];
  const sent = block.sent
    ? {
        screens: block.sent.screens,
        names: block.sent.titles.join(" · "),
        rest: Math.max(0, block.sent.screens - block.sent.titles.length),
      }
    : null;
  const nobody =
    !more &&
    same !== null &&
    Array.isArray(same.reviewers) &&
    same.reviewers.length === 0 &&
    !block.reviewer;
  return { reviewers, sent, nobody };
}
