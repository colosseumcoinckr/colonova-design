/**
 * 초안 서비스(2026-10-23 · 최종 구현 계획 F1 · 작업 B2) — 저장소 · 블록 엔진 · Confluence
 * 클라이언트 · 기획 AI · 발행 엔진을 잇는 몸. 모든 요청은 활성 프로젝트에서 돈다. 초안이
 * 바뀔 때마다 `draft.changed` 를, AI 진행마다 `draft.ai` 를 방송한다. 프런트가 보낸 문서
 * 아이디는 믿지 않고 — 원장(클론 `docs/plans/confluence.json`)과 뿌리 미러로 범위를 검사한다.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type {
  DraftBlock,
  DraftBlockStatus,
  DraftBlockView,
  DraftEdit,
  DraftMessage,
  DraftOp,
  DraftOpState,
  DraftPlanRef,
  DraftPublishPreview,
  DraftPublishResult,
  DraftReadRef,
  DraftRefInput,
  DraftSnapshot,
  DraftSummary,
  DraftThread,
  DraftView,
  ServerMessage,
} from "@colonova-design/protocol";
import { draftStageOf } from "@colonova-design/protocol";
import { ConfluenceClient, createConfluenceTransport } from "./confluence-client.js";
import {
  type ConfluenceLedger,
  emptyConfluenceLedger,
  readConfluenceLedger,
} from "./confluence-ledger.js";
import { deriveMarkdown } from "./confluence-markdown.js";
import { confluenceLedgerFile, confluenceRootIdKey, confluenceSiteKey } from "./confluence-sync.js";
import { type CredentialStore, loadConfluenceCredentials } from "./credentials.js";
import { buildDraftPrompt, type DraftAiRunner, type DraftPromptRef } from "./draft-ai.js";
import {
  composeDraftBody,
  type DraftPublishContext,
  type DraftPublisher,
} from "./draft-publish.js";
import {
  type DraftRecord,
  type DraftRecordBlock,
  DraftStore,
  type ProposalOpRecord,
  type ProposalRecord,
  type ThreadRecord,
} from "./draft-store.js";
import type { DaemonLogger } from "./log.js";
import { planRefHeader } from "./plan-refs.js";
import type { RestTransport } from "./rest-transport.js";
import {
  blockFingerprint,
  newBlockXml,
  parseStorage,
  projectBlock,
  renderBlock,
  type StorageDoc,
} from "./storage-blocks.js";

/** 초안 서비스가 사는 데 꼭 필요한 것 — 서버가 만들어 넘기고, 시험은 가짜를 넣는다. */
export interface DraftServiceDeps {
  registry: { activeSlug(): string | null; paths(slug: string): { root: string } };
  machineSetting: { get(key: string): string | null };
  credentials: CredentialStore;
  /** 클론 뿌리 — 없으면 null(연결 전 · 내려간 프로젝트). */
  workspaceRoot(slug: string): string | null;
  claudeExecutable(): string | null;
  broadcast(message: ServerMessage): void;
  logger: DaemonLogger;
  ai: DraftAiRunner;
  publisher: DraftPublisher;
  now?: () => Date;
  /** 저장 전송 — 시험이 기록된 fixture 를 넣는다. 없으면 env 가 고른다. */
  transport?: (site: string) => RestTransport;
}

/** 새 블록의 열쇠 — `n` + 소문자 12자 16진(공통 계약 §4). */
function newBlockId(): string {
  return `n${randomBytes(6).toString("hex")}`;
}

/** 문서를 Confluence 에서 여는 주소 — 웹의 docUrl 과 같은 모양(호스트를 못 읽으면 null). */
function confluencePageUrl(site: string, pageId: string): string | null {
  const host = site
    .trim()
    .replace(/^https?:\/\//iu, "")
    .replace(/[/?#].*$/u, "");
  if (!/^[a-z0-9.-]+$/iu.test(host) || pageId === "") return null;
  return `https://${host}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
}

/**
 * 절 이름의 같은 꼴(2026-10-23 · 웹 검토 R2 의 1) — 파생 마크다운 머리말 줄과 요청의 절
 * 이름을 한 정규화로 견준다. 굵게 · 기울임 · 취소선 · 코드 표지와 백슬래시 이스케이프를
 * 벗기고, 링크는 글만 남기며, `[Confluence 매크로: …]` · `[첨부: …]` 자리 표시와 토큰
 * `⟦…⟧` 는 지우고, 공백의 꼴을 하나로 본다. 양쪽 모두에 쓴다 — 같으면 같은 절이다.
 */
function normalizeSectionName(name: string): string {
  const withoutPlaceholders = name
    .replace(/\[Confluence 매크로: [^\]]*\]/gu, "")
    .replace(/\[첨부: [^\]]*\]/gu, "")
    .replace(/⟦[^⟧]*⟧/gu, "");
  const withoutLinks = withoutPlaceholders.replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1");
  const withoutMarkers = withoutLinks
    .replace(/(?:\*\*|__|\*|~~|`+)/gu, "")
    .replace(/\\(.)/gu, "$1");
  return withoutMarkers.replace(/[ \t\r\n]+/gu, " ").trim();
}

/** 관용 읽기 도우미 — 깨진 값은 버린다(draft-store 의 같은 감각). */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** AI 답의 블록 투영 검사 — 모양이 아니면 그 걸음은 버려진다. */
function isBlockView(value: unknown): value is DraftBlockView {
  const raw = asRecord(value);
  if (raw === null) return false;
  const isText = (item: unknown): item is string => typeof item === "string";
  switch (raw.kind) {
    case "heading":
      return (
        typeof raw.level === "number" &&
        Number.isInteger(raw.level) &&
        raw.level >= 1 &&
        raw.level <= 6 &&
        isText(raw.text)
      );
    case "paragraph":
      return isText(raw.text);
    case "list":
      return (
        (raw.ordered === true || raw.ordered === false) &&
        Array.isArray(raw.items) &&
        raw.items.every(isText)
      );
    case "table":
      return (
        Array.isArray(raw.rows) &&
        raw.rows.every((row) => {
          const one = asRecord(row);
          if (one === null) return false;
          const cells = one.cells;
          return (
            Array.isArray(cells) &&
            cells.every((cell) => {
              const pick = asRecord(cell);
              return (
                pick !== null &&
                (pick.header === true || pick.header === false) &&
                isText(pick.text)
              );
            })
          );
        })
      );
    case "preserved":
      return isText(raw.label);
    default:
      return false;
  }
}

export class DraftService {
  readonly #deps: DraftServiceDeps;
  readonly #now: () => Date;
  /** slug 별 저장소 — 한 벌만 만들어 기억한다(withLock 의 잠금이 인스턴스 안에 있다). */
  readonly #stores = new Map<string, DraftStore>();
  /** `<slug>:<docKey>` → 도는 생성의 손. cancel 이 끊고, stop 이 전부 끊는다. */
  readonly #running = new Map<string, AbortController>();
  /** 이 프로세스에서 도는 발행의 명령 아이디 — 재시작이 물려받은 잠금과 구별한다(2026-10-23 작업 B7). */
  readonly #sending = new Set<string>();

  constructor(deps: DraftServiceDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => new Date());
  }

  /** 데몬이 내려갈 때 도는 생성을 끊는다(2026-10-23 작업 B2). */
  stop(): void {
    for (const controller of this.#running.values()) controller.abort();
    this.#running.clear();
  }

  // ————— 목록 · 열기 · 만들기 —————

  async list(): Promise<DraftSummary[]> {
    const slug = this.#slug();
    const store = this.#store(slug);
    const rows: DraftSummary[] = [];
    for (const record of store.list()) {
      rows.push(
        this.#summary(await this.#recoverOrphaned(store, record), this.#missingBase(store, record)),
      );
    }
    return rows;
  }

  async open(pageId: string): Promise<DraftView> {
    const slug = this.#slug();
    const store = this.#store(slug);
    const docKey = `p-${pageId}`;
    const site = this.#requireSite(slug);
    const rootId = this.#deps.machineSetting.get(confluenceRootIdKey(slug));
    const ledger = this.#ledger(slug);
    if (
      ledger.pages[pageId] === undefined &&
      ledger.folders[pageId] === undefined &&
      pageId !== rootId
    ) {
      throw new Error("기획서 목록에 없는 문서입니다 — 가져온 기획서 가운데서 열어 주세요.");
    }
    const existing = store.read(docKey);
    if (existing !== null) return this.#view(await this.#recoverOrphaned(store, existing));
    const { client } = await this.#confluence(slug);
    return await store.withLock(docKey, async () => {
      const again = store.read(docKey);
      if (again !== null) return this.#view(again);
      const read = await client.readPage(pageId);
      if (!read.readable) throw new Error(read.detail);
      const page = read.value;
      const doc = parseStorage(page.storage);
      const now = this.#now().toISOString();
      const record: DraftRecord = {
        format: 1,
        docKey,
        kind: "existing",
        site,
        pageId,
        spaceId: page.spaceId,
        parent: null,
        title: page.title,
        baseTitle: page.title,
        baseVersion: page.version,
        baseFetchedAt: now,
        revision: 0,
        state: "editing",
        frame: doc.frame,
        blocks: doc.blocks.map((block) => ({
          ...block,
          baseFingerprint: blockFingerprint(block.xml),
        })),
        observedVersion: null,
        pendingCommandId: null,
        createdAt: now,
        updatedAt: now,
      };
      store.create(record, page.storage);
      this.#broadcast(record);
      return this.#view(record);
    });
  }

  async create(input: {
    title: string;
    parentId: string;
    parentType: "page" | "folder";
    templatePageId?: string;
  }): Promise<DraftView> {
    const slug = this.#slug();
    const store = this.#store(slug);
    const site = this.#requireSite(slug);
    const rootId = this.#deps.machineSetting.get(confluenceRootIdKey(slug));
    if (rootId === null) {
      throw new Error("기준 문서가 정해지지 않았습니다 — 연결에서 뿌리를 먼저 골라 주세요.");
    }
    const ledger = this.#ledger(slug);
    // 부모 — 뿌리 이거나 원장의 페이지 · 폴더. 종류는 원장의 실제가 이긴다.
    const parentPage = ledger.pages[input.parentId];
    const parentFolder = ledger.folders[input.parentId];
    let parentTitle: string | null = parentPage?.title ?? parentFolder?.title ?? null;
    const parentType = parentFolder !== undefined ? "folder" : "page";
    if (parentTitle === null && input.parentId !== rootId) {
      throw new Error("기획서 목록에 없는 자리입니다 — 새 문서의 자리는 목록에서 골라 주세요.");
    }
    const { client } = await this.#confluence(slug);
    // 공간 열쇠와 (부모가 뿌리일 때의) 제목 — 뿌리 문서를 읽어 얻는다.
    const rootRead = await client.readPage(rootId);
    if (!rootRead.readable) throw new Error(rootRead.detail);
    if (parentTitle === null) parentTitle = rootRead.value.title;
    // 틀 — 범위 안 문서의 본문을 블록으로 가져온다. 모두 새 블록이다(새 문서다).
    let frame: StorageDoc["frame"] = [{ slot: "main" }];
    let blocks: DraftRecordBlock[] = [];
    if (input.templatePageId !== undefined) {
      const templateId = input.templatePageId;
      if (ledger.pages[templateId] === undefined && templateId !== rootId) {
        throw new Error("기획서 목록에 없는 문서입니다 — 틀은 가져온 기획서 가운데서 골라 주세요.");
      }
      const template = await client.readPage(templateId);
      if (!template.readable) throw new Error(template.detail);
      const doc = parseStorage(template.value.storage);
      frame = doc.frame;
      blocks = doc.blocks.map((block) => ({ ...block, id: newBlockId(), baseFingerprint: null }));
    }
    const docKey = `n-${randomBytes(16).toString("hex")}`;
    const now = this.#now().toISOString();
    const record: DraftRecord = {
      format: 1,
      docKey,
      kind: "new",
      site,
      pageId: null,
      spaceId: rootRead.value.spaceId,
      parent: { id: input.parentId, type: parentType, title: parentTitle },
      title: input.title,
      baseTitle: null,
      baseVersion: null,
      baseFetchedAt: null,
      revision: 0,
      state: "editing",
      frame,
      blocks,
      observedVersion: null,
      pendingCommandId: null,
      createdAt: now,
      updatedAt: now,
    };
    return await store.withLock(docKey, () => {
      store.create(record, null);
      this.#broadcast(record);
      return this.#view(record);
    });
  }

  async get(docKey: string): Promise<DraftView> {
    const store = this.#storeFor(docKey);
    const record = this.#requireRecord(docKey, store);
    return this.#view(await this.#recoverOrphaned(store, record));
  }

  // ————— 고치기 · 버리기 —————

  async edit(docKey: string, expectedRevision: number, edits: DraftEdit[]): Promise<DraftView> {
    const store = this.#storeFor(docKey);
    const saved = await store.withLock(docKey, () => {
      const record = this.#requireRecord(docKey, store);
      if (record.state === "publishing" || record.state === "result-unknown") {
        throw new Error("발행이 도는 동안에는 초안을 고칠 수 없습니다.");
      }
      const work: DraftRecord = { ...record, blocks: record.blocks.map((block) => ({ ...block })) };
      // 하나라도 맞지 않으면 전부 거절이다 — 걸음을 차례로 복사본에 적용한다.
      for (const edit of edits) this.#applyEdit(store, work, edit);
      if (work.state === "published" || work.state === "closed-unconfirmed") work.state = "editing";
      return store.save(work, expectedRevision);
    });
    this.#broadcast(saved);
    return this.#view(saved);
  }

  async discard(docKey: string): Promise<{ discarded: true }> {
    const store = this.#storeFor(docKey);
    await store.withLock(docKey, () => {
      const record = this.#requireRecord(docKey, store);
      if (
        record.state === "publishing" ||
        record.state === "result-unknown" ||
        record.pendingCommandId !== null
      ) {
        throw new Error(
          "발행 결과를 확인하기 전에는 초안을 버릴 수 없어요 — 결과 다시 확인이나 재전송 없이 종료를 먼저 해 주세요",
        );
      }
      store.remove(docKey);
      this.#broadcast(record);
    });
    // 도는 생성이 있으면 끊는다 — 버린 초안의 답은 남기지 않으니 끝까지 돌릴 까닭이 없다(2026-10-23 마감 점검).
    this.#running.get(this.#runKey(this.#slug(), docKey))?.abort();
    return { discarded: true };
  }

  // ————— 기획 대화 —————

  /**
   * 묻기 — 사람 메시지를 붙이고 답의 자리를 마련해 바로 돌려주고, 뒤에서 생성을 돈다(2026-10-23 · D3).
   * 같은 초안에 도는 생성이 있으면 거절이다.
   */
  ask(
    docKey: string,
    text: string,
    refs: DraftRefInput[],
  ): { threadId: string; messageId: string } {
    const slug = this.#slug();
    const store = this.#store(slug);
    const runKey = this.#runKey(slug, docKey);
    if (this.#running.has(runKey)) {
      throw new Error("이미 도는 질문이 있습니다 — 끝나거나 멈춘 뒤에 다시 보내 주세요.");
    }
    const record = this.#requireRecord(docKey, store);
    // 근거 — 원장으로 제목 · 판을 채운다. 범위 밖은 거절이다.
    const ledger = this.#ledger(slug);
    const refRows = refs.map((ref) => {
      const page = ledger.pages[ref.pageId];
      if (page === undefined) {
        throw new Error("근거 문서가 기획서 목록에 없습니다 — 목록 가운데서 골라 주세요.");
      }
      return { input: ref, title: page.title, version: page.version, path: page.path };
    });
    // 근거의 파생 마크다운을 못 읽으면 묻기를 거절한다 — 빈 몸을 AI 에게 주지 않고 사람의 말로
    // 알린다(2026-10-23 2차 검토 R3 발견 5). 절을 골랐을 때와 문서 전체일 때가 같은 급의 오류이다.
    for (const row of refRows) this.#markdown(slug, row.path);
    const thread: ThreadRecord = store.thread(docKey) ?? {
      format: 1,
      threadId: randomUUID(),
      docKey,
      sdkSessionId: null,
      messages: [],
    };
    const history = thread.messages;
    const userMessage: DraftMessage = {
      messageId: randomUUID(),
      role: "user",
      text,
      at: this.#now().toISOString(),
      refs: refRows.map(({ input, title, version }) => ({
        pageId: input.pageId,
        title,
        version,
        ...(input.sections !== undefined ? { sections: input.sections } : {}),
      })),
    };
    const aiMessageId = randomUUID();
    thread.messages = [...thread.messages, userMessage];
    store.saveThread(thread);
    // 도는 생성 — cancel 이 끊는 손이다.
    const controller = new AbortController();
    this.#running.set(runKey, controller);
    void this.#generate({
      slug,
      store,
      record,
      thread,
      text,
      history,
      refs: refRows,
      aiMessageId,
      signal: controller.signal,
    }).finally(() => {
      if (this.#running.get(runKey) === controller) this.#running.delete(runKey);
    });
    return { threadId: thread.threadId, messageId: aiMessageId };
  }

  cancel(docKey: string): { cancelled: boolean } {
    const controller = this.#running.get(this.#runKey(this.#slug(), docKey));
    if (controller === undefined) return { cancelled: false };
    controller.abort();
    return { cancelled: true };
  }

  thread(docKey: string): DraftThread {
    const slug = this.#slug();
    const store = this.#store(slug);
    this.#requireRecord(docKey, store);
    return this.#threadView(slug, docKey, store);
  }

  /**
   * 근거 스냅샷(2026-10-23 · 최종 구현 계획 F3 · 작업 C3) — 요청 순간의 문서를
   * 마크다운 한 장으로 굳혀 입력창 첨부로 내준다. 화면 작업 중 가져오기가 돌거나
   * 문서를 고쳐도 이 장은 바뀌지 않는다.
   */
  snapshot(input: { pageId?: string; docKey?: string; sections?: string[] }): DraftSnapshot {
    if ((input.pageId !== undefined) === (input.docKey !== undefined)) {
      throw new Error("문서 하나만 골라 주세요 — 목록의 문서나 열린 초안 가운데 하나입니다.");
    }
    const slug = this.#slug();
    const sections = input.sections ?? [];
    return input.pageId !== undefined
      ? this.#snapshotOfPage(slug, input.pageId, sections)
      : this.#snapshotOfDraft(input.docKey ?? "", sections);
  }

  /** 가져온 문서의 스냅샷 — 원장으로 범위를 검사하고 클론의 파생 마크다운을 읽는다. */
  #snapshotOfPage(slug: string, pageId: string, sections: string[]): DraftSnapshot {
    const ledger = this.#ledger(slug);
    const page = ledger.pages[pageId];
    if (page === undefined) {
      throw new Error("근거 문서가 기획서 목록에 없습니다 — 목록 가운데서 골라 주세요.");
    }
    const root = this.#deps.workspaceRoot(slug);
    let markdown: string;
    try {
      markdown = readFileSync(join(root ?? "", "docs", "plans", `${page.path}.md`), "utf8");
    } catch {
      throw new Error("기획서 본문을 읽지 못했습니다 — 가져오기를 다시 돌려 주세요.");
    }
    const body = sections.length > 0 ? this.#sliceSections(markdown, sections) : markdown;
    const ref: DraftPlanRef = {
      title: page.title,
      pageId,
      docKey: null,
      url: confluencePageUrl(ledger.site, pageId),
      version: page.version,
      revision: null,
      published: true,
      sections,
    };
    return this.#packSnapshot(ref, page.title, `판 ${page.version} 기준`, body);
  }

  /** 초안의 스냅샷 — 저장 포맷을 파생 마크다운으로 내려 스냅샷에 담는다. */
  #snapshotOfDraft(docKey: string, sections: string[]): DraftSnapshot {
    const record = this.#requireRecord(docKey);
    const derived = deriveMarkdown(composeDraftBody(record), {
      pageId: record.pageId ?? "",
      space: null,
      title: record.title,
      version: record.baseVersion ?? 0,
      updatedAt: null,
    });
    const body =
      sections.length > 0 ? this.#sliceSections(derived.markdown, sections) : derived.markdown;
    const ref: DraftPlanRef = {
      title: record.title,
      pageId: record.pageId,
      docKey: record.docKey,
      url: record.pageId !== null ? confluencePageUrl(record.site, record.pageId) : null,
      version: record.baseVersion,
      revision: record.revision,
      published: false,
      sections,
    };
    return this.#packSnapshot(
      ref,
      record.title,
      `아직 발행하지 않은 초안 · 개정 ${record.revision}`,
      body,
    );
  }

  /** 첨부 한 장 — 표식 · 제목 · 한 줄 안내 · 마크다운을 UTF-8 base64 로 싼다. */
  #packSnapshot(ref: DraftPlanRef, title: string, note: string, markdown: string): DraftSnapshot {
    const clipped = Array.from(title.trim()).slice(0, 40).join("");
    const stamp = ref.published ? ` · 판 ${ref.version}` : ` · 초안 개정 ${ref.revision ?? 0}`;
    const text = [planRefHeader(ref), "", `# ${title}`, note, "", markdown].join("\n");
    return {
      attachment: {
        name: `기획서 · ${clipped}${stamp}.md`,
        mediaType: "text/markdown",
        data: Buffer.from(text, "utf8").toString("base64"),
      },
      ref,
    };
  }

  /** 생성의 몸 — 시작 방송 → 답 → 걸음 검사 → 변경안 · AI 메시지 저장 → done 방송. */
  async #generate(input: {
    slug: string;
    store: DraftStore;
    record: DraftRecord;
    thread: ThreadRecord;
    text: string;
    history: DraftMessage[];
    refs: Array<{ input: DraftRefInput; title: string; version: number; path: string }>;
    aiMessageId: string;
    signal: AbortSignal;
  }): Promise<void> {
    const { slug, store, record, thread, text, history, refs, aiMessageId, signal } = input;
    const docKey = record.docKey;
    const announce = (
      phase: "started" | "text" | "read" | "done" | "failed" | "cancelled",
      extra: { text?: string; read?: DraftReadRef; proposalId?: string; detail?: string },
    ): void => {
      this.#deps.broadcast({
        type: "draft.ai",
        docKey,
        threadId: thread.threadId,
        messageId: aiMessageId,
        phase,
        ...extra,
      });
    };
    announce("started", {});
    // 없는 클론의 임시 읽기 폴더 — 생성이 끝나면 거둔다.
    let tempRoot: string | null = null;
    try {
      const executable = this.#deps.claudeExecutable();
      if (executable === null) {
        throw new Error("기획 AI 를 찾지 못했습니다 — Claude Code CLI 를 먼저 설치해 주세요.");
      }
      const cloneRoot = this.#deps.workspaceRoot(slug);
      let readRoot: string;
      if (cloneRoot === null) {
        tempRoot = mkdtempSync(join(tmpdir(), "draft-ai-"));
        readRoot = tempRoot;
      } else {
        readRoot = join(cloneRoot, "docs", "plans");
      }
      const ledger = this.#ledger(slug);
      const promptRefs: DraftPromptRef[] = refs.map(({ input: ref, title, version, path }) => {
        const markdown = this.#markdown(slug, path);
        return {
          title,
          version,
          markdown:
            ref.sections !== undefined ? this.#sliceSections(markdown, ref.sections) : markdown,
          ...(ref.sections !== undefined ? { sections: ref.sections } : {}),
        };
      });
      const prompt = buildDraftPrompt({
        draft: this.#view(store.read(docKey) ?? record),
        text,
        refs: promptRefs,
        history,
      });
      const reads: DraftReadRef[] = [];
      const seenReads = new Set<string>();
      const answer = await this.#deps.ai(
        { executable, readRoot, resume: thread.sdkSessionId, prompt, signal },
        {
          onText: (accumulated) => announce("text", { text: accumulated }),
          onRead: (absPath) => {
            // 원장에 없는 파일은 담지 않는다 — 읽은 근거만 대화에 남는다.
            const found = this.#readRef(slug, absPath, ledger);
            if (found !== null && !seenReads.has(found.pageId)) {
              seenReads.add(found.pageId);
              reads.push(found);
              announce("read", { read: found });
            }
          },
        },
      );
      // 걸음 검사 — 맞지 않는 것은 버린다(로그엔 종류와 수만 남긴다).
      // 생성 중에 초안이 버려졌으면 아무것도 남기지 않는다 — 버린 열쇠에 대화 · 변경안을 다시 쓰면 다음에 연 새 초안에
      // 옛 기록이 붙는다(2026-10-23 검토 B10).
      if (store.read(docKey) === null) {
        announce("cancelled", {});
        return;
      }
      // 걸음은 물을 때의 초안(AI 가 본 것)으로 검사한다 — 지금 초안으로 재면 생성 중에 사람이 고친 블록의 지문이 실려,
      // AI 의 옛 내용이 그 위에 채택될 수 있다(2026-10-23 오케스트레이터 검토 · 계획 §6).
      const { ops, dropped } = this.#normalizeOps(answer.ops, record);
      if (dropped > 0) this.#deps.logger.info("기획 AI 변경안 거절", { count: dropped });
      let proposalId: string | null = null;
      if (ops.length > 0) {
        proposalId = randomUUID();
        const proposal: ProposalRecord = {
          proposalId,
          threadId: thread.threadId,
          createdAt: this.#now().toISOString(),
          draftRevision: record.revision,
          baseVersion: record.baseVersion,
          summary: answer.summary,
          ops,
        };
        // 저장도 문서 잠금 안에서 — 같은 순간의 채택이 저장한 표시를 덮지 않게 저장 직전에
        // 지금 목록을 다시 읽어 합친다(2026-10-23 · 검토 발견 6).
        await store.withLock(docKey, () => {
          // 생성 중에 초안의 개정이나 기준 판이 바뀌었으면(사람의 고침 · 채택 · 발행 · 다시 맞추기) 이 변경안은 처음부터
          // 오래됨이다 — 계획 §6 「생성 중 사람이 초안을 고쳤으면 변경안을 오래된 것으로 표시한다」.
          const current = store.read(docKey);
          if (current === null) return;
          if (current.revision !== record.revision || current.baseVersion !== record.baseVersion) {
            for (const op of proposal.ops) op.state = "stale";
          }
          store.saveProposals(docKey, [...store.proposals(docKey), proposal]);
        });
      }
      thread.sdkSessionId = answer.sdkSessionId;
      thread.messages = [
        ...thread.messages,
        {
          messageId: aiMessageId,
          role: "assistant",
          text: answer.reply,
          at: this.#now().toISOString(),
          ...(proposalId !== null ? { proposalId } : {}),
          ...(reads.length > 0 ? { reads } : {}),
        },
      ];
      // 대화도 문서 잠금 안에서, 초안이 아직 있을 때만 쓴다 — 버리기와 엇갈려 지운 열쇠에 다시 쓰지 않게.
      const kept = await store.withLock(docKey, () => {
        if (store.read(docKey) === null) return false;
        store.saveThread(thread);
        return true;
      });
      if (!kept) {
        announce("cancelled", {});
        return;
      }
      announce("done", proposalId !== null ? { proposalId } : {});
    } catch (error) {
      if (signal.aborted) {
        announce("cancelled", {});
        return;
      }
      this.#deps.logger.error("기획 AI 생성 실패", { err: error });
      // 짧은 한국어만 대화에 남긴다 — 바깥 오류 문장은 그대로 두지 않는다(session.asPlannerFacingError 와 같은 감각).
      const detail = error instanceof Error ? error.message : String(error);
      const sentence = /[\p{Script=Hangul}]/u.test(detail)
        ? detail
        : "생성이 끊겼습니다 — 잠시 뒤 다시 물어 주세요.";
      thread.messages = [
        ...thread.messages,
        {
          messageId: aiMessageId,
          role: "assistant",
          text: "",
          at: this.#now().toISOString(),
          error: sentence,
        },
      ];
      // 버려진 초안의 대화는 다시 쓰지 않는다(2026-10-23 검토 B10) — 잠금 안에서 확인하고 쓴다.
      await store.withLock(docKey, () => {
        if (store.read(docKey) !== null) store.saveThread(thread);
      });
      announce("failed", { detail: sentence });
    } finally {
      if (tempRoot !== null) rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  /** AI 걸음을 검사해 변경안으로 받는다 — 맞지 않는 것은 버린다. */
  #normalizeOps(
    items: unknown[],
    record: DraftRecord,
  ): { ops: ProposalOpRecord[]; dropped: number } {
    const ops: ProposalOpRecord[] = [];
    let dropped = 0;
    for (const item of items) {
      const op = this.#opOf(item, record);
      if (op === null) dropped += 1;
      else ops.push(op);
    }
    return { ops, dropped };
  }

  #opOf(item: unknown, record: DraftRecord): ProposalOpRecord | null {
    const raw = asRecord(item);
    if (raw === null) return null;
    const opId =
      typeof raw.opId === "string" && raw.opId !== ""
        ? raw.opId
        : `op-${randomBytes(4).toString("hex")}`;
    if (raw.type === "replace" || raw.type === "delete") {
      if (typeof raw.blockId !== "string") return null;
      const block = record.blocks.find((candidate) => candidate.id === raw.blockId);
      if (block === undefined) return null;
      if (raw.type === "delete") {
        return {
          opId,
          type: "delete",
          blockId: raw.blockId,
          state: "open",
          baseFingerprint: blockFingerprint(block.xml),
        };
      }
      if (!isBlockView(raw.view)) return null;
      if (!renderBlock(block, raw.view).ok) return null;
      return {
        opId,
        type: "replace",
        blockId: raw.blockId,
        view: raw.view,
        state: "open",
        baseFingerprint: blockFingerprint(block.xml),
      };
    }
    if (raw.type === "insert") {
      if (raw.afterBlockId !== null && typeof raw.afterBlockId !== "string") return null;
      if (
        raw.afterBlockId !== null &&
        !record.blocks.some((candidate) => candidate.id === raw.afterBlockId)
      ) {
        return null;
      }
      if (!isBlockView(raw.view)) return null;
      if (!newBlockXml(raw.view).ok) return null;
      return {
        opId,
        type: "insert",
        afterBlockId: raw.afterBlockId,
        view: raw.view,
        state: "open",
        baseFingerprint: null,
      };
    }
    if (raw.type === "title") {
      if (typeof raw.title !== "string" || raw.title.length < 1 || raw.title.length > 255) {
        return null;
      }
      return { opId, type: "title", title: raw.title, state: "open", baseFingerprint: null };
    }
    return null;
  }

  /** 변경안의 한 걸음이 지금 초안에도 맞는가 — 채택 전의 마지막 대 본(2026-10-23 작업 B2). */
  #opStale(op: ProposalOpRecord, record: DraftRecord): boolean {
    if (op.type === "replace" || op.type === "delete") {
      const block = record.blocks.find((candidate) => candidate.id === op.blockId);
      if (block === undefined) return true;
      return blockFingerprint(block.xml) !== op.baseFingerprint;
    }
    if (op.type === "insert") {
      return (
        op.afterBlockId !== null &&
        !record.blocks.some((candidate) => candidate.id === op.afterBlockId)
      );
    }
    return false;
  }

  // ————— 채택 · 거절 —————

  async adopt(
    docKey: string,
    proposalId: string,
    opIds: string[],
    expectedRevision: number,
  ): Promise<DraftView> {
    const store = this.#storeFor(docKey);
    const saved = await store.withLock(docKey, () => {
      const record = this.#requireRecord(docKey, store);
      if (record.state === "publishing" || record.state === "result-unknown") {
        throw new Error("발행이 도는 동안에는 채택할 수 없습니다.");
      }
      const proposals = store.proposals(docKey);
      const proposal = proposals.find((row) => row.proposalId === proposalId);
      if (proposal === undefined) {
        throw new Error("변경안을 찾지 못했습니다 — 대화를 다시 읽어 주세요.");
      }
      const wanted = new Set(opIds);
      const work: DraftRecord = { ...record, blocks: record.blocks.map((block) => ({ ...block })) };
      let applied = 0;
      for (const op of proposal.ops) {
        if (!wanted.has(op.opId)) continue;
        // 이미 정해진 걸음은 두 번 적용하지 않는다. 오래됨으로 표시된 걸음도 — 지문 · 앵커를 다시 대 보는 것만으로는
        // 생성 중 고침 · 기준 바뀜(블록 id 재매김)을 가리지 못한다(2026-10-23 검토 B10).
        if (op.state === "adopted" || op.state === "rejected" || op.state === "stale") continue;
        if (this.#opStale(op, work) || !this.#applyOp(work, op)) {
          op.state = "stale";
          continue;
        }
        op.state = "adopted";
        applied += 1;
      }
      if (applied > 0) {
        if (work.state === "published" || work.state === "closed-unconfirmed")
          work.state = "editing";
        // 개정이 다르면 DraftStaleError — 처리기가 코드 draft.stale 로 낸다.
        store.save(work, expectedRevision);
        store.saveProposals(docKey, proposals);
      } else if (proposal.ops.some((op) => op.state === "stale" && wanted.has(op.opId))) {
        // 아무것도 적용되지 않았어도 stale 표시는 남긴다 — 대화가 다시 읽힐 때 보인다.
        store.saveProposals(docKey, proposals);
      }
      return applied > 0 ? (store.read(docKey) ?? work) : record;
    });
    this.#broadcast(saved);
    return this.#view(saved);
  }

  async reject(docKey: string, proposalId: string, opIds?: string[]): Promise<DraftThread> {
    const slug = this.#slug();
    const store = this.#storeFor(docKey);
    return await store.withLock(docKey, () => {
      const proposals = store.proposals(docKey);
      const proposal = proposals.find((row) => row.proposalId === proposalId);
      if (proposal === undefined) {
        throw new Error("변경안을 찾지 못했습니다 — 대화를 다시 읽어 주세요.");
      }
      const wanted = opIds === undefined ? null : new Set(opIds);
      for (const op of proposal.ops) {
        if (wanted !== null && !wanted.has(op.opId)) continue;
        if (op.state !== "open") continue;
        op.state = "rejected";
      }
      store.saveProposals(docKey, proposals);
      return this.#threadView(slug, docKey, store);
    });
  }

  /** 채택의 한 걸음을 초안에 적용한다 — edit 과 같은 규칙. 못 적용하면 거짓. */
  #applyOp(record: DraftRecord, op: ProposalOpRecord): boolean {
    switch (op.type) {
      case "replace": {
        const index = record.blocks.findIndex((block) => block.id === op.blockId);
        const block = record.blocks[index];
        if (index === -1 || block === undefined) return false;
        if (!projectBlock(block).editable) return false;
        const rendered = renderBlock(block, op.view);
        if (!rendered.ok) return false;
        record.blocks[index] = { ...block, kind: op.view.kind, xml: rendered.xml };
        return true;
      }
      case "insert": {
        const made = newBlockXml(op.view);
        if (!made.ok) return false;
        if (op.afterBlockId !== null && !record.blocks.some((b) => b.id === op.afterBlockId)) {
          return false;
        }
        record.blocks.splice(this.#indexAfter(record, op.afterBlockId), 0, {
          id: newBlockId(),
          slot: this.#slotAfter(record, op.afterBlockId),
          kind: op.view.kind,
          xml: made.xml,
          baseFingerprint: null,
        });
        return true;
      }
      case "delete": {
        const index = record.blocks.findIndex((block) => block.id === op.blockId);
        if (index === -1) return false;
        record.blocks.splice(index, 1);
        return true;
      }
      case "title":
        record.title = op.title;
        return true;
    }
  }

  // ————— 발행 묶음 — publisher 로 넘기고, 초안이 바뀌면 방송한다 —————

  /**
   * 발행의 자리 — 저장소 · 클라이언트 · 뿌리 · 스위치 · 계정. 연결이 없으면 클라이언트는
   * null 이고, 계정 대조는 whoAmI 가 이길 때만 채워진다(실패면 null).
   */
  async #context(slug: string): Promise<DraftPublishContext> {
    const store = this.#store(slug);
    const site = this.#deps.machineSetting.get(confluenceSiteKey(slug));
    const rootId = this.#deps.machineSetting.get(confluenceRootIdKey(slug));
    let client: ConfluenceClient | null = null;
    let accountId: string | null = null;
    if (site !== null) {
      const creds = await loadConfluenceCredentials(this.#deps.credentials, process.env);
      if (creds !== null) {
        client = new ConfluenceClient(
          { site, email: creds.email, token: creds.token },
          this.#transportFor(site),
        );
        const who = await client.whoAmI().catch(() => null);
        if (who?.ok) accountId = who.accountId;
      }
    }
    return {
      store,
      client,
      rootId,
      enabled: process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH === "1",
      accountId,
      now: this.#now,
    };
  }

  async publishPreview(docKey: string): Promise<DraftPublishPreview> {
    const ctx = await this.#context(this.#slug());
    // 미리보기의 저장(observedVersion)도 문서 잠금 안에서 — 편집 저장과 겹쳐 잠긴 개정 오류로
    // 보이지 않게 한다(2026-10-23 · 검토 발견 5).
    return await ctx.store.withLock(docKey, () => this.#deps.publisher.preview(ctx, docKey));
  }

  async publish(input: {
    docKey: string;
    commandId: string;
    expectedRevision: number;
    stage?: { notation: string; reason: string };
  }): Promise<DraftPublishResult> {
    const ctx = await this.#context(this.#slug());
    const before = ctx.store.read(input.docKey);
    // 도는 발행 표식을 먼저 선다 — 읽는 길의 회복이 이 잠금을 건드리지 않게(2026-10-23 작업 B7).
    this.#sending.add(input.commandId);
    let result: DraftPublishResult;
    try {
      result = await this.#deps.publisher.publish(ctx, input);
    } finally {
      this.#sending.delete(input.commandId);
    }
    this.#broadcastIfChanged(ctx.store, input.docKey, before);
    return result;
  }

  async publishRecheck(commandId: string): Promise<DraftPublishResult> {
    const ctx = await this.#context(this.#slug());
    return await this.#settle(ctx, commandId, () => this.#deps.publisher.recheck(ctx, commandId));
  }

  async publishClose(commandId: string): Promise<DraftPublishResult> {
    const ctx = await this.#context(this.#slug());
    return await this.#settle(ctx, commandId, () => this.#deps.publisher.close(ctx, commandId));
  }

  async rebase(docKey: string): Promise<DraftView> {
    const ctx = await this.#context(this.#slug());
    const record = await this.#deps.publisher.rebase(ctx, docKey);
    this.#broadcast(record);
    return this.#view(record);
  }

  async resolve(docKey: string, blockId: string, choice: "mine" | "theirs"): Promise<DraftView> {
    const ctx = await this.#context(this.#slug());
    const record = await this.#deps.publisher.resolve(ctx, { docKey, blockId, choice });
    this.#broadcast(record);
    return this.#view(record);
  }

  /** 확인 뒤의 정산(recheck · close) — 명령의 초안을 찾아 바뀜만 방송한다. */
  async #settle(
    ctx: DraftPublishContext,
    commandId: string,
    run: () => Promise<DraftPublishResult>,
  ): Promise<DraftPublishResult> {
    const intent = ctx.store.intent(commandId);
    const before = intent === null ? null : ctx.store.read(intent.docKey);
    const result = await run();
    if (intent !== null) this.#broadcastIfChanged(ctx.store, intent.docKey, before);
    return result;
  }

  /**
   * 물려받은 발행 도중 초안의 회복(2026-10-23 작업 B7 · 최종 구현 계획 A5 · A9) — 데몬이 발행
   * 답을 받기 전에 멈추면 디스크에는 publishing 초안과 sending 의도만 남는다. 읽어 돌려주는
   * 길에서 이 프로세스의 도는 발행이 아닌 잠금을 result-unknown 으로 옮겨 저장하고(문서 잠금
   * 안에서 개정 대조를 지킨다), 의도가 아직 sending 면 unknown 으로 옮긴다. 다시 보내지 않는다
   * — 그 뒤는 결과 다시 확인 · 재전송 없이 종료의 몫이다.
   */
  async #recoverOrphaned(store: DraftStore, record: DraftRecord): Promise<DraftRecord> {
    if (record.state !== "publishing") return record;
    if (record.pendingCommandId === null || this.#sending.has(record.pendingCommandId)) {
      return record;
    }
    return await store.withLock(record.docKey, () => {
      // 잠금 차례에는 지금 모양을 다시 본다 — 도는 발행이 잠근 초안이면 그대로 둔다.
      const current = store.read(record.docKey);
      if (
        current === null ||
        current.state !== "publishing" ||
        current.pendingCommandId === null ||
        this.#sending.has(current.pendingCommandId)
      ) {
        return current ?? record;
      }
      const intent = store.intent(current.pendingCommandId);
      if (intent !== null && intent.state === "sending") {
        store.saveIntent({ ...intent, state: "unknown" });
      }
      const saved = store.save({ ...current, state: "result-unknown" }, current.revision);
      this.#deps.logger.info("멈춘 발행 초안 회복", { count: 1 });
      this.#broadcast(saved);
      return saved;
    });
  }

  // ————— 안 — 프로젝트 · 저장소 · 연결 · 범위 —————

  #slug(): string {
    const slug = this.#deps.registry.activeSlug();
    if (slug === null || slug === "") {
      throw new Error("초안을 쓸 프로젝트가 없습니다 — 프로젝트를 먼저 골라 주세요.");
    }
    return slug;
  }

  #store(slug: string): DraftStore {
    let store = this.#stores.get(slug);
    if (store === undefined) {
      store = new DraftStore(join(this.#deps.registry.paths(slug).root, "plans"), this.#now);
      this.#stores.set(slug, store);
    }
    return store;
  }

  /** 요청의 초안 열쇠로 저장소를 고른다 — 활성 프로젝트의 저장소다. */
  #storeFor(docKey: string): DraftStore {
    void docKey;
    return this.#store(this.#slug());
  }

  #requireSite(slug: string): string {
    const site = this.#deps.machineSetting.get(confluenceSiteKey(slug));
    if (site === null) {
      throw new Error("먼저 연결해 주세요 — 초안은 연결 뒤에 쓸 수 있어요.");
    }
    return site;
  }

  async #confluence(slug: string): Promise<{ client: ConfluenceClient; site: string }> {
    const site = this.#requireSite(slug);
    const creds = await loadConfluenceCredentials(this.#deps.credentials, process.env);
    if (creds === null) {
      throw new Error("먼저 연결해 주세요 — 사이트 · 이메일 · 토큰을 넣어 주세요.");
    }
    return {
      client: new ConfluenceClient(
        { site, email: creds.email, token: creds.token },
        this.#transportFor(site),
      ),
      site,
    };
  }

  #transportFor(site: string): RestTransport {
    return this.#deps.transport?.(site) ?? createConfluenceTransport(process.env, site).transport;
  }

  #ledger(slug: string): ConfluenceLedger {
    const root = this.#deps.workspaceRoot(slug);
    if (root === null) return emptyConfluenceLedger();
    return readConfluenceLedger(confluenceLedgerFile(root));
  }

  #requireRecord(docKey: string, store?: DraftStore): DraftRecord {
    const record = (store ?? this.#storeFor(docKey)).read(docKey);
    if (record === null) {
      throw new Error("열려 있는 초안이 없습니다 — 목록에서 다시 열어 주세요.");
    }
    return record;
  }

  #runKey(slug: string, docKey: string): string {
    return `${slug}:${docKey}`;
  }

  // ————— 안 — 걸음 적용 —————

  /** edit 의 한 걸음 — 하나라도 실패하면 예외로 전부 거절이다. */
  #applyEdit(store: DraftStore, record: DraftRecord, edit: DraftEdit): void {
    switch (edit.type) {
      case "set": {
        const index = this.#indexOf(record, edit.blockId);
        const block = record.blocks.at(index);
        if (block === undefined) {
          throw new Error("블록을 찾지 못했습니다 — 초안을 다시 읽어 주세요.");
        }
        if (!projectBlock(block).editable) {
          throw new Error(
            "보존 블록은 고칠 수 없습니다 — 매크로 · 병합 표 · 중첩 목록은 그대로 둡니다.",
          );
        }
        const rendered = renderBlock(block, edit.view);
        if (!rendered.ok) throw new Error(rendered.reason);
        record.blocks[index] = { ...block, kind: edit.view.kind, xml: rendered.xml };
        return;
      }
      case "insert": {
        const made = newBlockXml(edit.view);
        if (!made.ok) throw new Error(made.reason);
        record.blocks.splice(this.#indexAfter(record, edit.afterBlockId), 0, {
          id: newBlockId(),
          slot: this.#slotAfter(record, edit.afterBlockId),
          kind: edit.view.kind,
          xml: made.xml,
          baseFingerprint: null,
        });
        return;
      }
      case "delete": {
        record.blocks.splice(this.#indexOf(record, edit.blockId), 1);
        return;
      }
      case "move": {
        const index = this.#indexOf(record, edit.blockId);
        const [moved] = record.blocks.splice(index, 1);
        if (moved === undefined) return;
        moved.slot = this.#slotAfter(record, edit.afterBlockId);
        record.blocks.splice(this.#indexAfter(record, edit.afterBlockId), 0, moved);
        return;
      }
      case "revert": {
        const index = this.#indexOf(record, edit.blockId);
        const current = record.blocks.at(index);
        if (current === undefined) {
          throw new Error("블록을 찾지 못했습니다 — 초안을 다시 읽어 주세요.");
        }
        const base = store.readBase(record.docKey);
        if (base === null) throw new Error("기준 원문이 없어 되돌릴 수 없습니다.");
        const baseBlock = parseStorage(base).blocks.find((block) => block.id === edit.blockId);
        if (baseBlock === undefined) {
          throw new Error("기준에 없는 블록은 되돌릴 수 없습니다.");
        }
        record.blocks[index] = {
          ...current,
          xml: baseBlock.xml,
          baseFingerprint: blockFingerprint(baseBlock.xml),
        };
        return;
      }
      case "title": {
        if (edit.title.length < 1 || edit.title.length > 255) {
          throw new Error("제목은 1자 이상 255자 이하여야 합니다.");
        }
        record.title = edit.title;
        return;
      }
    }
  }

  #indexOf(record: DraftRecord, blockId: string): number {
    const index = record.blocks.findIndex((block) => block.id === blockId);
    if (index === -1) throw new Error("블록을 찾지 못했습니다 — 초안을 다시 읽어 주세요.");
    return index;
  }

  /** 앞 블록의 칸 — 앞이 없으면 첫 칸(첫 블록의 칸, 없으면 최상위). */
  #slotAfter(record: DraftRecord, afterBlockId: string | null): string {
    if (afterBlockId === null) return record.blocks[0]?.slot ?? "main";
    const block = record.blocks.find((candidate) => candidate.id === afterBlockId);
    if (block === undefined) {
      throw new Error("블록을 찾지 못했습니다 — 초안을 다시 읽어 주세요.");
    }
    return block.slot;
  }

  #indexAfter(record: DraftRecord, afterBlockId: string | null): number {
    if (afterBlockId === null) return 0;
    return this.#indexOf(record, afterBlockId) + 1;
  }

  // ————— 안 — 근거 문서 —————

  /**
   * 원장 경로의 파생 마크다운 — 클론 `docs/plans/<path>.md`. 읽지 못하면 묻기를 거절한다 — 빈 몸을
   * AI 에게 조용히 주지 않는다(2026-10-23 2차 검토 R3 발견 5).
   */
  #markdown(slug: string, path: string): string {
    const root = this.#deps.workspaceRoot(slug);
    if (root !== null) {
      try {
        return readFileSync(join(root, "docs", "plans", `${path}.md`), "utf8");
      } catch {
        // 읽지 못하면 아래 문장으로 넘어간다.
      }
    }
    throw new Error("기획서 본문을 읽지 못했어요 — 새로 가져오기를 한 뒤 다시 물어 주세요");
  }

  /**
   * 절이 있으면 그 절만 — 같은 단계의 다음 머리말까지. 절 이름은 `normalizeSectionName` 의
   * 한 정규화로 견준다(2026-10-23 · 웹 검토 R2 의 1). 고른 절 중 하나라도 못 찾으면 문서
   * 전체로 대신하지 않고 거절한다 — AI 에게 엉뚱한 전체 문장을 주지 않게.
   */
  #sliceSections(markdown: string, sections: string[]): string {
    if (sections.length === 0) return markdown;
    const lines = markdown.split("\n");
    const picked: string[] = [];
    for (const wanted of sections) {
      const key = normalizeSectionName(wanted);
      const start = lines.findIndex((line) => {
        const match = /^(#{1,6}) (.+)$/.exec(line);
        return match !== null && normalizeSectionName(match[2] ?? "") === key;
      });
      if (start === -1) {
        throw new Error("고른 절을 문서에서 찾지 못했어요 — 문서를 다시 읽은 뒤 골라 주세요");
      }
      const level = lines.at(start)?.match(/^#+/)?.[0].length ?? 1;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i += 1) {
        const otherLevel = /^(#{1,6}) /.exec(lines[i] ?? "")?.[1]?.length;
        if (otherLevel !== undefined && otherLevel <= level) {
          end = i;
          break;
        }
      }
      picked.push(lines.slice(start, end).join("\n"));
    }
    return picked.join("\n\n");
  }

  /** AI 가 읽은 파일을 원장 문서로 돌린다 — 원장에 없는 파일은 null(담지 않는다). */
  #readRef(slug: string, absPath: string, ledger: ConfluenceLedger): DraftReadRef | null {
    const root = this.#deps.workspaceRoot(slug);
    if (root === null) return null;
    const plansRoot = resolve(join(root, "docs", "plans"));
    const resolved = resolve(absPath);
    if (!resolved.startsWith(`${plansRoot}${sep}`)) return null;
    const relative = resolved.slice(plansRoot.length + 1);
    const withoutSuffix = relative.endsWith(".md") ? relative.slice(0, -".md".length) : relative;
    for (const [pageId, page] of Object.entries(ledger.pages)) {
      if (page.path === withoutSuffix) return { pageId, title: page.title, version: page.version };
    }
    return null;
  }

  // ————— 안 — 보기 —————

  #broadcast(record: DraftRecord): void {
    this.#deps.broadcast({
      type: "draft.changed",
      docKey: record.docKey,
      revision: record.revision,
      state: record.state,
    });
  }

  #broadcastIfChanged(store: DraftStore, docKey: string, before: DraftRecord | null): void {
    const record = store.read(docKey);
    if (record === null) return;
    if (before !== null && before.revision === record.revision && before.state === record.state) {
      return;
    }
    this.#broadcast(record);
  }

  #view(record: DraftRecord): DraftView {
    return {
      docKey: record.docKey,
      kind: record.kind,
      pageId: record.pageId,
      site: record.site,
      title: record.title,
      baseTitle: record.baseTitle,
      baseVersion: record.baseVersion,
      revision: record.revision,
      state: record.state,
      blocks: record.blocks.map((block) => this.#wireBlock(block)),
      parent: record.parent,
      stage: draftStageOf(record.title),
      observedVersion: record.observedVersion,
      pendingCommandId: record.pendingCommandId,
      updatedAt: record.updatedAt,
    };
  }

  #wireBlock(block: DraftRecordBlock): DraftBlock {
    const projection = projectBlock(block);
    const status: DraftBlockStatus =
      block.theirsXml !== undefined
        ? "conflict"
        : block.baseFingerprint === null
          ? "new"
          : blockFingerprint(block.xml) !== block.baseFingerprint
            ? "changed"
            : "same";
    const wire: DraftBlock = {
      id: block.id,
      view: projection.view,
      editable: projection.editable,
      tokens: projection.tokens,
      status,
    };
    if (block.theirsXml !== undefined) {
      wire.theirs = projectBlock({
        id: block.id,
        slot: block.slot,
        kind: block.kind,
        xml: block.theirsXml,
      }).view;
    }
    return wire;
  }

  /** 기준에 있었는데 빠진 블록 수 — 요약의 changedBlocks 가 지움도 센다. */
  #missingBase(store: DraftStore, record: DraftRecord): number {
    const base = store.readBase(record.docKey);
    if (base === null) return 0;
    const current = new Set(record.blocks.map((block) => block.id));
    let missing = 0;
    for (const block of parseStorage(base).blocks) {
      if (!current.has(block.id)) missing += 1;
    }
    return missing;
  }

  #summary(record: DraftRecord, missingBase: number): DraftSummary {
    let changed = 0;
    for (const block of record.blocks) {
      if (block.theirsXml !== undefined) continue;
      if (block.baseFingerprint === null || blockFingerprint(block.xml) !== block.baseFingerprint) {
        changed += 1;
      }
    }
    return {
      docKey: record.docKey,
      pageId: record.pageId,
      title: record.title,
      revision: record.revision,
      state: record.state,
      changedBlocks: changed + missingBase,
      baseVersion: record.baseVersion,
      observedVersion: record.observedVersion,
      updatedAt: record.updatedAt,
    };
  }

  #threadView(slug: string, docKey: string, store: DraftStore): DraftThread {
    const record = this.#requireRecord(docKey, store);
    const thread = store.thread(docKey);
    return {
      docKey,
      threadId: thread?.threadId ?? "",
      messages: thread?.messages ?? [],
      proposals: store.proposals(docKey).map((proposal) => ({
        proposalId: proposal.proposalId,
        createdAt: proposal.createdAt,
        draftRevision: proposal.draftRevision,
        summary: proposal.summary,
        // 열린 걸음은 지금 초안과 다시 대 본다 — 사람이 고친 블록의 걸음은 stale 다.
        ops: proposal.ops.map((op): DraftOp => {
          const state: DraftOpState =
            op.state === "open" && this.#opStale(op, record) ? "stale" : op.state;
          const base = { opId: op.opId, state };
          switch (op.type) {
            case "replace":
              return { ...base, type: "replace", blockId: op.blockId, view: op.view };
            case "insert":
              return { ...base, type: "insert", afterBlockId: op.afterBlockId, view: op.view };
            case "delete":
              return { ...base, type: "delete", blockId: op.blockId };
            case "title":
              return { ...base, type: "title", title: op.title };
            default:
              return op;
          }
        }),
      })),
      running: this.#running.has(this.#runKey(slug, docKey)),
    };
  }
}
