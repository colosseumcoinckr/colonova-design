/**
 * 초대 확인판의 **진짜 컨트롤러** 견본(F) — `overlay-fixture.html?case=inviteflow` 가 불러온다. 정적인 `case=invite`
 * 와 달리 `useInviteImport` 가 파일을 읽고 · 확인하고 · 적용하고 · 다시 시도하는 길을 그대로 탄다. 가짜는
 * 데몬의 선로(`api`)뿐이다. 화면 밖의 시험이 `window.__inviteFlow` 로 손을 댄다:
 *
 *   make(kind)        초대 파일(File)을 만든다 — `ok`(프로젝트 셋) · `many`(여덟) · `empty`(프로젝트 없음 → 내용 오류)
 *                     · `broken`(JSON 아님 → 읽지 못함)
 *   takeFile(file)    컨트롤러에 파일을 건넨다(드롭과 같은 길)
 *   token             `ok` | `refuse` | `throw` — 연결 코드를 받는 쪽의 답
 *   failNames         이 이름의 프로젝트는 만들기가 거절된다
 *   delay             선로 한 번의 지연(ms)
 *   log               선로 호출의 기록
 *
 * 이 파일은 견본이다 — `vite build` 의 입력(index.html)에 없고 tsconfig 도 보지 않는다.
 */
import { useEffect, useMemo } from "react";
import { useInviteImport } from "../src/hooks/use-invite-import";
import { InviteConfirm } from "../src/next/onboarding/InviteConfirm";
import { calls, mockDaemon, PROJECTS } from "./overlay-mocks";

type TokenAnswer = "ok" | "refuse" | "throw";

interface Flow {
  token: TokenAnswer;
  failNames: string[];
  delay: number;
  offline: boolean;
  log: string[];
  make: (kind: "ok" | "many" | "empty" | "broken") => File;
  takeFile: (file: File) => void;
}

const flow: Flow = {
  token: "ok",
  failNames: [],
  delay: 150,
  offline: false,
  log: [],
  make: (kind) => {
    const project = (name: string, slug: string) => ({
      repoUrl: `https://github.com/colosseum/${slug}`,
      name,
      baseBranch: "main",
      approveCommands: false,
    });
    const projects =
      kind === "many"
        ? [
            project("고객 센터", "support"),
            project("정산 대시보드", "settle-board"),
            project("쿠폰 관리", "coupon"),
            project("공지 사이트", "notice"),
            project("사내 위키", "wiki"),
            project("채용 페이지", "careers"),
            project("상점 관리자", "shop-admin"),
            project("문서 포털", "docs-portal"),
          ]
        : kind === "empty"
          ? []
          : [
              project("고객 센터", "support"),
              project("상점 관리자", "shop-admin"),
              project("정산 대시보드", "settle-board"),
            ];
    const text =
      kind === "broken"
        ? "{이건 JSON 이 아니에요"
        : JSON.stringify({ v: 4, token: "ghp_견본", authorName: "정인권", projects });
    return new File([text], "견본.colonova-invite", { type: "application/json" });
  },
  takeFile: () => undefined,
};
Object.assign(window, { __inviteFlow: flow });

const wait = () => new Promise<void>((resolve) => window.setTimeout(resolve, flow.delay));

/** 가짜 선로 — 진짜 `call` 처럼 연결이 없으면 보내지도 않고 곧바로 거절한다. */
const api = new Proxy({} as Record<string, unknown>, {
  get:
    (_target, key: string) =>
    async (...args: unknown[]) => {
      if (flow.offline) throw new Error("아직 연결되지 않았습니다");
      flow.log.push(key);
      calls.push(key);
      await wait();
      if (key === "githubTokenSet") {
        if (flow.token === "throw")
          throw new Error("응답이 늦어졌습니다 — 잠시 뒤 대화나 화면을 다시 확인해 주세요.");
        return flow.token === "ok"
          ? { id: "github", status: "pass", detail: "연결됨" }
          : {
              id: "github",
              status: "warn",
              detail:
                "개발자에게 받은 코드가 이 레포에 닿지 않습니다 — 개발자에게 새 초대 파일을 요청하세요.",
            };
      }
      if (key === "projectCreate") {
        const name = (args[0] as { name?: string } | undefined)?.name ?? "";
        if (flow.failNames.includes(name))
          throw new Error(`‘${name}’ 은 이미 같은 이름의 프로젝트가 있습니다`);
      }
      if (key === "githubRepoInspect") return { canPush: true };
      return {};
    },
});

export function InviteFlow() {
  const base = useMemo(() => mockDaemon(), []);
  const daemon = useMemo(
    () =>
      mockDaemon({
        api,
        connection: "open",
        projects: PROJECTS,
        status: { ...base.status, authorName: "정인권" },
      }),
    [base],
  );
  const invite = useInviteImport(daemon);
  useEffect(() => {
    flow.takeFile = invite.takeFile;
  }, [invite.takeFile]);
  return (
    <>
      <p style={{ padding: 24, fontSize: 13 }}>
        초대 확인판 흐름 견본 — <code>window.__inviteFlow.takeFile(__inviteFlow.make("ok"))</code>
      </p>
      <InviteConfirm
        daemon={daemon}
        state={invite.state}
        onApply={(authorDraft, openRepoUrl) => {
          calls.push(`apply:${openRepoUrl ?? ""}`);
          invite.apply(authorDraft);
        }}
        onRetry={(authorDraft) => {
          calls.push("retry");
          invite.retry(authorDraft);
        }}
        onClose={invite.close}
        onOpenPicker={() => calls.push("picker")}
        onDiscarded={() => calls.push("discarded")}
      />
    </>
  );
}
