/**
 * 선로의 입력 한계(2026-10-23 화면 확인 · R2 검토 3) — `packages/protocol/src/draft.ts` 의 요청
 * 스키마와 같은 수를 웹에도 둔다. 데몬의 zod 검사가 영어로 답하기 전에 화면이 먼저 지키고,
 * 이유는 `L.drafts` 의 문장이 한 줄로 말한다. 수를 바꿀 때는 선로 스키마와 함께 고친다.
 */
export const DRAFT_LIMITS = {
  /** `draft.create` 의 제목 — z.string().min(1).max(255). */
  titleLength: 255,
  /** `draft.publish` 의 새 단계 표기 — z.string().min(1).max(32). */
  notationLength: 32,
  /** `draft.ask` 의 질문 — z.string().min(1).max(8_000). */
  questionLength: 8_000,
  /** `draft.ask` 의 근거 문서 수 — z.array(refInputSchema).max(20). */
  refCount: 20,
  /** 근거 한 문서의 절 수 — z.array(z.string().max(200)).max(20). */
  sectionCount: 20,
  /** 절 이름 하나의 길이 — z.string().max(200). */
  sectionLength: 200,
} as const;
