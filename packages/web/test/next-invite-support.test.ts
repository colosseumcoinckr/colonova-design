import assert from "node:assert/strict";
import { test } from "node:test";
import type { InviteRow, NormalizedInvite } from "@colonova-design/protocol";
import type { Daemon } from "../src/lib/daemon-client.ts";
import { applyInvite } from "../src/lib/invite-import.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-problem.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import { supportFor } from "../src/next/lib/support.ts";

/**
 * 개발팀 창구(2026-11-12 설계 결정 ㉱ · 작업 WE) — 판정 순수 함수 supportFor 와
 * 가져오기(applyInvite)가 창구를 저장하고 초대장에 칸이 없을 때 이미 있는 값을
 * 지우지 않는 것을 본다.
 */

const PROJECT: InviteRow["project"] = {
  repoUrl: "https://github.com/org/a.git",
  name: "a",
  baseBranch: "main",
  approveCommands: true,
};

function inviteOf(support?: NormalizedInvite["support"]): NormalizedInvite {
  return {
    token: "t",
    ...(support ? { support } : {}),
    projects: [PROJECT],
  };
}

/** applyInvite 가 부르는 선로의 최소 모양 — 창구 저장만 녹음한다. */
function daemonScene() {
  const calls: Array<{ method: string; arg: unknown }> = [];
  const daemon = {
    projects: [],
    api: {
      githubTokenSet: async () => ({ status: "pass" }),
      machineAuthorSet: async (arg: unknown) => {
        calls.push({ method: "machineAuthorSet", arg });
        return { ok: true };
      },
      machineSupportSet: async (arg: unknown) => {
        calls.push({ method: "machineSupportSet", arg });
        return { ok: true };
      },
      projectCreate: async () => ({}),
    },
  } as unknown as Daemon;
  return { daemon, calls };
}

const ADD: InviteRow[] = [{ project: PROJECT, action: "add" }];

test("supportFor — 칸이 없거나 이름 · 대화방 · 주소가 모두 비면 보일 것이 없다", () => {
  assert.equal(supportFor(), null);
  assert.equal(supportFor(null), null);
  assert.equal(supportFor({}), null);
  // https 가 아니거나 300자를 넘는 주소는 없는 것으로 — 여는 쪽도 거른다(검토 WF-4).
  assert.equal(supportFor({ url: "javascript:alert(1)" }), null);
  assert.equal(supportFor({ url: "http://chat.example/r/1" }), null);
  assert.equal(supportFor({ url: `https://${"u".repeat(293)}` }), null);
});

test("supportFor — 주소만 적힌 창구도 선다(kind: url)", () => {
  // 이름 · 대화방 없이 주소만 있으면 `대화방 열기` 하나가 설 변형이다(검토 WF-3).
  assert.deepEqual(supportFor({ url: "https://chat.example/r/1" }), {
    kind: "url",
    url: "https://chat.example/r/1",
  });
});

test("supportFor — 이름만 · 대화방만 · 둘 다, 그리고 초대장이 기계 설정보다 먼저다", () => {
  assert.deepEqual(supportFor({ name: "김개발" }), { kind: "name", name: "김개발" });
  assert.deepEqual(supportFor({ room: "#dev" }), { kind: "room", room: "#dev" });
  const both = supportFor(
    { name: "김개발", room: "#dev", url: "https://chat.example/r/1" },
    { name: "박개발" },
  );
  assert.deepEqual(both, {
    kind: "both",
    name: "김개발",
    room: "#dev",
    url: "https://chat.example/r/1",
  });
  // 놓은 초대 파일이 있으면 그 칸이 선다 — 방금 놓은 파일의 창구가 저장을 기다리지 않는다.
  const stored = supportFor(undefined, { name: "박개발" });
  assert.deepEqual(stored, { kind: "name", name: "박개발" });
});

test("applyInvite — 초대장에 창구가 있으면 machine.support.set 으로 저장한다", async () => {
  const { daemon, calls } = daemonScene();
  const result = await applyInvite(
    daemon,
    inviteOf({ name: "김개발", room: "#dev", url: "https://chat.example/r/1" }),
    ADD,
    { firstRun: false },
  );
  assert.equal(result.tokenError, undefined);
  const saved = calls.filter((call) => call.method === "machineSupportSet");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0]?.arg, {
    name: "김개발",
    room: "#dev",
    url: "https://chat.example/r/1",
  });
});

test("applyInvite — 초대장에 칸이 없으면 저장 선로를 부르지 않는다(있는 값을 지우지 않는다)", async () => {
  const { daemon, calls } = daemonScene();
  const result = await applyInvite(daemon, inviteOf(), ADD, { firstRun: false });
  assert.equal(result.tokenError, undefined);
  assert.equal(
    calls.some((call) => call.method === "machineSupportSet"),
    false,
    "옛 초대 파일을 다시 열어도 이미 저장된 창구가 사라지지 않는다",
  );
});

test("applyInvite — 창구 저장이 실패해도 가져오기는 계속되고, 실패 표시가 실린다", async () => {
  const { daemon } = daemonScene();
  daemon.api.machineSupportSet = async () => {
    throw new Error("선로 끊김");
  };
  const result = await applyInvite(daemon, inviteOf({ name: "김개발" }), ADD, { firstRun: false });
  assert.equal(result.tokenError, undefined);
  assert.equal(result.results[0]?.ok, true);
  // 화면은 이 표시로 «저장하지 못했어요» 한 줄을 세운다(검토 WF-7).
  assert.equal(result.supportFailed, true);
});

test("L.support — 창구 문장은 labels 에만 있고 네 자리가 같은 조각을 쓴다", () => {
  assert.equal(L.support.contact({ name: "김개발", room: "#dev" }), "김개발 · #dev");
  assert.equal(L.support.contact({ name: "김개발" }), "김개발");
  assert.equal(L.support.contact({ room: "#dev" }), "#dev");
  assert.equal(L.support.devLineBoth("김개발", "#dev"), "막히면 김개발님에게 물어요 — #dev");
  assert.equal(L.support.devLineName("김개발"), "막히면 김개발님에게 물어요.");
  assert.equal(L.support.devLineRoom("#dev"), "막히면 #dev에서 물어요.");
  // 주소만 적힌 창구의 문장(검토 WF-3) — 준비 화면 셋째 줄과 설정 → 연결 의 값.
  assert.equal(L.support.devLineUrl, "막히면 개발팀 대화방에서 물어요.");
  assert.equal(L.support.settingsUrl, "개발팀 대화방");
  assert.equal(L.support.problemRow("김개발 · #dev"), "물어볼 곳 — 김개발 · #dev");
  assert.equal(L.support.openRoom, "대화방 열기");
  assert.equal(
    L.support.saveFailed,
    "막히면 물어볼 곳은 저장하지 못했어요 — 초대 파일을 다시 열면 돼요",
  );
});
