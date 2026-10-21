import assert from "node:assert/strict";
import { test } from "node:test";
import { timeAgo } from "../src/lib/format.ts";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-labels.test.ts 와 같은 모양).
import {
  type ConfluenceConnection,
  type ConfluenceFormState,
  canConnect,
  cancelChangeRoot,
  cancelReconnect,
  confluenceStatus,
  confluenceTone,
  connectInput,
  effectiveSite,
  emptyConfluenceForm,
  failConnect,
  settleConnect,
  settleRoots,
  startChangeRoot,
  startPick,
  startReconnect,
} from "../src/next/settings/confluence-form.ts";

/** 기획서 연결 판의 걸음(기획서 동기화 1단계 · M2) — 이메일·토큰의 일회성을 못 박는다. */

const linked = (rootTitle: string | null): ConfluenceFormState => ({
  ...emptyConfluenceForm,
  phase: "connected",
  site: "colosseum.atlassian.net",
  linked: { site: "colosseum.atlassian.net", rootTitle },
});

test("연결이 서면 이메일·토큰의 흔적은 판에서 지워진다 — 사이트와 뿌리만 남는다", () => {
  const next = settleConnect(
    {
      ...emptyConfluenceForm,
      email: "me@example.com",
      token: "tok",
      site: "colosseum.atlassian.net",
    },
    { site: "colosseum.atlassian.net", rootTitle: "8.8 ColoNova" },
  );
  assert.equal(next.phase, "connected");
  assert.equal(next.email, "");
  assert.equal(next.token, "");
  assert.equal(next.failure, null);
  assert.equal(next.site, "colosseum.atlassian.net");
  assert.deepEqual(next.linked, { site: "colosseum.atlassian.net", rootTitle: "8.8 ColoNova" });
});

test("연결이 져도 흔적은 지워진다 — 다시 넣는 말이 곧 새 자격이다", () => {
  const next = failConnect(
    { ...emptyConfluenceForm, email: "me@example.com", token: "tok" },
    "Confluence 연결이 만료됐거나 자격이 틀렸습니다. 설정에서 다시 연결해 주세요.",
  );
  assert.equal(next.phase, "failed");
  assert.equal(next.email, "");
  assert.equal(next.token, "");
  assert.equal(next.roots, null);
  assert.ok(next.failure !== null);
  assert.ok(next.failure.startsWith(L.plans.failed("").slice(0, -2)));
});

test("찾기의 끝 — 목록이 채워지고 실패 문장은 지운다", () => {
  const next = settleRoots({ ...failConnect(emptyConfluenceForm, "x"), roots: null }, [
    { id: "987", title: "8.8 ColoNova" },
  ]);
  assert.deepEqual(next.roots, [{ id: "987", title: "8.8 ColoNova" }]);
  assert.equal(next.failure, null);
});

test("상태 한 줄 — 만족이 이기고, 데몬 판이 방송 전엔 화면의 끝이 대신한다", () => {
  assert.equal(confluenceStatus(undefined, null, timeAgo), L.plans.statusNotConnected);
  assert.equal(
    confluenceStatus(undefined, linked(null).linked, timeAgo),
    L.plans.statusConnected("colosseum.atlassian.net"),
  );
  assert.equal(
    confluenceStatus(undefined, linked("8.8 ColoNova").linked, timeAgo),
    L.plans.statusRooted("8.8 ColoNova"),
  );

  assert.equal(
    confluenceStatus(
      {
        site: "colosseum.atlassian.net",
        connected: true,
        expired: false,
        rootTitle: "8.8 ColoNova",
        lastImportAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        pages: 12,
      },
      null,
      timeAgo,
    ),
    L.plans.statusImported(
      timeAgo(Date.parse(new Date(Date.now() - 5 * 60_000).toISOString())),
      12,
    ),
  );

  assert.equal(
    confluenceStatus(
      { site: "s", connected: true, expired: true, rootTitle: "r", lastImportAt: null, pages: 0 },
      linked("r").linked,
      timeAgo,
    ),
    L.plans.statusExpired,
  );
  assert.equal(
    confluenceStatus(
      {
        site: "s",
        connected: true,
        expired: false,
        rootTitle: "8.8",
        lastImportAt: null,
        pages: 0,
      },
      null,
      timeAgo,
    ),
    L.plans.statusRooted("8.8"),
  );
  assert.equal(
    confluenceStatus(
      { site: "s", connected: true, expired: false, rootTitle: null, lastImportAt: null, pages: 0 },
      null,
      timeAgo,
    ),
    L.plans.statusConnected("s"),
  );
});

const alive = (over: Partial<ConfluenceConnection> = {}): ConfluenceConnection => ({
  site: "colosseum.atlassian.net",
  connected: true,
  expired: false,
  rootTitle: null,
  lastImportAt: null,
  pages: 0,
  ...over,
});

test("사이트 — 입력 칸이 비어 있으면 이미 연결된 사이트가 쓰인다", () => {
  assert.equal(effectiveSite(emptyConfluenceForm, undefined), "");
  assert.equal(effectiveSite(emptyConfluenceForm, alive()), "colosseum.atlassian.net");
  assert.equal(effectiveSite(linked(null), undefined), "colosseum.atlassian.net");
  // 사용자가 쓴 것이 이긴다.
  assert.equal(
    effectiveSite({ ...emptyConfluenceForm, site: "other.atlassian.net" }, alive()),
    "other.atlassian.net",
  );
});

test("연결 단추 — 사이트가 있어야 하고 이메일 · 토큰은 짝이며, 저장된 자격이 있을 때만 비워도 된다", () => {
  const form = (over: Partial<ConfluenceFormState>) => ({ ...emptyConfluenceForm, ...over });
  // 처음 연결 — 셋 다 있어야 한다.
  assert.equal(canConnect(form({}), undefined), false);
  assert.equal(canConnect(form({ site: "s.atlassian.net" }), undefined), false);
  assert.equal(canConnect(form({ site: "s", email: "a@b.c" }), undefined), false);
  assert.equal(canConnect(form({ site: "s", token: "t" }), undefined), false);
  assert.equal(canConnect(form({ site: "s", email: "a@b.c", token: "t" }), undefined), true);
  // 연결된 적이 있으면 비워 두고 다시 확인할 수 있다 — 사이트는 연결된 것이 대신한다.
  assert.equal(canConnect(form({}), alive()), true);
  // 끊겼으면(만료) 저장된 자격이 이미 틀렸으므로 새 자격이 있어야 한다.
  assert.equal(canConnect(form({}), alive({ expired: true })), false);
  assert.equal(canConnect(form({ email: "a@b.c", token: "t" }), alive({ expired: true })), true);
  // 하나만 넣은 것은 연결된 뒤에도 안 된다 — 선로가 짝으로 받는다.
  assert.equal(canConnect(form({ email: "a@b.c" }), alive()), false);
});

test("연결 입력 — 이메일 · 토큰은 둘 다 있을 때만 싣고, 사이트는 연결된 것으로 채운다", () => {
  assert.deepEqual(connectInput(emptyConfluenceForm, alive()), {
    site: "colosseum.atlassian.net",
  });
  assert.deepEqual(
    connectInput(
      { ...emptyConfluenceForm, site: "s.atlassian.net", email: "a@b.c", token: "t" },
      undefined,
    ),
    { site: "s.atlassian.net", email: "a@b.c", token: "t" },
  );
  // 반쪽은 싣지 않는다.
  assert.deepEqual(connectInput({ ...emptyConfluenceForm, site: "s", email: "a@b.c" }, undefined), {
    site: "s",
  });
});

test("다시 연결 — 열면 사이트가 미리 들어 있고, 그만두면 넣다 만 이메일 · 토큰이 지워진다", () => {
  const opened = startReconnect(linked(null), alive());
  assert.equal(opened.reconnecting, true);
  assert.equal(opened.site, "colosseum.atlassian.net");
  const typed = { ...opened, email: "a@b.c", token: "t" };
  const closed = cancelReconnect(typed);
  assert.equal(closed.reconnecting, false);
  assert.equal(closed.email, "");
  assert.equal(closed.token, "");
  // 연결이 서면 열린 칸도 접힌다.
  assert.equal(settleConnect(typed, { site: "s", rootTitle: null }).reconnecting, false);
});

test("기준 페이지 바꾸기 — 열면 찾기 칸이, 그만두면 목록과 찾는 말이 함께 접힌다", () => {
  const opened = startChangeRoot(linked("8.8 ColoNova"));
  assert.equal(opened.changingRoot, true);
  const searched = settleRoots({ ...opened, rootQuery: "Colo" }, [{ id: "1", title: "ColoNova" }]);
  const closed = cancelChangeRoot(searched);
  assert.equal(closed.changingRoot, false);
  assert.equal(closed.roots, null);
  assert.equal(closed.rootQuery, "");
  // 하나를 고르면(연결이 이기면) 접힌다.
  const picked = settleConnect(searched, { site: "s", rootTitle: "ColoNova" });
  assert.equal(picked.changingRoot, false);
  assert.equal(picked.roots, null);
  assert.equal(picked.picking, null);
});

test("고르는 중 — 단추가 잠기고, 지면 찾은 목록은 그대로 남아 다른 줄을 다시 고를 수 있다", () => {
  const roots = [
    { id: "1", title: "하나" },
    { id: "2", title: "둘" },
  ];
  const picking = startPick({ ...linked(null), roots }, "1");
  assert.equal(picking.picking, "1");
  const failed = failConnect(picking, "페이지를 읽지 못했습니다");
  assert.equal(failed.picking, null);
  assert.deepEqual(failed.roots, roots);
  assert.ok(failed.failure !== null);
  // 자격으로 연결하다 진 것은 목록이 없으니 그대로 null.
  assert.equal(failConnect({ ...emptyConfluenceForm, roots: null }, "x").roots, null);
});

test("상태 알약의 색 — 연결 전은 담담히, 끊김은 노랑, 선 것은 초록", () => {
  assert.equal(confluenceTone(undefined, null), "plain");
  assert.equal(confluenceTone(alive({ expired: true }), null), "warn");
  assert.equal(confluenceTone(alive(), null), "ok");
  assert.equal(confluenceTone(undefined, linked("r").linked), "ok");
});
