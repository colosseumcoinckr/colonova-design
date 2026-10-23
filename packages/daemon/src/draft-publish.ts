/**
 * 발행 엔진(2026-10-23 · 최종 구현 계획 F2 · 작업 B3) — 사람이 확인한 블록만 바꾼 본문을
 * Confluence 에 보내는 한 편이다. 확인 → 미리보기 재검사 → 의도 영속 → 편집 잠금 → 조건부
 * 갱신(판 번호) → 결과 확인의 순서를 지킨다(정본 계획 §9). 응답을 잃으면 원격과 저장한 의도를
 * 대조한다. 적용 여부가 불명확하면 `결과 확인 필요`(unknown)로 두고 자동으로 다시 보내지 않는다.
 * 원격에 다른 사람의 미발행 초안이 있거나 판정할 수 없으면 발행을 막는다.
 */

import type {
  DraftPublishBlocker,
  DraftPublishPreview,
  DraftPublishResult,
} from "@colonova-design/protocol";
import { draftStageOf } from "@colonova-design/protocol";
import { decodeEntities } from "./comment-text.js";
import type { ConfluenceClient, ConfluencePage } from "./confluence-client.js";
import type {
  DraftRecord,
  DraftRecordBlock,
  DraftStore,
  PublishIntentRecord,
} from "./draft-store.js";
import {
  blockFingerprint,
  parseStorage,
  projectBlock,
  serializeStorage,
} from "./storage-blocks.js";

export interface DraftPublishContext {
  store: DraftStore;
  client: ConfluenceClient | null; // 연결이 없으면 null
  rootId: string | null; // 연결 기준 페이지 — 범위 검사
  enabled: boolean; // COLONOVA_DESIGN_CONFLUENCE_PUBLISH === "1"
  accountId: string | null; // whoAmI 의 accountId — 결과 대조에 쓴다
  now(): Date;
}

/** 재검사의 시간 여유 — 확인 시각 5분 전부터 만들어진 판만 이번 확인의 결과로 본다(2026-10-23 · §9). */
const RECHECK_WINDOW_MS = 5 * 60 * 1000;

/** frame 순서대 이어 쓰고 칸 자리에 블록을 채운다 — serializeStorage 와 같은 규칙이다. */
export function composeDraftBody(draft: DraftRecord): string {
  return serializeStorage({ frame: draft.frame, blocks: draft.blocks });
}

// ————— 작은 도우미 —————

/** 초안을 읽는다 — 없으면 오류다. 문장은 데몬의 관례대로 한국어 한 줄이다. */
function requireDraft(store: DraftStore, docKey: string): DraftRecord {
  const draft = store.read(docKey);
  if (draft === null) throw new Error("초안이 없습니다");
  return draft;
}

/**
 * 읽은 판의 작성자 — ConfluencePage 가 아직 작성자를 실어 주지 않으므로 응답 원본의 여분 필드를
 * 본다(클라이언트는 손대지 않는다 · 2026-10-23 작업 B3). 모르면 null 이고 판단은 unknown 으로 둔다 —
 * 거짓 적용을 만들지 않는다.
 */
function pageAuthorId(page: ConfluencePage): string | null {
  if (!("authorId" in page)) return null;
  const authorId = page.authorId;
  return typeof authorId === "string" && authorId !== "" ? authorId : null;
}

/** 의도의 지금 모양을 답으로 옮긴다 — sending 은 아직 정해지지 않은 결과로 본다. */
function resultOf(intent: PublishIntentRecord, detail: string): DraftPublishResult {
  return {
    commandId: intent.commandId,
    docKey: intent.docKey,
    state: intent.state === "sending" ? "unknown" : intent.state,
    pageId: intent.result !== null ? intent.result.pageId : intent.pageId,
    version: intent.result !== null ? intent.result.version : null,
    detail,
  };
}

/** 보내기 전에 막힌 발행 — 의도를 남기지 않는다. 고쳐서 같은 명령을 다시 보낼 수 있어야 한다. */
function failedResult(
  input: { commandId: string; docKey: string },
  pageId: string | null,
  detail: string,
): DraftPublishResult {
  return {
    commandId: input.commandId,
    docKey: input.docKey,
    state: "failed",
    pageId,
    version: null,
    detail,
  };
}

/** 단계 표기를 제목의 마지막 표기에 겹쳐 쓴다 — 표기가 없으면 제목이 그대로 간다. */
function stagedTitle(title: string, stage?: { notation: string; reason: string }): string {
  if (stage === undefined) return title;
  const matches = [...title.matchAll(/(?:^|[^A-Za-z])([vV])(\d+(?:\.\d+)*)/g)];
  const last = matches.at(-1);
  if (last === undefined || last.index === undefined) return title;
  const digits = last[2] ?? "";
  const start = last.index + last[0].length - digits.length - 1;
  return `${title.slice(0, start)}${last[1]}${stage.notation}${title.slice(last.index + last[0].length)}`;
}

// ————— 발행 본문의 글 대조 —————

/** 블록 경계를 표시하는 사설 글자 — 공백으로 뭉개지지 않게(comment-text 와 같은 감각). */
const BLOCK_EDGE = "\ue000";

/**
 * 보낸 본문과 원격 본문의 글 대조(2026-10-23 · 독립 검토 R1 발견 2) — 판 · 작성자 · 시각이
 * 같아도 글이 다르면 남이 쓴 판이다. Confluence 가 저장하며 바꿀 수 있는 꼴(속성 · 공백 ·
 * 엔티티 · 태그 배치 · 문서 끝의 빈 문단)에 흔들리지 않게: CDATA 속 글은 그대로 두고, 나머지는
 * 태그를 벗기고 엔티티를 풀고, 블록 경계는 끊고, 공백의 꼴(연속 · 줄바꿈 · nbsp)은 하나로 본다.
 * 모르는 이름 엔티티는 양쪽 다 같은 표지로 견준다 — 한쪽이 글자면 다른 글이다(거짓 적용보다
 * unknown 이 안전하다 · 2026-10-23 2차 검토 R3 발견 2).
 */
export function publishedTextMatches(sentXml: string, remoteXml: string): boolean {
  return publishedText(sentXml) === publishedText(remoteXml);
}

/** 본문 하나의 글 — CDATA 는 속 글 그대로, 이외는 태그를 벗기고 엔티티를 푼 글을 이어 정규화한다. */
function publishedText(storage: string): string {
  const pieces: Array<{ cdata: boolean; text: string }> = [];
  let last = 0;
  for (const match of storage.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    const at = match.index ?? 0;
    if (at > last) pieces.push({ cdata: false, text: storage.slice(last, at) });
    pieces.push({ cdata: true, text: match[1] ?? "" });
    last = at + match[0].length;
  }
  if (last < storage.length) pieces.push({ cdata: false, text: storage.slice(last) });
  return (
    pieces
      .map((piece) =>
        piece.cdata
          ? piece.text
          : decodeEntities(
              piece.text
                .replace(/<br\b[^>]*\/?>/g, BLOCK_EDGE)
                .replace(
                  /<\/?(?:p|li|ul|ol|h[1-6]|div|table|tbody|thead|tr|td|th|blockquote|pre)\b[^>]*>/g,
                  BLOCK_EDGE,
                )
                .replace(/<[^>]*>/g, ""),
            ).replace(/[^\S\ue000]+/g, " "),
      )
      .join("")
      // 경계의 줄과 그에 붙은 공백은 태그 배치의 꼴이다 — 경계 하나로 묶는다.
      .replace(/(?:\s*\ue000)+\s*/g, BLOCK_EDGE)
      // 맨 앞 · 맨 뒤의 경계는 문서를 감싼 꼴이다 — 빈 문단이 얹히거나 글이 감싸져도 같은 글이다.
      .replace(/^\ue000+/, "")
      .replace(/\ue000+$/, "")
      .trim()
  );
}

/**
 * 발행 뒤의 정리 — 초안을 발행본 기준으로 옮겨 같은 본문을 다시 쓰지 않게 한다. 새 기준은 적용된
 * 판의 원격 본문(remoteBody)이다 — Confluence 가 저장하며 바꾼 꼴(속성 · 엔티티)이 다시 맞추기에서
 * 가짜 충돌이 되지 않게 한다(2026-10-23 2차 검토 R3 발견 2). 원격을 못 읽었으면 보낸 본문이 기준이다.
 * 블록마다 지금 원문의 지문을 기준 지문으로 심고 충돌 자리를 비운다.
 */
function alignToPublished(
  store: DraftStore,
  applied: PublishIntentRecord,
  pageId: string,
  remoteBody: string | null,
): void {
  const sent = store.intentBody(applied.commandId);
  if (sent === null) throw new Error("발행 본문이 남아 있지 않아 초안을 발행본에 맞출 수 없습니다");
  const draft = store.read(applied.docKey);
  if (draft === null) throw new Error("초안이 없습니다");
  const body = remoteBody ?? sent;
  store.replaceBase(applied.docKey, body);
  // 초안을 새 기준에서 다시 세운다 — 블록 id 는 기준을 파싱한 자리 번호라, 넣거나 빼거나 옮긴 뒤의 옛 id 를 그대로 두면
  // 되돌리기 · 빠진 블록 세기가 엉뚱한 기준 블록을 잡는다. 원격 본문이면 Confluence 가 저장하며 바꾼 꼴도 그대로 따른다
  // (고치지 않은 블록은 원문 바이트 그대로 나간다는 약속 — 2026-10-23 오케스트레이터 검토).
  const doc = parseStorage(body);
  store.save(
    {
      ...draft,
      pageId,
      title: applied.title,
      baseTitle: applied.title,
      baseVersion: applied.result !== null ? applied.result.version : applied.targetVersion,
      frame: doc.frame,
      blocks: doc.blocks.map((block) => ({
        ...block,
        baseFingerprint: blockFingerprint(block.xml),
      })),
      state: "published",
      pendingCommandId: null,
      observedVersion: null,
    },
    draft.revision,
  );
}

/** 미적용 확인 — 잠금을 풀어 다음 발행이 새 확인과 원격 대조로 가게 한다(2026-10-23 · §9). */
function markNotApplied(
  ctx: DraftPublishContext,
  intent: PublishIntentRecord,
  detail: string,
): DraftPublishResult {
  const next = { ...intent, state: "not-applied" as const };
  ctx.store.saveIntent(next);
  const draft = ctx.store.read(intent.docKey);
  if (draft !== null && draft.pendingCommandId === intent.commandId) {
    ctx.store.save({ ...draft, state: "editing", pendingCommandId: null }, draft.revision);
  }
  return resultOf(next, detail);
}

// ————— 원격과 기준을 블록으로 맞추기 — 다시 맞추기의 3자 비교 —————

/** 두 지문 열의 같은 지문 짝 — LCS 표를 역주행으로 채우고 앞에서 걷는다. */
function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const width = b.length;
  const table = new Uint32Array((a.length + 1) * (width + 1));
  const at = (i: number, j: number): number => table[i * (width + 1) + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = width - 1; j >= 0; j -= 1) {
      const same = a[i] === b[j];
      table[i * (width + 1) + j] = same
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < width) {
    const left = a[i];
    const right = b[j];
    if (left !== undefined && right !== undefined && left === right) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

/**
 * 기준 블록마다 원격의 짝을 매긴다 — LCS 짝과, 짝 사이 구간의 같은 자리 짝짓기다. 남는 기준은
 * 원격이 지운 것이고(null), 남는 원격은 원격이 새로 넣은 것이다(짝이 없는 원격 칸).
 */
function pairRemote(a: string[], b: string[]): Array<number | null> {
  const partner: Array<number | null> = new Array(a.length).fill(null);
  let baseStart = 0;
  let remoteStart = 0;
  for (const [baseIndex, remoteIndex] of lcsMatches(a, b)) {
    const span = Math.min(baseIndex - baseStart, remoteIndex - remoteStart);
    for (let k = 0; k < span; k += 1) partner[baseStart + k] = remoteStart + k;
    partner[baseIndex] = remoteIndex;
    baseStart = baseIndex + 1;
    remoteStart = remoteIndex + 1;
  }
  const tail = Math.min(a.length - baseStart, b.length - remoteStart);
  for (let k = 0; k < tail; k += 1) partner[baseStart + k] = remoteStart + k;
  return partner;
}

export class DraftPublisher {
  /** 보내기 전의 전체 검사 — 막는 이유를 모두 모은다. 원격이 더 새 판이면 초안에 표시해 둔다. */
  async preview(ctx: DraftPublishContext, docKey: string): Promise<DraftPublishPreview> {
    const draft = requireDraft(ctx.store, docKey);
    const blockers: DraftPublishBlocker[] = [];
    if (!ctx.enabled) blockers.push("publish-disabled");
    if (draft.pendingCommandId !== null) blockers.push("pending-command");
    if (draft.blocks.some((block) => block.theirsXml !== undefined)) blockers.push("conflict-open");
    if (ctx.client === null) blockers.push("remote-missing");

    const kind = draft.pageId !== null ? "update" : "create";
    const baseXml = ctx.store.readBase(docKey);
    const base = baseXml !== null ? parseStorage(baseXml) : null;
    const draftIds = new Set(draft.blocks.map((block) => block.id));
    let changed = 0;
    let inserted = 0;
    let deleted = 0;
    const protectedRemoved: string[] = [];
    const remember = (label: string): void => {
      if (!protectedRemoved.includes(label)) protectedRemoved.push(label);
    };
    for (const block of draft.blocks) {
      if (block.baseFingerprint === null) {
        inserted += 1;
        continue;
      }
      if (blockFingerprint(block.xml) === block.baseFingerprint) continue;
      changed += 1;
      const old = base?.blocks.find((row) => row.id === block.id);
      if (old === undefined) continue;
      const before = projectBlock(old).tokens;
      const now = projectBlock(block).tokens;
      for (const name of Object.keys(before)) {
        if (!(name in now)) remember(before[name] ?? "");
      }
    }
    for (const old of base?.blocks ?? []) {
      if (draftIds.has(old.id)) continue;
      deleted += 1;
      const view = projectBlock(old).view;
      if (view.kind === "preserved") remember(view.label);
    }

    const titleChanged = kind === "update" && draft.title !== draft.baseTitle;
    if (kind === "update" && changed === 0 && inserted === 0 && deleted === 0 && !titleChanged) {
      blockers.push("nothing-to-publish");
    }
    const stage = draftStageOf(draft.title);

    let remoteVersion: number | null = null;
    const client = ctx.client;
    if (client !== null) {
      const pageId = draft.pageId;
      if (pageId !== null) {
        // 기존 문서 — 판 · 범위 · 권한 · 원격 초안을 차례로 본다(2026-10-23 · 최종 구현 계획 §9).
        const page = await client.readPage(pageId);
        if (page.readable === false) {
          blockers.push("remote-missing");
        } else {
          remoteVersion = page.value.version;
          if (draft.baseVersion !== null && page.value.version > draft.baseVersion) {
            blockers.push("remote-newer");
            if (draft.observedVersion !== page.value.version) {
              ctx.store.save({ ...draft, observedVersion: page.value.version }, draft.revision);
            }
          }
          // 뿌리가 없으면 조상 검사를 건너뛰지 않는다 — 범위를 못 가리는 세계는 닫는다(2026-10-23 · 검토 의심 2).
          if (ctx.rootId === null) {
            blockers.push("out-of-scope");
          } else if (page.value.id !== ctx.rootId) {
            const ancestors = await client.pageAncestors(page.value.id);
            if (ancestors.readable === false || !ancestors.value.includes(ctx.rootId)) {
              blockers.push("out-of-scope");
            }
          }
          const operations = await client.pageOperations(page.value.id);
          const mayUpdate =
            operations.readable === true &&
            operations.value.some((row) => row.operation === "update" && row.targetType === "page");
          if (!mayUpdate) blockers.push("no-permission");
          const remoteDraft = await client.readDraft(page.value.id);
          if (remoteDraft.readable === false) {
            blockers.push("remote-draft-unknown");
          } else if (
            remoteDraft.value.status === "draft" &&
            remoteDraft.value.storage !== null &&
            remoteDraft.value.storage !== page.value.storage
          ) {
            blockers.push("remote-draft");
          }
        }
      } else {
        // 새 문서 — 부모가 페이지일 때만 그 페이지로 범위와 권한을 본다(폴더는 문서 읽기가 없다).
        const parent = draft.parent;
        if (parent !== null && parent.type === "page") {
          // 뿌리가 없으면 조상 검사를 건너뛰지 않는다 — 갱신과 같은 닫힌 쪽이다(2026-10-23 · 검토 의심 2).
          if (ctx.rootId === null) {
            blockers.push("out-of-scope");
          } else if (parent.id !== ctx.rootId) {
            const ancestors = await client.pageAncestors(parent.id);
            if (ancestors.readable === false || !ancestors.value.includes(ctx.rootId)) {
              blockers.push("out-of-scope");
            }
          }
          const operations = await client.pageOperations(parent.id);
          const mayCreate =
            operations.readable === true &&
            operations.value.some(
              (row) =>
                (row.operation === "create" || row.operation === "update") &&
                row.targetType === "page",
            );
          if (!mayCreate) blockers.push("no-permission");
        }
      }
    }

    return {
      docKey,
      kind,
      pageId: draft.pageId,
      title: draft.title,
      titleChanged,
      parent: draft.parent,
      baseVersion: draft.baseVersion,
      remoteVersion,
      draftRevision: draft.revision,
      changes: { changed, inserted, deleted, protectedRemoved },
      stage: {
        current: stage.notation,
        closed: stage.closed,
        required: kind === "update" && stage.closed,
      },
      blockers,
      checkedAt: ctx.now().toISOString(),
    };
  }

  /**
   * 확인된 발행 — 의도를 먼저 영속하고 조건부 갱신으로 보낸다. 같은 명령은 두 번 보내지 않는다.
   * 보내기 전의 검사가 하나라도 남으면 실패로 돌아가고, 실패에는 의도를 남기지 않는다.
   */
  async publish(
    ctx: DraftPublishContext,
    input: {
      docKey: string;
      commandId: string;
      expectedRevision: number;
      stage?: { notation: string; reason: string };
    },
  ): Promise<DraftPublishResult> {
    const store = ctx.store;
    return store.withLock(input.docKey, async () => {
      const seen = store.intent(input.commandId);
      if (seen !== null) {
        // 같은 아이디의 다른 초안 — 남의 결과를 돌려주지 않는다(2026-10-23 · 검토 발견 9).
        if (seen.docKey !== input.docKey) {
          throw new Error("이 발행 명령 아이디는 이미 다른 초안의 발행에 쓰였습니다");
        }
        return resultOf(seen, "이미 처리한 발행 명령이다 — 저장된 결과를 돌려준다");
      }
      const draft = requireDraft(store, input.docKey);
      if (draft.revision !== input.expectedRevision) {
        return failedResult(
          input,
          draft.pageId,
          "초안이 예상 개정과 다르게 바뀌었다 — 다시 읽고 한 번 더한다",
        );
      }
      const check = await this.preview(ctx, input.docKey);
      if (check.blockers.length > 0) {
        return failedResult(input, draft.pageId, check.blockers[0] ?? "publish-disabled");
      }
      if (check.stage.required && input.stage === undefined) {
        return failedResult(
          input,
          draft.pageId,
          "이 발행은 개정 발행이다 — 새 단계 표기와 사유가 필요하다",
        );
      }
      const client = ctx.client;
      if (client === null) return failedResult(input, draft.pageId, "remote-missing");
      // preview 가 observedVersion 을 고쳤을 수 있으니 보내기 전의 초안을 다시 읽는다.
      const current = requireDraft(store, input.docKey);
      const kind = current.pageId !== null ? "update" : "create";
      const title = stagedTitle(current.title, input.stage);
      const body = composeDraftBody(current);
      const targetVersion = kind === "update" ? (current.baseVersion ?? 0) + 1 : null;
      const intent: PublishIntentRecord = {
        format: 1,
        commandId: input.commandId,
        docKey: current.docKey,
        kind,
        site: current.site,
        pageId: current.pageId,
        spaceId: current.spaceId,
        parentId: kind === "create" ? (current.parent?.id ?? null) : null,
        title,
        baseVersion: current.baseVersion,
        targetVersion,
        bodyFingerprint: blockFingerprint(body),
        stage: input.stage ?? null,
        confirmedAt: ctx.now().toISOString(),
        state: "sending",
        result: null,
      };
      // 보내기 전에 의도와 본문을 남긴다 — 응답을 잃어도 무엇을 보냈는지 안다(2026-10-23 · §9).
      store.saveIntent(intent, body);
      const locked = store.save(
        { ...current, state: "publishing", pendingCommandId: input.commandId },
        current.revision,
      );
      const message = input.stage?.reason;
      const sent =
        kind === "update"
          ? await client.updatePage({
              pageId: current.pageId ?? "",
              title,
              storage: body,
              version: targetVersion ?? 1,
              ...(message === undefined ? {} : { message }),
            })
          : await client.createPage({
              spaceId: current.spaceId ?? "",
              parentId: current.parent?.id ?? null,
              title,
              storage: body,
            });
      if (sent.written === true) {
        const applied: PublishIntentRecord = {
          ...intent,
          state: "applied",
          result: {
            pageId: sent.value.id,
            version: sent.value.version,
            at: ctx.now().toISOString(),
          },
        };
        store.saveIntent(applied);
        // 적용된 판의 원격 본문을 한 번 읽는다 — 판이 같으면 그 본문이 새 기준이다. 읽기에 실패하거나
        // 판이 다르면 보낸 본문이 기준이다(2026-10-23 2차 검토 R3 발견 2).
        const reread = await client.readPage(sent.value.id);
        alignToPublished(
          store,
          applied,
          sent.value.id,
          reread.readable === true && reread.value.version === sent.value.version
            ? reread.value.storage
            : null,
        );
        return resultOf(applied, "발행이 적용되었다 — 초안이 발행본 기준으로 옮겨졌다");
      }
      if (sent.reason === "conflict") {
        const conflict = { ...intent, state: "conflict" as const };
        store.saveIntent(conflict);
        const reread = await client.readPage(current.pageId ?? "");
        store.save(
          {
            ...locked,
            state: "editing",
            pendingCommandId: null,
            observedVersion:
              reread.readable === true ? reread.value.version : locked.observedVersion,
          },
          locked.revision,
        );
        return resultOf(conflict, "원격 문서의 판이 기준과 다르다 — 다시 맞춘 뒤 발행한다");
      }
      if (sent.reason === "unknown") {
        const unknown = { ...intent, state: "unknown" as const };
        store.saveIntent(unknown);
        // 잠금은 유지한다 — 결과 확인 · 종료로만 풀리고 자동으로 다시 보내지 않는다.
        store.save({ ...locked, state: "result-unknown" }, locked.revision);
        return resultOf(unknown, "발행 결과를 알 수 없다 — 원격과 대조해 확인해야 한다");
      }
      const failed = { ...intent, state: "failed" as const };
      store.saveIntent(failed);
      store.save({ ...locked, state: "editing", pendingCommandId: null }, locked.revision);
      return resultOf(failed, sent.detail);
    });
  }

  /**
   * 결과 대조 — 응답을 잃은 발행을 원격과 저장한 의도로 가린다. update 는 판 · 작성자 · 시각 ·
   * 본문의 글까지 같아야 적용으로 본다. create 는 같은 부모의 같은 제목 문서를 읽어 작성자와
   * 본문을 대 본다(2026-10-23 · 검토 발견 2). 판정이 서면 unknown 을 유지하고 다시 보내지 않는다.
   */
  async recheck(ctx: DraftPublishContext, commandId: string): Promise<DraftPublishResult> {
    const found = ctx.store.intent(commandId);
    if (found === null) throw new Error("발행 의도가 없습니다");
    return ctx.store.withLock(found.docKey, async () => {
      const intent = ctx.store.intent(commandId);
      if (intent === null) throw new Error("발행 의도가 없습니다");
      if (intent.state !== "sending" && intent.state !== "unknown") {
        return resultOf(intent, "정해진 발행 결과를 돌려준다");
      }
      const client = ctx.client;
      if (client === null) return resultOf(intent, "연결이 없어 발행 여부를 판정하지 못했다");
      const border = Date.parse(intent.confirmedAt) - RECHECK_WINDOW_MS;
      const at = ctx.now().toISOString();
      if (intent.kind === "update") {
        const pageId = intent.pageId;
        if (pageId === null) return resultOf(intent, "문서가 정해지지 않은 발행이다");
        const page = await client.readPage(pageId);
        if (page.readable === false) {
          return resultOf(intent, "원격 문서를 읽지 못해 발행 여부를 판정하지 못했다");
        }
        if (page.value.version === intent.targetVersion) {
          const author = pageAuthorId(page.value);
          if (author === null || ctx.accountId === null || author !== ctx.accountId) {
            return resultOf(intent, "새 판의 작성자를 가릴 수 없어 발행 여부를 판정하지 못했다");
          }
          const madeAt = Date.parse(page.value.updatedAt ?? "");
          if (!Number.isFinite(madeAt) || madeAt <= border) {
            return resultOf(
              intent,
              "새 판이 이 확인 전에 만들어진 판이라 발행 여부를 판정하지 못했다",
            );
          }
          // 본문 대조 — 판 · 작성자 · 시각이 같아도 글이 다르면 내가 보낸 판이 아니다(2026-10-23 · 검토 발견 2).
          const sentBody = ctx.store.intentBody(commandId);
          if (sentBody === null) {
            return resultOf(intent, "보낸 본문이 남아 있지 않아 발행 여부를 판정하지 못했다");
          }
          if (!publishedTextMatches(sentBody, page.value.storage)) {
            return resultOf(
              intent,
              "원격의 새 판 본문이 보낸 것과 달라 발행 여부를 판정하지 못했다",
            );
          }
          const applied: PublishIntentRecord = {
            ...intent,
            state: "applied",
            result: { pageId, version: page.value.version, at },
          };
          ctx.store.saveIntent(applied);
          // 읽은 판이 곧 적용된 판이다 — 원격 본문이 새 기준이다.
          alignToPublished(ctx.store, applied, pageId, page.value.storage);
          return resultOf(applied, "원격 문서를 다시 읽어 발행을 확인했다");
        }
        if (page.value.version === intent.baseVersion) {
          return markNotApplied(
            ctx,
            intent,
            "원격 문서가 아직 기준 판이다 — 발행은 적용되지 않았다",
          );
        }
        return resultOf(intent, "원격 문서의 판이 예상 밖이라 발행 여부를 판정하지 못했다");
      }
      const spaceId = intent.spaceId;
      if (spaceId === null) return resultOf(intent, "공간이 정해지지 않은 발행이다");
      const rows = await client.findPagesByTitle(spaceId, intent.title);
      if (rows.readable === false) {
        return resultOf(intent, "원격 문서 목록을 읽지 못해 발행 여부를 판정하지 못했다");
      }
      const hits = rows.value.filter(
        (row) =>
          row.parentId === intent.parentId &&
          row.createdAt !== null &&
          Date.parse(row.createdAt) > border,
      );
      if (hits.length === 1) {
        const hit = hits[0];
        if (hit === undefined) return resultOf(intent, "발행 여부를 판정하지 못했다");
        // 찾은 문서를 읽어 작성자와 본문을 대 본다 — 제목 · 부모 · 시각만으로 적용으로 보지
        // 않는다(2026-10-23 · 검토 발견 2).
        const page = await client.readPage(hit.id);
        if (page.readable === false) {
          return resultOf(intent, "새 문서를 읽지 못해 발행 여부를 판정하지 못했다");
        }
        const author = pageAuthorId(page.value);
        if (author === null || ctx.accountId === null || author !== ctx.accountId) {
          return resultOf(intent, "새 문서의 작성자를 가릴 수 없어 발행 여부를 판정하지 못했다");
        }
        const sentBody = ctx.store.intentBody(commandId);
        if (sentBody === null) {
          return resultOf(intent, "보낸 본문이 남아 있지 않아 발행 여부를 판정하지 못했다");
        }
        if (!publishedTextMatches(sentBody, page.value.storage)) {
          return resultOf(
            intent,
            "원격의 새 문서 본문이 보낸 것과 달라 발행 여부를 판정하지 못했다",
          );
        }
        const applied: PublishIntentRecord = {
          ...intent,
          state: "applied",
          result: { pageId: hit.id, version: hit.version ?? 1, at },
        };
        ctx.store.saveIntent(applied);
        // 찾아 읽은 문서가 적용된 판과 같은 판일 때만 원격 본문이 새 기준이다.
        alignToPublished(
          ctx.store,
          applied,
          hit.id,
          page.value.version === (hit.version ?? 1) ? page.value.storage : null,
        );
        return resultOf(applied, "원격에서 새 문서를 찾아 발행을 확인했다");
      }
      if (hits.length === 0) {
        return markNotApplied(ctx, intent, "원격에 새 문서가 없다 — 발행은 적용되지 않았다");
      }
      return resultOf(intent, "같은 제목의 문서가 여럿 있어 발행 여부를 판정하지 못했다");
    });
  }

  /**
   * 재전송 없이 종료 — 의도를 미확정 종료로 남기고 편집 잠금을 푼다. 다음 발행은 새 확인과
   * 원격 대조로만 진행한다(2026-10-23 · §9).
   */
  async close(ctx: DraftPublishContext, commandId: string): Promise<DraftPublishResult> {
    const found = ctx.store.intent(commandId);
    if (found === null) throw new Error("발행 의도가 없습니다");
    return ctx.store.withLock(found.docKey, () => {
      const intent = ctx.store.intent(commandId);
      if (intent === null) throw new Error("발행 의도가 없습니다");
      if (intent.state === "applied")
        return resultOf(intent, "이미 확인된 발행이라 종료하지 않는다");
      if (intent.state === "closed-unconfirmed") return resultOf(intent, "이미 종료한 발행이다");
      const closed = { ...intent, state: "closed-unconfirmed" as const };
      ctx.store.saveIntent(closed);
      const draft = ctx.store.read(intent.docKey);
      if (draft !== null && draft.pendingCommandId === intent.commandId) {
        ctx.store.save({ ...draft, state: "editing", pendingCommandId: null }, draft.revision);
      }
      return resultOf(closed, "재전송 없이 발행을 종료했다 — 다음 발행은 새 확인으로 한다");
    });
  }

  /**
   * 다시 맞추기 — 원격 최신본(R)을 새 기준으로 삼고 옛 기준(B)과 블록 지문을 LCS 로 맞춘 뒤
   * 3자 비교한다. 초안이 안 고친 블록은 원격을 따르고, 내가 고친 블록은 원격도 바꿨으면
   * 충돌로 남긴다. 원격이 새로 넣은 블록은 원격 순서의 자리에 들어간다.
   */
  async rebase(ctx: DraftPublishContext, docKey: string): Promise<DraftRecord> {
    return ctx.store.withLock(docKey, async () => {
      const draft = requireDraft(ctx.store, docKey);
      if (draft.pendingCommandId !== null) {
        throw new Error("발행 결과를 확인하기 전에는 다시 맞추지 않습니다");
      }
      const client = ctx.client;
      const pageId = draft.pageId;
      if (client === null || pageId === null) {
        throw new Error("원격 문서가 정해지지 않아 다시 맞추지 못했습니다");
      }
      const remote = await client.readPage(pageId);
      if (remote.readable === false) {
        throw new Error(`원격 문서를 읽지 못해 다시 맞추지 못했습니다 (${remote.detail})`);
      }
      const baseXml = ctx.store.readBase(docKey);
      if (baseXml === null) throw new Error("기준 원문이 없어 다시 맞추지 못했습니다");
      const baseDoc = parseStorage(baseXml);
      const remoteDoc = parseStorage(remote.value.storage);
      const baseFps = baseDoc.blocks.map((block) => blockFingerprint(block.xml));
      const remoteFps = remoteDoc.blocks.map((block) => blockFingerprint(block.xml));
      const partner = pairRemote(baseFps, remoteFps);
      const baseOfRemote = new Map<number, number>();
      partner.forEach((remoteIndex, baseIndex) => {
        if (remoteIndex !== null) baseOfRemote.set(remoteIndex, baseIndex);
      });

      // 초안 블록의 기준 자리 — 기준 지문으로 먼저 찾고(2026-10-23 작업 B3), id 가 대신한다.
      const used = new Set<number>();
      const baseById = new Map(baseDoc.blocks.map((block, index) => [block.id, index] as const));
      const baseByFp = new Map<string, number[]>();
      baseFps.forEach((fp, index) => {
        const list = baseByFp.get(fp);
        if (list === undefined) baseByFp.set(fp, [index]);
        else list.push(index);
      });
      const indexOf = (block: DraftRecordBlock): number => {
        if (block.baseFingerprint !== null) {
          for (const index of baseByFp.get(block.baseFingerprint) ?? []) {
            if (!used.has(index)) {
              used.add(index);
              return index;
            }
          }
        }
        const byId = baseById.get(block.id);
        if (byId === undefined) return -1;
        used.add(byId);
        return byId;
      };
      const indices = draft.blocks.map(indexOf);
      const owner = new Map<number, DraftRecordBlock>();
      draft.blocks.forEach((block, position) => {
        const index = indices[position];
        if (index !== undefined && index >= 0) owner.set(index, block);
      });

      // 원격만의 자리 — 짝지지 못한 원격 블록과 「내가 지우고 원격이 바꾼」 블록을 앵커 뒤에
      // 세워 둔다. 앵커는 원격 순서에서 바로 앞의 짝지어진 블록이다(문서 맨 앞은 -1).
      const pending = new Map<number, DraftRecordBlock[]>();
      const addPending = (anchor: number, block: DraftRecordBlock): void => {
        const list = pending.get(anchor);
        if (list === undefined) pending.set(anchor, [block]);
        else list.push(block);
      };
      let lastPairedRemote = -1;
      for (let r = 0; r < remoteDoc.blocks.length; r += 1) {
        const remoteBlock = remoteDoc.blocks[r];
        if (remoteBlock === undefined) continue;
        const baseIndex = baseOfRemote.get(r);
        if (baseIndex === undefined) {
          // 원격이 새로 넣은 블록 — 원격 순서의 자리, 바로 앞의 짝지어진 블록 뒤에 넣는다.
          addPending(lastPairedRemote < 0 ? -1 : (baseOfRemote.get(lastPairedRemote) ?? -1), {
            id: remoteBlock.id,
            slot: remoteBlock.slot,
            kind: remoteBlock.kind,
            xml: remoteBlock.xml,
            baseFingerprint: remoteFps[r] ?? null,
          });
          continue;
        }
        lastPairedRemote = r;
        // 내가 지운 기준 블록을 원격이 바꿨으면 충돌로 되살린다(지금 xml 은 빈 글이다).
        if (owner.has(baseIndex)) continue;
        const oldFp = baseFps[baseIndex];
        const newFp = remoteFps[r];
        if (oldFp === undefined || newFp === undefined || oldFp === newFp) continue;
        addPending(baseIndex, {
          id: remoteBlock.id,
          slot: remoteBlock.slot,
          kind: remoteBlock.kind,
          xml: "",
          baseFingerprint: newFp,
          theirsXml: remoteBlock.xml,
        });
      }

      // 초안 순서로 걷으며 새 초안을 만든다.
      const result: DraftRecordBlock[] = [];
      let conflict = false;
      const taken = new Set<string>();
      const push = (block: DraftRecordBlock): void => {
        let id = block.id;
        while (taken.has(id)) id = `${id}~`;
        taken.add(id);
        result.push({ ...block, id });
      };
      const flushBefore = (baseIndex: number): void => {
        for (const anchor of [...pending.keys()].sort((a, b) => a - b)) {
          if (anchor >= baseIndex) continue;
          for (const block of pending.get(anchor) ?? []) push(block);
          pending.delete(anchor);
        }
      };
      flushBefore(0);
      draft.blocks.forEach((block, position) => {
        const baseIndex = indices[position];
        if (block.baseFingerprint === null || baseIndex === undefined || baseIndex < 0) {
          push(block); // 초안의 새 블록 — 앞 블록 뒤에 그대로 지킨다
          return;
        }
        flushBefore(baseIndex);
        const remoteIndex = partner[baseIndex] ?? null;
        const mineChanged = blockFingerprint(block.xml) !== block.baseFingerprint;
        if (remoteIndex === null) {
          if (mineChanged) {
            // 원격이 지웠는데 내가 고쳤다 — 내 것을 충돌 블록으로 남긴다.
            conflict = true;
            push({
              id: block.id,
              slot: block.slot,
              kind: block.kind,
              xml: block.xml,
              baseFingerprint: null,
              theirsXml: "",
            });
          }
          return; // 안 고쳤으면 원격의 지움을 따라 뺀다
        }
        const remoteBlock = remoteDoc.blocks[remoteIndex];
        const newFp = remoteFps[remoteIndex];
        const oldFp = baseFps[baseIndex];
        if (remoteBlock === undefined || newFp === undefined || oldFp === undefined) return;
        // LCS 짝은 원격이 그대로 둔 블록이고, 구간의 순서대 짝은 원격이 바꾼 블록이다.
        const remoteChanged = newFp !== oldFp;
        if (mineChanged && remoteChanged) {
          conflict = true;
          push({
            id: block.id,
            slot: remoteBlock.slot,
            kind: remoteBlock.kind,
            xml: block.xml,
            baseFingerprint: newFp,
            theirsXml: remoteBlock.xml,
          });
          return;
        }
        if (mineChanged) {
          // 원격이 그대로 둔 블록은 내 것을 지킨다.
          push({
            id: block.id,
            slot: remoteBlock.slot,
            kind: remoteBlock.kind,
            xml: block.xml,
            baseFingerprint: newFp,
          });
          return;
        }
        push({
          id: remoteBlock.id,
          slot: remoteBlock.slot,
          kind: remoteBlock.kind,
          xml: remoteBlock.xml,
          baseFingerprint: newFp,
        });
      });
      flushBefore(Number.MAX_SAFE_INTEGER);

      // 원격 본문이 곧 새 기준이다 — 초안 레코드와 함께 바꿔치기 한다.
      ctx.store.replaceBase(docKey, remote.value.storage);
      return ctx.store.save(
        {
          ...draft,
          baseTitle: remote.value.title,
          baseVersion: remote.value.version,
          baseFetchedAt: ctx.now().toISOString(),
          frame: remoteDoc.frame,
          blocks: result,
          state: conflict ? "conflict" : "editing",
          observedVersion: null,
        },
        draft.revision,
      );
    });
  }

  /** 충돌 한 줄을 고른다 — mine 과 theirs 중에서. 빈 글을 고르면 블록이 빠진다. */
  async resolve(
    ctx: DraftPublishContext,
    input: { docKey: string; blockId: string; choice: "mine" | "theirs" },
  ): Promise<DraftRecord> {
    return ctx.store.withLock(input.docKey, () => {
      const draft = requireDraft(ctx.store, input.docKey);
      const index = draft.blocks.findIndex((block) => block.id === input.blockId);
      const block = draft.blocks[index];
      if (block === undefined || block.theirsXml === undefined) {
        throw new Error("충돌 중인 블록이 아닙니다");
      }
      const chosen = input.choice === "mine" ? block.xml : (block.theirsXml ?? "");
      const blocks = [...draft.blocks];
      if (chosen === "") blocks.splice(index, 1);
      else
        blocks[index] = {
          id: block.id,
          slot: block.slot,
          kind: block.kind,
          xml: chosen,
          baseFingerprint: block.baseFingerprint,
        };
      const state = blocks.some((row) => row.theirsXml !== undefined)
        ? "conflict"
        : draft.state === "conflict"
          ? "editing"
          : draft.state;
      return ctx.store.save({ ...draft, blocks, state }, draft.revision);
    });
  }
}
