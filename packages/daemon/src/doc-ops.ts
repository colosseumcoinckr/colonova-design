/**
 * 문서 관리 서비스(2026-10-23 · 최종 구현 계획 F4 · 작업 D1a) — 휴지통 이동 · 복구 · 복제 ·
 * 위치 옮기기. 모든 요청은 활성 프로젝트에서 돌고, 프런트가 보낸 문서 아이디는 믿지 않는다 —
 * 원장(프로젝트 폴더 사본의 `confluence/confluence.json`)과 사본으로 범위를 검사한다. 영구 삭제는 제공하지
 * 않고, 미발행 초안이 있는 문서를 자동 정리하지 않고, 삭제된 문서를 자동 재생성하지 않는다
 * (정본 계획 §9). 실사이트 쓰기는 발행 게이트(`COLONOVA_DESIGN_CONFLUENCE_PUBLISH=1`)가
 * 켜졌을 때만 열린다. 기록은 `plans/ops/<commandId>.json` 과 `plans/trash.json` 이다.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DocOpBlocker,
  DocOpKind,
  DocOpPreview,
  DocOpResult,
  DocTrashEntry,
  ServerMessage,
} from "@colonova-design/protocol";
import {
  ConfluenceClient,
  type ConfluencePage,
  type ConfluenceWrite,
  createConfluenceTransport,
} from "./confluence-client.js";
import { type ConfluenceLedger, readConfluenceLedger } from "./confluence-ledger.js";
import { confluenceMirrorLedger } from "./confluence-mirror.js";
import {
  confluenceRootIdKey,
  confluenceRootTitleKey,
  confluenceSiteKey,
} from "./confluence-sync.js";
import { type CredentialStore, loadConfluenceCredentials } from "./credentials.js";
import type { DaemonLogger } from "./log.js";
import type { RestTransport } from "./rest-transport.js";

/** 문서 관리가 사는 데 꼭 필요한 것 — 서버가 만들어 넘기고, 시험은 가짜를 넣는다. */
export interface DocOpsDeps {
  registry: { activeSlug(): string | null; paths(slug: string): { root: string } };
  machineSetting: { get(key: string): string | null };
  credentials: CredentialStore;
  broadcast(message: ServerMessage): void;
  logger: DaemonLogger;
  /** 저장 전송 — 시험이 기록된 가짜를 넣는다. 없으면 env 가 고른다. */
  transport?: (site: string) => RestTransport;
  now?: () => Date;
  /** 적용 · 결과 불명 뒤에 트리를 걷는다 — 실패는 조용히(2026-10-23 · 최종 구현 계획 F2 · 작업 B5). */
  walkNow(slug: string): Promise<unknown>;
}

/** 한 명령의 기록 — sending 으로 먼저 쓰고 보내므로, 응답을 잃어도 같은 명령이 다시 쓰지 않는다. */
interface DocOpCommandRecord {
  format: 1;
  commandId: string;
  op: DocOpKind;
  pageId: string;
  parentId: string | null;
  title: string | null;
  createdAt: string;
  /** null 은 보내는 중이다 — 이 상태로 끝난 기록은 적용 여부를 모른다. */
  result: DocOpResult | null;
}

/** 휴지통 목록 파일의 모양 — 깨진 값은 버린다. */
interface TrashFile {
  format: 1;
  entries: DocTrashEntry[];
}

/** 미리보기의 검사 결과 — trash 의 기록 · restore 의 재료로 쓰는 원격 문서가 함께 온다. */
interface DocOpCheck {
  preview: DocOpPreview;
  page: ConfluencePage | null;
  entry: DocTrashEntry | null;
}

/** 막는 이유의 클라이언트 문장 — 데몬의 오류 문장은 한국어 한 줄이다(기존 관례). */
const BLOCKER_SENTENCES: Record<DocOpBlocker, string> = {
  "publish-disabled": "문서 관리가 꺼져 있습니다 — 발행을 허용해 주세요.",
  "out-of-scope": "기획서 목록에 없는 문서입니다 — 가져온 기획서 가운데서 골라 주세요.",
  "not-trashed-here": "이 앱이 휴지통으로 옮긴 문서가 아닙니다.",
  "remote-missing": "문서를 원격에서 읽지 못했습니다 — 연결을 확인해 주세요.",
  "no-permission": "권한이 없는 문서입니다 — Confluence 에서 권한을 확인해 주세요.",
  "has-draft": "미발행 초안이 있는 문서입니다 — 초안을 먼저 확인해 주세요.",
  "same-parent": "이미 그 부모 아래에 있습니다 — 다른 부모를 골라 주세요.",
};

/** 문서 관리 명령의 열쇠 — 소문자 UUID(경로에도 쓰여 모양을 좁힌다). */
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Confluence 페이지 · 폴더의 id — 숫자 1~20자(선로의 검사와 같은 모양). */
const PAGE_ID_PATTERN = /^\d{1,20}$/;

/** 관용 읽기 도우미 — 깨진 값은 버린다(draft-store 의 같은 감각). */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

export class DocOps {
  readonly #deps: DocOpsDeps;
  readonly #now: () => Date;

  constructor(deps: DocOpsDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => new Date());
  }

  // ————— 미리보기 —————

  /** 원격 대상과 자식 영향 범위를 확인한다(정본 계획 §9). 막는 이유를 모두 모은다. */
  async preview(op: DocOpKind, pageId: string, parentId?: string): Promise<DocOpPreview> {
    return (await this.#check(this.#slug(), op, pageId, parentId)).preview;
  }

  // ————— 수행 —————

  async trash(input: { pageId: string; commandId: string }): Promise<DocOpResult> {
    return await this.#run("trash", input);
  }

  async restore(input: { pageId: string; commandId: string }): Promise<DocOpResult> {
    return await this.#run("restore", input);
  }

  async copy(input: {
    pageId: string;
    commandId: string;
    title: string;
    parentId: string;
  }): Promise<DocOpResult> {
    return await this.#run("copy", input);
  }

  async move(input: { pageId: string; commandId: string; parentId: string }): Promise<DocOpResult> {
    return await this.#run("move", input);
  }

  /** 이 앱이 휴지통으로 옮긴 문서 목록 — 복구의 문이다. */
  trashed(): DocTrashEntry[] {
    return this.#entries(this.#slug());
  }

  // ————— 안 — 검사 —————

  async #check(
    slug: string,
    op: DocOpKind,
    pageId: string,
    parentId?: string,
  ): Promise<DocOpCheck> {
    const ledger = this.#ledger(slug);
    const rootId = this.#deps.machineSetting.get(confluenceRootIdKey(slug));
    // 미발행 로컬 초안의 존재 — 초안은 사람이 버린다(정본 계획 §9). 내용은 보지 않는다.
    const hasDraft = existsSync(join(this.#plansRoot(slug), "drafts", `p-${pageId}.json`));
    const target = parentId === undefined ? null : this.#targetOf(slug, ledger, parentId);
    const checkedAt = this.#now().toISOString();
    const base = {
      op,
      pageId,
      hasDraft,
      target,
      checkedAt,
    };
    // 게이트가 꺼졌으면 원격을 두드리지 않는다 — 쓰기가 막힌 세계에서 읽을 것도 없다.
    if (process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH !== "1") {
      return {
        preview: { ...base, title: "", childCount: null, blockers: ["publish-disabled"] },
        page: null,
        entry: null,
      };
    }
    if (op === "restore") {
      // 복구는 이 앱이 휴지통으로 옮긴 문서에만 열린다 — 아니면 not-trashed-here 다.
      const entry = this.#entries(slug).find((row) => row.pageId === pageId) ?? null;
      if (entry === null) {
        return {
          preview: {
            ...base,
            title: ledger.pages[pageId]?.title ?? "",
            childCount: null,
            blockers: ["not-trashed-here"],
          },
          page: null,
          entry: null,
        };
      }
      const client = await this.#client(slug);
      const read = await client.readTrashedPage(pageId);
      if (read.readable === false) {
        return {
          preview: { ...base, title: entry.title, childCount: null, blockers: ["remote-missing"] },
          page: null,
          entry,
        };
      }
      return {
        preview: { ...base, title: read.value.title, childCount: null, blockers: [] },
        page: read.value,
        entry,
      };
    }
    // trash · copy · move — 범위는 원장의 pages 와 뿌리다.
    if (ledger.pages[pageId] === undefined && pageId !== rootId) {
      return {
        preview: { ...base, title: "", childCount: null, blockers: ["out-of-scope"] },
        page: null,
        entry: null,
      };
    }
    // 복제 · 이동의 대상 부모 — 원장의 문서 · 폴더나 뿌리가 아니면 범위 밖이다. 프런트가 보낸
    // 부모 아이디는 믿지 않는다(2026-10-23 · 검토 발견 3).
    if ((op === "copy" || op === "move") && parentId !== undefined && target === null) {
      return {
        preview: {
          ...base,
          title: ledger.pages[pageId]?.title ?? "",
          childCount: null,
          blockers: ["out-of-scope"],
        },
        page: null,
        entry: null,
      };
    }
    const client = await this.#client(slug);
    const read = await client.readPage(pageId);
    if (read.readable === false) {
      return {
        preview: {
          ...base,
          title: ledger.pages[pageId]?.title ?? "",
          childCount: null,
          blockers: ["remote-missing"],
        },
        page: null,
        entry: null,
      };
    }
    const page = read.value;
    // 자식 영향 범위 — 휴지통 이동은 아이까지 같이 간다. 읽지 못하면 모름(null)이다.
    const children = await client.listDirectChildren(pageId, "page");
    const childCount = children.readable ? children.value.length : null;
    // 권한 — trash 는 문서의 동작이고, copy · move 는 대상 부모의 동작이다.
    const permitted =
      op === "trash"
        ? await this.#hasOperation(client, pageId, ["delete", "update"], ["page"])
        : parentId !== undefined &&
          (await this.#hasOperation(client, parentId, ["create", "update"], ["page", "folder"]));
    const blockers: DocOpBlocker[] = [];
    if (!permitted) blockers.push("no-permission");
    if ((op === "trash" || op === "move") && hasDraft) blockers.push("has-draft");
    if (
      op === "move" &&
      parentId !== undefined &&
      page.parentId !== null &&
      page.parentId === parentId
    ) {
      blockers.push("same-parent");
    }
    return {
      preview: { ...base, title: page.title, childCount, blockers },
      page,
      entry: null,
    };
  }

  /** 동작 읽기의 한 끗 — 필요한 동작이 문서 · 폴더에 열려 있는가. 읽지 못하면 없는 것이다. */
  async #hasOperation(
    client: ConfluenceClient,
    pageId: string,
    names: string[],
    targetTypes: string[],
  ): Promise<boolean> {
    const read = await client.pageOperations(pageId);
    if (read.readable === false) return false;
    return read.value.some(
      (row) => names.includes(row.operation) && targetTypes.includes(row.targetType),
    );
  }

  /** 부모의 원장 정보 — 폴더 · 문서 · 뿌리의 순서로 본다. 원장에 없으면 null 이다. */
  #targetOf(slug: string, ledger: ConfluenceLedger, parentId: string): DocOpPreview["target"] {
    const folder = ledger.folders[parentId];
    if (folder !== undefined) {
      return { id: parentId, type: "folder", title: folder.title };
    }
    const page = ledger.pages[parentId];
    if (page !== undefined) {
      return { id: parentId, type: "page", title: page.title };
    }
    if (parentId === this.#deps.machineSetting.get(confluenceRootIdKey(slug))) {
      return {
        id: parentId,
        type: "page",
        title: this.#deps.machineSetting.get(confluenceRootTitleKey(slug)) ?? "",
      };
    }
    return null;
  }

  // ————— 안 — 수행 —————

  async #run(
    op: DocOpKind,
    input: { pageId: string; commandId: string; parentId?: string; title?: string },
  ): Promise<DocOpResult> {
    // 명령 아이디는 파일 경로에 쓰이고 문서 아이디는 초안 경로에 조인된다 — 모양을 좁힌다.
    if (!COMMAND_ID_PATTERN.test(input.commandId)) {
      throw new Error("문서 관리 명령 아이디는 소문자 UUID 여야 합니다");
    }
    if (!PAGE_ID_PATTERN.test(input.pageId)) throw new Error("문서 아이디는 숫자여야 합니다");
    const slug = this.#slug();
    const file = join(this.#plansRoot(slug), "ops", `${input.commandId}.json`);
    const seen = this.#readCommand(file);
    if (seen !== null) {
      // 같은 아이디의 다른 명령 — 남의 결과를 돌려주지 않는다(2026-10-23 · 검토 발견 9).
      if (seen.op !== op || seen.pageId !== input.pageId) {
        throw new Error("이 명령 아이디는 이미 다른 문서 관리 명령에 쓰였습니다");
      }
      if (seen.result !== null) return seen.result;
      const unknown: DocOpResult = {
        commandId: input.commandId,
        op,
        state: "unknown",
        pageId: null,
        detail: "이 명령은 보낸 기록만 있습니다 — 적용 여부를 알 수 없어 다시 보내지 않았습니다.",
      };
      this.#writeCommand(file, { ...seen, result: unknown });
      return unknown;
    }
    // 수행 전에 미리보기를 다시 돌린다 — has-draft 를 뺀 막는 이유가 남으면 아무것도 보내지 않는다.
    const check = await this.#check(slug, op, input.pageId, input.parentId);
    const blocker = check.preview.blockers.find((row) => row !== "has-draft");
    if (blocker !== undefined) {
      return {
        commandId: input.commandId,
        op,
        state: "failed",
        pageId: null,
        detail: BLOCKER_SENTENCES[blocker],
      };
    }
    const record: DocOpCommandRecord = {
      format: 1,
      commandId: input.commandId,
      op,
      pageId: input.pageId,
      parentId: input.parentId ?? null,
      title: input.title ?? null,
      createdAt: this.#now().toISOString(),
      result: null,
    };
    // sending 기록을 먼저 쓴다 — 응답을 잃어도 같은 명령의 재전송이 다시 쓰지 않는다.
    this.#writeCommand(file, record);
    const client = await this.#client(slug);
    const sent = await this.#send(client, op, input, check);
    const result: DocOpResult = sent.written
      ? {
          commandId: input.commandId,
          op,
          state: "applied",
          pageId: op === "copy" ? sent.value.id : input.pageId,
          detail: "",
        }
      : {
          commandId: input.commandId,
          op,
          state: sent.reason === "unknown" ? "unknown" : "failed",
          pageId: null,
          detail: sent.detail,
        };
    if (result.state === "applied") {
      if (op === "trash") {
        // 휴지통 기록 — 복구는 이 목록에 있을 때만 열린다. 초안은 사람이 버린다(정본 계획 §9).
        this.#saveEntries(slug, [
          ...this.#entries(slug),
          {
            pageId: input.pageId,
            title: check.page?.title ?? "",
            parentId: check.page?.parentId ?? null,
            trashedAt: this.#now().toISOString(),
          },
        ]);
      }
      if (op === "restore") {
        this.#saveEntries(
          slug,
          this.#entries(slug).filter((row) => row.pageId !== input.pageId),
        );
      }
    }
    if (result.state === "applied" || result.state === "unknown") {
      // 적용 · 결과 불명 뒤에는 트리를 걷는다 — 이동은 판이 안 오르고 휴지통으로 간 문서는 검색에서
      // 빠질 뿐이라 증분이 못 본다(2026-10-23 · 최종 구현 계획 F2 · 작업 B5). 결과 불명이어도 실제
      // 상태를 목록에 비추는 것이 사람이 판단할 재료다. 걷기의 실패는 결과를 바꾸지 않는다.
      await this.#deps.walkNow(slug).catch(() => undefined);
    }
    this.#writeCommand(file, { ...record, result });
    // 로그에는 종류와 숫자만 — 제목 · 경로 · 사용자의 말은 남기지 않는다.
    this.#deps.logger.info("문서 관리", { op, state: result.state });
    return result;
  }

  /** 원격의 한 끗 — 종류마다의 길. restore 은 미리보기가 읽어 둔 휴지통 본문으로 보낸다. */
  #send(
    client: ConfluenceClient,
    op: DocOpKind,
    input: { pageId: string; parentId?: string; title?: string },
    check: DocOpCheck,
  ): Promise<ConfluenceWrite<{ id: string }>> {
    switch (op) {
      case "trash":
        return client.trashPage(input.pageId);
      case "copy":
        return client.copyPage({
          pageId: input.pageId,
          parentId: input.parentId ?? "",
          title: input.title ?? "",
        });
      case "move":
        return client.movePage({ pageId: input.pageId, parentId: input.parentId ?? "" });
      case "restore": {
        const page = check.page;
        // 막는 이유가 없었다 — 휴지통 본문이 반드시 있다.
        if (page === null) {
          return Promise.resolve({
            written: false as const,
            reason: "unknown" as const,
            detail: "문서 복구의 결과를 알 수 없습니다 — 휴지통 본문을 읽지 못했습니다.",
          });
        }
        return client.restorePage({
          pageId: input.pageId,
          title: page.title,
          storage: page.storage,
          version: page.version + 1, // version 은 휴지통 판 + 1 이다
        });
      }
    }
  }

  // ————— 안 — 프로젝트 · 연결 · 원장 —————

  #slug(): string {
    const slug = this.#deps.registry.activeSlug();
    if (slug === null || slug === "") {
      throw new Error("문서를 관리할 프로젝트가 없습니다 — 프로젝트를 먼저 골라 주세요.");
    }
    return slug;
  }

  async #client(slug: string): Promise<ConfluenceClient> {
    const site = this.#deps.machineSetting.get(confluenceSiteKey(slug));
    if (site === null) {
      throw new Error("먼저 연결해 주세요 — 문서 관리는 연결 뒤에 쓸 수 있어요.");
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
    // 원장 파일이 없으면 읽기가 빈 원장을 돌려준다 — 연결 전 · 아직 가져오기 전의 모양이다.
    return readConfluenceLedger(confluenceMirrorLedger(this.#deps.registry.paths(slug).root));
  }

  #plansRoot(slug: string): string {
    return join(this.#deps.registry.paths(slug).root, "plans");
  }

  // ————— 안 — 기록 —————

  /** 없거나 깨진 기록은 null — 읽기는 절대 던지지 않는다. */
  #readCommand(file: string): DocOpCommandRecord | null {
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
      op: raw.op as DocOpKind,
      pageId: raw.pageId,
      parentId: asString(raw.parentId),
      title: asString(raw.title),
      createdAt: raw.createdAt,
      result: asRecord(raw.result) === null ? null : (raw.result as DocOpResult),
    };
  }

  #readJson(file: string): unknown {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  #entries(slug: string): DocTrashEntry[] {
    const raw = asRecord(this.#readJson(join(this.#plansRoot(slug), "trash.json")));
    const list = raw?.entries;
    if (!Array.isArray(list)) return [];
    const entries: DocTrashEntry[] = [];
    for (const item of list) {
      const row = asRecord(item);
      const pageId = row === null ? null : asString(row.pageId);
      const title = row === null ? null : asString(row.title);
      const trashedAt = row === null ? null : asString(row.trashedAt);
      if (row === null || pageId === null || title === null || trashedAt === null) continue;
      entries.push({
        pageId,
        title,
        parentId: asString(row.parentId),
        trashedAt,
      });
    }
    return entries;
  }

  #saveEntries(slug: string, entries: DocTrashEntry[]): void {
    const file: TrashFile = { format: 1, entries };
    this.#writeAtomic(
      join(this.#plansRoot(slug), "trash.json"),
      `${JSON.stringify(file, null, 2)}\n`,
    );
  }

  #writeCommand(file: string, record: DocOpCommandRecord): void {
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
