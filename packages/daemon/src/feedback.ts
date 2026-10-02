/**
 * 기능 제안 접수 (PLAN-FEEDBACK) — 앱 자체에 바라는 점을 제작팀 게시판
 * (RELEASES_REPO)의 이슈로 올리는 데몬 절반. 프로젝트·세션·개발자 알림
 * 어느 상태도 건드리지 않는다: 클라이언트가 접수 저장소를 고를 수 없듯,
 * 이 길은 기계 전체의 GitHub 토큰 하나로 고정 저장소에만 쓴다.
 *
 * 함께 가는 것은 요청 · 불편한 점 · 앱 버전 · 운영체제뿐이다. 대화 · 화면
 * 캡처 · 연결 프로젝트 이름 · 소스 · 로그 · 연결 코드 · 작성 이름은 절대
 * 실리지 않으며, 예외 문장에도 요청 본문이 새어 들어가지 않는다(HTTP 오류
 * 문장은 GitHub 의 응답만 인용한다).
 */
import {
  type FeatureRequestInput,
  type FeatureRequestResult,
  RELEASES_REPO,
} from "@colonova-design/protocol";
import { type GitHubClient, HttpError } from "./github.js";

/** 제작팀 게시판의 이슈 목록 — uncertain 의 안내가 여기로만 간다. */
export const FEEDBACK_ISSUES_URL = `https://github.com/${RELEASES_REPO}/issues`;
/** 브라우저 마무리의 빈 작성 페이지 — 긴 URL 대비 UI 가 함께 준다. */
export const FEEDBACK_NEW_ISSUE_URL = `https://github.com/${RELEASES_REPO}/issues/new`;

/** 이슈 제목이 요청 첫 줄에서 가져가는 상한. */
const TITLE_LINE_MAX = 80;

/** 브라우저 마무리로 가는 HTTP 상태 — 토큰이 닿지 않는다는 뜻들. */
const BROWSER_STATUSES: Record<number, true> = { 401: true, 403: true, 404: true, 410: true };

/** 접수가 의존하는 것 — 라우터가 주입한다(브리지의 좁은 면만 본다). */
export interface FeedbackDeps {
  /** 기계 전체 토큰의 클라이언트 — 없으면(토큰 없음) 브라우저 마무리. */
  github: { client(): GitHubClient | null; readonly authExpired: boolean };
  /** 앱 버전 — 알 수 없으면 null 이고 본문에서 빠진다. */
  appVersion?: () => string | null;
}

/**
 * 이슈 제목 — `[기능 제안] ` 과 요청 첫 줄(최대 80자). 코드 단위로 자른다:
 * 제목은 안내문이지 본문을 대신하지 않으므로 정확한 글자 수보다 상한이 중요하다.
 */
export function feedbackTitle(request: string): string {
  const firstLine = request.split("\n", 1)[0] ?? "";
  return `[기능 제안] ${firstLine.slice(0, TITLE_LINE_MAX)}`;
}

/**
 * 이슈 본문 — 요청, 불편한 점(있을 때만), 앱 버전(알 수 있을 때), 운영체제.
 * `process.platform` 은 사용자가 고칠 수 없는 기계의 사실이므로 그대로 싣는다.
 */
export function feedbackBody(
  input: FeatureRequestInput,
  appVersion: string | null,
  platform: string,
): string {
  const sections = ["### 요청", input.request];
  if (input.context) sections.push("", "### 불편한 점", input.context);
  const env = [`- 운영체제: ${platform}`];
  if (appVersion) env.unshift(`- 앱 버전: ${appVersion}`);
  sections.push("", ...env);
  return sections.join("\n");
}

/**
 * 접수 한 번. 자동 재전송은 없다 — 어느 길에서든 답은 정산이고, 다시 시도는
 * 새 명령 id 가 하는 일이다. 분류:
 * 토큰 없음·만료 → browser · 401/403/404/410 → browser · 5xx·네트워크·2xx
 * 인데 번호가 무효 → uncertain · 그 밖의 명시적 거절(422 등) → failed.
 */
export async function submitFeatureRequest(
  input: FeatureRequestInput,
  deps: FeedbackDeps,
): Promise<FeatureRequestResult> {
  const client = deps.github.client();
  // 토큰이 없거나 만료가 확인된 토큰이면 아예 보내지 않는다 — 브라우저 마무리.
  if (client === null || deps.github.authExpired) return browserResult(input, deps);
  const [owner, repo] = RELEASES_REPO.split("/");
  try {
    const number = await client.createIssue({
      owner: owner!,
      repo: repo!,
      title: feedbackTitle(input.request),
      body: feedbackBody(input, deps.appVersion?.() ?? null, process.platform),
    });
    if (!Number.isInteger(number) || number <= 0)
      return { kind: "uncertain", url: FEEDBACK_ISSUES_URL };
    return { kind: "sent", number, url: `${FEEDBACK_ISSUES_URL}/${number}` };
  } catch (error) {
    // 요청 본문은 예외에 실리지 않는다 — HttpError 의 문장은 GitHub 응답의
    // 인용뿐이고, 그 밖의 오류(네트워크)는 종류만 본다.
    if (error instanceof HttpError) {
      if (BROWSER_STATUSES[error.status]) return browserResult(input, deps);
      // 5xx 와 2xx/3xx(잘못된 성공)는 등록 여부를 모른다; 4xx 의 나머지는
      // GitHub 가 명시적으로 거절한 것이다.
      if (error.status >= 500 || error.status < 400)
        return { kind: "uncertain", url: FEEDBACK_ISSUES_URL };
      return { kind: "failed", reason: "rejected" };
    }
    return { kind: "uncertain", url: FEEDBACK_ISSUES_URL };
  }
}

/** 브라우저 마무리 — 제목·본문을 채운 고정 저장소의 새 이슈 URL. */
function browserResult(input: FeatureRequestInput, deps: FeedbackDeps): FeatureRequestResult {
  const title = feedbackTitle(input.request);
  const body = feedbackBody(input, deps.appVersion?.() ?? null, process.platform);
  const url = `${FEEDBACK_NEW_ISSUE_URL}?${new URLSearchParams({ title, body }).toString()}`;
  return { kind: "browser", url, title, body };
}
