/**
 * 대화록 견본 — 데몬 없이 `Thread` 를 눈으로 보는 페이지(PLAN-THREAD 단계 1).
 * 앱과 같은 CSS(테마 · styles.css · next.css→chat.css)와 같은 칸 모양
 * (.nx → .nx-chat → .nx-transcript)으로 올린다. `vite build` 의 입력은
 * index.html 뿐이라 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   pnpm exec vite --port 29181 --strictPort
 *   → http://127.0.0.1:29181/dev/thread-fixture.html
 */
import { markTurn } from "@colonova-design/protocol";
import { type ComponentProps, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Block, Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { ResultScreen } from "../src/next/chat/ResultScreens";
import { RunLine } from "../src/next/chat/RunLine";
import { Thread } from "../src/next/chat/Thread";
import { L } from "../src/next/labels";
import { ComparisonDialog, openComparison } from "../src/next/preview/ComparisonDialog";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();

/**
 * 주소 끝의 `?theme=dark` 처럼 테마를, `?w=387` 로 대화 칸의 폭을 바꾼다 — 좁은 칸(320~640)
 * 에서 말풍선 · 핀 · 고친 화면 카드가 무너지지 않는지 눈으로 본다.
 */
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const COLUMN = Number(query.get("w")) || 420;
/** `?fork=0` 이면 갈래를 못 내는 AI — 정산 줄 `···` 메뉴의 `여기서 새 대화` 가 이유와 함께 흐려진다. */
const CAN_BRANCH = query.get("fork") !== "0";
/** 눌린 손을 읽는 시험이 `window.__calls` 를 본다 — 정산 줄 메뉴의 갈래 · 기록 · 토스트. */
const calls: string[] = [];
Object.assign(window, { __calls: calls });

const PREVIEW_URL = "http://127.0.0.1:5274";

/** 견본 사진 — 데몬 없이 `고친 화면` 카드가 사진을 그리도록 캔버스로 화면 하나를 그린다. */
function drawShot(title: string, width = 960, height = 600, before = false): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, 68);
  ctx.fillStyle = "#1f2430";
  ctx.font = "600 24px sans-serif";
  ctx.fillText(title, 36, 42);
  // 수정 전에는 오른쪽 위의 단추가 없고 둘째 줄도 강조되지 않았다 — 전 · 후를 넘겨 볼 때 달라진 곳이 눈에 띄게.
  if (!before) {
    ctx.fillStyle = "#2f6fed";
    ctx.fillRect(width - 150, 18, 110, 34);
  }
  for (let row = 0; row < 6; row += 1) {
    const y = 104 + row * 78;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(36, y, width - 72, 62);
    ctx.fillStyle = row === 1 && !before ? "#ffe9b8" : "#e4e7ee";
    ctx.fillRect(56, y + 18, 40 + ((row * 37) % 90), 12);
    ctx.fillStyle = "#c9ced9";
    ctx.fillRect(width - 260, y + 22, 150, 10);
  }
  return canvas;
}

const SHOTS: Record<string, string> = {
  "member/list": drawShot("회원 목록").toDataURL("image/png").split(",")[1] ?? "",
  "member/1": drawShot("김기획 회원 상세").toDataURL("image/png").split(",")[1] ?? "",
};
const BEFORE_SHOTS: Record<string, string> = {
  "member/list": drawShot("회원 목록", 960, 600, true).toDataURL("image/png").split(",")[1] ?? "",
};
const THUMBS = [
  drawShot("서비스", 120, 80).toDataURL("image/jpeg", 0.7).split(",")[1] ?? "",
  drawShot("연락처", 120, 80).toDataURL("image/jpeg", 0.7).split(",")[1] ?? "",
];

/**
 * 견본의 사진 읽기 — 길에 따라 사진이 있는 · 없는 · 읽다 실패한 · 아직 읽는 중인 네 모양이
 * 한 줄에 서도록 한다.
 */
const loadComparison: ComponentProps<typeof Thread>["loadComparison"] = async ({
  route,
  requestId,
}) => {
  // 카드가 넘기는 길은 `/member/empty` 처럼 앞 슬래시가 붙는다 — 견본의 열쇠는 뗀 모양이다.
  const key = route.replace(/^\//, "");
  const diffShot = diffShots()[key];
  if (diffShot) {
    return {
      requestId: requestId ?? "",
      sessionId: "s",
      sha: "x",
      route,
      title: route,
      viewport: "desktop",
      before: diffShot.before ? { at: "", ...diffShot.before } : null,
      after: { at: "", ...diffShot.after },
    };
  }
  if (key === "member/empty") return null;
  if (key === "member/fail") throw new Error("fixture");
  if (key === "member/slow") return new Promise(() => {});
  return {
    requestId: requestId ?? "",
    sessionId: "s",
    sha: "x",
    route,
    title: route,
    viewport: "desktop",
    // 새 화면(`member/1`)은 수정 전 사진이 없다 — 토글 없이 `수정 후 모습` 이름표만 서는 모양.
    before: BEFORE_SHOTS[key] ? { at: "", mediaType: "image/png", data: BEFORE_SHOTS[key] } : null,
    after: { at: "", mediaType: "image/png", data: SHOTS[key] ?? SHOTS["member/list"] ?? "" },
  };
};

const user = (id: string, text: string, thumbs?: string[]): Block => ({
  type: "user",
  id,
  text,
  images: 0,
  ...(thumbs ? { thumbs } : {}),
});
/** 화면을 실제로 고친 요청 — `고친 화면` 카드는 요청 번호와 바뀐 화면이 있어야 선다. */
const withResult = (
  id: string,
  text: string,
  requestId: string,
  changedScreens: Array<{ route: string; title: string }>,
  /** 턴 끝의 자동 확인이 문제 없이 지나갔다 — 카드가 한 줄로 말한다(없으면 말하지 않는다). */
  checked?: { screens: number; phone: boolean },
): Block => ({
  type: "user",
  id,
  text,
  images: 0,
  requestId,
  changedScreens,
  ...(checked ? { checked } : {}),
});
const step = (id: string, text: string): Block => ({
  type: "text",
  id,
  text,
  agentId: null,
  streaming: false,
});
const answer = step; // 답도 같은 text 블록 — 묶음의 마지막 말이 답이 된다.
const turn = (id: string, durationMs: number): Block => ({
  type: "turn",
  id,
  subtype: "success",
  isError: false,
  costUsd: null,
  durationMs,
  resultText: null,
});

/** 프로토콜의 표식으로 만든 핀 묶음 — 저장된 옛 이름표 `div` 재현. */
const pinsTurn = markTurn(
  {
    kind: "comments",
    screen: "김기획 회원 상세",
    note: "찍은 곳을 눈에 잘 들게 고쳐 줘.",
    items: [{ id: "pin-1", label: "div", comment: "이 부분이 눈에 잘 안 들어와요" }],
  },
  [
    "찍은 곳을 눈에 잘 들게 고쳐 줘.",
    "",
    "아래는 사용자가 가리킨 자리입니다 — 사용자의 말대로 해 주세요.",
    "",
    '1. div — "이 부분이 눈에 잘 안 들어와요"',
    "   위치: body > div > main > div:nth-of-type(2)",
  ].join("\n"),
);

/** 핀 세 개 — 서비스 이름처럼 긴 이름표, 긴 메모, 메모 없는 핀, 사진(앞의 둘)이 함께. */
const pinsMany = markTurn(
  {
    kind: "comments",
    screen: "회원 목록",
    note: "표 머리를 한눈에 읽히게 해 줘.",
    items: [
      {
        id: "pin-a",
        label: "서비스를 선택하세요",
        comment: "[구현 검증 C] 수정하지 마세요.",
        shot: true,
      },
      {
        id: "pin-b",
        label: "회원 연락처 열 머리",
        comment: "글자가 너무 작고 흐려서 안 읽혀요. 조금만 키우고 진하게 해 주세요.",
        shot: true,
      },
      { id: "pin-c", label: "찍은 곳", comment: "" },
    ],
  },
  [
    "표 머리를 한눈에 읽히게 해 줘.",
    "",
    "아래는 사용자가 가리킨 자리입니다 — 사용자의 말대로 해 주세요.",
  ].join("\n"),
);

const blocks: Block[] = [
  // ① 첫 턴 — 맨 위 사람 말은 위 여백이 없고, 단추는 말풍선 옆자리에 매달린다.
  user("u1", "회원을 누르면 상세 화면이 나오게 해 줘. 연락처와 가입일이 보였으면 좋겠어."),
  step("t1a", "회원 목록 화면을 찾았어요"),
  step("t1b", "행을 누르면 상세로 가는 동작을 붙였어요"),
  answer(
    "t1c",
    [
      "**회원 목록** 화면의 행을 누르면 상세 화면으로 넘어가도록 바꿨어요.",
      "",
      "- 상세 화면에는 연락처와 가입일이 함께 보여요",
      "- 목록으로 돌아가는 길도 위에 있어요",
      "",
      `[회원 목록](${PREVIEW_URL}/member/list)`,
    ].join("\n"),
  ),
  turn("e1", 38000),

  // ② 둘째 턴 — 턴과 턴 사이가 가장 넓다.
  user("u2", "상세 화면 위쪽에 회원을 한 줄로 소개하는 문장을 넣어 줘."),
  step("t2a", "상세 화면의 머리를 살펴봤어요"),
  step("t2b", "회원 이름과 한 줄 소개 자리를 마련했어요"),
  step("t2c", "목 데이터에 소개 문장을 담았어요"),
  step("t2d", "글자 크기와 자간을 주변과 맞췄어요"),
  step("t2e", "화면을 다시 열어 확인했어요"),
  answer(
    "t2f",
    [
      "상세 화면 위쪽에 회원을 한 줄로 소개하는 문장을 넣었어요.",
      "이름 오른쪽에 역할이 작게 따라붙고, 아래 한 줄이 소개예요.",
      "",
      `[김기획 회원 상세](${PREVIEW_URL}/member/1)`,
    ].join("\n"),
  ),
  turn("e2", 41000),

  // ③ 핀 묶음 — 단추가 서지 않는 말도 같은 턴 간격이어야 한다.
  user("u3", pinsTurn),
  step("t3a", "찍은 자리의 주변을 살펴봤어요"),
  step("t3b", "배경과 글자의 대비를 높였어요"),
  step("t3c", "화면을 다시 열어 확인했어요"),
  answer(
    "t3d",
    [
      "찍어 주신 자리의 대비를 높여 문장이 눈에 잘 들어오게 했어요.",
      "",
      `[김기획 회원 상세](${PREVIEW_URL}/member/1)`,
    ].join("\n"),
  ),
  turn("e3", 33000),

  // ④ 짧은 말 — 단추가 말풍선 옆자리에서 말풍선을 가리지 않는지 본다.
  user("u4", "좋아요, 이대로 두자."),
  answer("t4a", "알겠어요. 지금 모습 그대로 둘게요."),
  turn("e4", 4000),

  // ⑤ 고친 화면 한 곳 — 사진 · 제목 · 이어 하기의 모양을 본다.
  withResult(
    "u5",
    "회원 목록 맨 위에 검색창을 넣어 줘.",
    "req-5",
    [{ route: "member/list", title: "회원 목록" }],
    { screens: 1, phone: true },
  ),
  step("t5a", "회원 목록 화면의 머리를 살펴봤어요"),
  step("t5b", "검색창을 머리 오른쪽에 넣었어요"),
  answer(
    "t5c",
    [
      "회원 목록 맨 위에 **검색창**을 넣었어요. 이름이나 연락처를 치면 목록이 바로 좁혀져요.",
      "",
      `[회원 목록](${PREVIEW_URL}/member/list)`,
    ].join("\n"),
  ),
  turn("e5", 52000),

  // ⑤' 자동 고침이 끼인 요청 — 카드와 원래 요청 사이에 고침 카드가 있어 요청과 설명을 다시 적는다
  // (끼지 않은 ⑤ 의 카드에는 그 줄이 없다 — 카드 바로 위가 그 요청의 답이다, 2026-10-06).
  withResult("u5r", "회원 목록의 표 아래에 쪽 번호를 붙여 줘.", "req-5r", [
    { route: "member/list", title: "회원 목록" },
  ]),
  answer("t5ra", "표 아래에 쪽 번호를 붙였어요."),
  turn("e5ra", 31000),
  {
    type: "user",
    id: "u5rg",
    text: markTurn(
      { kind: "gate", step: "화면 확인" },
      "회원 목록을 다시 열어 보니 쪽 번호를 계산하다 오류가 났어요. 고쳐 주세요.",
    ),
    images: 0,
  },
  answer("t5rb", "쪽 번호 계산에서 나던 오류를 고쳤어요. 이제 화면이 잘 열려요."),
  turn("e5rb", 18000),

  // ⑥ 핀 세 개 — 긴 이름표 · 긴 메모 · 사진이 있는 핀과 없는 핀이 한 말풍선에.
  user("u6", pinsMany, THUMBS),
  answer(
    "t6a",
    "표 머리의 글자를 키우고 진하게 바꿨어요. 표시한 서비스 선택 줄은 건드리지 않았어요.",
  ),
  turn("e6", 27000),

  // ⑦ 고친 화면 네 곳 — 사진이 있는 · 없는 · 읽다 실패한 · 아직 읽는 중인 모양이 함께.
  withResult(
    "u7",
    "회원 상세와 결제 내역, 환불 내역의 머리 문구를 같은 말투로 맞춰 줘.",
    "req-7",
    [
      { route: "member/1", title: "회원 상세" },
      { route: "member/empty", title: "결제 내역" },
      { route: "member/fail", title: "환불 내역" },
      { route: "member/slow", title: "포인트 내역" },
    ],
    // 네 화면 중 둘만 열렸고 휴대폰 폭은 다 보지 못했다 — 본 것만 말하는 모양.
    { screens: 2, phone: false },
  ),
  answer(
    "t7a",
    [
      "네 화면의 머리 문구를 **~해요** 말투로 맞췄어요.",
      "",
      "| 화면 | 바뀐 곳 |",
      "| --- | --- |",
      "| 회원 상세 | 머리 문구와 버튼 이름 |",
      "| 결제 내역 | 머리 문구 |",
      "| 환불 내역 | 머리 문구와 빈 화면 안내 |",
      "| 포인트 내역 | 머리 문구 |",
      "",
      "화면마다 글자 크기는 그대로 두었어요.",
    ].join("\n"),
  ),
  turn("e7", 74000),

  // ⑧ 실패 — 실패 카드와 이어지는 말의 간격.
  user("u8", "결제 내역에 카드 번호가 보이면 안 되니까 가려 줘."),
  {
    type: "turn",
    id: "e8",
    subtype: "error",
    isError: true,
    costUsd: null,
    durationMs: 1000,
    resultText: null,
  },
];

/**
 * `?scene=repro` — 베타 테스트에서 찍힌 대화 그대로(말 둘 + 핀 하나, 핀 이름표는 저장된 옛 모양
 * `서비스를선택하세요`). 좁은 칸(`?w=387`)에서 전후를 겹쳐 본다.
 */
const repro: Block[] = [
  user("r1", "[구현 검증 A] 파일·화면·설정 변경과 제출 없이 정확히 “구현 응답 A”만 답해주세요."),
  answer("r1a", "구현 응답 A"),
  {
    type: "turn",
    id: "re1",
    subtype: "success",
    isError: false,
    costUsd: null,
    durationMs: null,
    resultText: null,
  },
  user("r2", "[구현 검증 B] 파일·화면·설정 변경과 제출 없이 정확히 “구현 응답 B”만 답해주세요."),
  answer("r2a", "구현 응답 B"),
  {
    type: "turn",
    id: "re2",
    subtype: "success",
    isError: false,
    costUsd: null,
    durationMs: null,
    resultText: null,
  },
  user(
    "r3",
    markTurn(
      {
        kind: "comments",
        screen: "서비스 선택",
        note: "[구현 검증 C] 선택한 곳은 변경하지 말고 정확히 “구현 응답 C”만 답해주세요. 파일·화면·설정 변경과 제출은 하지 마세요.",
        items: [
          { id: "pin-r", label: "서비스를선택하세요", comment: "[구현 검증 C] 수정하지 마세요." },
        ],
      },
      "[구현 검증 C] 선택한 곳은 변경하지 말고 정확히 “구현 응답 C”만 답해주세요.",
    ),
  ),
  answer("r3a", "구현 응답 C"),
  {
    type: "turn",
    id: "re3",
    subtype: "success",
    isError: false,
    costUsd: null,
    durationMs: null,
    resultText: null,
  },
];

/**
 * `?scene=account` — 계정류 실패(2026-10-07 베타 준비 분석): 데몬이 `failure: "account"` 를 달아 사다리 없이 곧바로 끝낸
 * 실패. 카드가 계정의 말로 서고 `다른 계정으로 로그인` 이 `다시 시도` 곁에 선다(마지막 실패에만). 앞선 일시 실패는
 * 평소의 짧은 말이다. `?scene=account-old` 는 계정류 실패 뒤에 다른 실패가 이어진 대화 — 옛 계정류 카드에는 단추가 없고
 * 마지막 실패만 `다시 시도` 를 든다(`다른 계정으로 로그인` 도 마지막 카드에만).
 */
const accountFail: Block[] = [
  user("a1", "회원 목록에 이름으로 찾는 검색창을 넣어 줘."),
  {
    type: "turn",
    id: "a1e",
    subtype: "error",
    isError: true,
    costUsd: null,
    durationMs: 1000,
    resultText: "API Error: 529 Overloaded",
  },
  user("a2", "회원 목록에 이름으로 찾는 검색창을 넣어 줘."),
  {
    type: "turn",
    id: "a2e",
    subtype: "error",
    isError: true,
    costUsd: null,
    durationMs: 800,
    resultText: "Credit balance is too low",
    failure: "account",
  },
];
const accountOld: Block[] = [
  ...accountFail.slice(2),
  user("a3", "다시 해 줘."),
  {
    type: "turn",
    id: "a3e",
    subtype: "error",
    isError: true,
    costUsd: null,
    durationMs: 900,
    resultText: "API Error: 529 Overloaded",
  },
];

/** `?scene=queue` — 줄에 선 말(`편집` · `지금 보내기`)이 새 말풍선 모양에서도 그대로인지 본다. */
const queued: Block[] = [
  user("q1", "회원 목록에 검색창을 넣어 줘."),
  { ...answer("q1a", "검색창을 넣는 중이에요…"), streaming: true } as Block,
];
const queueItems = [
  { id: "qi1", text: "검색 결과가 없을 때 안내 문구도 넣어 줘.", images: 0, files: 0 },
  { id: "qi2", text: "", images: 1, files: 1 },
];

/**
 * `?scene=receipt` — 제출 영수증. 첫 제출에는 「이제부터」 세 줄(코멘트가 오는 길 · 원본이 그대로라는 말 · 소식이 오는 길
 * `개발자 소식은 앱이 켜져 있으면…`)이 서고, 같은 요청에 더한 제출에는 그 줄들이 없다(2026-10-06 · 2026-10-07).
 * 보낸 화면은 제출을 누를 때 확인 창이 보인 목록이다. 변형 셋:
 *   `?scene=receipt-none` 받을 개발자가 정해지지 않은 요청(호박색 줄 + `링크 복사`),
 *   `?scene=receipt-chat` 대화로 낸 제출(확인 창이 없어 보낸 화면을 모른다 — 그 줄이 없다),
 *   `?scene=receipt-old` 엿새 전의 영수증(시각이 날짜까지 말하고, 지금의 요청이 아니라 받을 개발자는 사건이 적은 한 명뿐).
 */
const done = (id: string): Block => ({
  type: "turn",
  id,
  subtype: "success",
  isError: false,
  costUsd: null,
  durationMs: null,
  resultText: null,
});
const receipts: Block[] = [
  user("rc1", "회원 목록에 검색창을 넣어 줘."),
  answer("rc1a", "검색창을 넣었어요."),
  done("rce1"),
  {
    type: "milestone",
    id: "rcm1",
    subtype: "handed",
    at: "2026-10-06T10:00:00+09:00",
    pr: 12,
    reviewer: "kim",
    note: "급하지 않아요",
    sent: { screens: 5, titles: ["회원 목록", "회원 상세", "결제 내역"] },
  },
  user("rc2", "빈 결과 안내도 넣어 줘."),
  answer("rc2a", "안내 문구를 넣었어요."),
  done("rce2"),
  {
    type: "milestone",
    id: "rcm2",
    subtype: "handed",
    at: "2026-10-06T11:00:00+09:00",
    pr: 12,
    reviewer: "kim",
    sent: { screens: 1, titles: ["회원 목록"] },
  },
];

/** 영수증 변형 하나 — 말 하나, 답 하나, 영수증 하나. */
const oneReceipt = (
  id: string,
  milestone: Partial<Extract<Block, { type: "milestone" }>>,
): Block[] => [
  user(`${id}u`, "회원 목록에 검색창을 넣어 줘."),
  answer(`${id}a`, "검색창을 넣었어요."),
  done(`${id}e`),
  {
    type: "milestone",
    id: `${id}m`,
    subtype: "handed",
    at: "2026-10-06T10:00:00+09:00",
    pr: 12,
    ...milestone,
  },
];
const receiptNone = oneReceipt("rn", {
  note: "급하지 않아요",
  sent: { screens: 2, titles: ["회원 목록", "회원 상세"] },
});
const receiptChat = oneReceipt("rt", { reviewer: "kim" });
const receiptOld = oneReceipt("ro", {
  at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  reviewer: "kim",
  sent: { screens: 3, titles: ["회원 목록", "회원 상세", "결제 내역"] },
});

/** 지금의 요청 — 영수증 변형이 `same` 으로 읽는다(받을 개발자 · 링크). */
const openRequest = (reviewers: string[]) => ({
  number: 12,
  url: "https://example.com/pull/12",
  title: "feat(members): 회원 목록에 검색창 추가 (작성: 정인권)",
  state: "open" as const,
  branch: "colonova-design/20261006-1",
  reviewers,
});

/**
 * `?scene=undo` — 마지막 결과에만 `방금 한 것 되돌리기` 가 선다(2026-10-06). 앞선 결과의 카드에는 없다 — 작업 기록의
 * 되돌리기는 「그 시점 이후 전부」 라서 옛 카드에 달면 이름이 거짓이 된다.
 */
const undoScene: Block[] = [
  withResult("uu1", "회원 목록 맨 위에 검색창을 넣어 줘.", "req-prev", [
    { route: "member/list", title: "회원 목록" },
  ]),
  answer("uu1a", "검색창을 넣었어요."),
  turn("uue1", 31000),
  withResult("uu2", "검색창 옆에 초기화 단추도 달아 줘.", "req-u", [
    { route: "member/list", title: "회원 목록" },
  ]),
  answer("uu2a", "초기화 단추를 달았어요."),
  turn("uue2", 22000),
];

/**
 * `?scene=working` — 맨 아래 `작업 중` 줄의 네 모양(2026-10-06): 묶음을 모를 때 · 살펴보는 중 · 고치는 중 + 할 일 진행 ·
 * 검사 중 + 1분이 넘은 시계. 좁은 칸(`?w=320`)에서 줄이 아래로 감겨도 잘리지 않는지 본다.
 */
const workingThread: Block[] = [
  { type: "user", id: "wk1", text: "회원 목록 맨 위에 검색창을 넣어 줘.", images: 0 },
];

function WorkingLines() {
  const since = useRef(Date.now() - 42_000).current;
  const longer = useRef(Date.now() - 125_000).current;
  return (
    <>
      <RunLine quiet={false} word={L.chat.working} steps={null} startedAt={since} />
      <RunLine quiet={false} word={L.journey.makingRead} steps={null} startedAt={since} />
      <RunLine
        quiet={false}
        word={L.journey.makingFile}
        steps={{ done: 2, total: 5 }}
        startedAt={since}
      />
      <RunLine
        quiet={false}
        word={L.journey.makingCheck}
        steps={{ done: 11, total: 12 }}
        startedAt={longer}
      />
    </>
  );
}

/**
 * `?scene=tools` — 작업 과정 줄의 도구 이름(2026-10-07 베타 준비 분석). `browser_snapshot` 같은 영어가 그대로 뜨던 자리가
 * 한국어로 읽히는지 본다: Claude 의 `mcp__서버__이름` · Codex 의 `서버/이름` · 통계가 아는 공급자 이름 · 모르는 도구(원문 그대로).
 * 줄 머리를 눌러 펼쳐 본다 — 작업 과정 보기는 이 장면에서 켜져 있다.
 */
const toolRow = (id: string, name: string, input: unknown = {}, isError = false): Block => ({
  type: "tool",
  id,
  name,
  input,
  agentId: null,
  done: true,
  isError,
  result: isError
    ? "이 프로젝트 폴더 밖의 파일은 고치지 않아요 — 프로젝트 안의 파일만 고쳐 주세요."
    : "ok",
  startedAt: Date.now() - 20_000,
});
const toolsThread: Block[] = [
  {
    type: "user",
    id: "tl1",
    text: "회원 목록 화면을 열어서 검색창을 확인하고 제출까지 해 줘.",
    images: 0,
  },
  toolRow("tl-a", "mcp__colonova-browser__browser_navigate", {
    url: "http://127.0.0.1:5274/member/list",
  }),
  toolRow("tl-b", "mcp__colonova-browser__browser_snapshot"),
  toolRow("tl-c", "mcp__colonova-browser__browser_click", { ref: "e12" }),
  toolRow("tl-d", "mcp__colonova-browser__browser_fill", { ref: "e3", text: "김기획" }),
  toolRow("tl-e", "mcp__colonova-browser__browser_screenshot"),
  toolRow("tl-f", "mcp__colonova-browser__screen_check", { route: "/member/list" }),
  toolRow("tl-g", "mcp__colonova-browser__repo_diagnostics"),
  toolRow("tl-h", "mcp__colonova-browser__submit_for_review", { note: "검색창 추가" }),
  toolRow("tl-i", "colonova-browser/browser_navigate", { url: "http://127.0.0.1:5274/" }),
  toolRow("tl-j", "colonova-browser/notify_developer", { title: "락파일" }),
  toolRow("tl-k", "commandExecution", { command: "pnpm test" }),
  toolRow("tl-l", "fileChange", { changes: [] }),
  toolRow("tl-m", "Write", { file_path: "/home/u/.claude/settings.json" }, true),
  toolRow("tl-n", "mcp__other-server__mystery_tool"),
  answer("tl-z", "검색창을 확인했어요."),
  turn("tl-t", 21000),
];

/**
 * `?scene=ci` — 자동 검사가 통과하지 못해 AI 에게 맡긴 차례(2026-10-07 베타 준비 분석): 끝난 모양. `?scene=ci-live` 는 AI 가 고치는
 * 중(알약이 `AI가 고치는 중`), `?scene=ci-one` 은 수를 모르는 옛 표식(머리에 `검사 N개` 가 없다). 받은 글은 접혀 있고 펼치면
 * AI 가 읽은 검사 이름 · 줄 위치가 보인다.
 */
const ciBody = [
  "자동 검사가 통과하지 못했습니다 — 제출한 요청에서 검사 2개가 실패했습니다. 아래 결과를 읽고 고쳐 주세요.",
  "",
  "1. build",
  "   컴파일 오류 1개",
  "   - src/pages/members.tsx:42 — Cannot find name 'searchWord'",
  "2. lint (node 20)",
  "   - src/pages/members.tsx:17 — 'query' is assigned a value but never used",
  "",
  "끝의 기준: 이 검사가 통과하도록 고치고, 레포가 선언한 검사 명령(package.json 의 lint · typecheck · test · build)을 돌려 확인해 주세요 — 검사와 무관한 변경은 하지 마세요.",
].join("\n");
const ciUser = (id: string, failing: number): Block => ({
  type: "user",
  id,
  text: markTurn({ kind: "ci", pr: 12, failing }, ciBody),
  images: 0,
});
const ciScene: Block[] = [
  user("ci1", "회원 목록 맨 위에 검색창을 넣어 줘."),
  answer("ci1a", "검색창을 넣었어요."),
  done("cie1"),
  ciUser("ci2", 2),
  answer("ci2a", "두 검사 모두 확인했어요."),
  done("cie2"),
];
const ciLiveScene: Block[] = [
  user("cl1", "회원 목록 맨 위에 검색창을 넣어 줘."),
  answer("cl1a", "검색창을 넣었어요."),
  done("cle1"),
  ciUser("cl2", 2),
];
const ciOneScene: Block[] = [ciUser("co1", 0), answer("co1a", "확인했어요."), done("coe1")];

/**
 * `?scene=merged` — 반영된 일의 성취 카드(2026-10-08 · A2b). 모양 여섯: ① 제목 · 며칠 · 화면 수를 다 아는 카드 ② 같은 날 반영(`제출한 날 안에`)
 * ③ 제목을 모르는 카드(`제출한 일이 반영됐어요`) ④ 아주 긴 제목 ⑤ 제목만 아는 카드(사실 줄에는 시각만 선다) ⑥ 필드 없는 옛 사건 — 지금의 얇은 한 줄 그대로.
 * `?scene=merged-live` 는 열린 지 0.7초 뒤에 새 반영이 도착한다 — 체크가 한 번 그려지는 모습(이번 창에서 막 도착한 카드에만).
 */
const mergedAt = (id: string, over: Partial<Extract<Block, { type: "milestone" }>>): Block => ({
  type: "milestone",
  id,
  subtype: "merged",
  at: "2026-10-06T09:30:00+09:00",
  pr: 12,
  ...over,
});
const mergedScene: Block[] = [
  user("mg1", "회원 목록에 이름으로 찾는 검색창을 넣어 줘."),
  answer("mg1a", "검색창을 넣었어요."),
  done("mge1"),
  mergedAt("mgm1", {
    title: "회원 목록에 이름으로 찾는 검색창",
    days: 3,
    screens: 2,
  }),
  user("mg2", "검색 결과가 없을 때 안내 문구도 넣어 줘."),
  answer("mg2a", "안내 문구를 넣었어요."),
  done("mge2"),
  mergedAt("mgm2", { title: "빈 결과 안내 문구", days: 0, screens: 1, pr: 13 }),
  mergedAt("mgm3", { days: 1, screens: 3, pr: 14 }),
  mergedAt("mgm4", {
    title:
      "결제 내역 화면의 필터 · 정렬 · 기간 선택 · 엑셀 내려받기 · 빈 화면 안내 문구를 한꺼번에 손본 아주 긴 제목의 일",
    days: 12,
    pr: 15,
  }),
  mergedAt("mgm5", { title: "로그인 화면 문구 다듬기", pr: 16 }),
  mergedAt("mgm6", { pr: 17 }),
];
const mergedLiveStart: Block[] = [
  user("ml1", "회원 목록에 이름으로 찾는 검색창을 넣어 줘."),
  answer("ml1a", "검색창을 넣었어요."),
  done("mle1"),
];
const mergedLiveArrival = (): Block =>
  mergedAt("mlm1", {
    title: "회원 목록에 이름으로 찾는 검색창",
    days: 2,
    screens: 2,
    at: new Date().toISOString(),
  });

/**
 * `?scene=diff` — 달라진 곳 윤곽 · 사진 복사(2026-10-08 베타 준비 분석 · 겹판 점검 E). 전/후 사진 쌍을 이 페이지가 캔버스로 직접
 * 합성해 `data:` 주소로 싣는다(1200×750 — 데몬이 찍는 PC 크기와 같다). 카드 일곱: 단추 하나만 바뀐 것 · 단추와 푸터가 바뀐 것
 * · 거의 같은 것(같은 그림을 JPEG 로 다시 구움) · WebP 두 장(단추 하나) · 세로가 두 배인 것(비교 불가 — 단추가 없다)
 * · 세로가 조금 긴 것(아래 넘침) · 통째로 바뀐 것. 그 아래에는 요청이 가리킨 곳(핀) 위치를 넘긴 카드 셋 — 핀 밖의 변경이 경고색으로 서는 모양 · 핀이 가리킨
 * 곳이 안 달라져서 경고를 거두는 모양 · 핀이 없는(말만 한) 모양. 제품은 지금 핀의 위치를 넘기지 않는다(docs/DEVELOPERS.md).
 * `?w=420|387|320` · `?theme=dark` 로 좁은 칸 · 어두운 팔레트에서 본다.
 */
interface DiffLook {
  button?: "blue" | "green";
  footer?: "light" | "dark";
  height?: number;
  dark?: boolean;
}

function drawDiffPage(look: DiffLook = {}): HTMLCanvasElement {
  const { button = "blue", footer = "light", height = 750, dark = false } = look;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const paper = dark ? "#14161d" : "#f4f5f7";
  const card = dark ? "#1d2029" : "#ffffff";
  const ink = dark ? "#e8eaf0" : "#1f2430";
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 1200, height);
  ctx.fillStyle = card;
  ctx.fillRect(0, 0, 1200, 76);
  ctx.fillStyle = ink;
  ctx.font = "700 26px sans-serif";
  ctx.fillText("ColoNova 회원관리", 36, 48);
  ctx.font = "500 18px sans-serif";
  ctx.fillStyle = dark ? "#9aa1b2" : "#6b7280";
  ctx.fillText("회원      결제      포인트", 380, 46);
  // 오른쪽 위의 단추 — 초록은 더 크고 글이 길다.
  const big = button === "green";
  ctx.fillStyle = big ? "#16a34a" : "#2f6fed";
  const bx = big ? 1012 : 1030;
  const by = big ? 15 : 19;
  const bw = big ? 170 : 140;
  const bh = big ? 46 : 38;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 17px sans-serif";
  ctx.fillText(big ? "새 회원 추가" : "새 회원", bx + 24, by + bh / 2 + 6);
  ctx.fillStyle = ink;
  ctx.font = "700 30px sans-serif";
  ctx.fillText("회원 목록", 36, 136);
  ctx.fillStyle = card;
  ctx.fillRect(36, 162, 420, 44);
  ctx.strokeStyle = dark ? "#343947" : "#d5d9e2";
  ctx.strokeRect(36.5, 162.5, 419, 43);
  ctx.fillStyle = dark ? "#7d8497" : "#9aa1b2";
  ctx.font = "500 16px sans-serif";
  ctx.fillText("이름이나 연락처로 찾기", 54, 190);
  for (let row = 0; row < 7; row += 1) {
    const y = 232 + row * 62;
    if (y + 52 > height - 70) break;
    ctx.fillStyle = card;
    ctx.fillRect(36, y, 1128, 52);
    ctx.fillStyle = ink;
    ctx.font = "600 17px sans-serif";
    ctx.fillText(
      ["김기획", "이운영", "박디자인", "최개발", "정마케팅", "한고객", "오파트너"][row] ?? "",
      60,
      y + 32,
    );
    ctx.fillStyle = dark ? "#343947" : "#e4e7ee";
    ctx.fillRect(420, y + 20, 160 + ((row * 41) % 90), 12);
    ctx.fillStyle = dark ? "#2b3a5c" : "#dbe6ff";
    ctx.fillRect(1040, y + 14, 96, 24);
  }
  ctx.fillStyle = footer === "dark" ? "#1f2430" : "#e5e7ec";
  ctx.fillRect(0, height - 60, 1200, 60);
  ctx.fillStyle = footer === "dark" ? "#e8eaf0" : "#6b7280";
  ctx.font = "500 16px sans-serif";
  ctx.fillText("© ColoNova Design · 문의 help@example.com", 36, height - 24);
  return canvas;
}

const shotOf = (canvas: HTMLCanvasElement, type = "image/png", quality?: number) => ({
  mediaType: type,
  data: canvas.toDataURL(type, quality).split(",")[1] ?? "",
});

type DiffShots = Record<
  string,
  | {
      before: { mediaType: string; data: string } | null;
      after: { mediaType: string; data: string };
    }
  | undefined
>;
let diffShotsCache: DiffShots | null = null;
function diffShots(): DiffShots {
  if (query.get("scene") !== "diff") return {};
  diffShotsCache ??= {
    "diff/button": {
      before: shotOf(drawDiffPage()),
      after: shotOf(drawDiffPage({ button: "green" })),
    },
    "diff/footer": {
      before: shotOf(drawDiffPage()),
      after: shotOf(drawDiffPage({ button: "green", footer: "dark" })),
    },
    // 같은 그림을 JPEG 로 다시 구웠다 — 압축 흔적이 가장자리에 남아도 윤곽이 서면 안 된다.
    "diff/same": {
      before: shotOf(drawDiffPage()),
      after: shotOf(drawDiffPage(), "image/jpeg", 0.7),
    },
    // 데몬의 사진처럼 WebP(품질 88)로 따로 구운 두 장 — 손실 압축의 잡음 속에서도 단추 하나만 잡혀야 한다.
    "diff/webp": {
      before: shotOf(drawDiffPage(), "image/webp", 0.88),
      after: shotOf(drawDiffPage({ button: "green" }), "image/webp", 0.88),
    },
    "diff/size": {
      before: shotOf(drawDiffPage()),
      after: shotOf(drawDiffPage({ height: 1500 })),
    },
    "diff/tall": {
      before: shotOf(drawDiffPage()),
      after: shotOf(drawDiffPage({ height: 800 })),
    },
    "diff/wide": {
      before: shotOf(drawDiffPage()),
      after: shotOf(drawDiffPage({ dark: true, footer: "dark" })),
    },
  };
  return diffShotsCache;
}

const diffScene: Block[] = [
  withResult(
    "df1",
    "회원 목록의 새 회원 단추와 푸터를 눈에 띄게 바꿔 줘.",
    "req-df",
    [
      { route: "diff/button", title: "단추 하나" },
      { route: "diff/footer", title: "단추와 푸터" },
      { route: "diff/same", title: "거의 같은 화면" },
      { route: "diff/webp", title: "WebP 두 장 · 단추 하나" },
      { route: "diff/size", title: "세로가 두 배" },
      { route: "diff/tall", title: "아래가 조금 긴 화면" },
      { route: "diff/wide", title: "통째로 바뀐 화면" },
    ],
    { screens: 7, phone: false },
  ),
  answer("df1a", "새 회원 단추를 초록으로 키우고 푸터를 어둡게 바꿨어요."),
  turn("dfe1", 24000),
];

/** 마지막 토스트 — 이 견본에는 셸의 토스트가 없어 한 줄로 보여 준다(`window.__calls` 에도 남는다). */
function say(text: string) {
  calls.push(`toast:${text}`);
  const line = document.getElementById("fixture-toast");
  if (line) line.textContent = text;
}

/** 수정 후 사진(1200×750) 위 단추의 자리 — 정규화 좌표. */
const PIN_BUTTON = { x: 0.84, y: 0.018, w: 0.15, h: 0.065 };
/** 아무것도 안 바뀐 표의 한 줄. */
const PIN_TABLE = { x: 0.03, y: 0.42, w: 0.5, h: 0.08 };

const diffDaemon = {
  api: { comparison: loadComparison },
  activeSlug: "fixture",
} as unknown as Daemon;

/** 핀 위치를 넘기면 — 직접 그린 카드 셋과 `수정 전·후 보기` 대화상자. */
function DiffPins() {
  const open = (title: string, pins?: (typeof PIN_BUTTON)[]) =>
    openComparison({
      route: "/diff/footer",
      title,
      requestId: "req-df",
      ...(pins ? { pins } : {}),
    });
  const cards: Array<{ title: string; pins?: (typeof PIN_BUTTON)[] }> = [
    { title: "핀이 가리킨 곳 밖도 달라진 요청", pins: [PIN_BUTTON] },
    { title: "핀이 가리킨 곳이 안 달라진 요청", pins: [PIN_TABLE] },
    { title: "핀 없이 말로만 한 요청" },
  ];
  return (
    <section className="nx-results" style={{ margin: "24px 20px 0" }}>
      <div className="nx-results-heading">
        <span>핀 위치를 넘긴 카드(견본 전용)</span>
      </div>
      <div className="nx-results-grid">
        {cards.map((card) => (
          <ResultScreen
            key={card.title}
            title={card.title}
            route="/diff/footer"
            requestId="req-df"
            loadComparison={loadComparison}
            onOpen={() => calls.push("open")}
            onCompare={() => open(card.title, card.pins)}
            onToast={say}
            {...(card.pins ? { pins: card.pins } : {})}
          />
        ))}
      </div>
    </section>
  );
}

const scene = query.get("scene");

/** 도는 답 견본 — 사람 말이 올라온 뒤 글이 이어지고 마감까지를 시간대로 밟는다. */
function LiveFixture() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [live, setLive] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach((id) => {
        window.clearTimeout(id);
      });
    },
    [],
  );
  const play = () => {
    timers.current.forEach((id) => {
      window.clearTimeout(id);
    });
    timers.current = [];
    const push = (ms: number, block: Block) =>
      timers.current.push(window.setTimeout(() => setBlocks((prev) => [...prev, block]), ms));
    setBlocks([user("lu1", "회원 목록에 검색을 넣어 줘.")]);
    setLive(true);
    // 첫 글 — 처음부터 답 모양으로 선다(마감에 모양이 바뀌지 않게).
    push(400, { ...step("lt1", "회원 목록 화면을 찾았어요"), streaming: true });
    // 뒤에 이어 온 글이 답 자리를 받는다 — 앞의 글은 과정으로 부드럽게 내려간다.
    push(1600, {
      ...step("lt2", "검색창 자리를 머리 쪽에 마련했어요"),
      streaming: true,
    });
    push(2800, {
      ...step(
        "lt3",
        [
          "검색창을 넣었어요. 치는 대로 목록이 좁혀져요.",
          "",
          `[회원 목록](${PREVIEW_URL}/member/list)`,
        ].join("\n"),
      ),
      streaming: true,
    });
    // 마감 — 과정이 접히고 고친 화면 카드와 체크가 한 번 등장한다.
    push(4200, turn("le1", 5200));
    timers.current.push(window.setTimeout(() => setLive(false), 4200));
  };
  return (
    <section className="nx-chat" style={{ width: COLUMN, margin: "24px auto 0" }}>
      <div style={{ display: "flex", gap: 8, padding: "0 20px 12px" }}>
        <button type="button" onClick={play}>
          도는 답 보기
        </button>
        <button
          type="button"
          onClick={() => {
            timers.current.forEach((id) => {
              window.clearTimeout(id);
            });
            setBlocks([]);
            setLive(false);
          }}
        >
          지우기
        </button>
      </div>
      <div className="nx-transcript" style={{ maxHeight: "70vh" }}>
        <Thread
          blocks={blocks}
          live={live}
          showThinking={false}
          showTools={false}
          previewUrl={PREVIEW_URL}
          cycleScreens={[{ route: "member/list", title: "회원 목록", note: "", at: "" }]}
          handoff={null}
          projectWorking={false}
          canBranch={CAN_BRANCH}
          queue={[]}
          preparing={false}
          dropped={[]}
          onFork={(turn) => calls.push(`fork:${turn}`)}
          onEditResend={() => {}}
          loadComparison={loadComparison}
          onAdditionalEdit={() => {}}
          onRetry={() => {}}
          onRetryDropped={() => {}}
          onOpenScreen={() => {}}
          onOpenHistory={() => calls.push("history")}
          onReply={async () => {}}
          onNote={async () => {}}
          onToast={(text) => calls.push(`toast:${text}`)}
          onQueueEdit={() => {}}
          onQueueNow={() => {}}
          onBackgroundTask={() => {}}
          onStopTask={() => {}}
        />
      </div>
    </section>
  );
}

function Fixture() {
  // `?scene=merged-live` — 열린 뒤에 도착하는 반영(체크가 그려지는 순간을 본다).
  const [lateMerged, setLateMerged] = useState<Block[]>(mergedLiveStart);
  useEffect(() => {
    if (scene !== "merged-live") return;
    const id = window.setTimeout(
      () => setLateMerged((prev) => [...prev, mergedLiveArrival()]),
      700,
    );
    return () => window.clearTimeout(id);
  }, []);
  return (
    /* .nx 는 견본에서 토큰 범위만 빌린다 — 셸의 그리드(사이드바 + 미리보기)와
       고정 높이는 풀어 평범한 문서가 되게 하고, 대화 칸은 margin auto 로 가운데. */
    <div
      className="nx"
      style={{ display: "block", height: "auto", minHeight: "100vh", overflow: "visible" }}
    >
      <section className="nx-chat" style={{ width: COLUMN, margin: "0 auto" }}>
        <div className="nx-transcript">
          <Thread
            blocks={
              scene === "merged"
                ? mergedScene
                : scene === "merged-live"
                  ? lateMerged
                  : scene === "repro"
                    ? repro
                    : scene === "queue"
                      ? queued
                      : scene === "receipt"
                        ? receipts
                        : scene === "receipt-none"
                          ? receiptNone
                          : scene === "receipt-chat"
                            ? receiptChat
                            : scene === "receipt-old"
                              ? receiptOld
                              : scene === "undo"
                                ? undoScene
                                : scene === "working"
                                  ? workingThread
                                  : scene === "tools"
                                    ? toolsThread
                                    : scene === "account"
                                      ? accountFail
                                      : scene === "account-old"
                                        ? accountOld
                                        : scene === "ci"
                                          ? ciScene
                                          : scene === "ci-live"
                                            ? ciLiveScene
                                            : scene === "ci-one"
                                              ? ciOneScene
                                              : scene === "diff"
                                                ? diffScene
                                                : blocks
            }
            live={scene === "queue" || scene === "ci-live"}
            showThinking={false}
            showTools={scene === "tools"}
            previewUrl={PREVIEW_URL}
            cycleScreens={[{ route: "member/list", title: "회원 목록", note: "", at: "" }]}
            handoff={
              scene === "receipt" || scene === "receipt-chat"
                ? openRequest(["kim", "lee"])
                : scene === "receipt-none"
                  ? openRequest([])
                  : null
            }
            projectWorking={false}
            canBranch={CAN_BRANCH}
            queue={scene === "queue" ? queueItems : []}
            preparing={false}
            dropped={[]}
            onFork={(turn) => calls.push(`fork:${turn}`)}
            onEditResend={() => {}}
            loadComparison={loadComparison}
            onAdditionalEdit={() => {}}
            onRetry={() => {}}
            onRetryDropped={() => {}}
            onLogin={() => calls.push("login")}
            onOpenScreen={() => {}}
            onOpenHistory={() => calls.push("history")}
            undoLast={
              scene === "undo" ? { requestId: "req-u", onUndo: () => calls.push("undo") } : null
            }
            onReply={async () => {}}
            onNote={async () => {}}
            onToast={scene === "diff" ? say : (text) => calls.push(`toast:${text}`)}
            onQueueEdit={() => {}}
            onQueueNow={() => {}}
            onBackgroundTask={() => {}}
            onStopTask={() => {}}
          />
          {scene === "working" && <WorkingLines />}
          {scene === "diff" && <DiffPins />}
        </div>
      </section>
      {scene === "diff" && (
        <>
          <ComparisonDialog daemon={diffDaemon} onToast={say} />
          <p
            id="fixture-toast"
            role="status"
            style={{ position: "fixed", left: 12, bottom: 12, margin: 0, fontSize: 13 }}
          />
        </>
      )}
      {scene === null && <LiveFixture />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
