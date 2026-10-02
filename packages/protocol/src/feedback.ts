/**
 * 기능 제안 (PLAN-FEEDBACK): the app-wide feedback channel's wire contract.
 *
 * A non-developer asks for a feature of ColoNova Design itself; the daemon
 * files it as an issue of the 제작팀's repo (RELEASES_REPO) — never a project
 * repo, never with the planner's chat, captures, project names, or source.
 * Only the two fields here plus app version and OS ride along.
 *
 * This module is the single source of the input limits and the result shape:
 * the UI's dialog, the wire schema, and the daemon's submit all read it.
 */
import { z } from "zod";

/** 요청(필수)의 글자 수 상한 — 공백 제외 4,000자 이하는 여기가 잣대다. */
export const FEATURE_REQUEST_MAX = 4000;
/** 불편한 점(선택)의 글자 수 상한. */
export const FEATURE_CONTEXT_MAX = 2000;

/**
 * 입력 계약 — 공백만 있는 요청은 거절되고 두 필드는 앞뒤 공백이 정리된다.
 * `context` 는 선택이며, 빈 값은 데몬이 본문에서 빼는 것으로 처리한다.
 */
export const featureRequestInputSchema = z.object({
  request: z.string().trim().min(1).max(FEATURE_REQUEST_MAX),
  context: z.string().trim().max(FEATURE_CONTEXT_MAX).optional(),
});

export type FeatureRequestInput = z.infer<typeof featureRequestInputSchema>;

/**
 * 접수의 네 가지 답 — 어느 길로도 자동 재전송은 없다.
 *
 * - `sent` — 유효한 이슈 번호를 받았다. 접수 완료.
 * - `browser` — 토큰 없음·만료 또는 401/403/404/410. 아직 접수하지 않았고,
 *   채워진 새 이슈 URL 을 기본 브라우저에서 사용자가 마무리한다.
 * - `failed` — 422 등 명시적 거절. 초안을 보존하고 수정·재시도(새 id)만이 길이다.
 * - `uncertain` — 네트워크 단절·5xx·잘못된 성공 응답. 등록 여부를 확인하지
 *   못했으므로 같은 id 로 다시 등록하지 않는다; 목록 확인이 유일한 안내다.
 */
export type FeatureRequestResult =
  | { kind: "sent"; number: number; url: string }
  | { kind: "browser"; url: string; title: string; body: string }
  | { kind: "failed"; reason: "rejected" }
  | { kind: "uncertain"; url: string };
