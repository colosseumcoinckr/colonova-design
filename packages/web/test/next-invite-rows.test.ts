import assert from "node:assert/strict";
import { test } from "node:test";
import type { InviteRow, InviteRowTarget } from "@colonova-design/protocol";
import type { InviteImportState } from "../src/hooks/use-invite-import.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-labels.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import {
  applyingLine,
  inviteFailures,
  inviteLockLine,
  inviteOutcome,
  inviteReachWarning,
  inviteReadError,
  inviteRowsCopy,
  inviteTitle,
  inviteUntil,
  inviteUpdateChanges,
  tokenFailureText,
} from "../src/next/lib/invite-rows.ts";

const MEMBER: InviteRowTarget = {
  slug: "member",
  name: "회원 관리",
  repoUrl: "https://github.com/team/member.git",
  baseBranch: "main",
  reviewers: ["dev1"],
  commandsApproved: true,
};

const SETTLE: InviteRowTarget = {
  slug: "settle",
  name: "정산",
  repoUrl: "https://github.com/team/settle.git",
  baseBranch: "main",
};

/** 초대장의 프로젝트 값 — 짝과 대조되는 부분만 바꿔 쓴다. */
function inviteProject(overrides: Partial<InviteRow["project"]> = {}): InviteRow["project"] {
  return {
    name: "회원 관리 서비스",
    repoUrl: "https://github.com/team/member.git",
    baseBranch: "main",
    ...overrides,
  } as InviteRow["project"];
}

test("inviteRowsCopy: 새로 행은 칩 · 이름 · 안내 한 줄", () => {
  const { rows, nothingChanged } = inviteRowsCopy(
    [{ project: inviteProject({ repoUrl: "https://github.com/team/new.git" }), action: "add" }],
    L,
    [MEMBER, SETTLE],
  );
  assert.equal(nothingChanged, false);
  assert.equal(rows[0]?.chip, "새로");
  assert.equal(rows[0]?.name, "회원 관리 서비스");
  assert.equal(rows[0]?.detail, null);
  assert.equal(rows[0]?.sub, "처음 열 때 준비에 몇 분 걸려요");
});

test("inviteRowsCopy: 바뀜 행은 무엇이 바뀌는지까지 한 줄에", () => {
  const row = {
    project: inviteProject({ baseBranch: "develop" }),
    action: "update",
    slug: "member",
    currentName: "회원 관리",
  } as const;
  const { rows } = inviteRowsCopy([row], L, [MEMBER, SETTLE]);
  assert.equal(rows[0]?.chip, "바뀜");
  assert.equal(rows[0]?.name, "회원 관리");
  assert.equal(rows[0]?.detail, "기본 가지 main → develop · 받을 개발자 명단이 바뀌어요");
});

test("inviteRowsCopy: 바뀐 것이 없으면 그대로 행, 판 전체는 연결 코드만", () => {
  const rows: InviteRow[] = [
    {
      project: inviteProject({ reviewers: ["dev1"], approveCommands: true }),
      action: "keep",
      slug: "member",
      currentName: "회원 관리",
    },
    {
      project: {
        ...inviteProject({ repoUrl: "https://github.com/team/settle.git" }),
        name: "정산팀",
      },
      action: "keep",
      slug: "settle",
      currentName: "정산",
    },
  ];
  const copy = inviteRowsCopy(rows, L, [MEMBER, SETTLE]);
  assert.deepEqual(
    copy.rows.map((row) => [row.chip, row.name]),
    [
      ["그대로", "회원 관리"],
      ["그대로", "정산"],
    ],
  );
  assert.equal(copy.nothingChanged, true);
});

test("inviteRowsCopy: 이름은 사용자가 지은 것이 이긴다", () => {
  const { rows } = inviteRowsCopy(
    [
      {
        project: inviteProject(),
        action: "update",
        slug: "member",
        currentName: "내 회원 화면",
      },
    ],
    L,
    [MEMBER],
  );
  assert.equal(rows[0]?.name, "내 회원 화면");
});

test("inviteRowsCopy: 새로 → 바뀜 → 그대로 순서로 서고, 같은 종류 안에서는 초대장의 순서를 지킨다", () => {
  const keep = (name: string): InviteRow => ({
    action: "keep",
    project: inviteProject({ repoUrl: `https://github.com/team/${name}.git`, name }),
    slug: name,
    currentName: name,
  });
  const add = (name: string): InviteRow => ({
    action: "add",
    project: inviteProject({ repoUrl: `https://github.com/team/${name}.git`, name }),
  });
  const update = (name: string): InviteRow => ({
    action: "update",
    project: inviteProject({ repoUrl: `https://github.com/team/${name}.git`, name }),
    slug: name,
    currentName: name,
  });
  const { rows } = inviteRowsCopy(
    [keep("k1"), add("a1"), update("u1"), keep("k2"), add("a2"), update("u2")],
    L,
    [],
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ["a1", "a2", "u1", "u2", "k1", "k2"],
  );
});

test("inviteUpdateChanges: 명령 허용이 새로 켜지면 문장이 더해진다", () => {
  const row = {
    project: inviteProject({ approveCommands: true }),
    action: "update",
    slug: "settle",
    currentName: "정산",
  } as const;
  const changes = inviteUpdateChanges(row, L, { ...SETTLE, commandsApproved: false });
  assert.deepEqual(changes, ["명령 실행이 미리 허용됐어요"]);
});

test("inviteRowsCopy: 빈 초대장은 그대로도 아니다", () => {
  const copy = inviteRowsCopy([], L, []);
  assert.deepEqual(copy.rows, []);
  assert.equal(copy.nothingChanged, false);
});

// ── 판의 제목이 단계의 시제를 따른다(2026-10-06 겹판 손질)

const INVITE = { token: "t", projects: [] } as never;
const ADD: InviteRow = { action: "add", project: inviteProject({ name: "새 화면" }) };
const KEEP: InviteRow = {
  action: "keep",
  project: inviteProject({ repoUrl: "https://github.com/team/settle.git" }),
  slug: "settle",
  currentName: "정산",
};

const confirm: InviteImportState = {
  phase: "confirm",
  invite: INVITE,
  rows: [ADD, KEEP],
  firstRun: false,
};

function done(
  results: Array<{ row: InviteRow; ok: boolean }>,
  tokenError?: string,
): InviteImportState {
  return {
    phase: "done",
    invite: INVITE,
    firstRun: false,
    result: { results, reachWarnings: [], ...(tokenError ? { tokenError } : {}) },
  };
}

test("inviteTitle: 확인 단계는 질문이다 — 아직 아무것도 바뀌지 않았으니 가져왔다고 말하지 않는다", () => {
  const head = inviteTitle(confirm, L, { reach: 3, reconnected: false });
  assert.equal(head.title, "이 초대 파일을 가져올까요?");
  assert.equal(head.sub, "가져오면 연결 코드가 새 것으로 바뀌어요 · 프로젝트 3개에 이어져요");
  assert.equal(head.tone, "info");
  assert.ok(!head.title.includes("가져왔"));
});

test("inviteTitle: 만료된 연결을 다시 잇는 초대는 다시 이어진다고 말한다", () => {
  const head = inviteTitle(confirm, L, { reach: 2, reconnected: true });
  assert.equal(
    head.sub,
    "가져오면 만료된 연결이 새 코드로 다시 이어져요 · 프로젝트 2개에 이어져요",
  );
});

test("inviteTitle: 끝난 뒤의 성공만 과거형이다", () => {
  const head = inviteTitle(
    done([
      { row: ADD, ok: true },
      { row: KEEP, ok: true },
    ]),
    L,
    { reach: 3, reconnected: false },
  );
  assert.equal(head.title, "초대 파일을 가져왔어요");
  assert.equal(head.sub, "연결 코드를 새 것으로 바꿨어요 · 프로젝트 3개에 이어져요");
  assert.equal(head.tone, "ok");
  const again = inviteTitle(done([{ row: KEEP, ok: true }]), L, { reach: 1, reconnected: true });
  assert.equal(again.sub, "만료됐던 연결이 새 코드로 다시 이어졌어요 · 프로젝트 1개에 이어져요");
});

test("inviteTitle: 일부만 실패하면 일부만 가져왔다고, 모두 실패하면 못 가져왔다고 말한다", () => {
  const partial = inviteTitle(
    done([
      { row: ADD, ok: false },
      { row: KEEP, ok: true },
    ]),
    L,
    { reach: 1, reconnected: false },
  );
  assert.equal(partial.title, "일부만 가져왔어요");
  assert.equal(partial.sub, "프로젝트 2개 중 1개를 가져왔어요");
  assert.equal(partial.tone, "warn");
  const none = inviteTitle(done([{ row: ADD, ok: false }]), L, { reach: 0, reconnected: false });
  assert.equal(none.title, "가져오지 못했어요");
  assert.equal(none.tone, "bad");
});

test("inviteTitle: 연결 코드가 거절되면 연결하지 못했다고 말한다 — 가져왔다고 하지 않는다", () => {
  const head = inviteTitle(done([], "연결 코드가 없습니다"), L, { reach: 1, reconnected: false });
  assert.equal(head.title, "연결하지 못했어요");
  assert.equal(head.tone, "bad");
  assert.ok(!head.title.includes("가져왔"));
});

test("inviteTitle: 읽는 중 · 오류 · 적용 중의 제목", () => {
  const ctx = { reach: 1, reconnected: false };
  assert.equal(inviteTitle({ phase: "reading" }, L, ctx).title, "초대 파일을 여는 중이에요");
  assert.equal(
    inviteTitle({ phase: "error", error: "x", firstRun: false }, L, ctx).title,
    "초대 파일을 열지 못했어요",
  );
  const applying = inviteTitle(
    { phase: "applying", invite: INVITE, rows: [ADD], firstRun: false, done: 0 },
    L,
    ctx,
  );
  assert.equal(applying.title, "가져오는 중이에요");
  // 닫을 수 없는 이유가 머리에 선다.
  assert.equal(applying.sub, "끝날 때까지 닫을 수 없어요");
});

test("inviteTitle: 어느 단계의 제목에도 개발 어휘가 없다", () => {
  const states: InviteImportState[] = [
    { phase: "reading" },
    confirm,
    done([{ row: ADD, ok: false }]),
    done([], "x"),
    done([{ row: ADD, ok: true }]),
  ];
  for (const state of states) {
    const head = inviteTitle(state, L, { reach: 1, reconnected: false });
    for (const word of ["턴", "경로", "git", "데몬", "커밋", "브랜치", "PR", "레포"]) {
      assert.ok(!head.title.includes(word), `${head.title} — ${word}`);
      assert.ok(!(head.sub ?? "").includes(word), `${head.sub} — ${word}`);
    }
  }
});

test("inviteOutcome: 코드 거절 · 모두 실패 · 일부 실패 · 모두 성공", () => {
  assert.equal(inviteOutcome({ tokenError: "x", results: [] }), "token");
  assert.equal(inviteOutcome({ results: [{ ok: false }, { ok: false }] }), "failed");
  assert.equal(inviteOutcome({ results: [{ ok: true }, { ok: false }] }), "partial");
  assert.equal(inviteOutcome({ results: [{ ok: true }, { ok: true }] }), "ok");
  // 행이 없어도 코드가 받아들여졌으면 성공이다(연결 코드만 새로 받은 초대).
  assert.equal(inviteOutcome({ results: [] }), "ok");
});

test("applyingLine: 지금 하는 행의 이름을 말하고, 끝에 닿으면 일반 문장이다", () => {
  const rows: InviteRow[] = [ADD, KEEP];
  assert.equal(applyingLine(rows, 0, L), "‘새 화면’ 연결하는 중…");
  // 바뀜 · 그대로는 사용자가 지은 이름이 이긴다.
  assert.equal(applyingLine(rows, 1, L), "‘정산’ 연결하는 중…");
  assert.equal(applyingLine(rows, 2, L), "2개 중 2개 연결됨…");
});

test("inviteUntil: 만료 예정이 앞날이면 월 · 일로 말한다 — 모르거나 이미 지난 날짜는 말하지 않는다", () => {
  const now = new Date(2026, 9, 6, 12).getTime();
  const future = new Date(2026, 10, 3, 9).toISOString();
  assert.equal(inviteUntil(future, now, L), "연결은 11월 3일까지예요");
  assert.equal(inviteUntil(null, now, L), null);
  assert.equal(inviteUntil(undefined, now, L), null);
  assert.equal(inviteUntil("아무 말", now, L), null);
  // 막 바꾼 코드의 날짜가 아직 상태에 안 실렸을 때의 옛(지난) 값은 거짓이다.
  assert.equal(inviteUntil(new Date(2026, 9, 1).toISOString(), now, L), null);
});

test("inviteFailures: 실패한 행만, 이름과 접어 둘 날것을 돌려준다", () => {
  const failures = inviteFailures([
    { row: ADD, ok: true },
    { row: KEEP, ok: false, error: "이미 있는 프로젝트입니다" },
    {
      row: {
        ...ADD,
        project: inviteProject({ repoUrl: "https://github.com/team/x.git", name: "엑스" }),
      },
      ok: false,
    },
  ]);
  assert.deepEqual(
    failures.map((failure) => [failure.name, failure.detail]),
    [
      ["정산", "이미 있는 프로젝트입니다"],
      ["엑스", null],
    ],
  );
});

test("tokenFailureText: 연결이 끊겨 있으면 끊겼다고, 아니면 코드를 못 받았다고 말한다", () => {
  assert.equal(tokenFailureText(L.chat.offline, L), L.invite.tokenOffline);
  assert.equal(tokenFailureText(null, L), L.invite.tokenRefused);
  // 어느 쪽도 프로젝트가 안 바뀌었다고 말한다.
  assert.ok(L.invite.tokenOffline.includes("하나도 바뀌지 않았어요"));
  assert.ok(L.invite.tokenRefused.includes("하나도 바뀌지 않았어요"));
});

test("inviteLockLine: 열려 있으면 잠그지 않고, 끊겼으면 이유 뒤에 약속을 붙인다", () => {
  assert.equal(inviteLockLine(null, L), null);
  assert.equal(inviteLockLine(L.chat.offline, L), `${L.chat.offline} — ${L.invite.lockNote}`);
});

test("inviteReadError: 읽기 오류는 모두 해요체 한 줄이고 날것이 섞이지 않는다", () => {
  const kinds = [
    "not-invite",
    "sealed",
    "unreadable",
    "version",
    "token",
    "content",
    "file",
  ] as const;
  const sentences = kinds.map((kind) => inviteReadError(kind, L));
  assert.equal(new Set(sentences).size, kinds.length);
  for (const sentence of sentences) {
    assert.ok(sentence.endsWith("."), sentence);
    // 옛 말투(~습니다)와 개발 어휘가 없다.
    assert.ok(!sentence.includes("습니다"), sentence);
    assert.ok(!sentence.includes("레포"), sentence);
  }
});

test("inviteReachWarning: 새 연결 코드로 제출할 수 없는 프로젝트를 개발자에게 알리라고 말한다", () => {
  const line = inviteReachWarning("회원 관리", L);
  assert.equal(
    line,
    "‘회원 관리’ 프로젝트는 새 연결 코드로 제출할 수 없어요 — 개발자에게 알려 주세요.",
  );
  assert.ok(!line.includes("넘길"));
});
