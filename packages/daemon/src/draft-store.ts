/**
 * 초안 저장소 (2026-10-23 · 최종 구현 계획 F2) — 기획서 초안 · 기준 원문 · AI 변경안 · 기획 대화 ·
 * 발행 의도를 프로젝트 데이터 폴더의 `plans` 아래에 둔다(공통 계약 D4). 클론 밖이라 보관 · 제출에
 * 타지 않는다.
 *
 * 읽기는 절대 던지지 않는다 — 없거나 깨진 JSON · 판이 다른 레코드는 null 이고 목록에서는 건너뛴다
 * (confluence-ledger 의 관용 읽기와 같은 길). 쓰기는 같은 폴더의 임시 파일 → rename 의 원자 쓰기다.
 * 저장소는 조용하다 — 로그를 쓰지 않는다.
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  DraftBlockView,
  DraftMessage,
  DraftOp,
  DraftOpState,
  DraftParent,
  DraftReadRef,
  DraftState,
  DraftTableCell,
  DraftTableRow,
} from "@colonova-design/protocol";
import { isDraftKey } from "@colonova-design/protocol";
import type { StorageBlockKind, StorageDoc } from "./storage-blocks.js";

export interface DraftRecordBlock {
  id: string;
  slot: string;
  kind: StorageBlockKind;
  xml: string;
  /** 기준에서 온 블록의 기준 지문. 새 블록은 null. */
  baseFingerprint: string | null;
  /** 충돌 중인 원격 쪽 원문. */
  theirsXml?: string;
}

export interface DraftRecord {
  format: 1;
  docKey: string;
  kind: "existing" | "new";
  site: string;
  pageId: string | null;
  spaceId: string | null;
  parent: DraftParent | null;
  title: string;
  baseTitle: string | null;
  baseVersion: number | null;
  baseFetchedAt: string | null;
  revision: number;
  state: DraftState;
  frame: StorageDoc["frame"];
  blocks: DraftRecordBlock[];
  observedVersion: number | null;
  pendingCommandId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 채택 전 변경안의 한 걸음 — 대상 블록의 생성 시 지문이 붙는다(다시 맞추기에 쓴다). */
export type ProposalOpRecord = DraftOp & { baseFingerprint: string | null };

export interface ProposalRecord {
  proposalId: string;
  threadId: string;
  createdAt: string;
  draftRevision: number;
  baseVersion: number | null;
  summary: string;
  ops: ProposalOpRecord[];
}

export interface ThreadRecord {
  format: 1;
  threadId: string;
  docKey: string;
  sdkSessionId: string | null;
  messages: DraftMessage[];
}

/** 확인 뒤의 발행은 불변 기록이다 — 초안을 지워도 남는다(2026-10-23 작업 A2). */
export interface PublishIntentRecord {
  format: 1;
  commandId: string;
  docKey: string;
  kind: "update" | "create";
  site: string;
  pageId: string | null;
  spaceId: string | null;
  parentId: string | null;
  title: string;
  baseVersion: number | null;
  targetVersion: number | null;
  bodyFingerprint: string;
  stage: { notation: string; reason: string } | null;
  confirmedAt: string;
  state:
    | "sending"
    | "applied"
    | "not-applied"
    | "unknown"
    | "conflict"
    | "failed"
    | "closed-unconfirmed";
  result: { pageId: string; version: number; at: string } | null;
}

/** 기대 개정과 다른 초안을 저장하려 했다 — 다시 읽고 한 번 더다. */
export class DraftStaleError extends Error {
  readonly code = "draft.stale";
}

// ————— 열쇠 — 경로 오르내리기를 막는 첫 걸음 —————

/** 발행 명령의 열쇠 — 소문자 UUID 만 경로에 들어간다(2026-10-23 작업 A2). */
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 정적 멤버 표 — 키가 곧 허용 값이고, `in` 검사가 값을 좁힌다. */
const DRAFT_STATES: Record<DraftState, true> = {
  editing: true,
  publishing: true,
  conflict: true,
  "result-unknown": true,
  published: true,
  "closed-unconfirmed": true,
};

const BLOCK_KINDS: Record<StorageBlockKind, true> = {
  heading: true,
  paragraph: true,
  list: true,
  table: true,
  preserved: true,
};

const OP_STATES: Record<DraftOpState, true> = {
  open: true,
  adopted: true,
  rejected: true,
  stale: true,
};

const INTENT_STATES: Record<PublishIntentRecord["state"], true> = {
  sending: true,
  applied: true,
  "not-applied": true,
  unknown: true,
  conflict: true,
  failed: true,
  "closed-unconfirmed": true,
};

// ————— 관용 읽기 도우미 — 깨진 값은 버리고, 절대 던지지 않는다 —————

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

/** 목록 — 낱목의 pick 이 null 이면 그 목만 버리고 나머지를 살린다. 배열이 아니면 null. */
function parseList<T>(raw: unknown, pick: (value: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null;
  const items: T[] = [];
  for (const entry of raw) {
    const item = pick(entry);
    if (item !== null) items.push(item);
  }
  return items;
}

function parseFrameEntry(raw: unknown): StorageDoc["frame"][number] | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rawText = asString(record.raw);
  if (rawText !== null) return { raw: rawText };
  const slot = asString(record.slot);
  return slot === null ? null : { slot };
}

function parseDraftParent(raw: unknown): DraftParent | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = asString(record.id);
  const title = asString(record.title);
  const type = record.type === "page" ? "page" : record.type === "folder" ? "folder" : null;
  if (id === null || title === null || type === null) return null;
  return { id, type, title };
}

function parseDraftBlock(raw: unknown): DraftRecordBlock | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = asString(record.id);
  const slot = asString(record.slot);
  const kind = asString(record.kind);
  const xml = asString(record.xml);
  if (id === null || slot === null || kind === null || xml === null) return null;
  if (!(kind in BLOCK_KINDS)) return null;
  const block: DraftRecordBlock = {
    id,
    slot,
    kind: kind as StorageBlockKind,
    xml,
    baseFingerprint: asString(record.baseFingerprint),
  };
  const theirsXml = asString(record.theirsXml);
  if (theirsXml !== null) block.theirsXml = theirsXml;
  return block;
}

/** 블록의 투영 — 변경안의 view 를 읽는다. 모양이 아니면 버린다. */
function parseBlockView(raw: unknown): DraftBlockView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  if (record.kind === "heading") {
    const level = asInt(record.level);
    const text = asString(record.text);
    if (level === null || level < 1 || level > 6 || text === null) return null;
    return { kind: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6, text };
  }
  if (record.kind === "paragraph") {
    const text = asString(record.text);
    return text === null ? null : { kind: "paragraph", text };
  }
  if (record.kind === "list") {
    const items = parseList(record.items, asString);
    if (items === null || (record.ordered !== true && record.ordered !== false)) return null;
    return { kind: "list", ordered: record.ordered, items };
  }
  if (record.kind === "table") {
    if (!Array.isArray(record.rows)) return null;
    const rows: DraftTableRow[] = [];
    for (const rawRow of record.rows) {
      const row = asRecord(rawRow);
      if (row === null || !Array.isArray(row.cells)) return null;
      const cells: DraftTableCell[] = [];
      for (const rawCell of row.cells) {
        const cell = asRecord(rawCell);
        const text = cell === null ? null : asString(cell.text);
        if (cell === null || text === null || typeof cell.header !== "boolean") return null;
        cells.push({ header: cell.header, text });
      }
      rows.push({ cells });
    }
    return { kind: "table", rows };
  }
  if (record.kind === "preserved") {
    const label = asString(record.label);
    return label === null ? null : { kind: "preserved", label };
  }
  return null;
}

function parseReadRef(raw: unknown): DraftReadRef | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const pageId = asString(record.pageId);
  const title = asString(record.title);
  if (pageId === null || title === null) return null;
  return { pageId, title, version: asInt(record.version) };
}

function parseMessageRef(raw: unknown): (DraftReadRef & { sections?: string[] }) | null {
  const ref = parseReadRef(raw);
  if (ref === null) return null;
  const record = asRecord(raw);
  const sections = record === null ? null : parseList(record.sections, asString);
  return sections === null ? ref : { ...ref, sections };
}

function parseDraftMessage(raw: unknown): DraftMessage | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const messageId = asString(record.messageId);
  const text = asString(record.text);
  const at = asString(record.at);
  const role = record.role;
  if (messageId === null || text === null || at === null) return null;
  if (role !== "user" && role !== "assistant") return null;
  const message: DraftMessage = { messageId, role, text, at };
  const proposalId = asString(record.proposalId);
  if (proposalId !== null) message.proposalId = proposalId;
  const error = asString(record.error);
  if (error !== null) message.error = error;
  const refs = parseList(record.refs, parseMessageRef);
  if (refs !== null) message.refs = refs;
  const reads = parseList(record.reads, parseReadRef);
  if (reads !== null) message.reads = reads;
  return message;
}

function parseProposalOp(raw: unknown): ProposalOpRecord | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const opId = asString(record.opId);
  const state = asString(record.state);
  if (opId === null || state === null || !(state in OP_STATES)) return null;
  const baseFingerprint = asString(record.baseFingerprint);
  if (record.type === "replace" || record.type === "insert") {
    const view = parseBlockView(record.view);
    if (view === null) return null;
    if (record.type === "replace") {
      const blockId = asString(record.blockId);
      return blockId === null
        ? null
        : { opId, type: "replace", blockId, view, state: state as DraftOpState, baseFingerprint };
    }
    // 맨 앞에 넣는 걸음은 앵커가 null 이다 — 버리지 않는다(2026-10-23 오케스트레이터 검토).
    if (record.afterBlockId === null) {
      return {
        opId,
        type: "insert",
        afterBlockId: null,
        view,
        state: state as DraftOpState,
        baseFingerprint,
      };
    }
    const afterBlockId = asString(record.afterBlockId);
    return afterBlockId === null
      ? null
      : { opId, type: "insert", afterBlockId, view, state: state as DraftOpState, baseFingerprint };
  }
  if (record.type === "delete") {
    const blockId = asString(record.blockId);
    return blockId === null
      ? null
      : { opId, type: "delete", blockId, state: state as DraftOpState, baseFingerprint };
  }
  if (record.type === "title") {
    const title = asString(record.title);
    return title === null
      ? null
      : { opId, type: "title", title, state: state as DraftOpState, baseFingerprint };
  }
  return null;
}

function parseProposalRecord(raw: unknown): ProposalRecord | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const proposalId = asString(record.proposalId);
  const threadId = asString(record.threadId);
  const createdAt = asString(record.createdAt);
  const summary = asString(record.summary);
  const draftRevision = asInt(record.draftRevision);
  if (proposalId === null || threadId === null || createdAt === null || summary === null)
    return null;
  if (draftRevision === null) return null;
  const ops = parseList(record.ops, parseProposalOp);
  if (ops === null) return null;
  return {
    proposalId,
    threadId,
    createdAt,
    draftRevision,
    baseVersion: asInt(record.baseVersion),
    summary,
    ops,
  };
}

function parseThreadRecord(raw: unknown, docKey: string): ThreadRecord | null {
  const record = asRecord(raw);
  if (record === null || record.format !== 1) return null;
  const threadId = asString(record.threadId);
  if (threadId === null || record.docKey !== docKey) return null;
  const messages = parseList(record.messages, parseDraftMessage);
  if (messages === null) return null;
  return { format: 1, threadId, docKey, sdkSessionId: asString(record.sdkSessionId), messages };
}

function parseIntentStage(raw: unknown): { notation: string; reason: string } | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const notation = asString(record.notation);
  const reason = asString(record.reason);
  return notation === null || reason === null ? null : { notation, reason };
}

function parseIntentResult(raw: unknown): PublishIntentRecord["result"] {
  const record = asRecord(raw);
  if (record === null) return null;
  const pageId = asString(record.pageId);
  const at = asString(record.at);
  const version = asInt(record.version);
  return pageId === null || at === null || version === null ? null : { pageId, version, at };
}

function parseIntentRecord(raw: unknown): PublishIntentRecord | null {
  const record = asRecord(raw);
  if (record === null || record.format !== 1) return null;
  const commandId = asString(record.commandId);
  const docKey = asString(record.docKey);
  if (commandId === null || !COMMAND_ID_PATTERN.test(commandId)) return null;
  if (docKey === null || !isDraftKey(docKey)) return null;
  const kind = record.kind === "update" ? "update" : record.kind === "create" ? "create" : null;
  if (kind === null) return null;
  const site = asString(record.site);
  const title = asString(record.title);
  const bodyFingerprint = asString(record.bodyFingerprint);
  const confirmedAt = asString(record.confirmedAt);
  const state = asString(record.state);
  if (site === null || title === null || bodyFingerprint === null || confirmedAt === null)
    return null;
  if (state === null || !(state in INTENT_STATES)) return null;
  return {
    format: 1,
    commandId,
    docKey,
    kind,
    site,
    pageId: asString(record.pageId),
    spaceId: asString(record.spaceId),
    parentId: asString(record.parentId),
    title,
    baseVersion: asInt(record.baseVersion),
    targetVersion: asInt(record.targetVersion),
    bodyFingerprint,
    stage: parseIntentStage(record.stage),
    confirmedAt,
    state: state as PublishIntentRecord["state"],
    result: parseIntentResult(record.result),
  };
}

/** 초안 레코드 — 신원(docKey · kind · 개정 · 상태 · 블록)이 깨지면 레코드 전체를 버린다. */
function parseDraftRecord(raw: unknown): DraftRecord | null {
  const record = asRecord(raw);
  if (record === null || record.format !== 1) return null;
  const docKey = asString(record.docKey);
  if (docKey === null || !isDraftKey(docKey)) return null;
  const kind = record.kind === "existing" ? "existing" : record.kind === "new" ? "new" : null;
  if (kind === null) return null;
  const title = asString(record.title);
  const site = asString(record.site);
  const revision = asInt(record.revision);
  const state = asString(record.state);
  if (title === null || site === null || revision === null) return null;
  if (state === null || !(state in DRAFT_STATES)) return null;
  const frame = parseList(record.frame, parseFrameEntry);
  if (frame === null) return null;
  const blocks = parseList(record.blocks, parseDraftBlock);
  if (blocks === null) return null;
  const createdAt = asString(record.createdAt);
  const updatedAt = asString(record.updatedAt);
  if (createdAt === null || updatedAt === null) return null;
  return {
    format: 1,
    docKey,
    kind,
    site,
    pageId: asString(record.pageId),
    spaceId: asString(record.spaceId),
    parent: parseDraftParent(record.parent),
    title,
    baseTitle: asString(record.baseTitle),
    baseVersion: asInt(record.baseVersion),
    baseFetchedAt: asString(record.baseFetchedAt),
    revision,
    state: state as DraftState,
    frame,
    blocks,
    observedVersion: asInt(record.observedVersion),
    pendingCommandId: asString(record.pendingCommandId),
    createdAt,
    updatedAt,
  };
}

export class DraftStore {
  readonly #root: string;
  readonly #now: () => Date;
  /** docKey → 그 열쇠의 마지막 작업. 메모리 안 약속 사슬이다(2026-10-23 작업 A2). */
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(root: string, now: () => Date = () => new Date()) {
    this.#root = root;
    this.#now = now;
  }

  /** 전체 초안 — updatedAt 이 늦은 것부터. 깨진 파일은 건너뛴다. */
  list(): DraftRecord[] {
    let names: string[];
    try {
      names = readdirSync(join(this.#root, "drafts"));
    } catch {
      return [];
    }
    const drafts: DraftRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const draft = parseDraftRecord(
        this.#readJson(this.#draftFile(name.slice(0, -".json".length))),
      );
      if (draft !== null) drafts.push(draft);
    }
    // 최신이 먼저 — ISO 시각의 사전 순서가 시간 순서다.
    return drafts.sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
  }

  read(docKey: string): DraftRecord | null {
    this.#checkDocKey(docKey);
    const draft = parseDraftRecord(this.#readJson(this.#draftFile(docKey)));
    return draft !== null && draft.docKey === docKey ? draft : null;
  }

  readBase(docKey: string): string | null {
    this.#checkDocKey(docKey);
    try {
      return readFileSync(this.#baseFile(docKey), "utf8");
    } catch {
      return null;
    }
  }

  /** 새 초안 — 이미 있으면 거절한다. 기준 원문이 있으면 함께 두다. */
  create(record: DraftRecord, baseXml: string | null): DraftRecord {
    this.#checkDocKey(record.docKey);
    if (existsSync(this.#draftFile(record.docKey))) throw new Error("초안이 이미 있습니다");
    this.#writeJson(this.#draftFile(record.docKey), record);
    if (baseXml !== null) this.#writeAtomic(this.#baseFile(record.docKey), baseXml);
    return record;
  }

  /**
   * 개정을 걸고 저장한다 — 디스크의 지금 개정이 기대값과 다르면 DraftStaleError. 같으면 개정을
   * 한 올리고 주입한 시계로 updatedAt 을 적는다.
   */
  save(record: DraftRecord, expectedRevision: number): DraftRecord {
    this.#checkDocKey(record.docKey);
    const current = parseDraftRecord(this.#readJson(this.#draftFile(record.docKey)));
    if (current === null) throw new Error("초안이 없습니다");
    if (current.revision !== expectedRevision) {
      throw new DraftStaleError(
        "초안이 예상 개정과 다르게 바뀌었습니다 — 다시 읽은 뒤에 저장해 주세요",
      );
    }
    const saved: DraftRecord = {
      ...record,
      revision: expectedRevision + 1,
      updatedAt: this.#now().toISOString(),
    };
    this.#writeJson(this.#draftFile(record.docKey), saved);
    return saved;
  }

  /**
   * 기준 원문을 바꿔치기 한다 — 다시 맞추기 · 발행 뒤에 쓴다(2026-10-23 작업 A2). 기준이 바뀌면 블록 id(기준을 파싱한
   * 자리 번호)가 다시 매겨질 수 있어 그 전의 열린 변경안 걸음은 모두 오래됨이 된다 — 뒤에 넣기 걸음이 엉뚱한 블록 뒤에
   * 들어가지 않게(2026-10-23 오케스트레이터 검토 · 작업 B9 관찰).
   */
  replaceBase(docKey: string, baseXml: string): void {
    this.#checkDocKey(docKey);
    this.#writeAtomic(this.#baseFile(docKey), baseXml);
    const proposals = this.proposals(docKey);
    let touched = false;
    for (const proposal of proposals) {
      for (const op of proposal.ops) {
        if (op.state !== "open") continue;
        op.state = "stale";
        touched = true;
      }
    }
    if (touched) this.saveProposals(docKey, proposals);
  }

  /** 초안 · 기준 · 변경안 · 대화를 지운다 — 발행 의도는 불변 기록이라 남는다. */
  remove(docKey: string): void {
    this.#checkDocKey(docKey);
    for (const file of [
      this.#draftFile(docKey),
      this.#baseFile(docKey),
      this.#proposalsFile(docKey),
      this.#threadFile(docKey),
    ]) {
      rmSync(file, { force: true });
    }
  }

  proposals(docKey: string): ProposalRecord[] {
    this.#checkDocKey(docKey);
    const parsed = this.#readJson(this.#proposalsFile(docKey));
    return parseList(parsed, parseProposalRecord) ?? [];
  }

  saveProposals(docKey: string, list: ProposalRecord[]): void {
    this.#checkDocKey(docKey);
    this.#writeJson(this.#proposalsFile(docKey), list);
  }

  thread(docKey: string): ThreadRecord | null {
    this.#checkDocKey(docKey);
    return parseThreadRecord(this.#readJson(this.#threadFile(docKey)), docKey);
  }

  saveThread(record: ThreadRecord): void {
    this.#checkDocKey(record.docKey);
    this.#writeJson(this.#threadFile(record.docKey), record);
  }

  intent(commandId: string): PublishIntentRecord | null {
    this.#checkCommandId(commandId);
    return parseIntentRecord(this.#readJson(this.#intentFile(commandId)));
  }

  /** 전체 발행 의도 — confirmedAt 이 늦은 것부터. */
  intents(): PublishIntentRecord[] {
    let names: string[];
    try {
      names = readdirSync(join(this.#root, "intents"));
    } catch {
      return [];
    }
    const intents: PublishIntentRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const intent = parseIntentRecord(
        this.#readJson(this.#intentFile(name.slice(0, -".json".length))),
      );
      if (intent !== null) intents.push(intent);
    }
    // 최신이 먼저 — ISO 시각의 사전 순서가 시간 순서다.
    return intents.sort((a, b) =>
      a.confirmedAt < b.confirmedAt ? 1 : a.confirmedAt > b.confirmedAt ? -1 : 0,
    );
  }

  /** 의도를 저장한다 — 본문은 처음 한 번만 쓰인다(확인한 본문은 바뀌지 않는다). */
  saveIntent(record: PublishIntentRecord, body?: string): void {
    this.#checkCommandId(record.commandId);
    this.#checkDocKey(record.docKey);
    if (body !== undefined) {
      const bodyFile = this.#intentBodyFile(record.commandId);
      if (!existsSync(bodyFile)) this.#writeAtomic(bodyFile, body);
    }
    this.#writeJson(this.#intentFile(record.commandId), record);
  }

  intentBody(commandId: string): string | null {
    this.#checkCommandId(commandId);
    try {
      return readFileSync(this.#intentBodyFile(commandId), "utf8");
    } catch {
      return null;
    }
  }

  /** 같은 초안의 작업을 한 줄로 세운다 — 앞 작업이 던져도 다음 작업은 돈다. */
  withLock<T>(docKey: string, fn: () => Promise<T> | T): Promise<T> {
    this.#checkDocKey(docKey);
    const previous = this.#locks.get(docKey) ?? Promise.resolve();
    const run = previous.then(fn);
    // 사슬 자체는 절대 거절하지 않게 고정한다 — 다음 작업이 막히면 곤란하다.
    this.#locks.set(
      docKey,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  // ————— 안 — 경로 · 검사 · 쓰기 · 읽기 —————

  #checkDocKey(docKey: string): void {
    if (!isDraftKey(docKey)) throw new Error("초안 열쇠 모양이 아닙니다");
  }

  #checkCommandId(commandId: string): void {
    if (!COMMAND_ID_PATTERN.test(commandId))
      throw new Error("발행 명령 아이디는 소문자 UUID 여야 합니다");
  }

  #draftFile(docKey: string): string {
    return join(this.#root, "drafts", `${docKey}.json`);
  }

  #baseFile(docKey: string): string {
    return join(this.#root, "drafts", `${docKey}.base.xml`);
  }

  #proposalsFile(docKey: string): string {
    return join(this.#root, "proposals", `${docKey}.json`);
  }

  #threadFile(docKey: string): string {
    return join(this.#root, "threads", `${docKey}.json`);
  }

  #intentFile(commandId: string): string {
    return join(this.#root, "intents", `${commandId}.json`);
  }

  #intentBodyFile(commandId: string): string {
    return join(this.#root, "intents", `${commandId}.body.xml`);
  }

  /** 없거나 깨진 파일은 null — 읽기는 절대 던지지 않는다. */
  #readJson(file: string): unknown {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  #writeJson(file: string, value: unknown): void {
    this.#writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  /** 원자 쓰기 — 임시 파일을 쓰고 바꿔치기 한다. 실패하면 임시 파일을 지운다. */
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
