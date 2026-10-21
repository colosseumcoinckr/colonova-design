import {
  ConfluenceClient,
  createConfluenceTransport,
  normalizeSite,
} from "../confluence-client.js";
import { readConfluenceLedger } from "../confluence-ledger.js";
import { deriveMarkdown } from "../confluence-markdown.js";
import {
  confluenceLedgerFile,
  confluenceSiteKey,
  ensurePlansExclude,
  resetLedgerOnRootChange,
} from "../confluence-sync.js";
import { CONFLUENCE_PAT_ITEM, loadConfluenceCredentials } from "../credentials.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type ConfluenceDeps = Pick<
  RouterDeps,
  "registry" | "machineSetting" | "fleet" | "credentials" | "confluence"
>;

type ConfluenceRequest = Extract<keyof RequestHandlers, `confluence.${string}` | `doc.${string}`>;

/** 기획서(Confluence) 연결 · 찾기 · 가져오기와 문서 읽기를 맡는다(2026-10-18 동기화 1단계). */
export function confluenceHandlers(deps: ConfluenceDeps): RequestHandlers<ConfluenceRequest> {
  return {
    "confluence.connect": (message) => confluenceConnect(deps, message),
    "confluence.suggestRoots": (message) => confluenceSuggestRoots(deps, message.query),
    "confluence.importNow": async () => {
      const slug = deps.registry.activeSlug();
      if (slug === null || slug === "") {
        throw new Error("가져올 프로젝트가 없습니다 — 프로젝트를 먼저 골라 주세요.");
      }
      return await deps.confluence.importNow(slug);
    },
    "doc.list": () => docList(deps),
    "doc.read": (message) => docRead(deps, message.pageId),
  };
}

/**
 * 기획서(Confluence) 연결 — 활성 프로젝트(slug)에 묶는다(2026-10-18 기획서 동기화).
 * 이메일·토큰은 한 번만 받는다: 검증(/user/current)이 이기면 자격은 저장소의
 * `confluence-pat` 한 몸으로, 연결 미러는 machine.json 의 슬러그 붙은 키로 둔다 —
 * 다른 프로젝트의 연결을 덮어쓰지 않고, 응답 어디에도 자격이 다시 나오지 않는다.
 * 이미 저장된 자격으로 뿌리만 고를 때는 이메일·토큰을 비우고 보낸다. 연결이 서면
 * 클론의 `.git/info/exclude` 에 기획서 폴더 거름을 박는다(F7 — 첫 쓰기보다 앞선다).
 */
async function confluenceConnect(
  deps: ConfluenceDeps,
  message: {
    site: string;
    email?: string;
    token?: string;
    rootPageId?: string;
  },
): Promise<{ site: string; rootTitle: string | null }> {
  const slug = deps.registry.activeSlug();
  if (slug === null || slug === "") {
    throw new Error("연결할 프로젝트가 없습니다 — 프로젝트를 먼저 골라 주세요.");
  }
  // 옛 뿌리의 id — 거울에 새기기 전의 값이어야 뿌리 교체를 알 수 있다.
  const previousRootId = deps.machineSetting.get(`confluenceRootId:${slug}`);
  let creds: { email: string; token: string } | null;
  if (message.email !== undefined && message.token !== undefined) {
    creds = { email: message.email, token: message.token };
  } else if (message.email !== undefined || message.token !== undefined) {
    // 선로의 짝 규칙이 이미 걸지만, 처리기의 방어도 같은 말을 한다.
    throw new Error("이메일과 토큰은 짝입니다 — 둘 다 넣어 주세요.");
  } else {
    creds = await loadConfluenceCredentials(deps.credentials, process.env);
  }
  if (creds === null) {
    throw new Error("Confluence 연결이 없습니다 — 이메일과 토큰을 넣어 연결해 주세요.");
  }
  const site = normalizeSite(message.site);
  const client = confluenceClient(site, creds);
  const who = await client.whoAmI();
  if (!who.ok) throw new Error(who.detail);
  let rootTitle: string | null = null;
  if (message.rootPageId !== undefined) {
    const root = await client.readPage(message.rootPageId);
    if (!root.readable) {
      throw new Error(`기준 페이지를 읽지 못했습니다 — ${root.detail}`);
    }
    rootTitle = root.value.title;
  }
  // 자격은 저장소로, 미러는 이 프로젝트의 키로 — 저장이 이겨야 다음 connect 이 자격 없이 온다.
  await deps.credentials.save(CONFLUENCE_PAT_ITEM, `${creds.email}\n${creds.token}`);
  deps.machineSetting.set(`confluenceSite:${slug}`, site);
  if (message.rootPageId !== undefined) {
    deps.machineSetting.set(`confluenceRootId:${slug}`, message.rootPageId);
    deps.machineSetting.set(`confluenceRootTitle:${slug}`, rootTitle);
  }
  const workspace = deps.fleet.workspaces.get(slug);
  if (workspace !== undefined) {
    // 뿌리가 바뀐 연결이면 원장을 비운다 — 새 뿌리의 문서가 처음부터 다시 걷힌다(옛 문서가 목록에 남지 않는다).
    resetLedgerOnRootChange(
      workspace.repo.root,
      previousRootId,
      // 선로의 짝 규칙이 이미 걸러 rootPageId 는 있다 — 없으면 같은 뿌리로 본다.
      message.rootPageId ?? previousRootId ?? "",
    );
    ensurePlansExclude(workspace.repo.root);
  }
  // 다시 연결이 서면 만료는 내려앉는다 — 루프가 다시 달린다.
  deps.confluence.clearExpired(slug);
  return { site, rootTitle };
}

/**
 * 기준 페이지 찾기 — 저장된 자격과 사이트로 CQL 제목 검색(type=page)을 돌린다.
 * 연결이 없으면 한국어 거절로 답한다; 자격은 어디에도 실리지 않는다.
 */
async function confluenceSuggestRoots(
  deps: ConfluenceDeps,
  query: string,
): Promise<{ roots: Array<{ id: string; title: string }> }> {
  const slug = deps.registry.activeSlug();
  const site = slug === null ? null : deps.machineSetting.get(`confluenceSite:${slug}`);
  const creds = await loadConfluenceCredentials(deps.credentials, process.env);
  if (site === null || creds === null) {
    throw new Error(
      "먼저 연결해 주세요 — 사이트 · 이메일 · 토큰을 넣으면 기준 페이지를 찾을 수 있어요.",
    );
  }
  const client = confluenceClient(site, creds);
  const escaped = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const read = await client.searchPages(`type=page AND title ~ "${escaped}"`);
  if (!read.readable) throw new Error(read.detail);
  // 판 번호 같은 다른 칸은 화면으로 보내지 않는다 — 찾기의 답은 id 와 제목뿐이다.
  return { roots: read.value.slice(0, 20).map(({ id, title }) => ({ id, title })) };
}

/**
 * 기획서 목록 — 원장이 아는 트리와 판. 연결이 없거나 아직 가져온 것이 없으면
 * docs 가 null 이다(읽지 못함이 아니라 「아직 없다」).
 */
function docList(deps: ConfluenceDeps): {
  docs: Array<{ pageId: string; title: string; version: number; path: string }> | null;
} {
  const slug = deps.registry.activeSlug();
  const site = slug === null ? null : deps.machineSetting.get(confluenceSiteKey(slug));
  if (slug === null || site === null) return { docs: null };
  const workspace = deps.fleet.workspaces.get(slug);
  if (workspace === undefined) return { docs: null };
  const ledger = readConfluenceLedger(confluenceLedgerFile(workspace.repo.root));
  return {
    docs: Object.entries(ledger.pages).map(([pageId, page]) => ({
      pageId,
      title: page.title,
      version: page.version,
      path: page.path,
    })),
  };
}

/**
 * 기획서 한 문서 — 파생 마크다운과 절(매크로 표식). 코멘트는 정본인 Confluence 에서
 * 그 자리에 읽어 실는다(안 풀린 것만 · 읽기 실패면 null — 원장의 수가 대신한다).
 * 자격은 이 답의 어디에도 실리지 않는다.
 */
async function docRead(
  deps: ConfluenceDeps,
  pageId: string,
): Promise<{
  markdown: string;
  sections: Array<{ heading: string; macro: boolean }>;
  comments: Array<{
    author: string;
    body: string;
    createdAt: string | null;
    anchorText: string | null;
  }> | null;
}> {
  const slug = deps.registry.activeSlug();
  const site = slug === null ? null : deps.machineSetting.get(confluenceSiteKey(slug));
  const creds = await loadConfluenceCredentials(deps.credentials, process.env);
  if (site === null || creds === null) {
    throw new Error("먼저 연결해 주세요 — 기획서는 연결 뒤에 읽혀요.");
  }
  const client = confluenceClient(site, creds);
  const read = await client.readPage(pageId);
  if (!read.readable) throw new Error(read.detail);
  const derived = deriveMarkdown(read.value.storage, {
    pageId: read.value.id,
    space: read.value.spaceId,
    title: read.value.title,
    version: read.value.version,
    updatedAt: read.value.updatedAt,
  });
  const footer = await client.listFooterComments(pageId);
  const inline = await client.listInlineComments(pageId);
  let comments: Array<{
    author: string;
    body: string;
    createdAt: string | null;
    anchorText: string | null;
  }> | null = null;
  if (footer.readable && inline.readable) {
    const names = new Map<string, string>();
    comments = [];
    for (const row of [...footer.value, ...inline.value]) {
      if (row.resolved) continue;
      let author = "";
      if (row.authorId !== null) {
        const cached = names.get(row.authorId);
        if (cached === undefined) {
          const name = await client.userName(row.authorId);
          names.set(row.authorId, name ?? "");
        }
        author = names.get(row.authorId) ?? "";
      }
      comments.push({
        author,
        body: row.body,
        createdAt: row.createdAt,
        anchorText: row.anchorText,
      });
    }
  }
  return { markdown: derived.markdown, sections: derived.sections, comments };
}

/** 저장된 전송 규약 — 전송은 env 가 고른다(fixture · API 재지정 · 실사이트). */
function confluenceClient(site: string, creds: { email: string; token: string }): ConfluenceClient {
  const { transport } = createConfluenceTransport(process.env, site);
  return new ConfluenceClient({ site, ...creds }, transport);
}
