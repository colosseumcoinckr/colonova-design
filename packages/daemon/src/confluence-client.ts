/**
 * Confluence REST client — 기획서 동기화 1단계의 읽기 클라이언트에 쓰기 손잡이를 얹었다
 * (2026-10-23 최종 구현 계획 F2 · 읽기는 docs/confluence-sync-plan-2026-10-18.md 의 1단계).
 * 자격(이메일 + API 토큰)과 주입된 RestTransport 만 안다 — 이 파일의 어떤 길도
 * 주어진 전송 밖으로 나가지 않고, 토큰은 헤더로만 탄다(github.ts 와 같은 약속).
 * 기본 인증은 이메일과 토큰이 한 몸이다 — 헤더 조립은 `headers()` 한 곳뿐이다.
 *
 * 읽기 실패는 던지지 않는다 — `readable: false` 와 한 단어 분류로 내려앉힌다
 * (github-ci 선례). 401 은 연결 끊김(다시 connect 하면 이어받는다), 403 은 권한,
 * 409 는 판 충돌, 429 는 한도(`BUDGETS.limitRetry` 사다리 — 한 분에서 두 배, 최대
 * 10분 · 2026-10-08 F14 선례), 그 밖은 unavailable 이다.
 *
 * 쓰기도 던지지 않는다 — `written: false` 와 한 단어 분류다(2026-10-23 최종 구현 계획 F2).
 * 쓰기는 자동으로 다시 보내지 않는다 — 다시 보내면 같은 문서가 둘 생긴다. 429 만 거절이
 * 확실하므로 읽기와 같은 사다리를 탄다. `unknown` 은 「적용됐는지 모른다」 다 — 네트워크
 * 실패 · 5xx · 2xx 인데 응답을 못 읽음이며, 부르는 쪽이 원격을 다시 읽어 대조한다.
 *
 * Endpoints used (실측 2026-10-18 — docs/confluence-sync-plan-2026-10-18.md · cite in every fixture):
 *   GET /wiki/api/v2/pages/{id}?body-format=storage  — 정본 한 문서(저장 포맷 원문)
 *   GET /wiki/api/v2/{pages|folders|whiteboards|databases|embeds}/{id}/direct-children
 *                                                    — 트리 걷기(종류 있는 직접 아이 · `_links.next` · 2026-10-23 최종 구현 계획 F0)
 *   GET /wiki/rest/api/search?cql=…                  — CQL 증분(`type=page` 를 묶는 건 호출자 — 코멘트가 섞인다 · 실측)
 *   GET /wiki/api/v2/pages/{id}/footer-comments?body-format=storage — 바닥글 · 답글(부모 id)
 *   GET /wiki/api/v2/pages/{id}/inline-comments?body-format=storage — 인라인 · 해결 상태(REST 해결 읽기는 아직 미실측 — 사전 검증 2)
 *     본문 형식을 밝혀야 본문이 온다 — 해결 · 고치기가 본문을 다시 싣기 때문이다(2026-10-23 오케스트레이터 검토).
 *   GET /wiki/api/v2/users/{accountId}               — 코멘트 작성자 이름(뷰어의 「작성자」 · 캐시로 끊는다)
 *   GET /wiki/rest/api/user/current                  — 인증 검증(사전 검증 1 · 실측 2026-10-18 — v2 의 users/me 는
 *                                                      이 게이트웨이에서 400 이라 v1 current 로 간다)
 *   POST /wiki/api/v2/pages                          — 기획 문서 새 페이지(발행의 새 문서 · 2026-10-23 최종 구현 계획 F2)
 *   PUT /wiki/api/v2/pages/{id}                      — 기존 문서를 새 판으로(판이 어긋나면 409 · F2)
 *   DELETE /wiki/api/v2/pages/{id}                   — 문서를 휴지통으로(빈 몸 204 · F2)
 *   POST /wiki/api/v2/footer-comments                — 바닥글 코멘트 · 답글(2026-10-23 최종 구현 계획 F4 · 작업 D2a)
 *   POST /wiki/api/v2/inline-comments                — 인라인 코멘트 · 답글(문장 닻 · 작업 D2a)
 *   PUT /wiki/api/v2/{footer|inline}-comments/{id}   — 코멘트 고치기 · 해결(판 + 1 · 작업 D2a)
 *   GET /wiki/api/v2/pages/{id}?get-draft=true&body-format=storage — 임시 저장 초안(F2)
 *   GET /wiki/api/v2/pages/{id}/operations           — 문서에 걸린 동작(F2)
 *   GET /wiki/api/v2/pages/{id}/ancestors?limit=250  — 윗문서 줄(id 들 · F2)
 *   GET /wiki/api/v2/pages?space-id=…&title=…&status=current&limit=25 — 제목으로 문서 찾기(F2)
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
  /**
   * 이 판을 쓴 계정(version.authorId) — 발행 결과를 모를 때 "내가 쓴 판인가"를 대 보는 재료다
   * (2026-10-23 · 최종 구현 계획 F2). 응답이 안 주면 없다.
   */
  authorId?: string | null;
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

/** 트리 한 줄 — 폴더 · 화이트보드 등 종류가 실린다. 본문은 페이지만 readPage 로 읽는다(2026-10-23 최종 구현 계획 F0). */
export interface ConfluenceTreeChild {
  id: string;
  title: string;
  /** page | folder | whiteboard | database | embed — 응답이 안 주면 모르는 종류다. */
  type: string;
  /** current · archived — 응답이 안 주면 없는 것이고, 아는 아이만 걷는다. */
  status: string | null;
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
  /**
   * 코멘트의 판(version.number) — 고치기 · 해결의 낙관적 잠금 잣대다(2026-10-23 작업 D2a).
   * 응답이 안 주면 모른다 — 부르는 쪽은 고치기를 거절한다.
   */
  version: number | null;
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

/** 쓰기 실패의 한 단어 — 읽기의 분류에 쓰기의 사정(not-found · invalid · too-large)을 더한다(2026-10-23 최종 구현 계획 F2). */
export type ConfluenceWriteFailure =
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "not-found"
  | "invalid"
  | "too-large"
  | "limit"
  | "unknown";

/**
 * 쓰기의 약속 — 던지지 않는다. `unknown` 은 「적용됐는지 모른다」 다: 네트워크 실패 · 5xx ·
 * 2xx 인데 응답을 못 읽음. 부르는 쪽이 원격을 다시 읽어 대조한다. 쓰기는 자동으로 다시
 * 보내지 않는다 — 다시 보내면 같은 문서가 둘 생긴다(429 만 거절이 확실하니 사다리를 탄다).
 */
export type ConfluenceWrite<T> =
  | { written: true; value: T }
  | { written: false; reason: ConfluenceWriteFailure; detail: string };

/** 한도 사다리 — 429 를 이만큼 오른 뒤에도 막히면 한도로 분류하고 돌아온다. 시간은 BUDGETS.limitRetry 의 몫이다. */
const LIMIT_ATTEMPTS = 3;

/** 목록이 따라가는 쪽 상한 — github.ts 의 COMMENT_PAGE_CAP 과 같은 감각. 그 너머는 사람의 몫이다. */
const PAGE_CAP = 10;

/** direct-children 경로의 복수형 — v2 가 아래를 읽어 주는 다섯 종류다(2026-10-23 최종 구현 계획 F0). */
const TREE_PARENT_SEGMENTS: Record<string, string> = {
  page: "pages",
  folder: "folders",
  whiteboard: "whiteboards",
  database: "databases",
  embed: "embeds",
};

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
    const page = pageOf(read.value);
    if (page === null) {
      return {
        readable: false,
        reason: "unavailable",
        detail: "문서 읽기에 실패했습니다 — 응답에 본문이 없습니다.",
      };
    }
    return { readable: true, value: page };
  }

  /**
   * 한 부모의 직접 아이 — 폴더가 응답에 오르는 v2 계약(2026-10-23 최종 구현 계획 F0). 폐기 예정인
   * children 은 페이지만 돌려주었으므로 폴더 아래 문서가 원장에 들어오지 못했다. 트리 걷기는
   * 호출자(가져오기 루프)가 재귀로 한다.
   */
  async listDirectChildren(
    parentId: string,
    parentType: string,
  ): Promise<ConfluenceRead<ConfluenceTreeChild[]>> {
    const segment = TREE_PARENT_SEGMENTS[parentType];
    if (segment === undefined) {
      return {
        readable: false,
        reason: "unavailable",
        detail: "트리 읽기에 실패했습니다 — 이 종류의 아래는 읽지 못합니다.",
      };
    }
    const first = `/wiki/api/v2/${segment}/${encodeURIComponent(parentId)}/direct-children?limit=250`;
    return await this.listRows(first, "트리 읽기", { requireComplete: true }, (row) => {
      const id = asString(row.id);
      if (!id) return null;
      return {
        id,
        title: asString(row.title) ?? "",
        type: asString(row.type) ?? "unknown",
        status: asString(row.status),
      };
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
    return await this.listRows(first, "문서 찾기", {}, (row) => {
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
    const first = `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/footer-comments?body-format=storage&limit=100`;
    return await this.listRows(first, "코멘트 읽기", {}, commentOf);
  }

  /** 인라인 코멘트 — 닻(본문 선택)과 해결 상태. 해결의 REST 모양은 사전 검증 2 의 입력이다. */
  async listInlineComments(pageId: string): Promise<ConfluenceRead<ConfluenceComment[]>> {
    const first = `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/inline-comments?body-format=storage&limit=100`;
    return await this.listRows(first, "코멘트 읽기", {}, commentOf);
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
   * 기획 문서를 새 페이지로 만든다 — 발행의 「새 문서」 갈래(2026-10-23 최종 구현 계획 F2).
   * 부모가 없으면 본문에서 뺀다 — 공간 뿌리에 오른다. 새 판은 Confluence 가 1 로 연다.
   */
  async createPage(input: {
    spaceId: string;
    parentId: string | null;
    title: string;
    storage: string;
  }): Promise<ConfluenceWrite<{ id: string; version: number; title: string }>> {
    const body: Record<string, unknown> = {
      spaceId: input.spaceId,
      status: "current",
      title: input.title,
      body: { representation: "storage", value: input.storage },
    };
    if (input.parentId !== null) body.parentId = input.parentId;
    const write = await this.requestWrite("POST", "/wiki/api/v2/pages", "문서 만들기", body);
    if (write.written === false) return write;
    const row = asRecord(write.value);
    const id = row === null ? null : asString(row.id);
    if (row === null || id === null) {
      return {
        written: false,
        reason: "unknown",
        detail: "문서 만들기의 결과를 알 수 없습니다 — Confluence 응답을 읽지 못했습니다.",
      };
    }
    return {
      written: true,
      value: {
        id,
        version: asNumber(asRecord(row.version)?.number) ?? 1,
        title: asString(row.title) ?? input.title,
      },
    };
  }

  /**
   * 기존 문서를 새 판으로 쓴다 — 발행의 「고친 문서」 갈래(2026-10-23 최종 구현 계획 F2).
   * `version` 은 새 판 번호(기준 + 1)다. 판이 어긋나면 Confluence 의 409 가 곧 충돌 신호다.
   */
  async updatePage(input: {
    pageId: string;
    title: string;
    storage: string;
    version: number;
    message?: string;
  }): Promise<ConfluenceWrite<{ id: string; version: number }>> {
    const version: Record<string, unknown> = { number: input.version };
    if (input.message !== undefined) version.message = input.message;
    const write = await this.requestWrite(
      "PUT",
      `/wiki/api/v2/pages/${encodeURIComponent(input.pageId)}`,
      "문서 갱신",
      {
        id: input.pageId,
        status: "current",
        title: input.title,
        body: { representation: "storage", value: input.storage },
        version,
      },
    );
    if (write.written === false) return write;
    const row = asRecord(write.value);
    const id = row === null ? null : asString(row.id);
    if (row === null || id === null) {
      return {
        written: false,
        reason: "unknown",
        detail: "문서 갱신의 결과를 알 수 없습니다 — Confluence 응답을 읽지 못했습니다.",
      };
    }
    return {
      written: true,
      value: { id, version: asNumber(asRecord(row.version)?.number) ?? input.version },
    };
  }

  /** 문서를 휴지통으로 옮긴다 — DELETE 의 204 는 빈 몸이다(2026-10-23 최종 구현 계획 F2). */
  async trashPage(pageId: string): Promise<ConfluenceWrite<{ id: string }>> {
    const write = await this.requestWrite(
      "DELETE",
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
      "문서 버리기",
    );
    if (write.written === false) return write;
    return { written: true, value: { id: pageId } };
  }

  /**
   * 문서를 다른 부모 아래 복제한다 — v1 copy 길(2026-10-23 최종 구현 계획 F4 · 작업 D1a).
   * 첨부 · 라벨 · 속성까지 따라온다(정본 계획 §9 — 첨부 있는 복제는 첨부까지 확인한다).
   * 권한은 대상 부모의 것이라 미리보기가 pageOperations 로 본다. 새 문서의 id 만 꺼낸다.
   */
  async copyPage(input: {
    pageId: string;
    parentId: string;
    title: string;
  }): Promise<ConfluenceWrite<{ id: string }>> {
    const write = await this.requestWrite(
      "POST",
      `/wiki/rest/api/content/${encodeURIComponent(input.pageId)}/copy`,
      "문서 복제",
      {
        destination: { type: "parent_page", value: input.parentId },
        pageTitle: input.title,
        copyAttachments: true,
        copyLabels: true,
        copyProperties: true,
        copyPermissions: false,
        copyCustomContents: true,
      },
    );
    if (write.written === false) return write;
    const id = asString(asRecord(write.value)?.id);
    if (id === null) {
      return {
        written: false,
        reason: "unknown",
        detail: "문서 복제의 결과를 알 수 없습니다 — Confluence 응답을 읽지 못했습니다.",
      };
    }
    return { written: true, value: { id } };
  }

  /**
   * 문서의 위치를 옮긴다 — v1 move 의 append 길(2026-10-23 최종 구현 계획 F4 · 작업 D1a).
   * 문서의 id 는 유지된다(G4 의 확인 항목). 응답을 읽을 것이 없어도 옮겨진 것이므로
   * 본래의 id 로 답한다.
   */
  async movePage(input: {
    pageId: string;
    parentId: string;
  }): Promise<ConfluenceWrite<{ id: string }>> {
    const write = await this.requestWrite(
      "PUT",
      `/wiki/rest/api/content/${encodeURIComponent(input.pageId)}/move/append/${encodeURIComponent(input.parentId)}`,
      "문서 옮기기",
    );
    if (write.written === false) return write;
    return { written: true, value: { id: input.pageId } };
  }

  /**
   * 휴지통의 문서를 읽는다 — 복구에 옮길 본문과 판이 필요하다(2026-10-23 작업 D1a).
   * 읽는 해석은 readPage 와 같다.
   */
  async readTrashedPage(pageId: string): Promise<ConfluenceRead<ConfluencePage>> {
    const read = await this.requestRead(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?status=trashed&body-format=storage`,
      "휴지통 문서 읽기",
    );
    if (read.readable === false) return read;
    const page = pageOf(read.value);
    if (page === null) {
      return {
        readable: false,
        reason: "unavailable",
        detail: "휴지통 문서 읽기에 실패했습니다 — 응답에 본문이 없습니다.",
      };
    }
    return { readable: true, value: page };
  }

  /**
   * 휴지통의 문서를 되살린다 — v2 페이지 갱신의 status current 길이다(2026-10-23 작업 D1a).
   * 공식 문서가 복구를 명시하지 않아 G4 실측 전이다(최종 구현 계획 G4). `version` 은
   * 휴지통 판 + 1 이다.
   */
  async restorePage(input: {
    pageId: string;
    title: string;
    storage: string;
    version: number;
  }): Promise<ConfluenceWrite<{ id: string; version: number }>> {
    const write = await this.requestWrite(
      "PUT",
      `/wiki/api/v2/pages/${encodeURIComponent(input.pageId)}`,
      "문서 복구",
      {
        id: input.pageId,
        status: "current",
        title: input.title,
        body: { representation: "storage", value: input.storage },
        version: { number: input.version },
      },
    );
    if (write.written === false) return write;
    const row = asRecord(write.value);
    const id = row === null ? null : asString(row.id);
    if (row === null || id === null) {
      return {
        written: false,
        reason: "unknown",
        detail: "문서 복구의 결과를 알 수 없습니다 — Confluence 응답을 읽지 못했습니다.",
      };
    }
    return {
      written: true,
      value: { id, version: asNumber(asRecord(row.version)?.number) ?? input.version },
    };
  }

  /**
   * 바닥글 코멘트를 만든다 — 문서에 곧장이거나 답글(부모 코멘트 아래)이다(2026-10-23 작업 D2a).
   * v2 의 본문은 문서와 부모 중 하나다 — 답글의 자리는 부모가 안다.
   */
  async createFooterComment(input: {
    pageId?: string;
    parentCommentId?: string;
    storage: string;
  }): Promise<ConfluenceWrite<{ id: string }>> {
    const body: Record<string, unknown> = {
      body: { representation: "storage", value: input.storage },
    };
    if (input.pageId !== undefined) body.pageId = input.pageId;
    if (input.parentCommentId !== undefined) body.parentCommentId = input.parentCommentId;
    return await this.#writeForId("POST", "/wiki/api/v2/footer-comments", "코멘트 만들기", body);
  }

  /**
   * 인라인 코멘트를 만든다 — 문장 닻(textSelection 과 그 몇 번째 일치인가)이 실린다
   * (2026-10-23 작업 D2a). 답글이면 닻을 빼고 부모만 싣는다 — 스레드의 자리는 부모의 몫이다.
   */
  async createInlineComment(input: {
    pageId?: string;
    parentCommentId?: string;
    storage: string;
    selection?: string;
    matchCount?: number;
    matchIndex?: number;
  }): Promise<ConfluenceWrite<{ id: string }>> {
    const body: Record<string, unknown> = {
      body: { representation: "storage", value: input.storage },
    };
    if (input.pageId !== undefined) body.pageId = input.pageId;
    if (input.parentCommentId !== undefined) body.parentCommentId = input.parentCommentId;
    if (input.selection !== undefined) {
      body.inlineCommentProperties = {
        textSelection: input.selection,
        textSelectionMatchCount: input.matchCount,
        textSelectionMatchIndex: input.matchIndex,
      };
    }
    return await this.#writeForId("POST", "/wiki/api/v2/inline-comments", "코멘트 만들기", body);
  }

  /**
   * 코멘트를 고치거나 해결한다 — 바닥글 · 인라인이 주소를 가른다(2026-10-23 작업 D2a).
   * 판은 요청의 현재 판 + 1 이다. 해결 표시는 인라인의 몫이다 — 바닥글의 본문에는
   * 아예 싣지 않는다.
   */
  async updateComment(input: {
    kind: "footer" | "inline";
    commentId: string;
    storage: string;
    version: number;
    resolved?: boolean;
  }): Promise<ConfluenceWrite<{ id: string }>> {
    const segment = input.kind === "inline" ? "inline-comments" : "footer-comments";
    const body: Record<string, unknown> = {
      version: { number: input.version + 1 },
      body: { representation: "storage", value: input.storage },
    };
    if (input.kind === "inline" && input.resolved !== undefined) {
      body.resolved = input.resolved;
    }
    return await this.#writeForId(
      "PUT",
      `/wiki/api/v2/${segment}/${encodeURIComponent(input.commentId)}`,
      "코멘트 갱신",
      body,
    );
  }

  /**
   * 임시 저장 판 읽기 — 공동 편집이 아직 내놓지 않은 초안이 실린다(2026-10-23 최종 구현 계획 F2).
   * 초안이 없으면(최신 판만 있으면) 값들이 없는 것이고, 그것은 읽지 못함이 아니다.
   */
  async readDraft(
    pageId: string,
  ): Promise<
    ConfluenceRead<{ status: string | null; version: number | null; storage: string | null }>
  > {
    const read = await this.requestRead(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?get-draft=true&body-format=storage`,
      "초안 읽기",
    );
    if (read.readable === false) return read;
    const row = read.value;
    return {
      readable: true,
      value: {
        status: asString(row.status),
        version: asNumber(asRecord(row.version)?.number),
        storage: asString(asRecord(asRecord(row.body)?.storage)?.value),
      },
    };
  }

  /** 문서에 걸린 동작 읽기 — 응답의 `operations` 배열이다(2026-10-23 최종 구현 계획 F2). */
  async pageOperations(
    pageId: string,
  ): Promise<ConfluenceRead<Array<{ operation: string; targetType: string }>>> {
    const read = await this.requestRead(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/operations`,
      "문서 동작 읽기",
    );
    if (read.readable === false) return read;
    const list = read.value.operations;
    const operations: Array<{ operation: string; targetType: string }> = [];
    if (Array.isArray(list)) {
      for (const row of list) {
        const record = asRecord(row);
        const operation = asString(record?.operation);
        if (record === null || operation === null) continue;
        operations.push({ operation, targetType: asString(record.targetType) ?? "" });
      }
    }
    return { readable: true, value: operations };
  }

  /** 윗문서 줄 읽기 — 응답 순서 그대로 id 만 꺼낸다(2026-10-23 최종 구현 계획 F2). */
  async pageAncestors(pageId: string): Promise<ConfluenceRead<string[]>> {
    const read = await this.requestRead(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/ancestors?limit=250`,
      "문서 윗줄 읽기",
    );
    if (read.readable === false) return read;
    const list = read.value.results;
    const ids: string[] = [];
    if (Array.isArray(list)) {
      for (const row of list) {
        const id = asString(asRecord(row)?.id);
        if (id !== null) ids.push(id);
      }
    }
    return { readable: true, value: ids };
  }

  /**
   * 제목으로 문서 찾기 — 같은 이름이 이미 공간에 오르는지 보는 길(2026-10-23 최종 구현 계획 F2).
   * 판과 만들어진 시각은 응답이 줄 때만 실린다 — 시각은 version 의 것이 먼저다.
   */
  async findPagesByTitle(
    spaceId: string,
    title: string,
  ): Promise<
    ConfluenceRead<
      Array<{
        id: string;
        title: string;
        parentId: string | null;
        version: number | null;
        createdAt: string | null;
      }>
    >
  > {
    const read = await this.requestRead(
      `/wiki/api/v2/pages?space-id=${encodeURIComponent(spaceId)}&title=${encodeURIComponent(title)}&status=current&limit=25`,
      "제목으로 문서 찾기",
    );
    if (read.readable === false) return read;
    const list = read.value.results;
    const pages: Array<{
      id: string;
      title: string;
      parentId: string | null;
      version: number | null;
      createdAt: string | null;
    }> = [];
    if (Array.isArray(list)) {
      for (const row of list) {
        const record = asRecord(row);
        const id = asString(record?.id);
        if (record === null || id === null) continue;
        const version = asRecord(record.version);
        pages.push({
          id,
          title: asString(record.title) ?? "",
          parentId: asString(record.parentId),
          version: asNumber(version?.number),
          createdAt: asString(version?.createdAt) ?? asString(record.createdAt),
        });
      }
    }
    return { readable: true, value: pages };
  }

  /**
   * 목록 한 끝까지 — 첫 주소에서 시작해 다음 쪽 표지(v2 는 `_links.next`, v1 CQL 은 Link 헤더)를 상한(PAGE_CAP)까지
   * 따라간다. 모양을 다르게 읽는 것은 `pick` 이고, 아이가 없는 줄은 거른다. 실패는 전체의 실패로 돌아온다 —
   * 빈 목록은 「읽었는데 없다」 일 때만 나온다(github-ci 선례). `requireComplete` 는 상한에서 끊긴 목록을
   * 실패로 돌려보낸다 — 트리 걷기는 끝까지 읽었을 때만 빠짐없이 걸었다 말한다(2026-10-23 최종 구현 계획 F0).
   */
  private async listRows<T>(
    first: string,
    label: string,
    opts: { requireComplete?: boolean } = {},
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
    if (opts.requireComplete === true && next !== null) {
      return {
        readable: false,
        reason: "unavailable",
        detail: `${label}에 실패했습니다 — 목록이 너무 길어 끝까지 읽지 못했습니다.`,
      };
    }
    return { readable: true, value: rows };
  }

  private isCql(url: string): boolean {
    return url.startsWith("/wiki/rest/api/search");
  }

  /**
   * id 하나인 쓰기의 한 끗 — 만들기 · 고치기의 공통 꼴(2026-10-23 작업 D2a). 응답을 읽지
   * 못하면 적용 여부를 모르는 것이다 — 자동으로 다시 보내지 않는다(requestWrite 의 약속).
   */
  async #writeForId(
    method: "POST" | "PUT",
    url: string,
    label: string,
    json: unknown,
  ): Promise<ConfluenceWrite<{ id: string }>> {
    const write = await this.requestWrite(method, url, label, json);
    if (write.written === false) return write;
    const id = asString(asRecord(write.value)?.id);
    if (id === null) {
      return {
        written: false,
        reason: "unknown",
        detail: `${label}의 결과를 알 수 없습니다 — Confluence 응답을 읽지 못했습니다.`,
      };
    }
    return { written: true, value: { id } };
  }

  /**
   * 쓰기의 한 끗 — 읽기의 requestRead 와 나란히, 약속만 다르다(2026-10-23 최종 구현 계획 F2).
   * 자동으로 다시 보내지 않는다 — 다시 보내면 같은 문서가 둘 생긴다. 429 만 거절이 확실하므로
   * 읽기와 같은 `BUDGETS.limitRetry` 사다리를 탄다(최대 LIMIT_ATTEMPTS). 네트워크 실패 · 5xx ·
   * 2xx 인데 응답을 못 읽은 것은 `unknown` 으로 돌아온다 — 적용됐는지 모르니 부르는 쪽이 원격을
   * 다시 읽어 대조한다. 실패 문장은 API 의 말뿐이다 — 토큰은 헤더로만 탄다.
   */
  private async requestWrite(
    method: "POST" | "PUT" | "DELETE",
    url: string,
    label: string,
    json?: unknown,
  ): Promise<
    | { written: true; status: number; value: unknown }
    | { written: false; reason: ConfluenceWriteFailure; detail: string }
  > {
    const bytes = json === undefined ? undefined : new TextEncoder().encode(JSON.stringify(json));
    for (let attempt = 1; ; attempt += 1) {
      let status: number;
      let body: Uint8Array;
      try {
        ({ status, body } = await this.transport.request({
          method,
          url,
          headers: this.headers(),
          ...(bytes === undefined ? {} : { body: bytes }),
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          written: false,
          reason: "unknown",
          detail: `${label}의 결과를 알 수 없습니다 — Confluence에 닿지 못했습니다 (${firstLine(reason)})`,
        };
      }
      if (status === 429 && attempt < LIMIT_ATTEMPTS) {
        await this.sleep(
          backoffDelay(attempt, BUDGETS.limitRetry.baseMs, BUDGETS.limitRetry.capMs),
        );
        continue;
      }
      if (status < 200 || status >= 300) {
        const reason: ConfluenceWriteFailure =
          status === 400
            ? "invalid"
            : status === 401
              ? "unauthorized"
              : status === 403
                ? "forbidden"
                : status === 404
                  ? "not-found"
                  : status === 409
                    ? "conflict"
                    : status === 413
                      ? "too-large"
                      : status === 429
                        ? "limit"
                        : // 그 밖의 4xx 는 거절이 확실하다 — 적용 여부를 모르는 것은 5xx 뿐이다.
                          status >= 400 && status < 500
                          ? "invalid"
                          : "unknown";
        return { written: false, reason, detail: httpError(label, status, body) };
      }
      // 2xx — 빈 몸(DELETE 의 204)은 읽을 것이 없고, 글자가 있으면 JSON 이어야 읽은 것이다.
      const text = new TextDecoder().decode(body).trim();
      if (text === "") return { written: true, status, value: null };
      try {
        return { written: true, status, value: JSON.parse(text) as unknown };
      } catch {
        return {
          written: false,
          reason: "unknown",
          detail: `${label}의 결과를 알 수 없습니다 — Confluence 응답을 읽지 못했습니다.`,
        };
      }
    }
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

  /**
   * 자격의 한 몸 — 이메일:토큰 짝을 기본 인증으로. 조립은 이 한 곳뿐이다. 쓰기의 JSON 본문에는
   * content-type 이 필요하다(2026-10-23 최종 구현 계획 F2).
   */
  private headers(): Record<string, string> {
    const pair = Buffer.from(`${this.creds.email}:${this.creds.token}`, "utf8").toString("base64");
    return {
      authorization: `Basic ${pair}`,
      accept: "application/json",
      "content-type": "application/json",
    };
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

/** 문서 한 줄 읽기 — v2 페이지 응답을 정본 모양으로. 본문이 없으면 없는 것이다(readPage · readTrashedPage 공용). */
function pageOf(row: Record<string, unknown>): ConfluencePage | null {
  const id = asString(row.id);
  const storage = asString(asRecord(asRecord(row.body)?.storage)?.value);
  if (!id || storage === null) return null;
  return {
    id,
    title: asString(row.title) ?? "",
    spaceId: asString(row.spaceId),
    version: asNumber(asRecord(row.version)?.number) ?? 0,
    storage,
    parentId: asString(row.parentId),
    updatedAt: asString(asRecord(row.version)?.createdAt),
    authorId: asString(asRecord(row.version)?.authorId),
  };
}

/** 코멘트 한 줄 읽기 — 모양이 갈리는 것(바닥글 · 인라인 · 옛 필드)을 한데 읽고 모르면 빈 값으로 흘린다. */
function commentOf(row: Record<string, unknown>): ConfluenceComment | null {
  const id = asString(row.id);
  if (!id) return null;
  const inlineProps =
    asRecord(row.inlineProperties) ?? asRecord(asRecord(row.properties)?.inlineProperties);
  return {
    id,
    // 작성자 · 만든 때는 판(version) 안에 온다(2026-10-24 공식 FooterCommentModel · 실측 사례).
    authorId: asString(asRecord(row.version)?.authorId) ?? asString(row.authorId),
    body: asString(asRecord(asRecord(row.body)?.storage)?.value) ?? "",
    createdAt: asString(asRecord(row.version)?.createdAt) ?? asString(row.createdAt),
    parentId: asString(row.parentId),
    resolved:
      row.resolutionStatus === "resolved" ||
      asRecord(asRecord(row.status))?.resolution === "resolved" ||
      asRecord(row.resolution)?.status === "resolved",
    anchorText: asString(inlineProps?.selection),
    version: asNumber(asRecord(row.version)?.number),
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
