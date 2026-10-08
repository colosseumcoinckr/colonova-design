import type { PreviewArrival } from "./preview-driver.js";

/**
 * 화면 확인이 로그인 벽에 막혔는지의 판정 (베타 준비 분석 2026-10-07). 검증 창은 사용자의 로그인 세션을 쓰지
 * 않으므로(별도 파티션) 로그인이 필요한 앱의 화면은 로그인 화면으로 튕긴다 — 그 화면은 문서가 잘 로드되고 콘솔도
 * 조용해서, 예전에는 「확인했어요」 로 셌다. 이 판정이 그 화면을 가려낸다.
 *
 * 판정은 순수하다 — 재료는 드라이버가 준 도착한 자리(`PreviewArrival`: 최종 주소 · 비밀번호 입력칸 수 · 상호작용
 * 요소 수)와 열어 달라고 한 주소뿐이다. 거짓 양성은 멀쩡한 확인을 「못 했다」 로 말하게 하고 거짓 음성은 예전처럼
 * 「했다」 를 말한다 — 지시서가 거짓 양성을 줄이는 쪽으로 보수적이라, 강한 신호 하나나 약한 신호의 겹침만 센다.
 *
 * 1. 외부 인증 호스트(`accounts.google.com` · `*.okta.com` …)로 갔다 — 강하다.
 * 2. 경로가 달라졌고 최종 경로가 로그인 모양이다. 강한 낱말(`/login` · `/signin` …)은 그것만으로 센다. 약한 낱말
 *    (`/auth` · `/sso` · `/oauth` …)은 설정 · 문서 · 관리 화면의 하위 경로로도 흔해서(`/settings/auth` · `/docs/auth` ·
 *    `/admin/sso`) 도착 화면에 비밀번호 입력칸이 있을 때만 센다(2026-10-08 검토 FIX1 — 거짓 양성).
 * 3. 비밀번호 입력칸이 정확히 하나고 상호작용 요소가 극히 적다 — 로그인 틀이 같은 주소에 서 있는 앱을 잡는다.
 *
 * 사용자가 인증 화면 자체를 열어 달라고 했으면(`/login` · `/signup` · `/account/password` …) 벽이 아니다 — 로그인
 * 화면을 만드는 사람이 그 화면을 확인하는 것이다.
 */
export type LoginWallReason = "auth-host" | "login-path" | "password-form";

/** AI 가 읽는 `screen_check` 결과에 실리는 한 줄 — 확인하지 못했다고 알리게 한다. */
export const LOGIN_WALL_NOTICE =
  "이 화면은 로그인 화면으로 이동했어요 — 로그인 없이 볼 수 있는 상태로 만들 수 없다면 확인하지 못했다고 알려 주세요(필요하면 notify_developer)";

/** 로그인 화면의 강한 경로 낱말 — 최종 경로에 이것이 있으면 로그인 모양이다(확장자는 뗀다: `login.html`). */
const LOGIN_SEGMENTS: ReadonlySet<string> = new Set([
  "login",
  "log-in",
  "log_in",
  "logon",
  "signin",
  "sign-in",
  "sign_in",
  "signon",
  "sign-on",
]);
/**
 * 약한 경로 낱말 — 인증 설정 · 문서 · 관리 화면(`/settings/auth` · `/docs/auth` · `/admin/sso`)에도 흔하다. 로그인 화면
 * 이어도 이 낱말만으로는 벽이라 하지 않고, 도착 화면에 비밀번호 입력칸이 있을 때만 센다(2026-10-08 검토 FIX1).
 */
const WEAK_LOGIN_SEGMENTS: ReadonlySet<string> = new Set([
  "sso",
  "saml",
  "oauth",
  "oauth2",
  "auth",
]);
/** 사용자가 열어 달라고 한 경로에 이것이 있으면 인증 화면을 직접 본 것이다 — 로그인 화면 + 가입 · 계정 · 비밀번호 화면. */
const AUTH_SEGMENTS: ReadonlySet<string> = new Set([
  ...LOGIN_SEGMENTS,
  ...WEAK_LOGIN_SEGMENTS,
  "signup",
  "sign-up",
  "sign_up",
  "register",
  "registration",
  "join",
  "password",
  "passwords",
  "reset",
  "reset-password",
  "forgot",
  "forgot-password",
  "account",
  "accounts",
]);

/** 로그인만 하는 외부 호스트 — 앱이 아니라 인증 서비스의 것이다. */
const AUTH_HOSTS: ReadonlySet<string> = new Set([
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "accounts.kakao.com",
  "kauth.kakao.com",
  "nid.naver.com",
]);
const AUTH_HOST_SUFFIXES = [
  ".okta.com",
  ".oktapreview.com",
  ".auth0.com",
  ".b2clogin.com",
  ".amazoncognito.com",
  ".onelogin.com",
];

/** 상호작용 요소가 이보다 적어야 「로그인 틀만 선 화면」 이다 — 아이디 · 비밀번호 · 단추 · 링크 몇 개의 크기. */
export const WALL_FEW_INTERACTIVE = 8;

/** 열어 달라고 한 주소를 읽는다 — 경로만 든 요청도 읽히게 가짜 뿌리를 둔다. 못 읽으면 null. */
function parseRequested(value: string): URL | null {
  try {
    return new URL(value, "http://preview.invalid");
  } catch {
    return null;
  }
}

/** 닿은 주소를 읽는다 — 페이지가 내놓은 전체 주소만 받는다(경로 조각이면 깨진 값이다). 못 읽으면 null. */
function parseArrived(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * 비교하는 경로 — 끝 슬래시를 뗀 경로에 해시 경로(`#/members`)를 이은 것이다. 해시 라우터 앱은 경로가 늘 `/` 라
 * 해시까지 봐야 화면이 갈린다.
 */
function routeOf(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const hashRoute = url.hash.startsWith("#/") ? url.hash.slice(1) : "";
  return path === "/" && hashRoute !== "" ? hashRoute : `${path}${hashRoute}`;
}

function hasSegment(route: string, words: ReadonlySet<string>): boolean {
  return route
    .toLowerCase()
    .split("/")
    .some((segment) => words.has(segment.replace(/\.[a-z0-9]+$/, "")));
}

function isAuthHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  // github.com 은 앱도 많은 호스트라 로그인 경로일 때만이다.
  if (host === "github.com") return /^\/(login|sessions?)(\/|$)/i.test(url.pathname);
  return AUTH_HOSTS.has(host) || AUTH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** 페이지가 내놓은 수 — 숫자가 아니거나 음수 · 무한이면 모르는 것이다. */
function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 이 열기가 로그인 벽에 닿았는가 — 닿았으면 이유, 아니면 null. `requested` 는 열어 달라고 한 주소(미리보기
 * 안의 경로, 전체 주소여도 된다). `arrival` 이 없으면(드라이버가 도착한 자리를 못 알려 줬다) 모르는 것이라 null.
 */
export function loginWallOf(
  requested: string,
  arrival: PreviewArrival | undefined,
): LoginWallReason | null {
  if (arrival === undefined) return null;
  const finalUrl = parseArrived(arrival.url);
  const wanted = parseRequested(requested);
  if (finalUrl === null || wanted === null) return null;
  const wantedRoute = routeOf(wanted);
  if (hasSegment(wantedRoute, AUTH_SEGMENTS)) return null;
  if (isAuthHost(finalUrl)) return "auth-host";
  const finalRoute = routeOf(finalUrl);
  const passwords = countOf(arrival.passwordFields);
  if (finalRoute !== wantedRoute) {
    if (hasSegment(finalRoute, LOGIN_SEGMENTS)) return "login-path";
    // 약한 낱말은 비밀번호 칸이 함께 있을 때만 — 칸 수를 모르면(null) 세지 않는다.
    if (passwords !== null && passwords >= 1 && hasSegment(finalRoute, WEAK_LOGIN_SEGMENTS)) {
      return "login-path";
    }
  }
  const interactive = countOf(arrival.interactive);
  if (passwords === 1 && interactive !== null && interactive <= WALL_FEW_INTERACTIVE) {
    return "password-form";
  }
  return null;
}
