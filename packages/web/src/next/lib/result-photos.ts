import type { ScreenComparison } from "@colonova-design/protocol";
import { screenPath } from "../../lib/screen-link.ts";

/**
 * `고친 화면` 카드가 읽는 사진 둘(2026-10-06 UX 점검). 데몬이 요청마다 찍어 둔 비교 기록은 수정 전과 수정 후를
 * 함께 들고 오는데, 카드는 수정 후만 집고 수정 전은 버렸다 — 제품의 핵심 장면(전 · 후)이 `수정 전·후 보기` 뒤
 * 대화상자에 숨어 있었다. 이제 카드가 둘 다 쥐고 사용자가 카드 안에서 넘겨 본다.
 *
 * 기록이 이 요청 · 이 화면의 것이 아니면(경로나 요청이 다르면) 사진은 없다 — 남의 사진을 보여 주는 것이 사진이
 * 없는 것보다 나쁘다. 형식과 크기가 어긋난 사진도 없는 것으로 친다(데이터 주소로 그릴 수 있는 한도).
 */

/** 데이터 주소로 그릴 수 있는 사진의 한도 — base64 글자 수. */
export const MAX_PHOTO_CHARS = 4 * 1024 * 1024;

const SAFE_TYPE = /^image\/(png|jpeg|webp)$/;

type Picture = ScreenComparison["before"];

/** 사진 하나를 `<img src>` 로 — 그릴 수 없는 사진은 null. */
export function photoUrl(shot: Picture | undefined): string | null {
  if (!shot || shot.data.length === 0 || shot.data.length > MAX_PHOTO_CHARS) return null;
  if (!SAFE_TYPE.test(shot.mediaType)) return null;
  return `data:${shot.mediaType};base64,${shot.data}`;
}

/** 이 카드의 사진 — 요청과 화면이 맞는 기록의 수정 전 · 수정 후. */
export function readPhotos(
  record: ScreenComparison | null | undefined,
  expect: { requestId: string; route: string },
): { before: string | null; after: string | null } {
  if (
    !record ||
    record.requestId !== expect.requestId ||
    screenPath(record.route) !== screenPath(expect.route)
  ) {
    return { before: null, after: null };
  }
  return { before: photoUrl(record.before), after: photoUrl(record.after) };
}
