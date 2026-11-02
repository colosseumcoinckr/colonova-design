/**
 * 초안 서비스(2026-10-23 · 최종 구현 계획 F1 · 작업 B2) — 저장소 · 블록 엔진 · Confluence
 * 클라이언트 · 기획 AI · 발행 엔진을 잇는 몸. 모든 요청은 활성 프로젝트에서 돈다. 초안이
 * 바뀔 때마다 `draft.changed` 를, AI 진행마다 `draft.ai` 를 방송한다. 프런트가 보낸 문서
 * 아이디는 믿지 않고 — 원장(프로젝트 폴더 사본의 `confluence/confluence.json`)과 사본 미러로 범위를 검사한다.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type {
  DraftBlock,
  DraftBlockStatus,
  DraftBlockView,
  DraftCompareResult,
  DraftConversationSummary,
  DraftEdit,
  DraftMessage,
  DraftMismatchRow,
  DraftOp,
  DraftOpState,
  DraftPlanRef,
  DraftPublishPreview,
  DraftPublishResult,
  DraftReadRef,
  DraftRefInput,
  DraftRevisionSummary,
  DraftRevisionView,
  DraftSnapshot,
  DraftSummary,
  DraftSyncDocRow,
  DraftSyncScreenRow,
  DraftThread,
  DraftView,
  EffortLevel,
  ServerMessage,
} from "@colonova-design/protocol";
import { draftStageOf } from "@colonova-design/protocol";
import { ConfluenceClient, createConfluenceTransport } from "./confluence-client.js";
import { type ConfluenceLedger, readConfluenceLedger } from "./confluence-ledger.js";
import { deriveMarkdown } from "./confluence-markdown.js";
import { confluenceMirrorLedger, confluenceMirrorRoot } from "./confluence-mirror.js";
import { confluenceRootIdKey, confluenceSiteKey } from "./confluence-sync.js";
import { type CredentialStore, loadConfluenceCredentials } from "./credentials.js";
import { buildDraftPrompt, type DraftAiRunner, type DraftPromptRef } from "./draft-ai.js";
import {
  composeDraftBody,
  type DraftPublishContext,
  type DraftPublisher,
} from "./draft-publish.js";
import {
  type ConversationRecord,
  conversationTitleOf,
  type DraftRecord,
  type DraftRecordBlock,
  DraftStore,
  type ProposalOpRecord,
  type ProposalRecord,
  type RevisionMeta,
  // 되돌릴 재료의 모양은 저장소의 것 — 변경안 기록과 같이 고치기가 한 모양을 쓴다(2026-10-31 2단계).
  type ScreenSyncInverse,
} from "./draft-store.js";
import type { DaemonLogger } from "./log.js";
import { realpathBestEffort } from "./paths.js";
import {
  clipSections,
  comparePrompt,
  compareScreens,
  parseCompareRows,
  readCompareDeclines,
} from "./plan-compare.js";
import { planRefHeader } from "./plan-refs.js";
import type { RestTransport } from "./rest-transport.js";
// 같이 고치기 기록 읽기(2026-11-02 C4 · C7) — 반대 방향은 type import 뿐이라 순환 없이 쓴다.
import { liveEntries, readSyncLines, screenSyncFile } from "./screen-plan-sync.js";
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
  claudeExecutable(): string | null;
  broadcast(message: ServerMessage): void;
  logger: DaemonLogger;
  ai: DraftAiRunner;
  publisher: DraftPublisher;
  /** 클론 뿌리 — 기획 AI 가 화면 코드를 읽는 두 번째 뿌리 · 클론 전이면 null(2026-10-23 · 기획서 사본 이동 계획 §6 · 사용자 결정 — 기획 AI 의 클론 읽기 허용). */
  cloneRoot?(slug: string): string | null;
  now?: () => Date;
  /** 저장 전송 — 시험이 기록된 fixture 를 넣는다. 없으면 env 가 고른다. */
  transport?: (site: string) => RestTransport;
}

/**
 * 되돌릴 재료의 모양 — 정의는 저장소에 있다(변경안 기록과 같이 고치기가 한 모양을 쓴다 · 2026-10-31
 * 2단계). 여기서는 같이 고치기의 옛 길이 그대로 쓰도록 다시 내놓는다.
 */
export type { ScreenSyncInverse };

/** 같이 고치기 한 문서의 결과 — 웹의 `PlanSyncDoc` 재료와 되돌리기 기록의 재료. */
export interface ScreenSyncResult {
  docKey: string | null;
  title: string;
  outcome: "adopted" | "proposed" | "unchanged" | "failed";
  changes: number;
  summary?: string;
  detail?: string;
  proposalId?: string;
  opIds?: string[];
  inverse?: ScreenSyncInverse[];
  /** 오래돼 들어가지 못하고 변경안으로 남은 걸음 수. */
  kept?: number;
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
  /** `<slug>:<docKey>` → 도는 생성의 끝 — 같이 고치기가 사람의 질문이 끝나기를 기다린다(2026-10-30). */
  readonly #runs = new Map<string, Promise<unknown>>();
  /** 이 프로세스에서 도는 발행의 명령 아이디 — 재시작이 물려받은 잠금과 구별한다(2026-10-23 작업 B7). */
  readonly #sending = new Set<string>();
  /** 이 프로세스에서 지워진 대화의 묘비(2026-11-03) — 도는 생성이 끝날 때 지워진 대화를 다시 쓰지 않게 가린다. */
  readonly #goneThreads = new Set<string>();

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

  /** `slug` 는 같이 고치기가 배경 프로젝트의 초안을 열 때만 준다(2026-10-30) — 없으면 활성 프로젝트다. */
  async open(pageId: string, slugOf?: string): Promise<DraftView> {
    const slug = slugOf ?? this.#slug();
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
      // 사람의 손 — 판 고르기 줄에 「직접 고침」으로 서는 판이다(2026-10-31 2단계).
      return store.save(work, expectedRevision, { origin: "person", label: null });
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
   * 같은 초안에 도는 생성이 있으면 거절이다. `pick` 은 기획 AI 의 모델 · 생각 시간(2026-10-26 사용자 요청) —
   * 없으면 CLI 기본으로 돈다. `threadId` 는 이어 가는 기획 대화(2026-10-31 3단계) — 없으면 이 문서에 붙은
   * 대화를 이어 받고, 그것도 없으면 새 대화를 만든다(이름은 첫 말의 머리). AI 의 변경안은 채택 없이 바로
   * 초안에 들어가고 되돌릴 재료가 변경안 기록에 남는다(2026-10-31 2단계 · 사용자 결정 — 추천안 채택).
   */
  ask(
    docKey: string,
    text: string,
    refs: DraftRefInput[],
    pick: { model?: string | null; effort?: EffortLevel | null } = {},
    threadId?: string | null,
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
    // 대화 — 이어 가는 대화가 이 문서로 옮겨 오고, 없으면 이 문서의 대화를 이어 받고, 그것도 없으면 새로 만든다.
    const conversation = this.#threadForAsk(store, threadId, docKey, text);
    const history = conversation.messages;
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
    conversation.messages = [...history, userMessage];
    store.saveConversation(conversation);
    // 도는 생성 — cancel 이 끊는 손이다.
    const controller = new AbortController();
    this.#running.set(runKey, controller);
    const run = this.#generate({
      slug,
      store,
      record,
      conversation,
      text,
      history,
      refs: refRows,
      aiMessageId,
      pick,
      signal: controller.signal,
      autoApply: true,
    }).finally(() => {
      if (this.#running.get(runKey) === controller) this.#running.delete(runKey);
      if (this.#runs.get(runKey) === run) this.#runs.delete(runKey);
    });
    this.#runs.set(runKey, run);
    return { threadId: conversation.threadId, messageId: aiMessageId };
  }

  /**
   * 묻기가 쓸 대화 — 이어 가는 대화(threadId)가 있으면 이 문서로 옮겨 오고, null 이면 새 대화를
   * 만든다(`새 기획 대화` · 2026-10-31 3단계), undefined 면 이 문서에 붙은 대화를 이어 받고, 그것도
   * 없으면 새 대화를 만든다. 이름은 첫 말의 머리로 짓는다(2026-10-31 3단계 — AI 가 짓는 이름표는
   * 생성을 한 번 더 도는 일이라 두지 않았다).
   */
  #threadForAsk(
    store: DraftStore,
    threadId: string | null | undefined,
    docKey: string,
    text: string,
  ): ConversationRecord {
    if (typeof threadId === "string") {
      const conversation = store.conversation(threadId);
      if (conversation === null) {
        throw new Error("이어 가는 대화를 찾지 못했습니다 — 대화 목록에서 다시 골라 주세요.");
      }
      conversation.docKey = docKey;
      return conversation;
    }
    // null 은 `새 기획 대화` — 붙은 대화가 있어도 새로 만든다(2026-10-31 3단계).
    const attached = threadId === undefined ? store.conversationOfDoc(docKey) : null;
    if (attached !== null) return attached;
    const now = this.#now().toISOString();
    return {
      format: 1,
      threadId: randomUUID(),
      title: conversationTitleOf(text),
      docKey,
      sdkSessionId: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  cancel(docKey: string): { cancelled: boolean } {
    const controller = this.#running.get(this.#runKey(this.#slug(), docKey));
    if (controller === undefined) return { cancelled: false };
    controller.abort();
    return { cancelled: true };
  }

  /**
   * 기획 대화의 판 — `threadId` 를 골랐으면 그 대화를, 없으면 이 문서의 최신 대화를 읽는다(2026-11-03).
   * 사이드바 목록의 줄이 옛 대화를 다시 여는 길이다 — 문서의 최신 대화만 읽던 동안에는 옛 대화를
   * 다시 볼 · 이어 말할 길이 없었다. 골른 대화가 이 문서의 것이 아니면 거절한다 — 옮겨졌거나
   * 지워진 대화를 여는 눌어 있는 고름이 낡은 문서에 붙지 않게.
   */
  thread(docKey: string, threadId?: string): DraftThread {
    const slug = this.#slug();
    const store = this.#store(slug);
    this.#requireRecord(docKey, store);
    if (threadId === undefined) return this.#threadView(slug, docKey, store);
    const conversation = store.conversation(threadId);
    if (conversation === null || conversation.docKey !== docKey) {
      throw new Error("이어 가는 대화를 찾지 못했습니다 — 대화 목록에서 다시 골라 주세요.");
    }
    return this.#threadView(slug, docKey, store, conversation);
  }

  /** 기획 대화의 이름 바꾸기(2026-11-03) — 첫 말의 머리로 지은 자동 제목을 사람이 고친다. 답은 고쳐진 줄. */
  renameThread(threadId: string, title: string): DraftConversationSummary {
    const slug = this.#slug();
    const store = this.#store(slug);
    const conversation = store.conversation(threadId);
    if (conversation === null) {
      throw new Error("대화를 찾지 못했습니다 — 목록에서 다시 골라 주세요.");
    }
    const name = title.trim();
    if (name === "") {
      throw new Error("대화의 이름이 비어 있습니다 — 한 글자라도 써 주세요.");
    }
    conversation.title = name;
    store.saveConversation(conversation);
    const ledger = this.#ledger(slug);
    return {
      threadId: conversation.threadId,
      title: conversation.title,
      docKey: conversation.docKey,
      docTitle: this.#docTitleOf(store, ledger, conversation.docKey),
      at: conversation.updatedAt,
      messageCount: conversation.messages.length,
      running:
        conversation.docKey !== null && this.#running.has(this.#runKey(slug, conversation.docKey)),
    };
  }

  /** 기획 대화 목록(2026-10-31 3단계) — 사이드바 위 묶음이 읽는다. 도는 대화의 표시까지 여기서 얹는다. */
  threadsList(): DraftConversationSummary[] {
    const slug = this.#slug();
    const store = this.#store(slug);
    const ledger = this.#ledger(slug);
    return store.conversations().map((conversation) => ({
      threadId: conversation.threadId,
      title: conversation.title,
      docKey: conversation.docKey,
      docTitle: this.#docTitleOf(store, ledger, conversation.docKey),
      at: conversation.updatedAt,
      messageCount: conversation.messages.length,
      running:
        conversation.docKey !== null && this.#running.has(this.#runKey(slug, conversation.docKey)),
    }));
  }

  /** 대화가 다룰 문서를 옮긴다(2026-10-31 3단계) — 답은 옮겨진 대화의 줄이다. */
  moveThread(threadId: string, docKey: string): DraftConversationSummary {
    const slug = this.#slug();
    const store = this.#store(slug);
    this.#requireRecord(docKey, store);
    const conversation = store.conversation(threadId);
    if (conversation === null) {
      throw new Error("대화를 찾지 못했습니다 — 목록에서 다시 골라 주세요.");
    }
    conversation.docKey = docKey;
    conversation.updatedAt = this.#now().toISOString();
    store.saveConversation(conversation);
    const ledger = this.#ledger(slug);
    return {
      threadId: conversation.threadId,
      title: conversation.title,
      docKey: conversation.docKey,
      docTitle: this.#docTitleOf(store, ledger, conversation.docKey),
      at: conversation.updatedAt,
      messageCount: conversation.messages.length,
      running: this.#running.has(this.#runKey(slug, docKey)),
    };
  }

  /** 기획 대화를 지운다 — 이 컴퓨터의 기록만 지우고 초안은 남는다(영구 삭제 길이 아니다). */
  deleteThread(threadId: string): { deleted: boolean } {
    const slug = this.#slug();
    const store = this.#store(slug);
    const conversation = store.conversation(threadId);
    if (conversation === null) {
      throw new Error("대화를 찾지 못했습니다 — 목록에서 다시 골라 주세요.");
    }
    // 도는 생성이 있으면 끊는다(2026-11-03) — 버리기의 419 줄과 같은 결. 묘비를 먼저 새겨
    // 끊긴 답의 마지막 저장이 지워진 대화를 부활시키지 않게 한다(abort 를 지나쳐 저장이 나가도).
    this.#goneThreads.add(threadId);
    if (conversation.docKey !== null) {
      this.#running.get(this.#runKey(slug, conversation.docKey))?.abort();
    }
    store.removeConversation(threadId);
    return { deleted: true };
  }

  /** 대화 줄의 문서 이름 — 초안 요약이 이기고, 사라진 초안은 원장의 제목으로 대신한다. */
  #docTitleOf(store: DraftStore, ledger: ConfluenceLedger, docKey: string | null): string {
    if (docKey === null) return "";
    const record = store.read(docKey);
    if (record !== null) return record.title;
    if (docKey.startsWith("p-")) return ledger.pages[docKey.slice(2)]?.title ?? "";
    return "";
  }

  /** 초안 판 목록(2026-10-31 2단계) — 새것부터. 스냅숏의 기준 대조로 바뀐 곳의 수를 센다. */
  async revisions(docKey: string): Promise<DraftRevisionSummary[]> {
    const store = this.#storeFor(docKey);
    const record = this.#requireRecord(docKey, store);
    const snapshots = store.revisions(docKey);
    // 스냅숏이 없는 옛 초안은 지금 모습을 한 판으로 내준다 — 목록이 텅 비면 판 고르기가 서지 않는다.
    if (snapshots.length === 0) {
      return [
        {
          revision: record.revision,
          at: record.updatedAt,
          origin: "person",
          label: null,
          changes: await this.#revisionChanges(store, record, record.blocks),
          state: record.state,
        },
      ];
    }
    const rows: DraftRevisionSummary[] = [];
    for (const snapshot of snapshots) {
      rows.push({
        revision: snapshot.revision,
        at: snapshot.at,
        origin: snapshot.origin,
        label: snapshot.label,
        changes: await this.#revisionChanges(store, record, snapshot.blocks),
        state: snapshot.state,
      });
    }
    return rows;
  }

  /** 옛 판의 읽기 전용 모습(2026-10-31 2단계) — 판 고르기에서 앞 판을 볼 때. 판 0 은 Confluence 출발점이다. */
  async revision(docKey: string, revision: number): Promise<DraftRevisionView> {
    const store = this.#storeFor(docKey);
    const record = this.#requireRecord(docKey, store);
    if (revision === 0) {
      // 출발점 — 기준 원문의 블록을 그대로 투영한다(Confluence 판과 견주기의 앞쪽 · 2026-10-31 2단계).
      const base = store.readBase(docKey);
      if (base === null) {
        throw new Error("기준 원문이 없습니다 — 새 문서 초안은 Confluence 판이 없어요.");
      }
      const blocks = parseStorage(base).blocks.map((block) =>
        this.#wireBlock({ ...block, baseFingerprint: blockFingerprint(block.xml) }),
      );
      return {
        docKey,
        revision: 0,
        at: record.createdAt,
        origin: "system",
        label: null,
        title: record.baseTitle ?? record.title,
        blocks,
      };
    }
    const snapshot = store.revision(docKey, revision);
    if (snapshot === null) {
      throw new Error("그 개정의 판이 없습니다 — 판 목록에서 다시 골라 주세요.");
    }
    return {
      docKey,
      revision: snapshot.revision,
      at: snapshot.at,
      origin: snapshot.origin,
      label: snapshot.label,
      title: snapshot.title,
      blocks: snapshot.blocks.map((block) => this.#wireBlock(block)),
    };
  }

  /** 고른 옛 판으로 되돌린다 — 판 고르기의 `이 판으로 되돌리기`. 스냅숏의 모습을 그대로 붙인다. */
  async restoreRevision(docKey: string, revision: number): Promise<DraftView> {
    const store = this.#storeFor(docKey);
    const saved = await store.withLock(docKey, () => {
      const record = this.#requireRecord(docKey, store);
      if (record.state === "publishing" || record.state === "result-unknown") {
        throw new Error("발행이 도는 동안에는 되돌릴 수 없어요 — 끝난 뒤 다시 눌러 주세요.");
      }
      if (revision === record.revision) return record;
      const snapshot = store.revision(docKey, revision);
      if (snapshot === null) {
        throw new Error("그 개정의 판이 없습니다 — 판 목록에서 다시 골라 주세요.");
      }
      const work: DraftRecord = {
        ...record,
        title: snapshot.title,
        blocks: snapshot.blocks.map((block) => ({ ...block })),
      };
      if (work.state === "published" || work.state === "closed-unconfirmed") work.state = "editing";
      return store.save(work, record.revision, { origin: "person", label: null });
    });
    this.#broadcast(saved);
    return this.#view(saved);
  }

  /** 판이 기준에서 바꾼 것 — 고침 · 새로 · 지움 수(요약의 셈과 같은 판정). */
  async #revisionChanges(
    store: DraftStore,
    record: DraftRecord,
    blocks: DraftRecordBlock[],
  ): Promise<{ changed: number; inserted: number; deleted: number }> {
    const base = store.readBase(record.docKey);
    let deleted = 0;
    if (base !== null) {
      const current = new Set(blocks.map((block) => block.id));
      for (const block of parseStorage(base).blocks) {
        if (!current.has(block.id)) deleted += 1;
      }
    }
    let changed = 0;
    let inserted = 0;
    for (const block of blocks) {
      if (block.theirsXml !== undefined) continue;
      if (block.baseFingerprint === null) inserted += 1;
      else if (blockFingerprint(block.xml) !== block.baseFingerprint) changed += 1;
    }
    return { changed, inserted, deleted };
  }

  /**
   * 바로 반영된 AI 고침을 되돌린다(2026-10-31 2단계) — 변경안 기록에 남은 재료로 그 판 직전으로 돌린다.
   * 그 사이 사람이 고친 블록은 남긴다(같이 고치기의 되돌리기와 같은 판정). 돌린 걸음은 거절로 적는다.
   */
  async undoProposal(
    docKey: string,
    proposalId: string,
  ): Promise<{ restored: number; kept: number }> {
    const store = this.#storeFor(docKey);
    const result = await store.withLock(docKey, () => {
      const proposals = store.proposals(docKey);
      const proposal = proposals.find((row) => row.proposalId === proposalId);
      if (proposal === undefined) {
        throw new Error("변경안을 찾지 못했습니다 — 대화를 다시 읽어 주세요.");
      }
      const inverse = proposal.inverse ?? [];
      if (proposal.appliedAt === undefined || inverse.length === 0) {
        throw new Error("바로 반영된 고침이 아니어서 되돌릴 수 없어요.");
      }
      if (proposal.undoneAt !== undefined) {
        throw new Error("이미 되돌린 고침이에요.");
      }
      const record = this.#requireRecord(docKey, store);
      if (record.state === "publishing" || record.state === "result-unknown") {
        throw new Error("발행이 도는 동안에는 되돌릴 수 없어요 — 끝난 뒤 다시 눌러 주세요.");
      }
      const work: DraftRecord = { ...record, blocks: record.blocks.map((block) => ({ ...block })) };
      let restored = 0;
      let kept = 0;
      for (const step of [...inverse].reverse()) {
        if (this.#revertStep(work, step)) restored += 1;
        else kept += 1;
      }
      proposal.undoneAt = this.#now().toISOString();
      if (restored > 0) {
        if (work.state === "published" || work.state === "closed-unconfirmed")
          work.state = "editing";
        store.save(work, record.revision, { origin: "person", label: null });
      }
      // 되돌린 걸음은 거절로 적는다 — 대화의 카드가 「들어간 고침」으로 남지 않게(같이 고치기의 되돌리기와 같다).
      for (const op of proposal.ops) {
        if (op.state === "adopted") op.state = "rejected";
      }
      store.saveProposals(docKey, proposals);
      return { restored, kept, record: store.read(docKey) ?? work };
    });
    if (result.restored > 0) this.#broadcast(result.record);
    return { restored: result.restored, kept: result.kept };
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

  /** 가져온 문서의 스냅샷 — 원장으로 범위를 검사하고 사본의 파생 마크다운을 읽는다. */
  #snapshotOfPage(slug: string, pageId: string, sections: string[]): DraftSnapshot {
    const ledger = this.#ledger(slug);
    const page = ledger.pages[pageId];
    if (page === undefined) {
      throw new Error("근거 문서가 기획서 목록에 없습니다 — 목록 가운데서 골라 주세요.");
    }
    let markdown: string;
    try {
      markdown = readFileSync(join(this.#mirrorRoot(slug), `${page.path}.md`), "utf8");
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

  /** 생성의 몸 — 시작 방송 → 답 → 걸음 검사 → 변경안 저장(바로 반영) → 대화 저장 → done 방송. */
  async #generate(input: {
    slug: string;
    store: DraftStore;
    record: DraftRecord;
    conversation: ConversationRecord;
    text: string;
    history: DraftMessage[];
    refs: Array<{ input: DraftRefInput; title: string; version: number; path: string }>;
    aiMessageId: string;
    /** 고른 모델 · 생각 시간 — 없으면 CLI 기본(2026-10-26 사용자 요청). */
    pick: { model?: string | null; effort?: EffortLevel | null };
    signal: AbortSignal;
    /**
     * 같이 고치기(2026-10-30) — 변경안이 없으면 대화에 아무것도 남기지 않는다. 화면의 색 · 간격 같은 요청이 기획 대화를
     * 「바꿀 것 없음」 기록으로 채우지 않게.
     */
    quiet?: boolean;
    /**
     * 바로 반영(2026-10-31 2단계 · 사용자 결정) — 변경안을 채택 없이 초안에 곧바로 넣는다. 사람이 고치던 블록의
     * 걸음은 덮지 않고 변경안으로 남긴다. 되돌릴 재료는 변경안 기록에 남는다.
     */
    autoApply?: boolean;
  }): Promise<string | null> {
    const { slug, store, record, conversation, text, history, refs, aiMessageId, pick, signal } =
      input;
    const docKey = record.docKey;
    const announce = (
      phase: "started" | "text" | "read" | "done" | "failed" | "cancelled",
      extra: { text?: string; read?: DraftReadRef; proposalId?: string; detail?: string },
    ): void => {
      this.#deps.broadcast({
        type: "draft.ai",
        docKey,
        threadId: conversation.threadId,
        messageId: aiMessageId,
        phase,
        ...extra,
      });
    };
    announce("started", {});
    // 사본이 없을 때의 임시 읽기 폴더 — 생성이 끝나면 거둔다.
    let tempRoot: string | null = null;
    try {
      const executable = this.#deps.claudeExecutable();
      if (executable === null) {
        throw new Error("기획 AI 를 찾지 못했습니다 — Claude Code CLI 를 먼저 설치해 주세요.");
      }
      const mirrorRoot = this.#mirrorRoot(slug);
      let readRoot: string;
      if (existsSync(mirrorRoot)) {
        readRoot = mirrorRoot;
      } else {
        // 첫 가져오기 전에는 사본 폴더가 없다 — 빈 임시 폴더로 AI 를 띄운다.
        tempRoot = mkdtempSync(join(tmpdir(), "draft-ai-"));
        readRoot = tempRoot;
      }
      const ledger = this.#ledger(slug);
      // 클론 뿌리 — 있으면 기획 AI 의 두 번째 읽기 뿌리로 싣는다(2026-10-23 · 기획서 사본 이동 계획 §6).
      const cloneRoot = this.#deps.cloneRoot?.(slug) ?? null;
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
        {
          executable,
          readRoot,
          ...(cloneRoot !== null ? { extraRoots: [cloneRoot] } : {}),
          resume: conversation.sdkSessionId,
          prompt,
          ...(pick.model ? { model: pick.model } : {}),
          ...(pick.effort ? { effort: pick.effort } : {}),
          signal,
        },
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
        return null;
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
          threadId: conversation.threadId,
          createdAt: this.#now().toISOString(),
          draftRevision: record.revision,
          baseVersion: record.baseVersion,
          summary: answer.summary,
          ops,
        };
        // 저장도 문서 잠금 안에서 — 같은 순간의 채택이 저장한 표시를 덮지 않게 저장 직전에
        // 지금 목록을 다시 읽어 합친다(2026-10-23 · 검토 발견 6). 바로 반영도 같은 잠금 안에서 —
        // 검사와 반영 사이에 사람의 고침이 끼지 않게(2026-10-31 2단계).
        await store.withLock(docKey, () => {
          // 생성 중에 초안의 개정이나 기준 판이 바뀌었으면(사람의 고침 · 채택 · 발행 · 다시 맞추기) 이 변경안은 처음부터
          // 오래됨이다 — 계획 §6 「생성 중 사람이 초안을 고쳤으면 변경안을 오래된 것으로 표시한다」.
          const current = store.read(docKey);
          if (current === null) return;
          if (current.revision !== record.revision || current.baseVersion !== record.baseVersion) {
            for (const op of proposal.ops) op.state = "stale";
          }
          store.saveProposals(docKey, [...store.proposals(docKey), proposal]);
          if (input.autoApply === true) {
            this.#applyProposalLocked(store, docKey, proposal, {
              origin: "ai",
              label: conversation.title,
            });
          }
        });
        // 바로 반영으로 초안이 바뀌었다 — 다른 창도 다시 읽게 방송한다(편집의 방송과 같은 길).
        const after = store.read(docKey);
        if (input.autoApply === true && after !== null && after.revision !== record.revision) {
          this.#broadcast(after);
        }
      }
      // 화면 제안(2026-11-02 · 같이 고치기 UX 계획 C8) — 정책을 바꾼 고침이 들어가면 같은 문서로 화면을 견준다.
      // 화면이 옛 규칙이면 답 아래에 어긋남 카드가 선다. 같이 고치기(quiet — autoApply 없이 #adoptFromScreen 이
      // 넣는 길)에는 돌지 않는다 — 한 방향의 고침이 반대 방향의 카드를 부르지 않게(같은 계획 §2 핑퐁 막기).
      let mismatch: { rows: DraftMismatchRow[] } | null = null;
      if (input.autoApply === true && answer.policy === true && proposalId !== null) {
        const after = store.read(docKey);
        if (after !== null && after.revision !== record.revision) {
          mismatch = await this.#mismatchOf(slug, after);
        }
      }
      if (input.quiet === true && proposalId === null) {
        // 바꿀 것이 없었다 — 대화 · 세션 열쇠를 남기지 않는다(다음 사람의 질문이 이 맞춰 보기를 이어받지 않게).
        announce("done", {});
        return null;
      }
      conversation.sdkSessionId = answer.sdkSessionId;
      conversation.messages = [
        ...conversation.messages,
        {
          messageId: aiMessageId,
          role: "assistant",
          text: answer.reply,
          at: this.#now().toISOString(),
          ...(proposalId !== null ? { proposalId } : {}),
          ...(reads.length > 0 ? { reads } : {}),
          ...(mismatch !== null ? { mismatch } : {}),
        },
      ];
      // 대화도 문서 잠금 안에서, 초안이 아직 있을 때만 쓴다 — 버리기와 엇갈려 지운 열쇠에 다시 쓰지 않게.
      // 지워진 대화도 다시 쓰지 않는다(2026-11-03) — 도는 중 지운 대화는 묘비(#goneThreads)가 가린다.
      const kept = await store.withLock(docKey, () => {
        if (store.read(docKey) === null) return false;
        if (this.#goneThreads.has(conversation.threadId)) return false;
        store.saveConversation(conversation);
        return true;
      });
      if (!kept) {
        announce("cancelled", {});
        return null;
      }
      announce("done", proposalId !== null ? { proposalId } : {});
      return proposalId;
    } catch (error) {
      if (signal.aborted) {
        announce("cancelled", {});
        return null;
      }
      this.#deps.logger.error("기획 AI 생성 실패", { err: error });
      // 짧은 한국어만 대화에 남긴다 — 바깥 오류 문장은 그대로 두지 않는다(session.asPlannerFacingError 와 같은 감각).
      const detail = error instanceof Error ? error.message : String(error);
      const sentence = /[\p{Script=Hangul}]/u.test(detail)
        ? detail
        : "생성이 끊겼습니다 — 잠시 뒤 다시 물어 주세요.";
      conversation.messages = [
        ...conversation.messages,
        {
          messageId: aiMessageId,
          role: "assistant",
          text: "",
          at: this.#now().toISOString(),
          error: sentence,
        },
      ];
      // 버려진 초안의 대화는 다시 쓰지 않는다(2026-10-23 검토 B10) — 잠금 안에서 확인하고 쓴다.
      // 지워진 대화도 같다(2026-11-03) — 끊긴 답의 오류 줄이 묘비에 가려 지워진 대화를 부활시키지 않게.
      await store.withLock(docKey, () => {
        if (store.read(docKey) === null) return;
        if (this.#goneThreads.has(conversation.threadId)) return;
        store.saveConversation(conversation);
      });
      announce("failed", { detail: sentence });
      if (input.quiet === true) throw error instanceof Error ? error : new Error(sentence);
      return null;
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

  // ————— 같이 고치기 — 화면 요청이 바꾼 기획을 초안에(2026-10-30 사용자 결정 · 같이 고치기 계획 §4 · §5) —————

  /**
   * 화면 요청에서 같이 고치기 — 기획 AI 가 이 화면 변경이 문서의 정책 · 규칙 · 조건을 바꾸는지 보고, 바꾸면 그 걸음을
   * 초안에 바로 채택한다. 사람이 고치던 블록은 덮지 않고 오래됨으로 남긴다. 발행은 하지 않는다. 바꿀 것이 없으면
   * 대화에도 아무것도 남기지 않는다. 같은 초안의 질문이 돌면 끝나기를 기다린다.
   */
  async screenSync(input: {
    slug: string;
    /** 기존 문서면 pageId, 아직 발행하지 않은 새 문서 초안이면 docKey 로 고른다. */
    pageId: string | null;
    docKey: string | null;
    /** 대화에 남는 말 — 화면 요청 그대로. */
    displayText: string;
    /** 기획 AI 에게 가는 말 — 요청 · 바뀐 화면 · 판정 기준. */
    promptText: string;
  }): Promise<ScreenSyncResult> {
    const { slug } = input;
    const store = this.#store(slug);
    let docKey = input.docKey ?? (input.pageId !== null ? `p-${input.pageId}` : null);
    if (docKey === null) {
      return {
        docKey: null,
        title: "",
        outcome: "failed",
        changes: 0,
        detail: "문서를 찾지 못했어요",
      };
    }
    let record = store.read(docKey);
    if (record === null && input.pageId !== null) {
      try {
        docKey = (await this.open(input.pageId, slug)).docKey;
        record = store.read(docKey);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          docKey: null,
          title: this.#ledger(slug).pages[input.pageId]?.title ?? "",
          outcome: "failed",
          changes: 0,
          detail: /[\p{Script=Hangul}]/u.test(detail) ? detail : "문서를 열지 못했어요",
        };
      }
    }
    if (record === null) {
      return { docKey, title: "", outcome: "failed", changes: 0, detail: "초안을 찾지 못했어요" };
    }
    const runKey = this.#runKey(slug, docKey);
    // 사람의 질문이 돌면 끝까지 기다린다 — 그 사이 다른 같이 고치기가 끼면 한 번 더 기다린다.
    for (
      let waited = this.#runs.get(runKey);
      waited !== undefined;
      waited = this.#runs.get(runKey)
    ) {
      await waited.catch(() => undefined);
    }
    record = store.read(docKey);
    if (record === null) {
      return { docKey, title: "", outcome: "failed", changes: 0, detail: "초안이 버려졌어요" };
    }
    const title = record.title;
    // 대화 — 이 문서에 붙은 대화를 이어 받고, 없으면 새로 만든다(옮기기와 같은 규칙 · 2026-10-31 3단계).
    const conversation =
      store.conversationOfDoc(docKey) ??
      ({
        format: 1,
        threadId: randomUUID(),
        title: conversationTitleOf(input.displayText),
        docKey,
        sdkSessionId: null,
        messages: [],
        createdAt: this.#now().toISOString(),
        updatedAt: this.#now().toISOString(),
      } satisfies ConversationRecord);
    const history = conversation.messages;
    conversation.messages = [
      ...history,
      {
        messageId: randomUUID(),
        role: "user",
        text: input.displayText,
        at: this.#now().toISOString(),
        origin: "screen",
      },
    ];
    const controller = new AbortController();
    this.#running.set(runKey, controller);
    const run = this.#generate({
      slug,
      store,
      record,
      conversation,
      text: input.promptText,
      history,
      refs: [],
      aiMessageId: randomUUID(),
      pick: {},
      signal: controller.signal,
      quiet: true,
    });
    this.#runs.set(runKey, run);
    let proposalId: string | null;
    try {
      proposalId = await run;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { docKey, title, outcome: "failed", changes: 0, detail };
    } finally {
      if (this.#running.get(runKey) === controller) this.#running.delete(runKey);
      if (this.#runs.get(runKey) === run) this.#runs.delete(runKey);
    }
    if (proposalId === null) return { docKey, title, outcome: "unchanged", changes: 0 };
    return await this.#adoptFromScreen(store, docKey, proposalId, title);
  }

  /**
   * 변경안의 열린 걸음을 초안에 바로 넣는다(2026-10-31 2단계 · 문서 잠금 안에서 부른다) — 채택과 같은 판정에
   * 되돌릴 재료를 함께 적는다. 사람이 고치던 블록의 걸음은 덮지 않고 변경안으로 남긴다(오래됨 표시는
   * 대화가 읽을 때 지금 초안과 다시 대 보는 몫이다). 발행이 도는 동안엔 아무것도 넣지 않는다.
   */
  #applyProposalLocked(
    store: DraftStore,
    docKey: string,
    proposal: ProposalRecord,
    meta: RevisionMeta,
  ): {
    summary: string;
    record: DraftRecord;
    applied: number;
    inverse: ScreenSyncInverse[];
    opIds: string[];
    total: number;
  } | null {
    const found = store.read(docKey);
    if (found === null) return null;
    // 발행이 도는 동안은 초안을 건드리지 않는다 — 변경안으로 남는다.
    if (found.state === "publishing" || found.state === "result-unknown") {
      return {
        summary: proposal.summary,
        record: found,
        applied: 0,
        inverse: [],
        opIds: [],
        total: proposal.ops.length,
      };
    }
    const work: DraftRecord = { ...found, blocks: found.blocks.map((block) => ({ ...block })) };
    const inverse: ScreenSyncInverse[] = [];
    const opIds: string[] = [];
    for (const op of proposal.ops) {
      if (op.state !== "open") continue;
      if (this.#opStale(op, work)) continue;
      const step = this.#applyWithInverse(work, op);
      if (step === null) continue;
      op.state = "adopted";
      inverse.push(step);
      opIds.push(op.opId);
    }
    if (inverse.length > 0) {
      if (work.state === "published" || work.state === "closed-unconfirmed") {
        work.state = "editing";
      }
      store.save(work, found.revision, meta);
      proposal.appliedAt = this.#now().toISOString();
      proposal.appliedOpIds = opIds;
      proposal.inverse = inverse;
    }
    store.saveProposals(docKey, [
      ...store.proposals(docKey).filter((row) => row.proposalId !== proposal.proposalId),
      proposal,
    ]);
    return {
      summary: proposal.summary,
      record: store.read(docKey) ?? work,
      applied: inverse.length,
      inverse,
      opIds,
      total: proposal.ops.length,
    };
  }

  /** 같이 고치기의 채택 — 바로 반영과 같은 판정(2026-10-31 2단계부터 #applyProposalLocked 가 같이 쓴다). */
  async #adoptFromScreen(
    store: DraftStore,
    docKey: string,
    proposalId: string,
    title: string,
  ): Promise<ScreenSyncResult> {
    const outcome = await store.withLock(docKey, () => {
      const proposals = store.proposals(docKey);
      const proposal = proposals.find((row) => row.proposalId === proposalId);
      if (proposal === undefined) return null;
      return this.#applyProposalLocked(store, docKey, proposal, {
        origin: "screen",
        label: null,
      });
    });
    if (outcome === null) {
      return { docKey, title, outcome: "failed", changes: 0, detail: "변경안을 찾지 못했어요" };
    }
    if (outcome.applied === 0) {
      return {
        docKey,
        title,
        outcome: "proposed",
        changes: outcome.total,
        summary: outcome.summary,
        proposalId,
      };
    }
    this.#broadcast(outcome.record);
    return {
      docKey,
      title: outcome.record.title,
      outcome: "adopted",
      changes: outcome.applied,
      summary: outcome.summary,
      proposalId,
      opIds: outcome.opIds,
      inverse: outcome.inverse,
      kept: outcome.total - outcome.applied,
    };
  }

  /** 한 걸음을 적용하고 되돌릴 재료를 돌려준다 — 못 적용하면 null(그 걸음은 오래됨). */
  #applyWithInverse(work: DraftRecord, op: ProposalOpRecord): ScreenSyncInverse | null {
    switch (op.type) {
      case "replace": {
        const before = work.blocks.find((block) => block.id === op.blockId);
        if (before === undefined || !this.#applyOp(work, op)) return null;
        const after = work.blocks.find((block) => block.id === op.blockId);
        if (after === undefined) return null;
        return {
          type: "replace",
          blockId: op.blockId,
          before: { kind: before.kind, xml: before.xml },
          after: blockFingerprint(after.xml),
        };
      }
      case "insert": {
        const known = new Set(work.blocks.map((block) => block.id));
        if (!this.#applyOp(work, op)) return null;
        const made = work.blocks.find((block) => !known.has(block.id));
        if (made === undefined) return null;
        return { type: "insert", blockId: made.id, after: blockFingerprint(made.xml) };
      }
      case "delete": {
        const index = work.blocks.findIndex((block) => block.id === op.blockId);
        const block = work.blocks[index];
        if (block === undefined || !this.#applyOp(work, op)) return null;
        return {
          type: "delete",
          block: { ...block },
          afterBlockId: work.blocks[index - 1]?.id ?? null,
        };
      }
      case "title": {
        const before = work.title;
        if (!this.#applyOp(work, op)) return null;
        return { type: "title", before, after: op.title };
      }
    }
  }

  /**
   * 같이 고친 초안 되돌리기(같이 고치기 계획 §5) — 들어간 모습 그대로인 블록만 그 전으로 돌린다. 그 뒤 사람이 고친
   * 블록은 그대로 두고 수만 센다. 발행한 뒤라도 Confluence 는 건드리지 않는다 — 초안이 공식본과 달라질 뿐이다.
   */
  async screenSyncUndo(input: {
    slug: string;
    docKey: string;
    proposalId: string;
    opIds: string[];
    inverse: ScreenSyncInverse[];
  }): Promise<{ restored: number; kept: number }> {
    const store = this.#store(input.slug);
    const { docKey } = input;
    const result = await store.withLock(docKey, () => {
      const record = store.read(docKey);
      if (record === null) return { restored: 0, kept: input.inverse.length, record: null };
      if (record.state === "publishing" || record.state === "result-unknown") {
        throw new Error("발행이 도는 동안에는 되돌릴 수 없어요 — 끝난 뒤 다시 눌러 주세요.");
      }
      const work: DraftRecord = { ...record, blocks: record.blocks.map((block) => ({ ...block })) };
      let restored = 0;
      let kept = 0;
      for (const step of [...input.inverse].reverse()) {
        if (this.#revertStep(work, step)) restored += 1;
        else kept += 1;
      }
      if (restored === 0) return { restored, kept, record: null };
      if (work.state === "published" || work.state === "closed-unconfirmed") work.state = "editing";
      store.save(work, record.revision);
      // 되돌린 걸음은 거절로 적는다 — 기획 대화의 변경안 카드가 「채택」으로 남지 않게.
      const proposals = store.proposals(docKey);
      const proposal = proposals.find((row) => row.proposalId === input.proposalId);
      if (proposal !== undefined) {
        const undone = new Set(input.opIds);
        for (const op of proposal.ops) {
          if (undone.has(op.opId) && op.state === "adopted") op.state = "rejected";
        }
        store.saveProposals(docKey, proposals);
      }
      return { restored, kept, record: store.read(docKey) ?? work };
    });
    if (result.record !== null) this.#broadcast(result.record);
    return { restored: result.restored, kept: result.kept };
  }

  // ————— 화면과 맞춰 보기 · 화면 제안(2026-11-02 · 같이 고치기 UX 계획 C7 · C8) —————

  /**
   * 화면과 맞춰 보기(C7) — 문서 하나와 지금 화면을 읽어 어긋난 곳을 돌려준다. 판정만 돌고 초안 · 화면 어디에도
   * 쓰지 않는다. 기획서 쪽 말의 정본은 초안 우선(계획 §2)이라 초안이 없으면 공식본 사본을 읽는데, 그 길에서 초안을
   * 만들지 않는다(같은 계획 C1 의 「판정만으로 초안이 생기지 않는다」와 같은 규칙).
   */
  async compare(pageId: string): Promise<DraftCompareResult> {
    const slug = this.#slug();
    const store = this.#store(slug);
    const docKey = `p-${pageId}`;
    const record = store.read(docKey);
    const page = this.#ledger(slug).pages[pageId];
    let markdown: string;
    let source: string;
    let title: string;
    if (record !== null) {
      markdown = this.#draftMarkdown(record);
      source = `초안 개정 ${record.revision}`;
      title = record.title;
    } else if (page !== undefined) {
      try {
        markdown = readFileSync(join(this.#mirrorRoot(slug), `${page.path}.md`), "utf8");
      } catch {
        throw new Error("기획서 본문을 읽지 못했어요 — 가져오기를 다시 돌려 주세요.");
      }
      source = `Confluence 판 ${page.version}`;
      title = page.title;
    } else {
      throw new Error("문서를 찾지 못했어요");
    }
    const parsed = await this.#runCompare(slug, {
      title,
      source,
      markdown,
      pageId,
    });
    return {
      docKey: record !== null ? docKey : null,
      pageId,
      title,
      source,
      rows: parsed.rows,
      note: parsed.note,
    };
  }

  /**
   * 맞춰 보기의 몸 — 절 상한 자르기 · 프롬프트 · 기획 AI 호출(도구 없는 읽기 러너) · 안 받은 짝 걷기. 대화나
   * 변경안을 남기지 않는다 — #generate 의 앞부분(러너 호출)만 베낀 읽기 판정이다.
   */
  async #runCompare(
    slug: string,
    doc: { title: string; source: string; markdown: string; pageId: string | null },
  ): Promise<{ rows: DraftMismatchRow[]; note: string | null }> {
    const executable = this.#deps.claudeExecutable();
    if (executable === null) {
      throw new Error("기획 AI 를 찾지 못했습니다 — Claude Code CLI 를 먼저 설치해 주세요.");
    }
    const mirrorRoot = this.#mirrorRoot(slug);
    // 사본이 없을 때의 임시 읽기 폴더 — #generate 와 같은 규칙.
    const tempRoot = existsSync(mirrorRoot) ? null : mkdtempSync(join(tmpdir(), "draft-ai-"));
    try {
      const { root } = this.#deps.registry.paths(slug);
      const cloneRoot = this.#deps.cloneRoot?.(slug) ?? null;
      const screens =
        doc.pageId === null
          ? []
          : await compareScreens({ root, repoRoot: cloneRoot, pageId: doc.pageId });
      const clipped = clipSections(doc.markdown);
      const answer = await this.#deps.ai(
        {
          executable,
          readRoot: tempRoot ?? mirrorRoot,
          ...(cloneRoot !== null ? { extraRoots: [cloneRoot] } : {}),
          resume: null,
          prompt: comparePrompt({
            title: doc.title,
            source: doc.source,
            markdown: clipped.body,
            partial: clipped.partial,
            screens,
          }),
          signal: new AbortController().signal,
        },
        { onText: () => undefined, onRead: () => undefined },
      );
      const parsed = answer.compare === undefined ? null : parseCompareRows(answer.compare);
      if (parsed === null) {
        throw new Error("맞춤 보기가 답을 끝내지 못했어요 — 잠시 뒤 다시 눌러 주세요.");
      }
      const declined =
        doc.pageId === null ? new Set<string>() : readCompareDeclines(root, doc.pageId);
      return {
        rows: parsed.rows.filter((row) => !declined.has(row.screenName)),
        note: clipped.partial ? "절이 많아 앞의 절만 봤어요" : null,
      };
    } finally {
      if (tempRoot !== null) rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  /**
   * 화면 제안의 판정(C8) — 기획 고침이 초안에 들어간 뒤 같은 문서로 조용히 견준다. 화면이 옛 규칙이면 줄을
   * 돌려준다. 실패는 조용히 사라진다 — 제안은 덤이고 사람의 고침 자체는 이미 끝났다.
   */
  async #mismatchOf(
    slug: string,
    record: DraftRecord,
  ): Promise<{ rows: DraftMismatchRow[] } | null> {
    try {
      const parsed = await this.#runCompare(slug, {
        title: record.title,
        source: `초안 개정 ${record.revision}`,
        markdown: this.#draftMarkdown(record),
        pageId: record.pageId,
      });
      return parsed.rows.length > 0 ? { rows: parsed.rows } : null;
    } catch (error) {
      this.#deps.logger.info("화면 견주기 실패", { err: error });
      return null;
    }
  }

  /** 초안의 지금 몸 — 저장 포맷을 파생 마크다운으로 내린다(#snapshotOfDraft 와 같은 길). */
  #draftMarkdown(record: DraftRecord): string {
    return deriveMarkdown(composeDraftBody(record), {
      pageId: record.pageId ?? "",
      space: null,
      title: record.title,
      version: record.baseVersion ?? 0,
      updatedAt: null,
    }).markdown;
  }

  /**
   * 같이 고친 기록 도출(C4) — 이 화면 대화에서 같이 고쳐진 문서들. 기획서 탭의 `초안에서 바뀐 곳` 묶음의 재료다.
   * 걸음이 닿은 절 머리를 함께 풀어 `보기` 가 스크롤 · 하이라이트할 자리를 안다.
   */
  syncDocs(sessionId: string): { docs: DraftSyncDocRow[] } {
    const slug = this.#slug();
    const { root } = this.#deps.registry.paths(slug);
    const store = this.#store(slug);
    const docs: DraftSyncDocRow[] = [];
    for (const entry of liveEntries(readSyncLines(screenSyncFile(root)))) {
      if (entry.sessionId !== sessionId) continue;
      // 기록 읽기는 관용이다(readSyncLines 검사가 최소) — opIds 가 없는 줄은 빈 걸음으로 센다.
      const opIds = Array.isArray(entry.opIds) ? entry.opIds : [];
      docs.push({
        pageId: entry.docKey.startsWith("p-") ? entry.docKey.slice(2) : null,
        docKey: entry.docKey,
        title: entry.title,
        changes: opIds.length,
        sections: this.#sectionsOf(store, { ...entry, opIds }),
        at: entry.at,
      });
    }
    return { docs };
  }

  /** 이 문서가 같이 고침으로 닿은 화면(C4) — `이 문서의 화면` 이 연결 파일 줄과 함께 보인다. */
  syncScreens(pageId: string): { screens: DraftSyncScreenRow[] } {
    const slug = this.#slug();
    const { root } = this.#deps.registry.paths(slug);
    const screens: DraftSyncScreenRow[] = [];
    const seen = new Set<string>();
    for (const line of readSyncLines(screenSyncFile(root))) {
      if (line.kind !== "card") continue;
      if (!line.sync.docs.some((doc) => doc.pageId === pageId)) continue;
      for (const screen of line.turn.screens) {
        if (screen.route === "" || seen.has(screen.route)) continue;
        seen.add(screen.route);
        screens.push({
          route: screen.route,
          title: screen.title.trim() === "" ? null : screen.title,
          at: line.at,
        });
      }
    }
    return { screens };
  }

  /** 걸음의 열쇠(opIds)가 닿은 절 머리 — 블록이 사라졌으면 빈 목록(보기는 문서 맨 위로 연다 · 계획 §3 C4 검토). */
  #sectionsOf(
    store: DraftStore,
    entry: { docKey: string; proposalId: string; opIds: string[] },
  ): string[] {
    const record = store.read(entry.docKey);
    if (record === null) return [];
    const proposal = store
      .proposals(entry.docKey)
      .find((row) => row.proposalId === entry.proposalId);
    if (proposal === undefined) return [];
    const opIds = new Set(entry.opIds);
    const wanted = new Set<string>();
    for (const op of proposal.ops) {
      if (!opIds.has(op.opId)) continue;
      if (op.type === "replace" || op.type === "delete") wanted.add(op.blockId);
      else if (op.type === "insert" && op.afterBlockId !== null) wanted.add(op.afterBlockId);
    }
    const sections = new Set<string>();
    let heading: string | null = null;
    for (const block of this.#view(record).blocks) {
      if (block.view.kind === "heading") heading = block.view.text;
      if (wanted.has(block.id) && heading !== null) sections.add(heading);
    }
    return [...sections].slice(0, 3);
  }

  /** 되돌리기의 한 걸음 — 들어간 모습 그대로일 때만 돌린다. */
  #revertStep(work: DraftRecord, step: ScreenSyncInverse): boolean {
    switch (step.type) {
      case "replace": {
        const index = work.blocks.findIndex((block) => block.id === step.blockId);
        const block = work.blocks[index];
        if (block === undefined || blockFingerprint(block.xml) !== step.after) return false;
        work.blocks[index] = { ...block, kind: step.before.kind, xml: step.before.xml };
        return true;
      }
      case "insert": {
        const index = work.blocks.findIndex((block) => block.id === step.blockId);
        const block = work.blocks[index];
        if (block === undefined || blockFingerprint(block.xml) !== step.after) return false;
        work.blocks.splice(index, 1);
        return true;
      }
      case "delete": {
        if (work.blocks.some((block) => block.id === step.block.id)) return false;
        if (
          step.afterBlockId !== null &&
          !work.blocks.some((block) => block.id === step.afterBlockId)
        ) {
          return false;
        }
        work.blocks.splice(this.#indexAfter(work, step.afterBlockId), 0, { ...step.block });
        return true;
      }
      case "title": {
        if (work.title !== step.after) return false;
        work.title = step.before;
        return true;
      }
    }
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
        // 개정이 다르면 DraftStaleError — 처리기가 코드 draft.stale 로 낸다. 남은 걸음의 채택도
        // AI 의 고침이다(2026-10-31 2단계 — 사람이 고친 블록 위의 단추로 들어간다).
        store.save(work, expectedRevision, { origin: "ai", label: null });
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
      const creds = await loadConfluenceCredentials(this.#deps.credentials, process.env, slug);
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
    const creds = await loadConfluenceCredentials(this.#deps.credentials, process.env, slug);
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

  /** 사본 뿌리 — 프로젝트 폴더 아래 `confluence/`(2026-10-23 · 기획서 사본 이동 계획 §1 D1). */
  #mirrorRoot(slug: string): string {
    return confluenceMirrorRoot(this.#deps.registry.paths(slug).root);
  }

  #ledger(slug: string): ConfluenceLedger {
    // 원장 파일이 없으면 읽기가 빈 원장을 돌려준다 — 연결 전 · 아직 가져오기 전의 모양이다.
    return readConfluenceLedger(confluenceMirrorLedger(this.#deps.registry.paths(slug).root));
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
   * 원장 경로의 파생 마크다운 — 사본 뿌리의 `<path>.md`. 읽지 못하면 묻기를 거절한다 — 빈 몸을
   * AI 에게 조용히 주지 않는다(2026-10-23 2차 검토 R3 발견 5).
   */
  #markdown(slug: string, path: string): string {
    try {
      return readFileSync(join(this.#mirrorRoot(slug), `${path}.md`), "utf8");
    } catch {
      // 읽지 못하면 아래 문장으로 넘어간다.
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
    // 앞자리와 받은 경로를 같은 도구로 푼다 — 실행기가 실제 경로(realpath) 표기로 알려도
    // 근거가 어긋나지 않게(2026-10-23 · 기획서 사본 이동 계획 §6 · 검토 R1).
    const mirrorRoot = realpathBestEffort(this.#mirrorRoot(slug));
    const resolved = realpathBestEffort(absPath);
    if (!resolved.startsWith(`${mirrorRoot}${sep}`)) return null;
    // 원장의 경로는 `/` 로 나눈다 — Windows 의 `\` 표기로는 어느 문서와도 맞지 않았다(2026-10-30 시험에서 찾음).
    const relative = resolved
      .slice(mirrorRoot.length + 1)
      .split(sep)
      .join("/");
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
      parentTitle: record.parent?.title ?? null,
    };
  }

  #threadView(
    slug: string,
    docKey: string,
    store: DraftStore,
    picked?: ConversationRecord,
  ): DraftThread {
    const record = this.#requireRecord(docKey, store);
    const conversation = picked ?? store.thread(docKey);
    return {
      docKey,
      threadId: conversation?.threadId ?? "",
      messages: conversation?.messages ?? [],
      proposals: store.proposals(docKey).map((proposal) => ({
        proposalId: proposal.proposalId,
        createdAt: proposal.createdAt,
        draftRevision: proposal.draftRevision,
        summary: proposal.summary,
        // 바로 반영(2026-10-31 2단계) — 들어간 고침의 표시와 되돌릴 수 있는지를 함께 실은다.
        ...(proposal.appliedAt !== undefined ? { appliedAt: proposal.appliedAt } : {}),
        ...(proposal.appliedOpIds !== undefined && proposal.appliedOpIds.length > 0
          ? { appliedOps: proposal.appliedOpIds.length }
          : {}),
        ...(proposal.appliedAt !== undefined
          ? { keptOps: proposal.ops.filter((op) => op.state === "open").length }
          : {}),
        ...(proposal.appliedAt !== undefined &&
        proposal.undoneAt === undefined &&
        (proposal.inverse?.length ?? 0) > 0
          ? { undoable: true }
          : {}),
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
