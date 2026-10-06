/**
 * 기능 제안 판의 순수 판정 — 화면 없는 쪽(2026-10-06 겹판 손질 · 피드백).
 * 시험이 src 에서 곧장 읽는 순수 모듈이라 형제를 부르지 않는다 — 문장(`L`)은 인자로 받는다
 * (타입만 가져오니 node 가 풀 일이 없다).
 */
import type { L } from "../labels";

/** 판이 쥐는 단계 — 작성 · 확인 · 전송 중과 끝의 네 모양(접수 · 브라우저 · 거절 · 확인 불가). */
export type Phase = "edit" | "review" | "sending" | "sent" | "browser" | "failed" | "uncertain";

/** 이 판이 읽는 문장 칸 — `L` 이 구조적으로 채운다. */
export type FeedbackWords = Pick<typeof L, "feedback">;

/**
 * 건네받은 약속이 **건네받는 순간 이미 거절돼 있었는가** — 요청이 나가기도 전에 막혔다는 뜻이다.
 * `daemon.api.feedbackSubmit` 은 소켓이 열려 있지 않으면 보내지도 않고 곧바로 거절한다
 * (`lib/daemon-client.ts` 의 `call`). 반대로 보낸 뒤의 거절(연결이 끊김 · 응답이 늦음)은 나중에
 * 온다. 앞의 것은 아무것도 나가지 않은 일이라 확인 불가가 아니다 — 같은 제안을 다시 보내도 두 번
 * 올라가지 않는다. 뒤의 것은 등록 여부를 모르니 확인 불가다(PLAN-FEEDBACK).
 *
 * 판정은 마이크로태스크의 차례로 한다: 이미 끝난 약속은 `race` 에서 표식(`PENDING`)보다 먼저
 * 구독되니 먼저 이기고, 아직 도는 약속은 표식이 이긴다. 시계에 기대지 않는다. 네이티브 약속만
 * 믿는다(다른 약속의 형은 한 번 더 감겨 이미 끝난 것도 늦게 보인다).
 */
export function rejectedBeforeSend(call: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");
  return Promise.race([call, Promise.resolve(pending)]).then(
    () => false,
    () => true,
  );
}

/**
 * 보내기를 잠그는 줄 — 연결의 이유(`connectionLock` 의 답) 뒤에 이 판이 약속하는 말을 붙인다.
 * 연결이 열려 있으면 잠그지 않는다(null).
 */
export function sendLockLine(reason: string | null, words: FeedbackWords): string | null {
  return reason === null ? null : `${reason} — ${words.feedback.lockNote}`;
}

export interface StageCopy {
  title: string;
  /** 제목 아래 한 줄 — 없는 단계도 있다. */
  sub: string | null;
}

/**
 * 단계마다의 제목 — 판의 이름(낭독이 읽는 것)이 단계를 따라 바뀐다. 확인 단계에서 `기능 제안` 이
 * 그대로면 낭독은 무엇을 확인하라는지 모른다.
 */
export function stageCopy(phase: Phase, words: FeedbackWords): StageCopy {
  const F = words.feedback;
  switch (phase) {
    case "edit":
      return { title: F.title, sub: F.editSub };
    case "review":
      return { title: F.reviewTitle, sub: F.reviewSub };
    case "sending":
      return { title: F.sendingTitle, sub: F.sendingSub };
    case "sent":
      return { title: F.sentHead, sub: null };
    case "browser":
      return { title: F.browserTitle, sub: null };
    case "failed":
      return { title: F.failedTitle, sub: null };
    case "uncertain":
      return { title: F.uncertainTitle, sub: null };
  }
}

/** 세 점(쓰기 · 확인 · 접수) 하나의 모양 — `warn` 은 접수가 손을 기다린다는 뜻이다. */
export type StepState = "done" | "now" | "todo" | "warn";

/**
 * 세 점의 모양 — 지난 단계는 체크, 지금은 채움, 남은 것은 빈 점이다. 전송 중은 셋째 점이 지금이고,
 * 브라우저 · 거절 · 확인 불가는 셋째 점이 손을 기다린다(`warn`). 색만으로 말하지 않으니 부르는 쪽이
 * 점 안의 그림과 글자도 함께 단다.
 */
export function stepStates(phase: Phase): [StepState, StepState, StepState] {
  switch (phase) {
    case "edit":
      return ["now", "todo", "todo"];
    case "review":
      return ["done", "now", "todo"];
    case "sending":
      return ["done", "done", "now"];
    case "sent":
      return ["done", "done", "done"];
    case "browser":
    case "failed":
    case "uncertain":
      return ["done", "done", "warn"];
  }
}

export type CounterTone = "calm" | "warn" | "over";

export interface Counter {
  /** 센 글자 수 — 앞뒤 공백은 뺀다(한도를 가르는 잣대와 같다). */
  used: number;
  shown: boolean;
  tone: CounterTone;
}

/**
 * 글자 수 표시 — 한도의 80% 부터 보이고, 90% 부터 노랗고, 넘으면 빨갛다. 평소에는 숫자가 없어
 * 입력칸이 조용하다. 넘은 것은 검증을 누르기 전에도 곧바로 말한다(부르는 쪽이 `over` 를 오류로).
 */
export function counterState(text: string, max: number): Counter {
  const used = text.trim().length;
  if (used > max) return { used, shown: true, tone: "over" };
  if (used >= max * 0.9) return { used, shown: true, tone: "warn" };
  return { used, shown: used >= max * 0.8, tone: "calm" };
}

/**
 * 판이 닫힌 사이에 답이 도착했을 때의 토스트 — 접수는 기쁜 소식, 나머지(브라우저 · 거절 · 확인 불가)는
 * 열어서 마저 해야 한다는 말이다. 닫힌 판은 아무것도 그리지 않으니 알릴 길이 이것뿐이다.
 */
export function closedArrival(accepted: boolean, words: FeedbackWords): string {
  return accepted ? words.feedback.toastSent : words.feedback.toastNeedsYou;
}
