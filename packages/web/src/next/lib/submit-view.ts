/**
 * 제출 확인(U3)의 상태 판정 — 목록 · 알림 줄 · 주 단추가 서로 어긋나지 않게 한 곳에서 정한다
 * (2026-10-06 겹판 손질). 옛 판은 `error` 하나에 읽기 실패와 보내기 실패를 섞어, 보내기가 실패하면
 * 목록이 사라지고 눌리는 단추는 `다시 확인` 뿐이었다 — 목록은 그대로인데 다시 제출할 길이 없었다.
 *
 * 순수 모듈이다 — 시험이 src 에서 곧장 읽으므로 형제를 부르지 않는다(journey.ts 와 같은 규칙).
 */

export interface SubmitViewInput {
  /** 제출할 내용의 사진(`submitPreview`)을 받았다. */
  hasSnapshot: boolean;
  /** 사진 속 최종 변경 파일의 수 — 0 이면 보낼 것이 없다. */
  files: number;
  /** 사진을 읽는 중. */
  loading: boolean;
  /** 사진을 읽지 못했다 — 목록 자체가 없다. */
  readFailed: boolean;
  /** 보내는 길이 실패했다 — 목록은 그대로고 다시 제출할 수 있다. */
  sendFailed: boolean;
  /** 확인하는 동안 내용이 바뀌었다 — 목록이 옛것이라 다시 읽어야 한다. */
  changed: boolean;
  /** 지금 보내는 중. */
  busy: boolean;
  /** 여정이 제출을 잠근 이유(`journey.submit`) — 열려 있으면 null. */
  lockReason: string | null;
}

/** 알림 줄의 종류 — 위에서 아래로, 먼저 말할 것이 앞이다. */
export type SubmitNotice = "send" | "read" | "changed" | "empty" | "lock";

export interface SubmitView {
  /** 목록을 그린다 — 읽는 중이거나 읽지 못했으면 없다. 보내기 실패는 목록을 지우지 않는다. */
  showList: boolean;
  /** 읽는 동안의 뼈대를 그린다. */
  skeleton: boolean;
  /** 주 단추가 눌린다. */
  enabled: boolean;
  /** 주 단추의 말 — 보내는 중 · 실패한 뒤의 다시 제출 · 평소. */
  action: "running" | "retry" | "confirm";
  notices: SubmitNotice[];
}

export function submitView(input: SubmitViewInput): SubmitView {
  const { hasSnapshot, files, loading, readFailed, sendFailed, changed, busy, lockReason } = input;
  const showList = hasSnapshot && !loading && !readFailed;
  const notices: SubmitNotice[] = [];
  if (sendFailed) notices.push("send");
  if (readFailed && !loading) notices.push("read");
  if (changed && !loading && !readFailed) notices.push("changed");
  if (showList && files === 0) notices.push("empty");
  if (lockReason !== null && !loading) notices.push("lock");
  return {
    showList,
    skeleton: loading,
    // 보내기 실패는 막지 않는다 — 같은 목록으로 한 번 더 보낼 수 있어야 한다.
    enabled: showList && files > 0 && !busy && !changed && lockReason === null,
    action: busy ? "running" : sendFailed ? "retry" : "confirm",
    notices,
  };
}
