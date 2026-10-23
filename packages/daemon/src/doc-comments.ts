/**
 * 문서 코멘트 서비스(2026-10-23 · 최종 구현 계획 F4 · 작업 D2a) — 바닥글 · 인라인 코멘트의
 * 만들기 · 답글 · 수정 · 해결을 정본인 Confluence 에 기록하는 몸(정본 계획 §9). 모든 요청은
 * 활성 프로젝트에서 돈다. 실사이트 쓰기는 발행 게이트(COLONOVA_DESIGN_CONFLUENCE_PUBLISH=1)가
 * 켜졌을 때만 열리고, 같은 명령 아이디의 재전송은 저장된 결과로 답한다 — 두 번 만들지 않는다.
 * 인라인 대상은 사람이 고른 문장이 원문에 한 번만 나올 때만 잇는다 — 화면의 글과 원문의 글은
 * 세는 법이 달라 몇 번째인지를 믿을 수 없다(2026-10-23 오케스트레이터 검토). 모호하거나 바뀐 문장은
 * 다시 고르게 한다. 로그에는 종류와 수만 남긴다 — 코멘트의 글 · 문장은 기록에 들어가지 않는다.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocCommentResult } from "@colonova-design/protocol";
import { anchorCount, commentIsPlain, commentStorage } from "./comment-text.js";
import {
  ConfluenceClient,
  type ConfluenceComment,
  type ConfluenceWrite,
  createConfluenceTransport,
} from "./confluence-client.js";
import {
  type ConfluenceLedger,
  emptyConfluenceLedger,
  readConfluenceLedger,
} from "./confluence-ledger.js";
import { confluenceLedgerFile, confluenceRootIdKey, confluenceSiteKey } from "./confluence-sync.js";
import { type CredentialStore, loadConfluenceCredentials } from "./credentials.js";
import type { DaemonLogger } from "./log.js";
import type { RestTransport } from "./rest-transport.js";

/** 문서 코멘트가 사는 데 꼭 필요한 것 — 서버가 만들어 넘기고, 시험은 가짜를 넣는다. */
export interface DocCommentsDeps {
  registry: { activeSlug(): string | null; paths(slug: string): { root: string } };
  machineSetting: { get(key: string): string | null };
  credentials: CredentialStore;
  /** 클론 뿌리 — 없으면 null(연결 전 · 내려간 프로젝트). 범위는 원장으로 본다. */
  workspaceRoot(slug: string): string | null;
  logger: DaemonLogger;
  /** 저장 전송 — 시험이 기록된 가짜를 넣는다. 없으면 env 가 고른다. */
  transport?: (site: string) => RestTransport;
  now?: () => Date;
}

/** 코멘트 명령의 종류 — 만들기 · 답글 · 수정 · 해결이다(정본 계획 §9). */
export type DocCommentOp = "create" | "reply" | "update" | "resolve";

/** 한 명령의 기록 — sending 으로 먼저 쓰고 보내므로, 응답을 잃어도 같은 명령이 다시 쓰지 않는다. */
interface CommentOpRecord {
  format: 1;
  commandId: string;
  op: DocCommentOp;
  pageId: string;
  createdAt: string;
  /** null 은 보내는 중이다 — 이 상태로 끝난 기록은 적용 여부를 모른다. */
  result: DocCommentResult | null;
}

/** 검사와 보내기의 사이 — 막혔으면 기록 없이 답하고, 열렸으면 보내는 문을 돌려준다. */
type Attempt =
  | { ready: false; detail: string }
  | { ready: true; send: () => Promise<ConfluenceWrite<{ id: string }>> };

/** 막는 이유의 기계 이름 — 화면의 사전과 붙는다(데몬은 기계 이름을 보낸다 · 작업 D2a). */
const REASON = {
  gate: "publish-disabled",
  scope: "out-of-scope",
  anchorMissing: "anchor-missing",
  anchorAmbiguous: "anchor-ambiguous",
  commentChanged: "comment-changed",
  commentMissing: "comment-missing",
  /** 서식 · 링크 · 멘션이 든 코멘트 — 맨 글로 고치면 잃는다. Confluence 에서 고친다. */
  commentNotPlain: "comment-not-plain",
  /** 원격 코멘트의 본문을 읽지 못했다 — 해결이 본문을 비워 쓰지 않게 멈춘다. */
  commentUnreadable: "comment-unreadable",
} as const;

/** 코멘트 명령의 열쇠 — 소문자 UUID(경로에도 쓰여 모양을 좁힌다). */
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 관용 읽기 도우미 — 깨진 값은 버린다(doc-ops 의 같은 감각). */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export class DocComments {
  readonly #deps: DocCommentsDeps;
  readonly #now: () => Date;

  constructor(deps: DocCommentsDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => new Date());
  }

  // ————— 수행 —————

  /** 만들기 — anchor 가 없으면 바닥글, 있으면 인라인이다(정본 계획 §9). */
  async create(input: {
    pageId: string;
    commandId: string;
    text: string;
    anchor?: { selection: string; index: number };
  }): Promise<DocCommentResult> {
    return await this.#run("create", input.pageId, input.commandId, (client) =>
      this.#attemptCreate(client, input),
    );
  }

  /** 답글 — 부모 코멘트의 종류가 스레드의 자리를 정한다. 부모의 존재는 원격이 가린다. */
  async reply(input: {
    pageId: string;
    commandId: string;
    parentId: string;
    kind: "footer" | "inline";
    text: string;
  }): Promise<DocCommentResult> {
    return await this.#run("reply", input.pageId, input.commandId, (client) => ({
      ready: true,
      send: () =>
        input.kind === "inline"
          ? client.createInlineComment({
              parentCommentId: input.parentId,
              storage: commentStorage(input.text),
            })
          : client.createFooterComment({
              parentCommentId: input.parentId,
              storage: commentStorage(input.text),
            }),
    }));
  }

  /** 수정 — 현재 판이 요청의 판과 같을 때만 쓴다(정본 계획 §9 — 코멘트 수정은 본문 판과 다른 사건이다). */
  async update(input: {
    pageId: string;
    commandId: string;
    commentId: string;
    kind: "footer" | "inline";
    version: number;
    text: string;
  }): Promise<DocCommentResult> {
    return await this.#run("update", input.pageId, input.commandId, (client) =>
      this.#attemptUpdate(client, input),
    );
  }

  /** 해결 · 다시 열기 — 인라인의 몫이다. 해결도 본문을 바꾸지 않는다 — 지금 판을 그대로 다시 쓴다. */
  async resolve(input: {
    pageId: string;
    commandId: string;
    commentId: string;
    version: number;
    resolved: boolean;
  }): Promise<DocCommentResult> {
    return await this.#run("resolve", input.pageId, input.commandId, (client) =>
      this.#attemptResolve(client, input),
    );
  }

  // ————— 안 — 종류마다의 검사 —————

  /** 인라인 만들기의 검사 — 문장이 원문의 글자(태그를 뺀)에 몇 번 나오는지 센다(정본 계획 §9). */
  async #attemptCreate(
    client: ConfluenceClient,
    input: { pageId: string; text: string; anchor?: { selection: string; index: number } },
  ): Promise<Attempt> {
    const storage = commentStorage(input.text);
    const anchor = input.anchor;
    if (anchor === undefined) {
      return {
        ready: true,
        send: () => client.createFooterComment({ pageId: input.pageId, storage }),
      };
    }
    const read = await client.readPage(input.pageId);
    if (read.readable === false) return { ready: false, detail: read.detail };
    // 문장의 수는 원문의 글(태그를 벗기고 엔티티를 푼)에서 센다. 한 번만 나와야 잇는다 — 둘 이상이면
    // 몇 번째인지를 화면과 원문이 같게 센다는 보장이 없다(2026-10-23 오케스트레이터 검토).
    const count = anchorCount(read.value.storage, anchor.selection);
    if (count === 0) return { ready: false, detail: REASON.anchorMissing };
    if (count > 1 || anchor.index !== 0) return { ready: false, detail: REASON.anchorAmbiguous };
    return {
      ready: true,
      send: () =>
        client.createInlineComment({
          pageId: input.pageId,
          storage,
          selection: anchor.selection,
          matchCount: 1,
          matchIndex: 0,
        }),
    };
  }

  /** 수정의 검사 — 종류의 목록에서 지금 판을 찾아 대어 본다(작업 D2a). */
  async #attemptUpdate(
    client: ConfluenceClient,
    input: {
      pageId: string;
      commentId: string;
      kind: "footer" | "inline";
      version: number;
      text: string;
    },
  ): Promise<Attempt> {
    const found = await this.#currentComment(client, input.pageId, input.kind, input.commentId);
    if ("detail" in found) return { ready: false, detail: found.detail };
    if (found.comment.version !== input.version) {
      return { ready: false, detail: REASON.commentChanged };
    }
    // 서식 · 멘션이 든 코멘트를 맨 글로 덮으면 그것들이 사라진다 — 화면이 막아도 여기서 다시 본다.
    if (!commentIsPlain(found.comment.body)) {
      return { ready: false, detail: REASON.commentNotPlain };
    }
    return {
      ready: true,
      send: () =>
        client.updateComment({
          kind: input.kind,
          commentId: input.commentId,
          storage: commentStorage(input.text),
          version: input.version,
        }),
    };
  }

  /** 해결의 검사 — 인라인 목록에서만 찾는다. 바닥글의 id 는 해결의 대상이 아니다(작업 D2a). */
  async #attemptResolve(
    client: ConfluenceClient,
    input: { pageId: string; commentId: string; version: number; resolved: boolean },
  ): Promise<Attempt> {
    const found = await this.#currentComment(client, input.pageId, "inline", input.commentId);
    if ("detail" in found) return { ready: false, detail: found.detail };
    if (found.comment.version !== input.version) {
      return { ready: false, detail: REASON.commentChanged };
    }
    // 해결은 본문을 그대로 다시 싣는다 — 본문을 읽지 못했으면 빈 본문으로 덮지 않게 멈춘다.
    if (found.comment.body.trim() === "") {
      return { ready: false, detail: REASON.commentUnreadable };
    }
    return {
      ready: true,
      send: () =>
        client.updateComment({
          kind: "inline",
          commentId: input.commentId,
          storage: found.comment.body,
          version: input.version,
          resolved: input.resolved,
        }),
    };
  }

  /** 지금 코멘트의 모습 — 종류의 목록에서 찾는다. 읽지 못하면 그 이유로, 없으면 comment-missing 이다. */
  async #currentComment(
    client: ConfluenceClient,
    pageId: string,
    kind: "footer" | "inline",
    commentId: string,
  ): Promise<{ comment: ConfluenceComment } | { detail: string }> {
    const list =
      kind === "inline"
        ? await client.listInlineComments(pageId)
        : await client.listFooterComments(pageId);
    if (list.readable === false) return { detail: list.detail };
    const comment = list.value.find((row) => row.id === commentId);
    if (comment === undefined) return { detail: REASON.commentMissing };
    return { comment };
  }

  // ————— 안 — 공통의 한 바퀴 —————

  async #run(
    op: DocCommentOp,
    pageId: string,
    commandId: string,
    attempt: (client: ConfluenceClient) => Attempt | Promise<Attempt>,
  ): Promise<DocCommentResult> {
    // 명령 아이디는 기록의 경로에 쓰인다 — 모양을 좁힌다(doc-ops 의 같은 검사).
    if (!COMMAND_ID_PATTERN.test(commandId)) {
      throw new Error("코멘트 명령 아이디는 소문자 UUID 여야 합니다");
    }
    const slug = this.#slug();
    const file = join(this.#plansRoot(slug), "comment-ops", `${commandId}.json`);
    const seen = this.#readRecord(file);
    if (seen !== null) {
      // 같은 아이디의 다른 명령 — 남의 결과를 돌려주지 않는다(2026-10-23 · 검토 발견 9).
      if (seen.op !== op || seen.pageId !== pageId) {
        throw new Error("이 명령 아이디는 이미 다른 코멘트 명령에 쓰였습니다");
      }
      // 같은 명령의 기록 — 그 결과로 답한다. sending 로 끝난 기록은 적용 여부를 모른다.
      if (seen.result !== null) return seen.result;
      const unknown: DocCommentResult = {
        commandId,
        state: "unknown",
        commentId: null,
        detail: "이 명령은 보낸 기록만 있습니다 — 적용 여부를 알 수 없어 다시 보내지 않았습니다.",
      };
      this.#writeRecord(file, { ...seen, result: unknown });
      return unknown;
    }
    // 게이트가 꺼졌으면 원격을 두드리지 않는다 — 쓰기가 막힌 세계에서 읽을 것도 없다.
    if (process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH !== "1") {
      return { commandId, state: "failed", commentId: null, detail: REASON.gate };
    }
    // 범위 — 원장의 문서와 뿌리뿐이다(doc-ops 의 같은 검사 · 작업 D2a).
    const rootId = this.#deps.machineSetting.get(confluenceRootIdKey(slug));
    if (this.#ledger(slug).pages[pageId] === undefined && pageId !== rootId) {
      return { commandId, state: "failed", commentId: null, detail: REASON.scope };
    }
    const client = await this.#client(slug);
    const prepared = await attempt(client);
    if (prepared.ready === false) {
      // 검사의 실패에는 기록을 남기지 않는다 — 같은 명령으로 다시 시도할 수 있다.
      return { commandId, state: "failed", commentId: null, detail: prepared.detail };
    }
    const record: CommentOpRecord = {
      format: 1,
      commandId,
      op,
      pageId,
      createdAt: this.#now().toISOString(),
      result: null,
    };
    // sending 기록을 먼저 쓴다 — 응답을 잃어도 같은 명령의 재전송이 다시 쓰지 않는다.
    this.#writeRecord(file, record);
    const sent = await prepared.send();
    const result: DocCommentResult = sent.written
      ? { commandId, state: "applied", commentId: sent.value.id, detail: "" }
      : {
          commandId,
          state: sent.reason === "unknown" ? "unknown" : "failed",
          commentId: null,
          detail: sent.detail,
        };
    this.#writeRecord(file, { ...record, result });
    // 로그에는 종류와 수만 — 코멘트의 글 · 문장은 남기지 않는다.
    this.#deps.logger.info("문서 코멘트", { op, state: result.state });
    return result;
  }

  // ————— 안 — 프로젝트 · 연결 · 원장 —————

  #slug(): string {
    const slug = this.#deps.registry.activeSlug();
    if (slug === null || slug === "") {
      throw new Error("코멘트를 달 프로젝트가 없습니다 — 프로젝트를 먼저 골라 주세요.");
    }
    return slug;
  }

  async #client(slug: string): Promise<ConfluenceClient> {
    const site = this.#deps.machineSetting.get(confluenceSiteKey(slug));
    if (site === null) {
      throw new Error("먼저 연결해 주세요 — 코멘트는 연결 뒤에 쓸 수 있어요.");
    }
    const creds = await loadConfluenceCredentials(this.#deps.credentials, process.env);
    if (creds === null) {
      throw new Error("먼저 연결해 주세요 — 사이트 · 이메일 · 토큰을 넣어 주세요.");
    }
    return new ConfluenceClient(
      { site, email: creds.email, token: creds.token },
      this.#deps.transport?.(site) ?? createConfluenceTransport(process.env, site).transport,
    );
  }

  #ledger(slug: string): ConfluenceLedger {
    const root = this.#deps.workspaceRoot(slug);
    if (root === null) return emptyConfluenceLedger();
    return readConfluenceLedger(confluenceLedgerFile(root));
  }

  #plansRoot(slug: string): string {
    return join(this.#deps.registry.paths(slug).root, "plans");
  }

  // ————— 안 — 기록 —————

  /** 없거나 깨진 기록은 null — 읽기는 절대 던지지 않는다. */
  #readRecord(file: string): CommentOpRecord | null {
    const raw = asRecord(this.#readJson(file));
    if (
      raw === null ||
      raw.format !== 1 ||
      typeof raw.commandId !== "string" ||
      typeof raw.op !== "string" ||
      typeof raw.pageId !== "string" ||
      typeof raw.createdAt !== "string"
    ) {
      return null;
    }
    return {
      format: 1,
      commandId: raw.commandId,
      op: raw.op as DocCommentOp,
      pageId: raw.pageId,
      createdAt: raw.createdAt,
      result: asRecord(raw.result) === null ? null : (raw.result as DocCommentResult),
    };
  }

  #readJson(file: string): unknown {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  #writeRecord(file: string, record: CommentOpRecord): void {
    this.#writeAtomic(file, `${JSON.stringify(record, null, 2)}\n`);
  }

  /** 원자 쓰기 — 임시 파일을 쓰고 바꿔치기 한다. 실패하면 임시 파일을 지운다(draft-store 선례). */
  #writeAtomic(file: string, data: string): void {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(temporary, data, { mode: 0o600 });
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
