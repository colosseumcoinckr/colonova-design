// 푸시 게이트의 실패는 분류기 한 곳(classifyGitHubFailure)이 갈래를 정한다(2026-10-08 검토 · F12).
// 옛 `PUSH_AUTH_FAILURE` 는 `403` 만 있으면 한도 거절도 인증으로 읽어 `push:auth` 알림과 `reason: "push-auth"`
// (`다시 연결`)로 말했다 — 순수 시험(git 을 부르지 않는다).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiffStatus } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: repo-publish 는 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그 지정을 못 고친다.
import { RepoCore } from "../dist/repo-core.js";
import { PublishCycle } from "../dist/repo-publish.js";

function scene() {
  const notices: Array<[string, string]> = [];
  const briefs: string[] = [];
  const core = new RepoCore({
    root: "/tmp/colonova-push-gate-never-cloned",
    url: null,
    onStatus: () => {},
  });
  const publish = new PublishCycle(core, {
    machineMemo: async () => null,
    notice: (key, detail) => notices.push([key, detail]),
  });
  /** 게이트 실패를 직접 부른다 — 부르는 쪽(보관 · 제출)의 git 은 이 시험의 몫이 아니다. */
  const fail = (gate: "push" | "pr", text: string): DiffStatus =>
    (
      publish as unknown as {
        failGate(gate: string, error: unknown, onSessionTurn: (brief: string) => void): DiffStatus;
      }
    ).failGate(gate, new Error(text), (brief) => briefs.push(brief));
  return { notices, briefs, fail };
}

test("한도의 403 푸시는 인증이 아니다 — push:auth 알림도 push-auth 사유도 없다", () => {
  for (const text of [
    "fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403\nremote: You have exceeded a secondary rate limit.",
    "error: RPC failed; HTTP 403 curl 22 The requested URL returned error: 403\nremote: API rate limit exceeded for user ID 1.",
    "remote: You have triggered an abuse detection mechanism. (403)",
  ]) {
    const { notices, fail } = scene();
    const status = fail("push", text);
    assert.equal(status.stage, "failed");
    assert.equal(status.reason, undefined, text);
    assert.deepEqual(notices, [], `다시 연결을 말하지 않는다: ${text}`);
  }
});

test("진짜 인증 거절은 그대로 — push-auth 사유와 push:auth 알림, AI 에게는 가지 않는다", () => {
  for (const text of [
    "fatal: Authentication failed for 'https://github.com/o/r.git/'",
    "제출에 실패했습니다 — GitHub 401: Bad credentials",
    "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/o/r.git/'",
  ]) {
    const { notices, briefs, fail } = scene();
    const status = fail("push", text);
    assert.equal(status.stage === "failed" && status.reason, "push-auth", text);
    assert.deepEqual(
      notices.map(([key]) => key),
      ["push:auth"],
      text,
    );
    assert.deepEqual(briefs, [], "AI 가 고칠 것이 아니다");
  }
});

test("권한 거절은 push:permission — 인증과 섞이지 않는다", () => {
  const { notices, briefs, fail } = scene();
  const status = fail(
    "push",
    "remote: Permission to o/r.git denied to colonova-bot.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403",
  );
  assert.equal(status.stage === "failed" && status.reason, undefined);
  assert.deepEqual(
    notices.map(([key]) => key),
    ["push:permission"],
  );
  assert.deepEqual(briefs, []);
});

test("파일 권한 거절(Permission denied)은 연결 문제가 아니다 — 모르면 AI 쪽, 다시 연결을 말하지 않는다", () => {
  const { notices, briefs, fail } = scene();
  const status = fail("push", "error: cannot open .git/FETCH_HEAD: Permission denied");
  assert.equal(status.stage === "failed" && status.reason, undefined);
  assert.deepEqual(notices, []);
  assert.equal(briefs.length, 1, "보수적으로 AI 의 과제가 된다");
});
