import type { DaemonNotice } from "@colonova-design/daemon/server";
import { NOTICE, type NoticeLine } from "./copy.js";

/** `<이름> · <꼬리>` — 이름은 알림이 부르는 대화 · 프로젝트의 것이다. */
function titled(name: string, line: NoticeLine): { title: string; body: string } {
  return { title: `${name} · ${line.tail}`, body: line.body };
}

/**
 * 알림 한 장의 문구. 사용자의 어휘만 나간다 — 도구 이름도, git 도 없다.
 * 스레드 이름이 제목이 되고, 몸글은 창을 열면 무엇을 확인하게 되는지를
 * 한 문장으로 말한다. 데몬은 의미만 건넨다(DaemonNotice); 문장은 `copy.ts` 가 정한다 —
 * 이 함수는 어느 사건이 어느 문장인가만 안다(순수 함수라 Electron 없이 시험이 돈다).
 */
export function noticeCopy(notice: DaemonNotice): {
  title: string;
  body: string;
} {
  switch (notice.kind) {
    case "done":
      return titled(notice.title, NOTICE.done);
    case "crashed":
      return titled(notice.title, NOTICE.crashed);
    case "ask":
      return titled(
        notice.title,
        notice.what === "question" ? NOTICE.askQuestion : NOTICE.askPermission,
      );
    case "gate":
      return titled(notice.title, NOTICE.gate[notice.stage]);
    case "handoff":
      // 커미티 B1+A (2026-09-15): 단위는 프로젝트다 — 한 사이클에 화면이
      // 여럿이라 첫 화면 하나만 부르면 나머지가 안 간 것처럼 읽힌다.
      return titled(
        notice.projectName,
        notice.event === "comments"
          ? NOTICE.comments(notice.count ?? 1)
          : NOTICE.handoff[notice.event],
      );
    case "ready":
      return titled(notice.title, NOTICE.ready);
    case "submit-blocked":
      return titled(
        notice.title,
        notice.reason === "auth" ? NOTICE.submitBlocked.auth : NOTICE.submitBlocked.notified,
      );
    case "update-done":
      return NOTICE.updateDone(notice.agent === "claude" ? "Claude Code" : "Codex", notice.version);
  }
}
