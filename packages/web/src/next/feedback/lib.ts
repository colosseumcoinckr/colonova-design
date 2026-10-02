/**
 * 기능 제안의 초안 장부 — 화면 없는 순수 절반. 초안과 전송 시작 표시를
 * 렌더러의 localStorage 에 보관하고(PLAN-FEEDBACK), 저장소가 막힌 실행에서는
 * 메모리로 갈아 앉는다. 파일에 적는 주인은 여기 하나다.
 */
import { FEATURE_CONTEXT_MAX, FEATURE_REQUEST_MAX } from "@colonova-design/protocol";

export const FEEDBACK_DRAFT_KEY = "colonova-design.feedbackDraft";

/** 등록 여부를 확인하지 못한 초안 — 화면은 이 표시만 보고 확인 불가로 복원한다. */
export interface FeedbackDraft {
  request: string;
  context: string;
  /** 전송을 시작했다는 표시 — API 에 실어 보내기 직전에 참이 된다. */
  attempted: boolean;
  /** 이번 전송이 탄 명령 ID — 같은 내용의 이중 등록을 가리는 열쇠. */
  commandId: string | null;
}

export function emptyDraft(): FeedbackDraft {
  return { request: "", context: "", attempted: false, commandId: null };
}

function sanitize(raw: unknown): FeedbackDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  // 파싱한 저장 값 — 모양을 믿지 않고 한 필드씩 좁혀 읽는다.
  const source: Record<string, unknown> = {};
  Object.assign(source, raw);
  const request = typeof source.request === "string" ? source.request : "";
  const context = typeof source.context === "string" ? source.context : "";
  if (!request.trim() && !context.trim() && source.attempted !== true) return null;
  return {
    request,
    context,
    attempted: source.attempted === true,
    commandId: typeof source.commandId === "string" ? source.commandId : null,
  };
}

/**
 * 저장소의 그림자 — 쓰기가 막힌 실행만의 대체품이다. 값은 문자열, 삭제는 null
 * 로 적는다. localStorage 의 setItem·removeItem 이 던지는 동안(할당량·정책)만
 * 그림자가 값을 쥔다 — 성공한 쓰기·지우기 뒤에는 그림자를 걷어 실제 저장소가
 * 늘 주인이 되게 한다(다시 켠 실행 · 개발 새로 고침 · 견본의 저장소 청소가
 * 낡은 그림자에 가려지지 않게). 읽을 때는 막힌 실행의 그림자를 먼저 본다.
 */
const shadow = new Map<string, string | null>();

function readRaw(key: string): string | null {
  if (shadow.has(key)) return shadow.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  // 그림자를 먼저 적는다 — 쓰기가 던져도 읽기가 낡은 저장 값을 되살리지 않게.
  // 성공하면 그림자를 걷는다. 삭제는 지우는 것이 아니라 null 의 tombstone 으로
  // 적는다: removeItem 이 던져 저장 값이 남아도 읽기가 그것을 보지 않는다.
  shadow.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    shadow.delete(key);
  } catch {
    /* 그림자가 대신 쥔다 */
  }
}

export function loadDraft(): FeedbackDraft | null {
  const raw = readRaw(FEEDBACK_DRAFT_KEY);
  if (raw === null) return null;
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDraft(draft: FeedbackDraft): void {
  writeRaw(FEEDBACK_DRAFT_KEY, JSON.stringify(draft));
}

export function clearDraft(): void {
  writeRaw(FEEDBACK_DRAFT_KEY, null);
}

/**
 * 창을 다시 열었을 때의 화면 — 전송 시작 표시가 남은 초안은 등록 여부를
 * 알 수 없으므로 확인 불가 화면으로만 돌아간다. 새 등록 버튼은 여기 없다:
 * 목록 확인이 먼저고, 이중 등록을 앱이 만들지 않는다.
 */
export function restoresUncertain(draft: FeedbackDraft | null): boolean {
  return draft?.attempted === true;
}

/** 접수 요청이 통과해야 하는 문지기 — 공백 정리와 길이 한도(계약의 상수). */
export function requestError(request: string): "empty" | "too-long" | null {
  const trimmed = request.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > FEATURE_REQUEST_MAX) return "too-long";
  return null;
}

export function contextError(context: string): "too-long" | null {
  if (context.trim().length > FEATURE_CONTEXT_MAX) return "too-long";
  return null;
}

/** 명령 ID — 같은 내용의 보내기를 가리는 열쇠. 무작위 값이면 충분하다. */
export function mintCommandId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* 아래의 대체품 */
  }
  return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
