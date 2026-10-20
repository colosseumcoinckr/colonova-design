import type { ServerMessage } from "@colonova-design/protocol";
import { collectDiagnostics } from "../diagnostics.js";
import { forgetMissingGit } from "../environment.js";
import { submitFeatureRequest } from "../feedback.js";
import { runOnboardingChecks, runPnpmInstall, startGitInstall } from "../onboarding.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type SystemDeps = Pick<
  RouterDeps,
  | "status"
  | "appVersion"
  | "claudeExecutable"
  | "refreshClaudeExecutable"
  | "claudeExecutableOverride"
  | "github"
  | "agentDrivers"
  | "agentInstall"
  | "broadcast"
  | "setClaudeExecutable"
  | "agentLogin"
  | "afterAgentLogin"
  | "escalation"
  | "machineSetting"
  | "agentUpdates"
  | "machineTurns"
>;
type SystemRequest = Extract<
  keyof RequestHandlers,
  | `daemon.${string}`
  | `diagnostics.${string}`
  | `onboarding.${string}`
  | `agent.${string}`
  | `escalation.${string}`
  | `machine.${string}`
  | `github.${string}`
  | "feedback.submit"
>;

/** 기계 설정 · AI 연결 · 진단 요청을 맡는다. */
export function systemHandlers(deps: SystemDeps): RequestHandlers<SystemRequest> {
  return {
    "daemon.status": async () => {
      return await deps.status();
    },
    // 진단 한 덩어리(2026-10-07 베타 준비 분석) — 읽기뿐. 종류 · 숫자 · 버전만 나간다.
    "diagnostics.summary": async () => {
      return await collectDiagnostics({
        status: () => deps.status(),
        appVersion: deps.appVersion,
      });
    },
    "onboarding.check": async (message) => {
      // 방어(2026-09-24): 시작 때 못 푼 claude 경로는 여기서 한 번 다시 푼다 —
      // 사용자가 앱 밖에서 직접 설치한 경우도 재시작 없이 잡히게.
      if (deps.claudeExecutable() === null) await deps.refreshClaudeExecutable();
      // git 도 같다(2026-10-20): 못 찾았다는 기억을 지워야 첫 화면의 `다시 확인` 이 새로 설치한 git 을 본다.
      forgetMissingGit();
      return await runOnboardingChecks({
        claudeExecutableOverride: deps.claudeExecutableOverride(),
        gitHubClient: () => deps.github.client(),
        provider: message.provider,
        driverFor: (id) => deps.agentDrivers.get(id),
        // 쓰기 레포 수(P1-2): 브리지의 캐시를 읽는다 — 피커가 곧 같은 목록을
        // 요청하므로 이 판정의 추가 비용은 첫 한 번뿐이다.
        githubWriteRepoCount: () => deps.github.writeRepoCount(),
      });
    },
    "onboarding.fix": async (message) => {
      switch (message.kind) {
        case "install-claude": {
          // 1단계: 데몬이 설치를 끝까지 지켜본다 — 진행 줄과 끝은 방송으로
          // 나가고, ok 면 웹이 게이트를 다시 묻는다. 종류마다 하나씩만 돈다.
          const kind = message.kind;
          return deps.agentInstall.start(kind, {
            onProgress: (line) =>
              deps.broadcast({ type: "onboarding.install.progress", kind, line }),
            onDone: (ok, detail, executable) => {
              // 방송 전에 먼저: 설치의 성공 판정에 쓴 경로를 심어야
              // 이어지는 재검사·로그인이 방금 설치한 CLI 를 본다(2026-09-24).
              if (ok && executable) deps.setClaudeExecutable(executable);
              deps.broadcast({ type: "onboarding.install.done", kind, ok, detail });
            },
          });
        }
        case "login-claude": {
          // P1-1: 데몬이 로그인을 대신 몰고, 주소·끝은 방송으로 나간다.
          // 각 드라이버가 자기 로그인 명령을 선언한다(loginCommand) — claude 는
          // `auth login`(스파이크로 확인: 주소는 stdout, 코드는 stdin).
          const provider = message.provider ?? "claude";
          const driver = deps.agentDrivers.get(provider);
          const command = driver?.loginCommand?.();
          if (!command) {
            return {
              started: false,
              guidance:
                "이 에이전트는 로그인을 앱이 대신 시작할 수 없습니다 — 터미널에서 직접 로그인한 뒤 다시 확인해 주세요.",
            };
          }
          return deps.agentLogin.start(command.command, command.args, {
            onUrl: (url, wantsCode) => deps.broadcast({ type: "agent.login.url", url, wantsCode }),
            onDone: (ok, detail) => {
              deps.broadcast({ type: "agent.login.done", ok, detail });
              // 로그인이 돌아왔다 — 로그인 만료로 멈춰 둔 말을 다시 세운다
              // (PLAN L12). 감시의 다음 틱을 기다리지 않게 하는 길이다.
              if (ok) deps.afterAgentLogin?.();
            },
          });
        }
        case "install-git":
          return startGitInstall();
        case "install-pnpm":
          return await runPnpmInstall();
      }
      return { started: false, guidance: "알 수 없는 수정 요청입니다." };
    },
    "agent.login.code": (message) => {
      if (!deps.agentLogin.submitCode(message.code)) {
        throw new Error("진행 중인 로그인이 없습니다 — 로그인 버튼을 다시 눌러 주세요.");
      }
      return { ok: true as const };
    },
    "escalation.set": async (message) => {
      await deps.escalation.set(message.config);
      return { ok: true as const };
    },
    "machine.set": async (message) => {
      const provider = message.provider;
      if (message.agentAutoUpdate !== undefined) {
        // 켬이 기본이라 파일에는 끔만 적힌다 — 잊기(null)가 곧 켬이다.
        deps.machineSetting.set("agentAutoUpdate", message.agentAutoUpdate ? null : "off");
        void deps
          .status()
          .then((status) => deps.broadcast({ type: "status", status } as ServerMessage));
        // 켰다면 이미 아는 새 버전을 곧바로 건다(도는 작업이 있으면 미룬다).
        if (message.agentAutoUpdate) void deps.agentUpdates.applyAuto();
      }
      if (provider === undefined) return { ok: true as const };
      if (provider !== null) {
        const driver = deps.agentDrivers.get(provider);
        if (!driver) throw new Error(`알 수 없는 에이전트입니다: ${provider}`);
        if (!driver.oneShot) {
          throw new Error(
            `${driver.describe().label} 는 보관 메모를 맡을 수 없습니다 — 자동으로 두거나 다른 에이전트를 골라 주세요.`,
          );
        }
        const diagnostic = await driver.isAvailable().catch(() => null);
        if (!diagnostic?.ok || !diagnostic.executable) {
          throw new Error(
            `${driver.describe().label} CLI 를 찾지 못했습니다 — 설치를 마친 뒤 다시 시도해 주세요.`,
          );
        }
      }
      deps.machineSetting.set("provider", provider);
      deps.machineTurns.invalidate();
      return { ok: true as const };
    },
    "agent.update": async (message) => {
      // PLAN-UI U12: `check` 는 `지금 확인` — 새 버전만 읽고 상태를 다시 보낸다.
      // 아니면 설치 진행기로 바꿔 깐다(도는 작업이 있으면 끝나는 즉시).
      if (message.check === true) {
        await deps.agentUpdates.check();
        void deps
          .status()
          .then((status) => deps.broadcast({ type: "status", status } as ServerMessage));
        return {
          ok: true as const,
          latestVersion: deps.agentUpdates.latest(message.kind) ?? null,
        };
      }
      return { ok: true as const, phase: deps.agentUpdates.request(message.kind) };
    },
    "machine.author.set": (message) => {
      // 이름은 문서로 흘러가는 문자열이라 잘라내는 것으로 충분하다 — 빈 칸은
      // 지우기(null 과 같은 길)로 읽는다. 상태를 곧바로 다시 보낸다 — 다음 방송을
      // 기다리면 초대 파일을 가져온 직후의 홈 인사가 이름 없이 남는다(단계 8 에서 봄).
      const name = message.name === null ? null : message.name.trim();
      deps.machineSetting.set("authorName", name === "" ? null : name);
      void deps
        .status()
        .then((status) => deps.broadcast({ type: "status", status } as ServerMessage));
      return { ok: true as const };
    },
    "escalation.notify": async (message) => {
      // 화면이 지은 문구를 그대로 울린다. 10분 동일 문구 dedupe 는 그대로
      // 두고(같은 사고가 연달아 슬랙을 때리지 않게), 문구에 프로젝트와
      // 시각이 들어 있어 두 번째 누름이 조용히 삼켜지지 않는다 — 그 조립은
      // 화면의 몫이다.
      const rung = await deps.escalation.notify(message.text);
      if (!rung)
        throw new Error("개발자 알림을 보내지 못했습니다 — 설정 → 알림에서 연결을 확인해 주세요.");
      return { ok: true as const };
    },
    "escalation.test": async () => {
      const sent = await deps.escalation.notify(
        "[ColoNova Design] 개발자 알림 시험 — 이 메시지가 보이면 연결된 것입니다.",
      );
      if (!sent)
        throw new Error("알림을 보내지 못했습니다 — 웹훅 주소나 봇 토큰·채널을 확인해 주세요.");
      return { ok: true as const };
    },
    "github.token.set": async (message) => {
      return await deps.github.setToken(message.token);
    },
    "github.repo.inspect": async (message) => {
      return await deps.github.inspectRepo(message.owner, message.repo);
    },
    // --- 기능 제안 (PLAN-FEEDBACK) ---------------------------------------
    // 앱 전체 기능: 활성 프로젝트·세션과 무관하므로 아무 준비도 묻지 않는다.
    "feedback.submit": async (message) => {
      return await submitFeatureRequest(
        { request: message.request, context: message.context },
        { github: deps.github, appVersion: deps.appVersion },
      );
    },
  };
}
