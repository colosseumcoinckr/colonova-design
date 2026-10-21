/**
 * Confluence REST client — 기획서 동기화 1단계의 읽기 전용 클라이언트
 * (docs/confluence-sync-plan-2026-10-18.md · docs/confluence-sync-design-2026-10-18.md, 2026-10-18).
 * 자격(이메일 + API 토큰)과 주입된 RestTransport 만 안다 — 이 파일의 어떤 길도
 * 주어진 전송 밖으로 나가지 않고, 토큰은 헤더로만 탄다(github.ts 와 같은 약속).
 * 기본 인증은 이메일과 토큰이 한 몸이다 — 헤더 조립은 `headers()` 한 곳뿐이다.
 *
 * 읽기 실패는 던지지 않는다 — `readable: false` 와 한 단어 분류로 내려앉힌다
 * (github-ci 선례). 401 은 연결 끊김(다시 connect 하면 이어받는다), 403 은 권한,
 * 409 는 판 충돌, 429 는 한도(`BUDGETS.limitRetry` 사다리 — 한 분에서 두 배, 최대
 * 10분 · 2026-10-08 F14 선례), 그 밖은 unavailable 이다.
 *
 * Endpoints used (실측 2026-10-18 — docs/confluence-sync-plan-2026-10-18.md · cite in every fixture):
 *   GET /wiki/api/v2/pages/{id}?body-format=storage  — 정본 한 문서(저장 포맷 원문)
 *   GET /wiki/api/v2/pages/{id}/children             — 트리 걷기(직접 아이 · `_links.next`)
 *   GET /wiki/rest/api/search?cql=…                  — CQL 증분(`type=page` 를 묶는 건 호출자 — 코멘트가 섞인다 · 실측)
 *   GET /wiki/api/v2/pages/{id}/footer-comments      — 바닥글 · 답글(부모 id)
 *   GET /wiki/api/v2/pages/{id}/inline-comments      — 인라인 · 해결 상태(REST 해결 읽기는 아직 미실측 — 사전 검증 2)
 *   GET /wiki/api/v2/users/{accountId}               — 코멘트 작성자 이름(뷰어의 「작성자」 · 캐시로 끊는다)
 *   GET /wiki/rest/api/user/current                  — 인증 검증(사전 검증 1 · 실측 2026-10-18 — v2 의 users/me 는
 *                                                      이 게이트웨이에서 400 이라 v1 current 로 간다)
 */

import { BUDGETS, backoffDelay } from "./budgets.js";
import {
  FetchRestTransport,
  FixtureTransport,
  firstLine,
  loadFixturePairs,
  nextLink,
  type RestTransport,
} from "./rest-transport.js";

/** 연결 한 벌 — 사이트 주소와 이메일 · 토큰 짝. 이메일도 개인 식별자라 비밀 취급이다. */
export interface ConfluenceCredentials {
  /** 예: colosseum.atlassian.net — 프로토콜 없이, Confluence 화면 주소의 이름. */
  site: string;
  email: string;
  token: string;
}

/** 한 문서의 정본 — 저장 포맷 원문이 곧 문서다. 마크다운은 파생물이다(1단계 원칙 1). */
export interface ConfluencePage {
  id: string;
  title: string;
  spaceId: string | null;
  /** 판 번호 — Confluence 가 쓸 때마다 올린다. 발행(2단계)의 낙관적 잠금 잣대다. */
  version: number;
  storage: string;
  parentId: string | null;
  /** 이 판이 만들어진 시각(version.createdAt) — 파생 마크다운 frontmatter 의 updatedAt. */
  updatedAt: string | null;
}

/** 목록 한 줄 — id 와 제목만. 본문은 `readPage` 로 따로 읽는다. */
export interface ConfluenceChild {
  id: string;
  title: string;
  /**
   * 판 번호 — 검색을 `withVersion` 으로 부를 때만 실린다(`expand=content.version`, 2026-10-19). 증분이 원장의
   * 판과 대어 본문 읽기를 건너뛰는 재료다. 응답이 안 주면 없다 — 부르는 쪽은 readPage 의 판으로 돌아간다.
   */
  version?: number;
}

/** 코멘트 한 줄 — 바닥글 · 인라인 공용 모양. 본문 사본은 만들지 않는다(원칙 1 — doc.read 가 읽을 때 실는다). */
export interface ConfluenceComment {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string | null;
  /** 답글 — 부모 코멘트 id. 바닥글 스레드가 그대로 온다(2026-10-18 실측). */
  parentId: string | null;
  /**
   * 해결 상태 — 인라인의 몫이다. REST 로 읽는 길은 앱 자체 실측이 아직 없다(사전 검증 2 — 2단계 착수 전 검증),
   * 모양이 갈리는 것을 한데 읽되 모르면 열린 것으로 흘린다(안 풀린 것만 보이는 게 뷰어의 약속이라).
   */
  resolved: boolean;
  /** 인라인 닻 — 본문 텍스트 선택(2026-10-18 실측). 응답이 안 주면 없는 것이다. */
  anchorText: string | null;
}

/** 인증 검증의 답 — github.ts 의 whoAmI 선례. 실패 문장은 재연결의 길을 가리킨다. */
export type WhoAmI =
  | { ok: true; accountId: string; displayName: string }
  | { ok: false; reason: "unauthorized" | "forbidden" | "unreachable"; detail: string };

/** 읽기 실패의 한 단어 — 원장 밖 상태와 상태 문장이 이 말로 흐른다(계획 M1 · 401 expired 선례). */
export type ConfluenceReadFailure =
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "limit"
  | "unavailable";

/** 읽기의 약속 — 던지지 않는다. `readable: false` 는 「없다」 가 아니라 「읽지 못했다」 다. */
export type ConfluenceRead<T> =
  | { readable: true; value: T }
  | { readable: false; reason: ConfluenceReadFailure; detail: string };

/** 한도 사다리 — 429 를 이만큼 오른 뒤에도 막히면 한도로 분류하고 돌아온다. 시간은 BUDGETS.limitRetry 의 몫이다. */
const LIMIT_ATTEMPTS = 3;

/** 목록이 따라가는 쪽 상한 — github.ts 의 COMMENT_PAGE_CAP 과 같은 감각. 그 너머는 사람의 몫이다. */
const PAGE_CAP = 10;

/**
 * 사이트 이름의 관용 — 사용자가 `https://…` 나 끝의 `/wiki` 를 붙여 넣어도 한 벌로 만든다
 * (설정 연결 입력 · MCP 의 CONFLUENCE_URL 같은 env 관례 모두). 클라이언트는 이름만 안다.
 */
export function normalizeSite(site: string): string {
  return site
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/\/wiki$/i, "");
}

/**
 * Fixture transport when COLONOVA_DESIGN_CONFLUENCE_FIXTURE points at a loadable
 * fixture directory; otherwise a fetch transport against the user's site
 * (COLONOVA_DESIGN_CONFLUENCE_API repoints it — tests and offline work).
 * A fixture directory that fails to load STOPS HERE — it never falls back to
 * the fetch transport, because that would send credential-bearing requests to
 * the real site while the caller believes it is talking to a recording
 * (2026-10-18 코호트 지적 — 삼킨 실패는 자격을 실은 요청을 기록 바깥으로 보낸다).
 */
export function createConfluenceTransport(
  env: NodeJS.ProcessEnv,
  site: string,
): { transport: RestTransport; fixtureDir: string | null } {
  const base = (env.COLONOVA_DESIGN_CONFLUENCE_API ?? `https://${normalizeSite(site)}`).replace(
    /\/+$/,
    "",
  );
  const fixtureDir = env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE ?? null;
  if (fixtureDir) {
    return { transport: new FixtureTransport(loadFixturePairs(fixtureDir)), fixtureDir };
  }
  return { transport: new FetchRestTransport(base), fixtureDir: null };
}

/** 기다림은 주입한다 — 시험은 자지 않는다(CI 는 프로세스를 띄우지 않는다). */
export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ConfluenceClient {
  constructor(
    private readonly creds: ConfluenceCredentials,
    private readonly transport: RestTransport,
    private readonly sleep: Sleep = realSleep,
  ) {}

  /**
   * The user this email+token acts as — 사전 검증 1 의 한 끝(앱 자체 기본 인증).
   * 답은 던지지 않고 분류로 돌아온다: 401 은 자격이 틀렸거나 만료된 것이다.
   * 실측(2026-10-18) — v2 의 users/me 는 이 게이트웨이에서 400(generic-content-type
   * 라우팅)이라, 인증 검증은 v1 의 user/current 로 간다.
   */
  async whoAmI(): Promise<WhoAmI> {
    const read = await this.requestRead("/wiki/rest/api/user/current", "Confluence 연결 확인");
    if (read.readable === false) {
      if (read.reason === "unauthorized") {
        return {
          ok: false,
          reason: "unauthorized",
          detail: read.detail,
        };
      }
      return {
        ok: false,
        reason: read.reason === "forbidden" ? "forbidden" : "unreachable",
        detail: read.detail,
      };
    }
    const accountId = asString(read.value.accountId);
    const displayName =
      asString(read.value.displayName) ??
      asString(read.value.publicName) ??
      asString(read.value.email);
    if (!accountId && !displayName) {
      return {
        ok: false,
        reason: "unreachable",
        detail: "Confluence 응답을 읽지 못했습니다.",
      };
    }
    return { ok: true, accountId: accountId ?? "", displayName: displayName ?? accountId ?? "" };
  }

  /** 정본 한 문서 — 저장 포맷 원문과 판. 없는 문서(404)도 읽지 못함의 한 갈래다(원장이 진실을 안다). */
  async readPage(pageId: string): Promise<ConfluenceRead<ConfluencePage>> {
    const read = await this.requestRead(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`,
      "문서 읽기",
    );
    if (read.readable === false) return read;
    const row = read.value;
    const id = asString(row.id);
    const storage = asString(asRecord(asRecord(row.body)?.storage)?.value);
    if (!id || storage === null) {
      return {
        readable: false,
        reason: "unavailable",
        detail: "문서 읽기에 실패했습니다 — 응답에 본문이 없습니다.",
      };
    }
    return {
      readable: true,
      value: {
        id,
        title: asString(row.title) ?? "",
        spaceId: asString(row.spaceId),
        version: asNumber(asRecord(row.version)?.number) ?? 0,
        storage,
        parentId: asString(row.parentId),
        updatedAt: asString(asRecord(row.version)?.createdAt),
      },
    };
  }

  /** 한 문서의 직접 아이 — 트리 걷기는 호출자(가져오기 루프)가 재귀로 한다. */
  async listChildren(pageId: string): Promise<ConfluenceRead<ConfluenceChild[]>> {
    const first = `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/children?limit=100`;
    return await this.listRows(first, "트리 읽기", (row) => {
      const id = asString(row.id);
      if (!id) return null;
      return { id, title: asString(row.title) ?? "" };
    });
  }

  /**
   * CQL 검색 — 증분(`lastModified >`)과 기준 페이지 찾기의 길. 코멘트가 섞여 오니 `type=page` 는 호출자가 묶는다(실측).
   * 제목은 `content.title` 이 먼저다 — 결과 줄의 `title` 은 찾는 말의 강조 표지가 섞일 수 있다(2026-10-19).
   */
  async searchPages(
    cql: string,
    opts: { withVersion?: boolean } = {},
  ): Promise<ConfluenceRead<ConfluenceChild[]>> {
    const expand = opts.withVersion === true ? "&expand=content.version" : "";
    const first = `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=100${expand}`;
    return await this.listRows(first, "문서 찾기", (row) => {
      const content = asRecord(row.content);
      const id = asString(content?.id);
      if (!id) return null;
      const title = asString(content?.title) ?? asString(row.title) ?? "";
      const version = asNumber(asRecord(content?.version)?.number);
      return version === null ? { id, title } : { id, title, version };
    });
  }

  /** 바닥글 코멘트 — 답글은 부모 id 로 온다(실측). 읽지 못하면 읽지 못함이고, 뷰어는 수만 잃는다. */
  async listFooterComments(pageId: string): Promise<ConfluenceRead<ConfluenceComment[]>> {
    const first = `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/footer-comments?limit=100`;
    return await this.listRows(first, "코멘트 읽기", commentOf);
  }

  /** 인라인 코멘트 — 닻(본문 선택)과 해결 상태. 해결의 REST 모양은 사전 검증 2 의 입력이다. */
  async listInlineComments(pageId: string): Promise<ConfluenceRead<ConfluenceComment[]>> {
    const first = `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/inline-comments?limit=100`;
    return await this.listRows(first, "코멘트 읽기", commentOf);
  }

  /** 코멘트 작성자의 이름 — v2 는 id 만 주므로 따로 읽는다. 캐시가 같은 사람을 두 번 묻지 않게 하고, 실패는 이름 없음으로 흘린다. */
  async userName(accountId: string): Promise<string | null> {
    const cached = this.names.get(accountId);
    if (cached !== undefined) return cached;
    const read = await this.requestRead(
      `/wiki/api/v2/users/${encodeURIComponent(accountId)}`,
      "작성자 읽기",
    );
    const name = read.readable ? asString(read.value.displayName) : null;
    this.names.set(accountId, name);
    return name;
  }

  private readonly names = new Map<string, string | null>();
  /**
   * 공간의 열쇠(예: COLO) — 폴더 경로의 첫 걸음이 공간 열쇠다(설계 문서의 폴더 예시).
   * 실측 계획의 엔드포인트 목록에 없는 한 읽기지만 v2 spaces 의 같은 족속이고, 실패는
   * 열쇠 없음(폴더 첫 걸음을 뿌리 제목만으로)으로 흘린다.
   */
  async spaceKey(spaceId: string): Promise<string | null> {
    const cached = this.spaceKeys.get(spaceId);
    if (cached !== undefined) return cached;
    const read = await this.requestRead(
      `/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}`,
      "공간 읽기",
    );
    const key = read.readable ? asString(read.value.key) : null;
    this.spaceKeys.set(spaceId, key);
    return key;
  }

  private readonly spaceKeys = new Map<string, string | null>();

  /**
   * 목록 한 끝까지 — 첫 주소에서 시작해 다음 쪽 표지(v2 는 `_links.next`, v1 CQL 은 Link 헤더)를 상한(PAGE_CAP)까지
   * 따라간다. 모양을 다르게 읽는 것은 `pick` 이고, 아이가 없는 줄은 거른다. 실패는 전체의 실패로 돌아온다 —
   * 빈 목록은 「읽었는데 없다」 일 때만 나온다(github-ci 선례).
   */
  private async listRows<T>(
    first: string,
    label: string,
    pick: (row: Record<string, unknown>) => T | null,
  ): Promise<ConfluenceRead<T[]>> {
    const rows: T[] = [];
    let next: string | null = first;
    for (let page = 0; page < PAGE_CAP && next !== null; page += 1) {
      const url = next;
      let data: unknown;
      if (this.isCql(url)) {
        const read = await this.requestRead(url, label, { headers: true });
        if (read.readable === false) return read;
        data = read.value;
        next = nextLink(read.headers?.link);
      } else {
        const read = await this.requestRead(url, label);
        if (read.readable === false) return read;
        data = read.value;
        next = bodyNext(data);
      }
      const list = asRecord(data)?.results;
      if (Array.isArray(list)) {
        for (const row of list) {
          const record = asRecord(row);
          if (record === null) continue;
          const value = pick(record);
          if (value !== null) rows.push(value);
        }
      }
    }
    return { readable: true, value: rows };
  }

  private isCql(url: string): boolean {
    return url.startsWith("/wiki/rest/api/search");
  }

  /**
   * 읽기의 한 끝 — 요청을 날리고 상태를 한 단어로 가른다. 429 는 LIMIT_ATTEMPTS 계단의 사다리를 탄다
   * (`BUDGETS.limitRetry` — 한 분에서 두 배, 최대 10분; github 푸시와 같은 한도 예의). 사다리가 끝나도
   * 막히면 `limit` 로 돌아온다: 시간이 푸는 문제니 두드리지 않는 것이 예의다(2026-10-08 F14).
   * 실패 문장은 API 의 말과 표지뿐이다 — 토큰은 헤더로만 타므로 어디에도 실리지 않는다.
   */
  private async requestRead(
    url: string,
    label: string,
    opts: { headers?: boolean } = {},
  ): Promise<
    | { readable: true; value: Record<string, unknown>; headers?: Record<string, string> }
    | { readable: false; reason: ConfluenceReadFailure; detail: string }
  > {
    for (let attempt = 1; ; attempt += 1) {
      let status: number;
      let body: Uint8Array;
      let headers: Record<string, string> | undefined;
      try {
        ({ status, body, headers } = await this.transport.request({
          method: "GET",
          url,
          headers: this.headers(),
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          readable: false,
          reason: "unavailable",
          detail: `${label}에 실패했습니다 — Confluence에 연결하지 못했습니다 (${firstLine(reason)})`,
        };
      }
      if (status === 429 && attempt < LIMIT_ATTEMPTS) {
        await this.sleep(
          backoffDelay(attempt, BUDGETS.limitRetry.baseMs, BUDGETS.limitRetry.capMs),
        );
        continue;
      }
      if (status < 200 || status >= 300) {
        return {
          readable: false,
          reason:
            status === 401
              ? "unauthorized"
              : status === 403
                ? "forbidden"
                : status === 409
                  ? "conflict"
                  : status === 429
                    ? "limit"
                    : "unavailable",
          detail:
            status === 401
              ? `${label}에 실패했습니다 — Confluence 연결이 만료됐거나 자격이 틀렸습니다. 설정에서 다시 연결해 주세요.`
              : httpError(label, status, body),
        };
      }
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(body));
      } catch {
        // A 2xx that is not JSON (a proxy's login page) is a failed read, not
        // a parse crash — github.ts whoAmI 의 관용과 같다.
        return {
          readable: false,
          reason: "unavailable",
          detail: `${label}에 실패했습니다 — Confluence 응답을 읽지 못했습니다.`,
        };
      }
      const record = asRecord(value);
      if (record === null) {
        return {
          readable: false,
          reason: "unavailable",
          detail: `${label}에 실패했습니다 — Confluence 응답을 읽지 못했습니다.`,
        };
      }
      return opts.headers
        ? { readable: true, value: record, headers }
        : { readable: true, value: record };
    }
  }

  /** 자격의 한 몸 — 이메일:토큰 짝을 기본 인증으로. 조립은 이 한 곳뿐이다. */
  private headers(): Record<string, string> {
    const pair = Buffer.from(`${this.creds.email}:${this.creds.token}`, "utf8").toString("base64");
    return { authorization: `Basic ${pair}`, accept: "application/json" };
  }
}

/** v2 목록의 다음 쪽 — `_links.next`(상대 경로)를 transport 의 url 로 바꾼다. 절대 주소는 잘라 붙인다. */
function bodyNext(data: unknown): string | null {
  const next = asString(asRecord(asRecord(data)?._links)?.next);
  if (!next) return null;
  if (!/^https?:\/\//i.test(next)) return next;
  try {
    const url = new URL(next);
    return `${url.pathname}${url.search}`;
  } catch {
    return next;
  }
}

/** 코멘트 한 줄 읽기 — 모양이 갈리는 것(바닥글 · 인라인 · 옛 필드)을 한데 읽고 모르면 빈 값으로 흘린다. */
function commentOf(row: Record<string, unknown>): ConfluenceComment | null {
  const id = asString(row.id);
  if (!id) return null;
  const inlineProps =
    asRecord(row.inlineProperties) ?? asRecord(asRecord(row.properties)?.inlineProperties);
  return {
    id,
    authorId: asString(row.authorId),
    body: asString(asRecord(asRecord(row.body)?.storage)?.value) ?? "",
    createdAt: asString(row.createdAt),
    parentId: asString(row.parentId),
    resolved:
      row.resolutionStatus === "resolved" ||
      asRecord(asRecord(row.status))?.resolution === "resolved" ||
      asRecord(row.resolution)?.status === "resolved",
    anchorText: asString(inlineProps?.selection),
  };
}

/** The API's own `message`, never the request: the token only ever rides in a
 * header, so nothing quoted back here can carry it (github.ts 와 같은 보장). */
function httpError(label: string, status: number, body: Uint8Array): string {
  const text = new TextDecoder().decode(body.subarray(0, 1000));
  let message = text.split("\n")[0] ?? "";
  try {
    const parsed = JSON.parse(text) as { message?: string };
    message = parsed.message ?? message;
  } catch {
    // Not JSON (a proxy's html error page); the first line is the best we have.
  }
  return `${label}에 실패했습니다 — Confluence ${status}: ${message}`;
}

/** 모르는 모양의 관용 — 레코드가 아니면 없는 것이다. 원장 parse 의 「깨진 값 버림」과 같은 마음가짐이다. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
