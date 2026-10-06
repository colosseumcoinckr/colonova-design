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
import type { Block } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { Thread } from "../src/next/chat/Thread";
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
function drawShot(title: string, width = 960, height = 600): HTMLCanvasElement {
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
  ctx.fillStyle = "#2f6fed";
  ctx.fillRect(width - 150, 18, 110, 34);
  for (let row = 0; row < 6; row += 1) {
    const y = 104 + row * 78;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(36, y, width - 72, 62);
    ctx.fillStyle = row === 1 ? "#ffe9b8" : "#e4e7ee";
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
    before: null,
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
): Block => ({ type: "user", id, text, images: 0, requestId, changedScreens });
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
  withResult("u5", "회원 목록 맨 위에 검색창을 넣어 줘.", "req-5", [
    { route: "member/list", title: "회원 목록" },
  ]),
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

  // ⑥ 핀 세 개 — 긴 이름표 · 긴 메모 · 사진이 있는 핀과 없는 핀이 한 말풍선에.
  user("u6", pinsMany, THUMBS),
  answer(
    "t6a",
    "표 머리의 글자를 키우고 진하게 바꿨어요. 표시한 서비스 선택 줄은 건드리지 않았어요.",
  ),
  turn("e6", 27000),

  // ⑦ 고친 화면 네 곳 — 사진이 있는 · 없는 · 읽다 실패한 · 아직 읽는 중인 모양이 함께.
  withResult("u7", "회원 상세와 결제 내역, 환불 내역의 머리 문구를 같은 말투로 맞춰 줘.", "req-7", [
    { route: "member/1", title: "회원 상세" },
    { route: "member/empty", title: "결제 내역" },
    { route: "member/fail", title: "환불 내역" },
    { route: "member/slow", title: "포인트 내역" },
  ]),
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

/** `?scene=queue` — 줄에 선 말(`편집` · `지금 보내기`)이 새 말풍선 모양에서도 그대로인지 본다. */
const queued: Block[] = [
  user("q1", "회원 목록에 검색창을 넣어 줘."),
  { ...answer("q1a", "검색창을 넣는 중이에요…"), streaming: true } as Block,
];
const queueItems = [
  { id: "qi1", text: "검색 결과가 없을 때 안내 문구도 넣어 줘.", images: 0, files: 0 },
  { id: "qi2", text: "", images: 1, files: 1 },
];

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
            blocks={scene === "repro" ? repro : scene === "queue" ? queued : blocks}
            live={scene === "queue"}
            showThinking={false}
            showTools={false}
            previewUrl={PREVIEW_URL}
            cycleScreens={[{ route: "member/list", title: "회원 목록", note: "", at: "" }]}
            handoff={null}
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
      {scene === null && <LiveFixture />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
