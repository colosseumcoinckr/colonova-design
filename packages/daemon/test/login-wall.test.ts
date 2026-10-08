// 로그인 벽 판정(2026-10-07 베타 준비 분석)의 표 시험. src 임포트인 이유는 common-instructions.test.ts 와 같다 — 이 모듈은
// 형제를 부르지 않는 순수 판정이라 node 의 타입 지우기로 그대로 읽힌다. 드라이버가 닿은 자리를 재는 부분(데스크톱)은 로컬 전용이다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIN_WALL_NOTICE, type LoginWallReason, loginWallOf } from "../src/login-wall.ts";

const ORIGIN = "http://127.0.0.1:5274";

/** 한 줄: 요청한 주소 · 닿은 주소 · 비밀번호 칸 수 · 상호작용 요소 수 → 판정. */
type Row = [
  name: string,
  requested: string,
  arrived: string,
  passwordFields: number,
  interactive: number,
  expected: LoginWallReason | null,
];

const rows: Row[] = [
  // (a) 경로가 달라졌고 최종 경로가 로그인 모양 — 강한 신호
  ["/login 으로 튕김", "/members", `${ORIGIN}/login?next=%2Fmembers`, 1, 5, "login-path"],
  ["/signin", "/members", `${ORIGIN}/signin`, 0, 3, "login-path"],
  ["/sign-in", "/members", `${ORIGIN}/sign-in`, 0, 30, "login-path"],
  ["/auth/login", "/members", `${ORIGIN}/auth/login`, 1, 20, "login-path"],
  ["django 의 /accounts/login/", "/members", `${ORIGIN}/accounts/login/`, 1, 6, "login-path"],
  [
    "강한 낱말은 비밀번호 칸이 없어도 선다(/login)",
    "/members",
    `${ORIGIN}/login`,
    0,
    2,
    "login-path",
  ],
  [
    "/settings/login — 강한 낱말은 하위 경로여도 선다",
    "/settings",
    `${ORIGIN}/settings/login`,
    0,
    3,
    "login-path",
  ],
  [
    "/admin/sso/login — 약한 낱말 뒤의 강한 낱말",
    "/admin",
    `${ORIGIN}/admin/sso/login`,
    0,
    3,
    "login-path",
  ],
  // (a') 약한 낱말(auth · sso · oauth · saml) — 도착 화면에 비밀번호 칸이 있을 때만 벽이다
  ["/sso 에 비밀번호 칸이 있다", "/members", `${ORIGIN}/sso`, 1, 4, "login-path"],
  ["/auth 에 비밀번호 칸이 있다", "/dashboard", `${ORIGIN}/auth`, 1, 12, "login-path"],
  [
    "/oauth/authorize 에 비밀번호 칸이 있다",
    "/members",
    `${ORIGIN}/oauth/authorize`,
    1,
    4,
    "login-path",
  ],
  ["/oauth2/start 에 비밀번호 칸이 있다", "/members", `${ORIGIN}/oauth2/start`, 1, 5, "login-path"],
  ["/saml 에 비밀번호 칸이 있다", "/members", `${ORIGIN}/saml`, 1, 5, "login-path"],
  [
    "해시 라우터의 #/auth 에 비밀번호 칸이 있다",
    "/#/members",
    `${ORIGIN}/#/auth`,
    1,
    12,
    "login-path",
  ],
  [
    "/settings → /settings/auth 도 비밀번호 칸이 있으면 센다",
    "/settings",
    `${ORIGIN}/settings/auth`,
    1,
    12,
    "login-path",
  ],
  ["확장자가 붙은 /login.html", "/members", `${ORIGIN}/login.html`, 0, 4, "login-path"],
  ["요청이 전체 주소여도", `${ORIGIN}/members`, `${ORIGIN}/login`, 0, 4, "login-path"],
  ["해시 라우터의 #/login", "/#/members", `${ORIGIN}/#/login`, 0, 4, "login-path"],
  // (a) 외부 인증 호스트 — 강한 신호
  [
    "구글 계정",
    "/members",
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
    0,
    9,
    "auth-host",
  ],
  [
    "마이크로소프트",
    "/members",
    "https://login.microsoftonline.com/common/oauth2/authorize",
    0,
    3,
    "auth-host",
  ],
  ["okta", "/members", "https://acme.okta.com/login/login.htm", 1, 4, "auth-host"],
  ["auth0", "/members", "https://acme.us.auth0.com/authorize?x=1", 0, 4, "auth-host"],
  [
    "깃허브 로그인",
    "/members",
    "https://github.com/login?return_to=%2Flogin%2Foauth",
    1,
    5,
    "auth-host",
  ],
  ["카카오 · 네이버", "/members", "https://nid.naver.com/nidlogin.login", 1, 6, "auth-host"],
  // (b) 같은 경로인데 로그인 틀만 선 화면 — 비밀번호 칸 하나와 극히 적은 요소
  ["같은 주소에 선 로그인 틀", "/members", `${ORIGIN}/members`, 1, 4, "password-form"],
  ["경계: 요소 8개", "/members", `${ORIGIN}/members`, 1, 8, "password-form"],
  ["다른 경로로 갔고 그곳에 로그인 틀이 있다", "/members", `${ORIGIN}/`, 1, 5, "password-form"],
  [
    "약한 낱말의 경로가 아니어도 같은 주소의 로그인 틀은 그대로 센다",
    "/settings",
    `${ORIGIN}/settings`,
    1,
    3,
    "password-form",
  ],
  // 거짓 양성이 없어야 하는 것
  ["정상 화면", "/members", `${ORIGIN}/members`, 0, 25, null],
  ["일반 리다이렉트 / → /home", "/", `${ORIGIN}/home`, 0, 12, null],
  ["옛 주소 → 새 주소", "/old-members", `${ORIGIN}/members`, 0, 12, null],
  ["언어 접두사", "/members", `${ORIGIN}/ko/members`, 0, 12, null],
  ["끝 슬래시만 다르다", "/members", `${ORIGIN}/members/`, 0, 12, null],
  ["쿼리만 다르다", "/members?tab=1", `${ORIGIN}/members?tab=2`, 0, 12, null],
  ["해시 라우터의 정상 화면", "/#/members", `${ORIGIN}/#/members`, 0, 12, null],
  [
    "login 이 든 다른 낱말(login-history)",
    "/members",
    `${ORIGIN}/profile/login-history`,
    0,
    9,
    null,
  ],
  ["author 는 auth 가 아니다", "/members", `${ORIGIN}/authors`, 0, 9, null],
  ["깃허브의 일반 화면", "/members", "https://github.com/acme/repo", 0, 40, null],
  ["다른 외부 사이트(결제)", "/pay", "https://checkout.example.com/session", 0, 6, null],
  ["비밀번호 칸이 있어도 요소가 많다(앱 안의 폼)", "/members", `${ORIGIN}/members`, 1, 9, null],
  ["비밀번호 칸이 둘(변경 · 가입 폼)", "/members", `${ORIGIN}/members`, 2, 4, null],
  ["?login=1 같은 쿼리는 경로가 아니다", "/members", `${ORIGIN}/?login=1`, 0, 12, null],
  // 약한 낱말만으로는 벽이 아니다 — 인증 설정 · 문서 · 관리 화면(2026-10-08 검토 FIX1 의 거짓 양성)
  ["/settings → /settings/auth", "/settings", `${ORIGIN}/settings/auth`, 0, 12, null],
  ["/docs → /docs/auth", "/docs", `${ORIGIN}/docs/auth`, 0, 30, null],
  ["/admin → /admin/sso", "/admin", `${ORIGIN}/admin/sso`, 0, 15, null],
  ["/admin → /admin/oauth", "/admin", `${ORIGIN}/admin/oauth`, 0, 15, null],
  ["/admin → /admin/saml", "/admin", `${ORIGIN}/admin/saml`, 0, 15, null],
  [
    "/sso 에 비밀번호 칸이 없다(SSO 단추만 선 화면은 모름으로 둔다)",
    "/members",
    `${ORIGIN}/sso`,
    0,
    2,
    null,
  ],
  ["/oauth/authorize 에 비밀번호 칸이 없다", "/members", `${ORIGIN}/oauth/authorize`, 0, 4, null],
  ["/auth 에 비밀번호 칸이 없다", "/dashboard", `${ORIGIN}/auth`, 0, 12, null],
  [
    "칸 수를 모르면 약한 낱말은 세지 않는다",
    "/settings",
    `${ORIGIN}/settings/auth`,
    Number.NaN,
    12,
    null,
  ],
  ["약한 낱말이 요청과 같은 경로(요청이 /auth)", "/auth", `${ORIGIN}/auth`, 1, 12, null],
  // 사용자가 인증 화면 자체를 열어 달라고 한 것 — 로그인 화면을 만드는 사람이 그 화면을 확인한다
  ["/login 을 열었다", "/login", `${ORIGIN}/login`, 1, 4, null],
  ["/login 의 쿼리", "/login", `${ORIGIN}/login?error=1`, 1, 4, null],
  ["/signup", "/signup", `${ORIGIN}/signup`, 1, 4, null],
  ["/account/password", "/account/password", `${ORIGIN}/account/password`, 1, 3, null],
  ["/login 이 구글로 보낸다", "/login", "https://accounts.google.com/o/oauth2/v2/auth", 0, 3, null],
];

for (const [name, requested, arrived, passwordFields, interactive, expected] of rows) {
  test(`로그인 벽 — ${name}`, () => {
    const reason = loginWallOf(requested, { url: arrived, passwordFields, interactive });
    assert.equal(reason, expected);
  });
}

test("닿은 자리를 모르면 벽이라고 말하지 않는다 — 재지 못한 것은 문제 없음이 아니라 모름이다", () => {
  assert.equal(loginWallOf("/members", undefined), null);
});

test("페이지가 내놓은 값을 그대로 믿지 않는다 — 깨진 주소 · 숫자가 아닌 칸은 조용히 모름이다", () => {
  const bad = (url: string, passwordFields: unknown, interactive: unknown) =>
    loginWallOf("/members", { url, passwordFields, interactive } as never);
  assert.equal(bad("not a url at all", 1, 2), null);
  assert.equal(bad(`${ORIGIN}/members`, "1", 2), null);
  assert.equal(bad(`${ORIGIN}/members`, 1, Number.NaN), null);
  assert.equal(bad(`${ORIGIN}/members`, 1, -3), null);
  assert.equal(bad(`${ORIGIN}/members`, Number.POSITIVE_INFINITY, 2), null);
  assert.equal(
    bad(`${ORIGIN}/login`, undefined, undefined),
    "login-path",
    "경로 신호는 숫자 없이도 선다",
  );
});

test("AI 가 읽는 한 문장은 확인하지 못했다고 알리게 한다", () => {
  assert.match(LOGIN_WALL_NOTICE, /^이 화면은 로그인 화면으로 이동했어요/);
  assert.match(LOGIN_WALL_NOTICE, /확인하지 못했다고 알려 주세요/);
  assert.match(LOGIN_WALL_NOTICE, /notify_developer/);
});
