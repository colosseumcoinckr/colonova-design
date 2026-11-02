/**
 * 문서의 곁 — 첨부 · 라벨 · 판 기록 · 본문 찾기 · 보존 블록 그림(2026-10-30 사용자 요청 — 기획서 칸에서
 * Confluence 기능을 가능한 한 온전히). 모든 요청은 활성 프로젝트에서 돈다.
 *
 * - 첨부 바이트는 데몬이 앱의 Confluence 자격으로 받아 base64 로 건넨다 — 토큰은 웹 · AI 어디에도 가지
 *   않고, 받는 주소는 사이트의 `/wiki/download/` 아래만 따른다.
 * - 라벨 쓰기는 발행 게이트(COLONOVA_DESIGN_CONFLUENCE_PUBLISH=1)가 켜졌을 때만 열린다. 같은 명령
 *   아이디의 재전송은 저장된 결과로 답하고, 보낸 기록만 남은 명령은 결과를 모른다고 답한다 — 다시 보내지
 *   않는다(코멘트 · 문서 관리와 같은 약속). 영구 삭제 길은 없다.
 * - 본문 찾기는 가져온 사본(프로젝트 데이터의 `confluence/`)을 읽는다 — 원격을 두드리지 않는다.
 * - 로그에는 종류와 수만 남긴다 — 라벨 이름 · 찾는 말 · 파일 이름은 기록에 들어가지 않는다.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DOC_ATTACHMENT_MAX_BYTES,
  type DocAttachmentData,
  type DocBlock,
  type DocBlockPreviews,
  type DocLabelResult,
  type DocSearchHit,
  type DocVersion,
  type DocVersionBody,
} from "@colonova-design/protocol";
import {
  type ConfluenceAttachment,
  ConfluenceClient,
  createConfluenceTransport,
} from "./confluence-client.js";
import { type ConfluenceLedger, readConfluenceLedger } from "./confluence-ledger.js";
import { confluenceMirrorLedger, confluenceMirrorRoot } from "./confluence-mirror.js";
import { confluenceRootIdKey, confluenceSiteKey } from "./confluence-sync.js";
import { mentionAccountIds, nameMentions, storageView } from "./confluence-view.js";
import { type CredentialStore, loadConfluenceCredentials } from "./credentials.js";
import { DraftStore } from "./draft-store.js";
import type { DaemonLogger } from "./log.js";
import type { RestTransport } from "./rest-transport.js";
import { projectBlock } from "./storage-blocks.js";

export interface DocMetaDeps {
  registry: { activeSlug(): string | null; paths(slug: string): { root: string } };
  machineSetting: { get(key: string): string | null };
  credentials: CredentialStore;
  logger: DaemonLogger;
  /** 저장 전송 — 시험이 기록된 가짜를 넣는다. 없으면 env 가 고른다. */
  transport?: (site: string) => RestTransport;
  now?: () => Date;
}

/** 막는 이유의 기계 이름 — 화면의 사전과 붙는다. */
const REASON = {
  gate: "publish-disabled",
  scope: "out-of-scope",
  invalid: "label-invalid",
} as const;

/** 라벨 명령의 열쇠 — 소문자 UUID(경로에도 쓰여 모양을 좁힌다). */
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 첨부 목록을 기억하는 시간 — 그림 여럿이 한 문서에서 목록을 거듭 읽지 않게. */
const ATTACHMENT_LIST_TTL_MS = 60_000;

/** 본문 찾기의 상한 — 결과 수 · 훑는 문서 수 · 미리 보기 글의 길이. */
const SEARCH_LIMIT = 30;
const SEARCH_PAGE_CAP = 3000;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 90;

/** Confluence 라벨이 받지 않는 글자 — 빈칸과 이 글자들(2026-10-30 · Confluence 라벨 규칙). */
const LABEL_FORBIDDEN = /[\s:;,.?&[\]()#^*@!<>"'\\|{}%$+=~`]/u;

/** 라벨 이름의 문제 — 없으면 null. 화면이 먼저 보고, 데몬이 한 번 더 본다. */
export function labelNameProblem(name: string): "empty" | "too-long" | "invalid-char" | null {
  if (name.trim() === "") return "empty";
  if (name.length > 255) return "too-long";
  if (LABEL_FORBIDDEN.test(name)) return "invalid-char";
  return null;
}

/** 라벨 이름의 정규화 — Confluence 는 라벨을 작은 글자로 둔다. */
export function normalizeLabel(name: string): string {
  return name.trim().toLowerCase();
}

/** 찾는 말의 조각 — 공백으로 나누고 대소문자 · 한글 조합 방식을 가리지 않는다(트리 찾기와 같다). */
function searchTokens(query: string): string[] {
  return query.normalize("NFC").toLowerCase().split(/\s+/u).filter(Boolean);
}

/**
 * 파생 마크다운 → 찾는 글 — 머리말을 떼고 마크다운 표식을 걷어 사람이 읽는 글만 남긴다.
 * 링크는 글만, 표의 칸 구분과 울타리는 빈칸으로.
 */
export function mirrorPlainText(markdown: string): string {
  let body = markdown;
  if (body.startsWith("---\n")) {
    const close = body.indexOf("\n---", 4);
    if (close !== -1) body = body.slice(close + 4);
  }
  return body
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/gu, "$1")
    .replace(/^\s*```.*$/gmu, " ")
    .replace(/^\s*\|?\s*-{3,}.*$/gmu, " ")
    .replace(/[#*_`>|~]+/gu, " ")
    .replace(/[ \t\r\n]+/gu, " ")
    .trim();
}

/** 맞은 자리 앞뒤의 짧은 글 — 잘린 끝에는 말줄임표가 선다. */
export function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + length + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * 본문 찾기 — 조각이 모두 제목이나 본문에 있고, 적어도 하나가 본문에 있어야 맞는다(제목만 맞는 문서는
 * 트리 찾기가 이미 보인다). 순서는 본문에서 맞은 조각이 많은 것 → 제목이 맞는 것 → 받은 순서다.
 */
export function searchDocs(
  pages: ReadonlyArray<{ pageId: string; title: string; text: string }>,
  query: string,
  limit = SEARCH_LIMIT,
): DocSearchHit[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const scored: Array<{ hit: DocSearchHit; score: number; order: number }> = [];
  pages.forEach((page, order) => {
    const body = page.text.normalize("NFC");
    const lowered = body.toLowerCase();
    const title = page.title.normalize("NFC").toLowerCase();
    let inBody = 0;
    let first = -1;
    let firstLength = 0;
    for (const token of tokens) {
      const at = lowered.indexOf(token);
      if (at === -1) {
        if (!title.includes(token)) return;
        continue;
      }
      inBody += 1;
      if (first === -1 || at < first) {
        first = at;
        firstLength = token.length;
      }
    }
    if (inBody === 0) return;
    const titleHit = tokens.some((token) => title.includes(token)) ? 1 : 0;
    scored.push({
      hit: {
        pageId: page.pageId,
        title: page.title,
        snippet: snippetAround(body, first, firstLength),
      },
      score: inBody * 2 + titleHit,
      order,
    });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, limit).map((entry) => entry.hit);
}

/** 이름이 같은 첨부 — NFC 로 맞춘다(맥에서 올린 파일의 한글 조합이 다를 수 있다). */
export function findAttachment(
  rows: readonly ConfluenceAttachment[],
  filename: string,
): ConfluenceAttachment | null {
  const want = filename.normalize("NFC");
  return rows.find((row) => row.title.normalize("NFC") === want) ?? null;
}

/** 한 명령의 기록 — sending 으로 먼저 쓰고 보내므로, 응답을 잃어도 같은 명령이 다시 쓰지 않는다. */
interface LabelOpRecord {
  format: 1;
  commandId: string;
  op: "add" | "remove";
  pageId: string;
  createdAt: string;
  result: DocLabelResult | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export class DocMeta {
  readonly #deps: DocMetaDeps;
  readonly #now: () => Date;
  /** 문서별 첨부 목록 — 짧게만 기억한다(그림 여럿이 같은 목록을 읽는다). */
  readonly #attachments = new Map<string, { at: number; rows: ConfluenceAttachment[] }>();

  constructor(deps: DocMetaDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => new Date());
  }

  // ————— 첨부 —————

  /** 이 문서의 첨부 한 벌 — 이름으로 찾아 받는다. 상한을 넘으면 tooLarge 로 답하고 받지 않는다. */
  async attachment(pageId: string, filename: string): Promise<DocAttachmentData> {
    const slug = this.#slug();
    const client = await this.#client(slug);
    let rows = this.#cachedAttachments(pageId);
    let found = rows === null ? null : findAttachment(rows, filename);
    if (found === null) {
      // 방금 올라온 첨부일 수 있다 — 기억이 모르면 한 번 새로 읽는다.
      const read = await client.listAttachments(pageId);
      if (read.readable === false) throw new Error(read.detail);
      rows = read.value;
      this.#attachments.set(pageId, { at: this.#now().getTime(), rows });
      found = findAttachment(rows, filename);
    }
    if (found === null) throw new Error("첨부를 찾지 못했습니다 — 문서에서 지워졌을 수 있습니다.");
    const mediaType = found.mediaType ?? "application/octet-stream";
    if (found.size !== null && found.size > DOC_ATTACHMENT_MAX_BYTES) {
      return { filename: found.title, mediaType, size: found.size, tooLarge: true, data: "" };
    }
    if (found.downloadLink === null) throw new Error("첨부를 받을 주소가 없습니다.");
    const bytes = await client.downloadAttachment(found.downloadLink, DOC_ATTACHMENT_MAX_BYTES);
    if (bytes.readable === false) throw new Error(bytes.detail);
    this.#deps.logger.info("첨부 받기", { bytes: bytes.value.bytes.byteLength });
    return {
      filename: found.title,
      mediaType: found.mediaType ?? bytes.value.contentType ?? "application/octet-stream",
      size: bytes.value.bytes.byteLength,
      tooLarge: false,
      data: Buffer.from(bytes.value.bytes).toString("base64"),
    };
  }

  /** 첨부 목록을 기억에 남긴다 — doc.read 가 읽은 목록을 그림 받기가 다시 쓴다. */
  rememberAttachments(pageId: string, rows: ConfluenceAttachment[]): void {
    this.#attachments.set(pageId, { at: this.#now().getTime(), rows });
  }

  #cachedAttachments(pageId: string): ConfluenceAttachment[] | null {
    const cached = this.#attachments.get(pageId);
    if (cached === undefined) return null;
    if (this.#now().getTime() - cached.at > ATTACHMENT_LIST_TTL_MS) {
      this.#attachments.delete(pageId);
      return null;
    }
    return cached.rows;
  }

  // ————— 라벨 —————

  async labelAdd(input: {
    pageId: string;
    commandId: string;
    label: string;
  }): Promise<DocLabelResult> {
    return await this.#runLabel("add", input);
  }

  async labelRemove(input: {
    pageId: string;
    commandId: string;
    label: string;
  }): Promise<DocLabelResult> {
    return await this.#runLabel("remove", input);
  }

  async #runLabel(
    op: "add" | "remove",
    input: { pageId: string; commandId: string; label: string },
  ): Promise<DocLabelResult> {
    const { pageId, commandId } = input;
    if (!COMMAND_ID_PATTERN.test(commandId)) {
      throw new Error("라벨 명령 아이디는 소문자 UUID 여야 합니다");
    }
    const slug = this.#slug();
    const file = join(
      this.#deps.registry.paths(slug).root,
      "plans",
      "label-ops",
      `${commandId}.json`,
    );
    const seen = this.#readRecord(file);
    if (seen !== null) {
      if (seen.op !== op || seen.pageId !== pageId) {
        throw new Error("이 명령 아이디는 이미 다른 라벨 명령에 쓰였습니다");
      }
      if (seen.result !== null) return seen.result;
      const unknown: DocLabelResult = {
        commandId,
        state: "unknown",
        detail: "이 명령은 보낸 기록만 있습니다 — 적용 여부를 알 수 없어 다시 보내지 않았습니다.",
      };
      this.#writeRecord(file, { ...seen, result: unknown });
      return unknown;
    }
    // 게이트가 꺼졌으면 원격을 두드리지 않는다.
    if (process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH !== "1") {
      return { commandId, state: "failed", detail: REASON.gate };
    }
    const label = normalizeLabel(input.label);
    if (labelNameProblem(label) !== null)
      return { commandId, state: "failed", detail: REASON.invalid };
    // 범위 — 원장의 문서와 뿌리뿐이다(코멘트 · 문서 관리와 같은 검사).
    const rootId = this.#deps.machineSetting.get(confluenceRootIdKey(slug));
    if (this.#ledger(slug).pages[pageId] === undefined && pageId !== rootId) {
      return { commandId, state: "failed", detail: REASON.scope };
    }
    const client = await this.#client(slug);
    const record: LabelOpRecord = {
      format: 1,
      commandId,
      op,
      pageId,
      createdAt: this.#now().toISOString(),
      result: null,
    };
    // sending 기록을 먼저 쓴다 — 응답을 잃어도 같은 명령의 재전송이 다시 쓰지 않는다.
    this.#writeRecord(file, record);
    const sent =
      op === "add" ? await client.addLabel(pageId, label) : await client.removeLabel(pageId, label);
    const result: DocLabelResult = sent.written
      ? { commandId, state: "applied", detail: "" }
      : { commandId, state: sent.reason === "unknown" ? "unknown" : "failed", detail: sent.detail };
    this.#writeRecord(file, { ...record, result });
    this.#deps.logger.info("문서 라벨", { op, state: result.state });
    return result;
  }

  // ————— 판 기록 —————

  async versions(pageId: string): Promise<{ versions: DocVersion[] }> {
    const client = await this.#client(this.#slug());
    const read = await client.listVersions(pageId);
    if (read.readable === false) throw new Error(read.detail);
    const names = new Map<string, string>();
    const versions: DocVersion[] = [];
    for (const row of read.value) {
      let author = "";
      if (row.authorId !== null) {
        const cached = names.get(row.authorId);
        author = cached ?? (await client.userName(row.authorId)) ?? "";
        names.set(row.authorId, author);
      }
      versions.push({
        number: row.number,
        author,
        createdAt: row.createdAt,
        message: row.message,
        minorEdit: row.minorEdit,
      });
    }
    return { versions };
  }

  async versionRead(pageId: string, version: number): Promise<DocVersionBody> {
    const client = await this.#client(this.#slug());
    const read = await client.readPageVersion(pageId, version);
    if (read.readable === false) throw new Error(read.detail);
    const view = await namedView(client, storageView(read.value.storage));
    return { version: read.value.version, title: read.value.title, view };
  }

  // ————— 본문 찾기 —————

  search(query: string): { results: DocSearchHit[] } {
    const slug = this.#slug();
    const root = this.#deps.registry.paths(slug).root;
    const mirror = confluenceMirrorRoot(root);
    const pages: Array<{ pageId: string; title: string; text: string }> = [];
    for (const [pageId, page] of Object.entries(this.#ledger(slug).pages)) {
      if (pages.length >= SEARCH_PAGE_CAP) break;
      let text = "";
      try {
        text = mirrorPlainText(readFileSync(join(mirror, `${page.path}.md`), "utf8"));
      } catch {
        // 사본이 아직 없거나 지워졌다 — 그 문서는 제목만으로는 본문 찾기에 들지 않는다.
        continue;
      }
      pages.push({ pageId, title: page.title, text });
    }
    const results = searchDocs(pages, query);
    this.#deps.logger.info("본문 찾기", { pages: pages.length, results: results.length });
    return { results };
  }

  // ————— 보존 블록 그림 —————

  /** 초안의 고칠 수 없는 블록마다 보기 블록 — 초안 파일을 읽기만 한다. */
  blockPreviews(docKey: string): DocBlockPreviews {
    const slug = this.#slug();
    const store = new DraftStore(join(this.#deps.registry.paths(slug).root, "plans"));
    const record = store.read(docKey);
    const previews: Record<string, DocBlock[]> = {};
    if (record === null) return { previews };
    for (const block of record.blocks) {
      if (projectBlock(block).editable) continue;
      const view = storageView(block.xml);
      if (view.length > 0) previews[block.id] = view;
    }
    return { previews };
  }

  // ————— 안 — 프로젝트 · 연결 · 원장 · 기록 —————

  #slug(): string {
    const slug = this.#deps.registry.activeSlug();
    if (slug === null || slug === "") {
      throw new Error("기획서를 읽을 프로젝트가 없습니다 — 프로젝트를 먼저 골라 주세요.");
    }
    return slug;
  }

  async #client(slug: string): Promise<ConfluenceClient> {
    const site = this.#deps.machineSetting.get(confluenceSiteKey(slug));
    if (site === null) throw new Error("먼저 연결해 주세요 — 기획서는 연결 뒤에 읽혀요.");
    const creds = await loadConfluenceCredentials(this.#deps.credentials, process.env, slug);
    if (creds === null)
      throw new Error("먼저 연결해 주세요 — 사이트 · 이메일 · 토큰을 넣어 주세요.");
    return new ConfluenceClient(
      { site, email: creds.email, token: creds.token },
      this.#deps.transport?.(site) ?? createConfluenceTransport(process.env, site).transport,
    );
  }

  #ledger(slug: string): ConfluenceLedger {
    return readConfluenceLedger(confluenceMirrorLedger(this.#deps.registry.paths(slug).root));
  }

  #readRecord(file: string): LabelOpRecord | null {
    let raw: Record<string, unknown> | null;
    try {
      raw = asRecord(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return null;
    }
    if (
      raw === null ||
      raw.format !== 1 ||
      typeof raw.commandId !== "string" ||
      (raw.op !== "add" && raw.op !== "remove") ||
      typeof raw.pageId !== "string" ||
      typeof raw.createdAt !== "string"
    ) {
      return null;
    }
    return {
      format: 1,
      commandId: raw.commandId,
      op: raw.op,
      pageId: raw.pageId,
      createdAt: raw.createdAt,
      result: asRecord(raw.result) === null ? null : (raw.result as DocLabelResult),
    };
  }

  /** 원자 쓰기 — 임시 파일을 쓰고 바꿔치기 한다(doc-comments 와 같은 길). */
  #writeRecord(file: string, record: LabelOpRecord): void {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}

/** 보기 블록의 멘션에 이름을 싣는다 — 사람 수는 30명까지만 묻는다(그 너머는 이름 없음). */
export async function namedView(
  client: { userName(accountId: string): Promise<string | null> },
  blocks: DocBlock[],
): Promise<DocBlock[]> {
  const names = new Map<string, string | null>();
  for (const id of mentionAccountIds(blocks).slice(0, 30)) names.set(id, await client.userName(id));
  return nameMentions(blocks, names);
}
