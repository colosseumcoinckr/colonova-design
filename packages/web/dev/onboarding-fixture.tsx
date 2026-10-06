/**
 * 처음 한 번 견본 — 데몬 없이 `FirstRun` · `NoProjects` 를 여러 상태로 눈으로 보는 페이지(2026-10-06
 * 온보딩 손질). 앱과 같은 CSS(테마 · styles.css · next.css→onboarding.css)를 올린다. `vite build` 의
 * 입력은 index.html 뿐이라 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   ./node_modules/.bin/vite --port 29181 --strictPort --host 127.0.0.1   (packages/web 에서)
 *   → http://127.0.0.1:29181/dev/onboarding-fixture.html
 *
 * 주소 끝의 `?theme=dark` 처럼 테마를, `?case=a,c` 로 보일 상태만을, `?w=` · `?h=` 로 창의 크기를 고른다.
 * `?case=journey` 는 한 화면이 상태를 따라 걸어가는 모습(통과의 순간 · 접힘)을 `?tick=` 밀리초마다
 * 보여 준다. `?hold=1` 은 끝 화면(`done`)의 흐려짐을 걷어 제목만 읽게 한다. 새 상태는 아래 `CASES` 에
 * 한 줄 더한다(새 페이지를 만들지 않는다). 호출 기록은 `window.__onboarding` 에 남는다.
 */

import type { OnboardingStep } from "@colonova-design/protocol";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { InviteImportController, InviteImportState } from "../src/hooks/use-invite-import";
import type { Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { FirstRun } from "../src/next/onboarding/FirstRun";
import { NoProjects } from "../src/next/onboarding/NoProjects";
import { mockDaemon, PROJECTS, STATUS } from "./overlay-mocks";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const FRAME_W = Number(query.get("w")) || 1100;
const FRAME_H = Number(query.get("h")) || 780;
const ONLY = query.get("case")?.split(",") ?? null;
const TICK = Number(query.get("tick")) || 1500;
document.body.style.background = "color-mix(in srgb, var(--bg) 82%, #888)";
if (query.get("hold") === "1") {
  const style = document.createElement("style");
  style.textContent =
    ".nx-ob--done .nx-ob-inner{opacity:1!important;filter:none!important;transform:none!important}";
  document.head.append(style);
}

const calls: string[] = [];
Object.assign(window, { __onboarding: { calls } });

const GIT_OK = { id: "git", status: "pass", detail: "git 준비됨 (git version 2.45.1)" };
const RUNTIME_OK = { id: "runtime", status: "pass", detail: "Node 24.1 · pnpm 10 준비됨" };
const GITHUB_OK = { id: "github", status: "pass", detail: "연결됨" };
const CLAUDE_INSTALL = {
  id: "claude",
  status: "fail",
  detail: "Claude Code CLI를 찾지 못했습니다.",
  fix: { kind: "install-claude", label: "Claude Code 설치" },
};
const CLAUDE_LOGIN = {
  id: "claude",
  status: "fail",
  detail: "Claude Code 로그인이 필요합니다 — 본인 구독으로 실행됩니다.",
  fix: { kind: "login-claude", label: "Claude Code 로그인" },
};
const CLAUDE_OK = { id: "claude", status: "pass", detail: "Claude Code 준비됨 (2.1.3) · max" };
const GIT_MISSING = {
  id: "git",
  status: "fail",
  detail: "git이 없습니다 — 설치 버튼을 누르면 설치 창이 열립니다.",
  fix: { kind: "install-git", label: "git 설치" },
};

/** 게이트 줄 — 도구 둘, AI 하나, (FirstRun 이 보지 않는) GitHub. */
const gates = (...picked: Array<Record<string, unknown>>): OnboardingStep[] =>
  [GIT_OK, RUNTIME_OK, ...picked, GITHUB_OK] as unknown as OnboardingStep[];

const POLICY_DETAIL =
  "회사 PC 정책이 설치를 막은 것 같아요. 아래 문장을 IT 담당자에게 보내 주세요.\nColoNova Design 이 Claude Code 를 사용자 폴더에 설치하려고 합니다(https://claude.ai/install.ps1 또는 install.sh). 이 설치를 허용해 주세요.";

const LOGIN = {
  url: "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code",
  wantsCode: true,
};

const NO_CODEX_STATUS = {
  ...STATUS,
  providers: (STATUS.providers ?? []).filter((entry) => entry.id !== "codex"),
};

interface Case {
  id: string;
  label: string;
  daemon?: Record<string, unknown>;
  invite?: InviteImportState;
  done?: boolean;
  checking?: boolean;
  screen?: "first-run" | "no-projects";
}

const CASES: Case[] = [
  {
    id: "a",
    label: "a · 켠 직후 — 도구를 확인하는 중(검사 답이 아직 없다)",
    daemon: { onboarding: null },
  },
  {
    id: "b",
    label: "b · 도구 확인됨 — AI 는 설치 전(가장 흔한 첫 모습)",
    daemon: { onboarding: gates(CLAUDE_INSTALL) },
  },
  {
    id: "c",
    label: "c · AI 설치 중 · 내려받는 중",
    daemon: {
      onboarding: gates(CLAUDE_INSTALL),
      install: { kind: "install-claude", line: "Downloading Claude Code 2.1.3" },
    },
  },
  {
    id: "d",
    label: "d · AI 설치 중 · 설치하는 중",
    daemon: {
      onboarding: gates(CLAUDE_INSTALL),
      install: { kind: "install-claude", line: "Installing to ~/.local/bin/claude" },
    },
  },
  {
    id: "e",
    label: "e · 로그인 중 — 브라우저가 열렸고 돌아오기를 기다린다",
    daemon: { onboarding: gates(CLAUDE_LOGIN), login: LOGIN },
  },
  {
    id: "f",
    label: "f · 설치가 막혔다 — 회사 정책(IT 담당자에게 보낼 문장)",
    daemon: {
      onboarding: gates(CLAUDE_INSTALL),
      installDone: { kind: "install-claude", ok: false, detail: POLICY_DETAIL },
    },
  },
  {
    id: "g",
    label: "g · AI 까지 통과 — 초대 파일만 남았다(Codex 는 묻는 줄)",
    daemon: { onboarding: gates(CLAUDE_OK) },
  },
  {
    id: "h",
    label: "h · 초대 파일을 여는 중",
    daemon: { onboarding: gates(CLAUDE_OK) },
    invite: { phase: "reading" },
  },
  {
    id: "i",
    label: "i · 초대 파일을 읽지 못했다",
    daemon: { onboarding: gates(CLAUDE_OK) },
    invite: {
      phase: "error",
      error: "초대 파일이 아니에요. 개발자에게 받은 초대 파일을 놓아 주세요.",
      firstRun: true,
    },
  },
  {
    id: "j",
    label: "j · 도구 확인이 막혔다(git 없음)",
    daemon: {
      onboarding: [
        GIT_MISSING,
        RUNTIME_OK,
        CLAUDE_INSTALL,
        GITHUB_OK,
      ] as unknown as OnboardingStep[],
    },
  },
  {
    id: "k",
    label: "k · 로그인이 실패로 끝났다",
    daemon: {
      onboarding: gates(CLAUDE_LOGIN),
      loginDone: {
        ok: false,
        detail: "로그인이 끝나지 않았어요. 브라우저 창을 닫았다면 다시 열어 주세요.",
      },
    },
  },
  {
    id: "l",
    label: "l · 셋 다 찼다 — 프로젝트를 가져왔다(경고 줄 포함)",
    daemon: { onboarding: gates(CLAUDE_OK), projects: PROJECTS },
  },
  {
    id: "m",
    label: "m · 끝 — `done` 제목(흐려지기 전의 얼굴 · `?hold=1` 로 걷는다)",
    daemon: { onboarding: gates(CLAUDE_OK), projects: PROJECTS },
    done: true,
  },
  {
    id: "n",
    label: "n · Codex 가 이 기계에 없다 — 줄이 없다",
    daemon: { onboarding: gates(CLAUDE_OK), status: NO_CODEX_STATUS },
  },
  {
    id: "o",
    label: "o · Codex 설치 중",
    daemon: {
      onboarding: gates(CLAUDE_OK),
      install: { kind: "install-codex", line: "Downloading codex" },
    },
  },
  {
    id: "p",
    label: "p · 프로바이더를 다시 묻는 중(checking)",
    daemon: { onboarding: gates(CLAUDE_LOGIN) },
    checking: true,
  },
  {
    id: "s",
    label: "s · 긴 글 — 프로젝트 이름이 아주 길고 많다(초대 완료 요약이 접힌다)",
    daemon: {
      onboarding: gates(CLAUDE_OK),
      projects: [
        "아주 아주 긴 프로젝트 이름의 관리자 콘솔 웹",
        "marketing-site-with-a-very-long-slug-name",
        "결제 정산 배치 모니터링 대시보드",
        "docs-portal",
        "상점 관리자",
        "고객 문의 응대 도구",
      ].map((name, index) => ({ name, slug: `p${index}`, reviewers: [], threads: [] })),
    },
  },
  {
    id: "t",
    label: "t · 긴 글 — 도구 확인이 막힘(긴 설명) · 설치가 막힘(긴 안내) · 초대 파일 오류(긴 문장)",
    daemon: {
      onboarding: [
        {
          ...GIT_MISSING,
          detail:
            "git이 없습니다 — 설치 버튼을 누르면 설치 창이 열립니다. 설치 창이 닫힌 뒤에도 이 화면이 그대로라면 앱을 껐다가 다시 켜 주세요. 그래도 안 되면 회사 PC 관리자에게 문의해 주세요.",
        },
        RUNTIME_OK,
        CLAUDE_INSTALL,
        GITHUB_OK,
      ] as unknown as OnboardingStep[],
      installDone: {
        kind: "install-claude",
        ok: false,
        detail: `${POLICY_DETAIL}`,
      },
    },
    invite: {
      phase: "error",
      error:
        "초대 파일이 아니에요. 개발자에게 받은 초대 파일을 놓아 주세요. 파일 이름이 바뀌었거나 다른 프로그램이 만든 파일이면 열 수 없어요. 개발자에게 새 초대 파일을 요청해 주세요.",
      firstRun: true,
    },
  },
  {
    id: "q",
    label: "q · 마지막 프로젝트를 정리한 뒤 — 초대 파일로 다시 시작",
    screen: "no-projects",
    daemon: { onboarding: gates(CLAUDE_OK) },
  },
  {
    id: "r",
    label: "r · 위와 같고 파일을 여는 중",
    screen: "no-projects",
    daemon: { onboarding: gates(CLAUDE_OK) },
    invite: { phase: "reading" },
  },
];

/** 한 화면이 걸어가는 길 — 같은 FirstRun 이 상태만 바뀐다(통과의 순간 · 접힘이 보인다). */
const JOURNEY: Array<{
  label: string;
  daemon: Record<string, unknown>;
  invite?: InviteImportState;
}> = [
  { label: "켠 직후", daemon: { onboarding: null } },
  { label: "도구 확인됨 · AI 설치 전", daemon: { onboarding: gates(CLAUDE_INSTALL) } },
  {
    label: "설치 중 · 내려받기",
    daemon: {
      onboarding: gates(CLAUDE_INSTALL),
      install: { kind: "install-claude", line: "Downloading Claude Code 2.1.3" },
    },
  },
  {
    label: "설치 중 · 설치",
    daemon: {
      onboarding: gates(CLAUDE_INSTALL),
      install: { kind: "install-claude", line: "Installing to ~/.local/bin/claude" },
    },
  },
  {
    label: "설치 중 · 확인",
    daemon: {
      onboarding: gates(CLAUDE_INSTALL),
      install: { kind: "install-claude", line: "Verifying sha256 checksum" },
    },
  },
  { label: "로그인 대기", daemon: { onboarding: gates(CLAUDE_LOGIN), login: LOGIN } },
  { label: "AI 통과 · 초대 파일 남음", daemon: { onboarding: gates(CLAUDE_OK) } },
  { label: "파일 여는 중", daemon: { onboarding: gates(CLAUDE_OK) }, invite: { phase: "reading" } },
  { label: "셋 다 찼다", daemon: { onboarding: gates(CLAUDE_OK), projects: PROJECTS } },
];

const controller = (state: InviteImportState): InviteImportController => ({
  state,
  openPicker: () => calls.push("openPicker"),
  apply: () => calls.push("apply"),
  retry: () => calls.push("retry"),
  close: () => calls.push("close"),
  takeFile: (file) => calls.push(`takeFile:${file.name}`),
});

const daemonOf = (patch: Record<string, unknown>) =>
  mockDaemon({ projects: [], onboarding: null, ...patch }) as Daemon;

function Screen({
  spec,
}: {
  spec: Pick<Case, "daemon" | "invite" | "done" | "checking" | "screen">;
}) {
  const daemon = useMemo(() => daemonOf(spec.daemon ?? {}), [spec.daemon]);
  const invite = useMemo(() => controller(spec.invite ?? { phase: "idle" }), [spec.invite]);
  const importing = invite.state.phase === "reading" || invite.state.phase === "applying";
  return spec.screen === "no-projects" ? (
    <NoProjects daemon={daemon} invite={invite} importing={importing} />
  ) : (
    <FirstRun
      daemon={daemon}
      provider="claude"
      invite={invite}
      checking={spec.checking ?? false}
      done={spec.done ?? false}
    />
  );
}

function Frame({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div id={`fixture-${id}`} style={{ width: FRAME_W }}>
      <div style={{ font: "11.5px/1.45 monospace", color: "#888", margin: "0 0 4px" }}>{label}</div>
      <div
        style={{
          position: "relative",
          width: FRAME_W,
          height: FRAME_H,
          overflow: "hidden",
          border: "1px dashed #8884",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Journey() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(query.get("pause") === "1");
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(
      () => setIndex((prev) => Math.min(prev + 1, JOURNEY.length - 1)),
      TICK,
    );
    return () => window.clearInterval(timer);
  }, [paused]);
  const step = JOURNEY[Math.min(index, JOURNEY.length - 1)] as (typeof JOURNEY)[number];
  Object.assign(window, { __onboardingJourney: { index, set: setIndex, pause: setPaused } });
  return (
    <Frame id="journey" label={`journey ${index + 1}/${JOURNEY.length} · ${step.label}`}>
      <Screen spec={{ daemon: step.daemon, ...(step.invite ? { invite: step.invite } : {}) }} />
    </Frame>
  );
}

const picked = CASES.filter((spec) => ONLY === null || ONLY.includes(spec.id));

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div style={{ display: "grid", gap: 28, padding: 20, justifyContent: "start" }}>
      {ONLY?.includes("journey") ? (
        <Journey />
      ) : (
        picked.map((spec) => (
          <Frame key={spec.id} id={spec.id} label={spec.label}>
            <Screen spec={spec} />
          </Frame>
        ))
      )}
    </div>
  </StrictMode>,
);
