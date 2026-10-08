// OS 알림 정책의 시험(2026-10-07 베타 준비 분석 · 첫 5분) — 첫 준비가 끝났다는 소식(`ready`)이 지금 보고 있는
// 프로젝트에도 오게 되면서, 중복 · 소음이 없는 규칙은 창 포커스 하나가 쥔다: 창이 앞에 있으면 어떤 알림도 내지 않고
// (앱 안의 알림이 말한다), 뒤에 있으면 `ready` 는 시점 설정과 무관하게 나간다.
// `../dist` 임포트인 이유는 notices 시험과 같다(src 의 `.js` 지정자를 node --test 가 못 읽는다).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DaemonNotice } from "@colonova-design/daemon/server";
import {
  DEFAULT_NOTIFICATION_PREFS,
  normalizeNotificationPrefs,
  shouldInterrupt,
  shouldNotify,
} from "../dist/notify-policy.js";

const ready: DaemonNotice = { kind: "ready", slug: "member", title: "회원 관리" };
const done: DaemonNotice = { kind: "done", sessionId: "s1", title: "검색창", durationMs: 5_000 };

test("창이 앞에 있으면 어떤 알림도 OS 로 내지 않는다 — 사용자가 이미 보고 있다", () => {
  assert.equal(shouldInterrupt(ready, DEFAULT_NOTIFICATION_PREFS, true), false);
  assert.equal(shouldInterrupt(done, DEFAULT_NOTIFICATION_PREFS, true), false);
  assert.equal(
    shouldInterrupt(
      { kind: "ask", sessionId: "s1", title: "t", what: "question" },
      DEFAULT_NOTIFICATION_PREFS,
      true,
    ),
    false,
  );
});

test("창이 뒤에 있으면 첫 준비 끝은 지금 보고 있던 프로젝트여도 나간다", () => {
  // 데몬은 프로젝트가 활성인지 가리지 않고 `ready` 를 보낸다 — 활성 프로젝트의 준비가 끝났을 때 사용자가 다른 앱에
  // 있으면 이것이 첫 `와` 를 알리는 유일한 신호다.
  assert.equal(shouldInterrupt(ready, DEFAULT_NOTIFICATION_PREFS, false), true);
});

test("첫 준비 끝은 완료 알림의 시점 설정을 타지 않는다 — 끄거나 오래 걸린 것만으로 해도 나간다", () => {
  for (const timing of ["off", "long", "all"] as const) {
    const prefs = normalizeNotificationPrefs({ done: timing, sound: true });
    assert.equal(shouldNotify(ready, prefs), true, `done=${timing}`);
    assert.equal(shouldInterrupt(ready, prefs, false), true, `done=${timing}`);
  }
  // 같은 설정에서 짧은 완료는 걸러진다 — 시점 정책은 완료만 탄다.
  assert.equal(shouldInterrupt(done, normalizeNotificationPrefs({ done: "long" }), false), false);
  assert.equal(shouldInterrupt(done, normalizeNotificationPrefs({ done: "off" }), false), false);
  assert.equal(shouldInterrupt(done, DEFAULT_NOTIFICATION_PREFS, false), true);
});

test("알림을 내보내는 자리는 정책 함수 하나를 지난다 — 창 포커스 판정이 흩어지지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/app-notify.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /shouldInterrupt\(notice, this\.prefs, this\.host\.window\?\.isFocused\(\) === true\)/,
  );
  assert.doesNotMatch(
    source,
    /\bshouldNotify\b/,
    "시점 정책만 따로 부르면 창 포커스 판정이 빠진다",
  );
});
