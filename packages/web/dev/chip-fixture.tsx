/**
 * 모델 칩 견본 — 데몬 없이 `Composer`(모델 칩 · ⚡ 토글 · 툴팁 카드)를 눈으로
 * 보는 페이지(PLAN-MODEL-CHIP D4). 앱과 같은 CSS(테마 · styles.css ·
 * next.css→chat.css)를 올린다. `vite build` 의 입력은 index.html 뿐이라 제품에
 * 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   pnpm --filter @colonova-design/web exec vite --port 29185 --strictPort
 *   → http://127.0.0.1:29185/dev/chip-fixture.html
 *
 * 벌 a–d 는 묶음 D 의 검수 항목: next 의 카드 · 켜짐 · 막힘 이유 · 받지 않는
 * 모델(번개가 사라짐). 툴팁 카드는 번개에 마우스를 올리거나 Tab 으로
 * 포커스하면 뜬다.
 *
 * 주소 끝의 쿼리로 상태를 고른다(2026-10-06 겹판 손질 — 팝을 열 때 가짜 데몬에 `planRefresh` 가
 * 없어 effect 가 TypeError 로 죽던 것을 함께 고쳤다):
 *   ?theme=claude|dark|github|…  테마
 *   ?case=a|b|c|d                한 벌만 — 대화 칸 벌(b·c·d)은 창 바닥에 붙어 위로 열린다
 *   ?ai=1|2                      쓸 수 있는 AI 수 — 1 이면 AI 줄이 서지 않는다(기본 2)
 *   ?usage=ok|loading|failed|empty  사용량 읽기 — ok(0.7초 뒤 읽힘) · loading(끝내 안 옴) · failed · empty(요금제에 한도 없음)
 *   ?models=few|many             모델 줄 수 — many 는 거르는 칸이 서는 길이(기본 few)
 *   ?w=460                       입력창 칸의 폭
 *   ?pins=7                      핀 N개를 입력창에 담아 본다(첫 핀만 메모가 있다) — 여섯을 넘으면 사진 한도 안내가 선다
 *   ?notes=0                     핀 메모를 모두 비운다 — 보내기를 누르면 `말 없는 핀` 안내가 선다
 */

import type { EffortLevel, PlanUsage, SessionModelInfo } from "@colonova-design/protocol";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChipTarget, Sessions } from "../src/hooks/useSessions";
import type { Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { Composer } from "../src/next/chat/Composer";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();

const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const ONLY = query.get("case");
const AI_COUNT = query.get("ai") === "1" ? 1 : 2;
const USAGE = query.get("usage") ?? "ok";
const MANY = query.get("models") === "many";
const WIDTH = Number(query.get("w")) || 460;
const PIN_COUNT = Number(query.get("pins")) || 0;
const PIN_NOTES = query.get("notes") !== "0";
/** `?pins=N` — 입력창의 핀 줄 견본. 첫 핀만 메모가 있어 `말 없는 핀` 판정도 눈으로 본다. */
const PINS = Array.from({ length: PIN_COUNT }, (_, index) => ({
  id: `p${index + 1}`,
  screen: "members",
  note: index === 0 && PIN_NOTES ? "버튼을 더 크게" : "",
  element: {
    component: "button",
    text: `단추 ${index + 1}`,
    path: `body > main > button:nth-of-type(${index + 1})`,
    rect: { x: 10, y: 10 + index * 30, width: 80, height: 24 },
  },
}));

const row = (parts: Partial<SessionModelInfo>): SessionModelInfo => ({
  value: "opus",
  displayName: "Opus 5.5",
  resolvedModel: null,
  description: "",
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high"],
  supportsFastMode: true,
  ...parts,
});

/** CLI 가 실제로 내려 주는 영어 설명 — 팝이 한국어로 옮겨 읽는다(`L.model.hints`). */
const CLAUDE_MODELS = [
  row({
    value: "default",
    displayName: "Default (recommended)",
    description: "Use the default model",
    resolvedModel: "claude-opus-5-5",
  }),
  row({
    value: "opus",
    displayName: "Opus 5.5",
    description: "For your toughest challenges",
    resolvedModel: "claude-opus-5-5",
  }),
  row({
    value: "sonnet",
    displayName: "Sonnet 5",
    description: "Efficient for routine tasks",
    supportsFastMode: false,
  }),
  row({
    value: "haiku",
    displayName: "Haiku 4.5",
    description: "Fastest for quick answers",
    supportsFastMode: false,
  }),
];

const CODEX_MODELS = [
  row({
    value: "gpt-5.3-codex",
    displayName: "GPT-5.3-Codex",
    description: "Most capable for your hardest and longest-running tasks",
    supportsFastMode: false,
  }),
  row({
    value: "gpt-5.3-codex-spark",
    displayName: "GPT-5.3-Codex-Spark",
    description: "Fastest for quick answers",
    supportsFastMode: false,
  }),
];

/** 모델이 많은 계정 — 여덟 줄을 넘으면 `더 보기` 뒤에 거르는 칸이 선다. */
const MANY_MODELS = [
  ...CLAUDE_MODELS,
  ...Array.from({ length: 7 }, (_, index) =>
    row({
      value: `legacy-${index + 1}`,
      displayName: `Claude ${index + 2}.${index} Preview`,
      description: index % 2 === 0 ? "Efficient for routine tasks" : "",
      supportsFastMode: false,
    }),
  ),
];

const modelsOf = (provider: string): SessionModelInfo[] =>
  provider === "codex" ? CODEX_MODELS : MANY ? MANY_MODELS : CLAUDE_MODELS;

const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

/** 가짜 요금제 읽기 — 5시간 창은 주의(70% 넘음), 모델별 주간 창은 위험(90% 넘음). */
const PLAN: PlanUsage = {
  subscriptionType: "max",
  fiveHour: { utilization: 72, resetsAt: inMinutes(95) },
  sevenDay: { utilization: 38, resetsAt: inMinutes(3 * 24 * 60) },
  modelWeekly: [
    {
      label: "Opus 주간",
      name: "Opus",
      period: "week",
      utilization: 91,
      resetsAt: inMinutes(2 * 24 * 60),
    },
  ],
  provider: "claude",
};

const PLAN_CODEX: PlanUsage = {
  subscriptionType: "plus",
  fiveHour: { utilization: 12, resetsAt: inMinutes(210) },
  sevenDay: { utilization: 20, resetsAt: inMinutes(5 * 24 * 60) },
  modelWeekly: [],
  provider: "codex",
};

const providers = [
  {
    id: "claude",
    label: "Claude",
    available: true,
    loggedIn: true,
    capabilities: { fastMode: true },
  },
  { id: "codex", label: "Codex", available: true, loggedIn: true, capabilities: {} },
].slice(0, AI_COUNT);

/**
 * 가짜 사용량 읽기 — 길에 따라 0.7초 뒤 끝나거나(ok · empty) 끝내 안 오거나(loading) 실패한다.
 * 칩은 이 약속의 끝을 보고 `읽는 중 → 정상 · 실패` 로 옮겨 간다.
 */
const planRefresh = (): Promise<unknown> => {
  if (USAGE === "loading") return new Promise(() => {});
  return new Promise((resolve, reject) => {
    window.setTimeout(() => (USAGE === "failed" ? reject(new Error("fixture")) : resolve({})), 700);
  });
};

/** 가짜 데몬 — 칩이 실제로 읽는 칸(providers · planUsageByProvider · api.planRefresh)만 채운다. */
const daemon = {
  status: {
    providers,
    planUsageByProvider:
      USAGE === "empty" || USAGE === "failed" ? {} : { claude: PLAN, codex: PLAN_CODEX },
  },
  api: { planRefresh },
} as unknown as Daemon;

/** 벌 하나 — 입력창 한 벌과 그 위의 표식. 주인의 값은 눌러 바꾸면 실제로 바뀐다(AI · 모델 · 생각 시간). */
function Case({
  id,
  title,
  variant,
  parts,
}: {
  id: string;
  title: string;
  variant: "thread" | "home";
  parts: Partial<ChipTarget>;
}) {
  const [provider, setProvider] = useState(parts.provider ?? "claude");
  const [model, setModel] = useState<string | null>(parts.model ?? "opus");
  const [effort, setEffort] = useState<EffortLevel | null>(parts.effort ?? "high");
  const [fastMode, setFastMode] = useState(parts.fastMode ?? false);
  const key = parts.key ?? `fixture-${id}`;
  const chip: ChipTarget = {
    subject: "session",
    key,
    fastModeBlocked: null,
    ...parts,
    provider,
    model,
    effort,
    fastMode,
    models: modelsOf(provider),
    setModel: (value) => {
      setModel(value);
      return Promise.resolve();
    },
    setEffort: (value) => {
      setEffort(value);
      return Promise.resolve();
    },
    setFast: (on) => {
      setFastMode(on);
      return Promise.resolve({ on, blocked: null, key });
    },
    // 다음 새 대화(next)만 AI 를 고른다 — 고르면 그 AI 의 모델 목록으로 바뀐다.
    pickProvider: parts.pickProvider
      ? (next) => {
          setProvider(next);
          setModel(modelsOf(next)[0]?.value ?? null);
        }
      : null,
  };
  const sessions = { chipTarget: () => chip, refreshUsage: () => {} } as unknown as Sessions;
  // 한 벌만 볼 때 대화 칸의 입력창은 창 바닥에 붙는다 — 실제 앱처럼 팝이 위로 열린다.
  const pinned = ONLY !== null && variant === "thread";
  return (
    <div
      id={`fixture-${id}`}
      style={
        pinned
          ? { position: "fixed", left: 0, right: 0, bottom: 0, width: WIDTH, margin: "0 auto" }
          : { width: WIDTH, margin: "28px auto" }
      }
    >
      {!pinned && <h3 style={{ margin: "0 0 8px" }}>{title}</h3>}
      <div className="nx-cmp-wrap">
        <Composer
          daemon={daemon}
          sessions={sessions}
          variant={variant}
          subject={chip.subject}
          draftKey={`fixture-${id}`}
          placeholder="무엇을 만들까요?"
          pins={PINS}
          onPinNote={() => {}}
          onPinRemove={() => {}}
          onPinFocus={() => {}}
          onToast={() => {}}
          onSend={async () => {}}
        />
      </div>
    </div>
  );
}

const CASES: Array<{
  id: string;
  title: string;
  variant: "thread" | "home";
  parts: Partial<ChipTarget>;
}> = [
  {
    id: "a",
    title: "a · 홈 next · Claude Opus · 꺼짐",
    variant: "home",
    parts: { subject: "next", key: "next:claude", pickProvider: () => {} },
  },
  {
    id: "b",
    title: "b · 대화 칸 session · Claude Opus · 켜짐",
    variant: "thread",
    parts: { subject: "session", fastMode: true },
  },
  {
    id: "c",
    title: "c · 대화 칸 session · Claude Opus · 막힘(usage credits)",
    variant: "thread",
    parts: { fastModeBlocked: "Fast mode requires usage credits" },
  },
  {
    id: "d",
    title: "d · 대화 칸 session · Claude Sonnet · 번개 없음",
    variant: "thread",
    parts: { model: "sonnet" },
  },
];

function Fixture() {
  return (
    /* .nx 는 견본에서 토큰 범위만 빌린다 — 셸의 그리드는 풀어 평범한 문서로. */
    <div
      className="nx"
      style={{ display: "block", height: "auto", minHeight: "100vh", overflow: "visible" }}
    >
      {CASES.filter((one) => ONLY === null || one.id === ONLY).map((one) => (
        <Case key={one.id} {...one} />
      ))}
    </div>
  );
}
const rootNode = document.getElementById("root");
if (rootNode) {
  createRoot(rootNode).render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
}
