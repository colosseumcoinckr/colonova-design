import type { DocBlock, DocImage, DocInline, DocPanelTone } from "@colonova-design/protocol";
import {
  CircleCheck,
  CircleX,
  Info,
  Lightbulb,
  type LucideIcon,
  Paperclip,
  Square,
  SquareCheck,
  StickyNote,
  TriangleAlert,
} from "lucide-react";
import { createContext, type ReactNode, type RefObject, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown } from "../../../components/Markdown";
import type { Daemon } from "../../../lib/daemon-client";
import { linkClick } from "../../../lib/open-link";
import { L } from "../../labels";
import { scrollToTarget } from "../../lib/scroll-to-target";
import { Spin } from "../../ui/icons";
import { ModalBody, ModalFrame, ModalHead } from "../../ui/ModalFrame";
import { fencedCode, isImageType, tocDepths } from "./doc-view-model";
import { downloadAttachment, useAttachment } from "./use-attachment";
import "./doc-view.css";

/**
 * 기획서 보기(2026-10-30 사용자 요청 — 기획서 칸에서 Confluence 기능을 가능한 한 온전히). 데몬이 저장
 * 포맷에서 내린 블록 나무를 그린다 — 정보 상자 · 상태 알약 · 펼치기 · 코드 · 목차 · 그림 · 단 나눔 ·
 * 할 일 · 병합 셀. 모르는 매크로는 `Confluence 전용 · 이름` 자리로 남는다. 읽는 글의 눈금은 공용
 * 마크다운(`.md`)의 규칙을 그대로 받는다.
 */

interface ViewContext {
  api: Daemon["api"];
  pageId: string;
  /** 다른 기획 문서로 가는 링크 — 목록에서 제목으로 찾아 연다. 못 찾으면 false. */
  openPage?: (title: string) => boolean;
}

const Ctx = createContext<ViewContext | null>(null);

function useView(): ViewContext {
  const value = useContext(Ctx);
  if (value === null) throw new Error("DocView context is required");
  return value;
}

const PANEL_ICON: Record<DocPanelTone, LucideIcon> = {
  info: Info,
  note: StickyNote,
  warning: TriangleAlert,
  tip: Lightbulb,
  success: CircleCheck,
  error: CircleX,
  panel: Info,
};

export function DocView({
  blocks,
  api,
  pageId,
  openPage,
}: {
  blocks: readonly DocBlock[];
  api: Daemon["api"];
  pageId: string;
  openPage?: (title: string) => boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <Ctx.Provider value={{ api, pageId, openPage }}>
      <div className="md nx-dv" ref={root}>
        <Blocks blocks={blocks} root={root} />
      </div>
    </Ctx.Provider>
  );
}

/** 편집기의 보존 블록 — 같은 그림을 작게(목차 · 그림 받기는 같은 길). */
export function DocPreview({
  blocks,
  api,
  pageId,
}: {
  blocks: readonly DocBlock[];
  api: Daemon["api"];
  pageId: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <Ctx.Provider value={{ api, pageId }}>
      <div className="md nx-dv nx-dv--preview" ref={root}>
        <Blocks blocks={blocks} root={root} />
      </div>
    </Ctx.Provider>
  );
}

type Root = RefObject<HTMLDivElement | null>;

function Blocks({ blocks, root }: { blocks: readonly DocBlock[]; root: Root }) {
  return (
    <>
      {blocks.map((block, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 본문 블록은 순서가 곧 자리다
        <Block key={at} block={block} root={root} />
      ))}
    </>
  );
}

function Block({ block, root }: { block: DocBlock; root: Root }): ReactNode {
  switch (block.t) {
    case "heading": {
      const Tag = `h${block.level}` as "h1";
      return (
        <Tag>
          <Inlines list={block.children} />
        </Tag>
      );
    }
    case "p":
      return (
        <p>
          <Inlines list={block.children} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag>
          {block.items.map((item, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 목록 항목은 순서가 곧 자리다
            <li key={at}>
              <ItemBody blocks={item} root={root} />
            </li>
          ))}
        </Tag>
      );
    }
    case "tasks":
      return (
        <ul className="nx-dv-tasks">
          {block.items.map((item, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 할 일은 순서가 곧 자리다
            <li key={at} className={item.done ? "nx-dv-task--done" : undefined}>
              {item.done ? (
                <SquareCheck className="nx-i" size={16} aria-label={L.confluence.taskDone} />
              ) : (
                <Square className="nx-i" size={16} aria-label={L.confluence.taskOpen} />
              )}
              <span>
                <Inlines list={item.children} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 넓은 표는 키보드로도 옆으로 굴린다(공용 마크다운과 같다)
        <section className="md__table-scroll" tabIndex={0}>
          <table>
            <tbody>
              {block.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 표의 줄은 순서가 곧 자리다
                <tr key={r}>
                  {row.cells.map((cell, c) => {
                    const Tag = cell.header ? "th" : "td";
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 칸은 순서가 곧 자리다
                      <Tag key={c} colSpan={cell.colspan} rowSpan={cell.rowspan}>
                        <ItemBody blocks={cell.blocks} root={root} />
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
    case "quote":
      return (
        <blockquote>
          <Blocks blocks={block.blocks} root={root} />
        </blockquote>
      );
    case "hr":
      return <hr />;
    case "code":
      return (
        <figure className="nx-dv-code">
          {block.title !== null && <figcaption>{block.title}</figcaption>}
          <Markdown text={fencedCode(block.text, block.language)} />
        </figure>
      );
    case "panel": {
      const Icon = PANEL_ICON[block.tone];
      return (
        <aside
          className={`nx-dv-panel nx-dv-panel--${block.tone}`}
          aria-label={block.title ?? L.confluence.panelTone(block.tone)}
        >
          <Icon className="nx-i nx-dv-panel-ic" size={16} aria-hidden="true" />
          <div className="nx-dv-panel-body">
            {block.title !== null && <p className="nx-dv-panel-title">{block.title}</p>}
            <Blocks blocks={block.blocks} root={root} />
          </div>
        </aside>
      );
    }
    case "expand":
      return (
        <details className="nx-dv-expand">
          <summary>{block.title ?? L.confluence.expandDefault}</summary>
          <div className="nx-dv-expand-body">
            <Blocks blocks={block.blocks} root={root} />
          </div>
        </details>
      );
    case "toc":
      return <Toc entries={block.entries} root={root} />;
    case "image":
      return <ImageView image={block.image} block />;
    case "columns":
      return (
        <div className="nx-dv-cols">
          {block.columns.map((column, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 단은 순서가 곧 자리다
            <div key={at} className="nx-dv-col">
              <Blocks blocks={column} root={root} />
            </div>
          ))}
        </div>
      );
    case "macro":
      return (
        <p className="nx-pl-note-box">
          {block.name === "" ? L.confluence.truncated : L.plans.macroInline(block.name)}
        </p>
      );
  }
}

/** 목록 항목 · 표 칸의 몸 — 문단 하나뿐이면 문단 여백 없이 글만 선다. */
function ItemBody({ blocks, root }: { blocks: readonly DocBlock[]; root: Root }) {
  const only = blocks.length === 1 ? blocks[0] : undefined;
  if (only?.t === "p") return <Inlines list={only.children} />;
  return <Blocks blocks={blocks} root={root} />;
}

function Toc({ entries, root }: { entries: Array<{ level: number; text: string }>; root: Root }) {
  const depths = tocDepths(entries);
  // 같은 이름의 제목이 여럿이면 목차의 몇 번째 같은 이름인지로 고른다.
  const jump = (index: number) => {
    const entry = entries[index];
    if (entry === undefined || root.current === null) return;
    const same = entries.slice(0, index).filter((one) => one.text === entry.text).length;
    const headings = Array.from(
      root.current.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    ).filter((node) => (node.textContent ?? "").replace(/\s+/gu, " ").trim() === entry.text);
    scrollToTarget(headings[same] ?? null, { block: "start" });
  };
  return (
    <nav className="nx-dv-toc" aria-label={L.confluence.tocTitle}>
      <p className="nx-dv-toc-title">{L.confluence.tocTitle}</p>
      {entries.length === 0 ? (
        <p className="nx-dv-toc-none">{L.confluence.tocEmpty}</p>
      ) : (
        <ol>
          {entries.map((entry, at) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: 목차는 순서가 곧 자리다
              key={at}
              style={{ paddingInlineStart: `calc(var(--sp-4) * ${depths[at] ?? 0})` }}
            >
              <button type="button" className="nx-dv-toc-link" onClick={() => jump(at)}>
                {entry.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

function Inlines({ list }: { list: readonly DocInline[] }) {
  return (
    <>
      {list.map((item, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 글 조각은 순서가 곧 자리다
        <Inline key={at} item={item} />
      ))}
    </>
  );
}

function Inline({ item }: { item: DocInline }): ReactNode {
  const view = useView();
  switch (item.t) {
    case "text":
      return item.text;
    case "br":
      return <br />;
    case "mark": {
      const inner = <Inlines list={item.children} />;
      if (item.mark === "b") return <strong>{inner}</strong>;
      if (item.mark === "i") return <em>{inner}</em>;
      if (item.mark === "u") return <u>{inner}</u>;
      if (item.mark === "s") return <del>{inner}</del>;
      if (item.mark === "sub") return <sub>{inner}</sub>;
      if (item.mark === "sup") return <sup>{inner}</sup>;
      return <code>{inner}</code>;
    }
    case "link":
      return (
        <a href={item.href} target="_blank" rel="noreferrer" onClick={linkClick}>
          <Inlines list={item.children} />
        </a>
      );
    case "page": {
      const title = item.title;
      if (view.openPage === undefined || title === "") return <Inlines list={item.children} />;
      return (
        <PageLink title={title} open={view.openPage}>
          <Inlines list={item.children} />
        </PageLink>
      );
    }
    case "attachment":
      return <AttachmentChip filename={item.filename} />;
    case "mention":
      return <span className="nx-dv-mention">@{item.name ?? L.confluence.mentionUnknown}</span>;
    case "status":
      return (
        <span
          className={`nx-dv-status nx-dv-status--${item.color}${item.subtle ? " nx-dv-status--subtle" : ""}`}
        >
          {item.text}
        </span>
      );
    case "image":
      return <ImageView image={item.image} block={false} />;
    case "date":
      return <time className="nx-dv-date">{item.value}</time>;
    case "emoji":
      return item.text;
    case "macro":
      return (
        <code className="nx-dv-macro">
          {item.name === "" ? L.confluence.truncated : L.plans.macroInline(item.name)}
        </code>
      );
  }
}

function PageLink({
  title,
  open,
  children,
}: {
  title: string;
  open: (title: string) => boolean;
  children: ReactNode;
}) {
  const [missing, setMissing] = useState(false);
  return (
    <>
      <button
        type="button"
        className="nx-dv-page"
        title={L.confluence.pageOpen(title)}
        onClick={() => setMissing(!open(title))}
      >
        {children}
      </button>
      {missing && (
        <span className="nx-dv-inline-fail" role="status">
          {L.confluence.pageMissing}
        </span>
      )}
    </>
  );
}

function AttachmentChip({ filename }: { filename: string }) {
  const view = useView();
  const [phase, setPhase] = useState<"idle" | "busy" | "failed" | "too-large">("idle");
  const note =
    phase === "failed"
      ? L.confluence.downloadFailed
      : phase === "too-large"
        ? L.confluence.tooLarge
        : L.confluence.downloadOf(filename);
  return (
    <>
      <button
        type="button"
        className="nx-dv-chip"
        title={note}
        aria-label={note}
        disabled={phase === "busy"}
        onClick={() => {
          setPhase("busy");
          void downloadAttachment(view.api, view.pageId, filename).then((done) =>
            setPhase(done === "ok" ? "idle" : done),
          );
        }}
      >
        {phase === "busy" ? <Spin /> : <Paperclip className="nx-i" size={13} aria-hidden="true" />}
        {L.plans.attachInline(filename)}
      </button>
      {(phase === "failed" || phase === "too-large") && (
        <span className="nx-dv-inline-fail" role="status">
          {note}
        </span>
      )}
    </>
  );
}

/**
 * 그림 한 장 — 홀로 선 그림(블록)은 칸 폭에 맞게 크게 그리되 본래 크기는 넘기지 않는다.
 * Confluence 가 저장한 표시 폭(`ac:width`)은 저 캔버스에서 찍은 값이라 문서 판에서는 쓰지
 * 않는다(2026-11-03 기획서 칸 그림 개선). 문장 속 그림(인라인)은 표시 폭을 그대로 믿어 줄이
 * 망가지지 않게 한다. 누르면 `ImageZoom` 의 겹판에서 자세히 본다.
 */
function ImageView({ image, block }: { image: DocImage; block: boolean }) {
  const view = useView();
  const source = image.source;
  const filename = source.kind === "attachment" && source.other !== true ? source.filename : null;
  const state = useAttachment(view.api, view.pageId, filename);
  const alt = image.alt ?? L.confluence.imageAlt;
  const style = block || image.width === null ? undefined : { width: `${image.width}px` };
  const className = block ? "nx-dv-img nx-dv-img--block" : "nx-dv-img";
  const draw = (url: string, lazy: boolean) =>
    block ? (
      <ImageZoom alt={alt} sub={source.kind === "attachment" ? source.filename : null}>
        <img className={className} src={url} alt={alt} loading={lazy ? "lazy" : undefined} />
      </ImageZoom>
    ) : (
      <img
        className={className}
        src={url}
        alt={alt}
        style={style}
        loading={lazy ? "lazy" : undefined}
      />
    );
  if (source.kind === "url") {
    return draw(source.url, true);
  }
  if (source.other === true) {
    return <span className="nx-dv-img-note">{L.confluence.imageOther(source.filename)}</span>;
  }
  if (state.phase === "loading") {
    return (
      <span className="nx-dv-img-note" role="status">
        <Spin /> {L.confluence.imageLoading}
      </span>
    );
  }
  if (state.phase === "ready" && isImageType(state.mediaType)) {
    return draw(state.url, false);
  }
  if (state.phase === "ready") return <AttachmentChip filename={source.filename} />;
  return (
    <span className="nx-dv-img-note">
      {state.phase === "too-large"
        ? L.confluence.imageTooLarge(source.filename)
        : L.confluence.imageFailed(source.filename)}
    </span>
  );
}

/**
 * 크게 보기 — 블록 그림을 누르면 겹판에 본래 크기까지 크게 띄운다. 뼈대는 공용 `ModalFrame`
 * (Esc · 스크림 · 초점 가두기)이고, 대화 칸 시안의 `크게 보기` 와 같은 이유로 앱 뿌리(`.nx`)로
 * 옮겨 그린다 — 문서 칸의 `container-type` 이 fixed 의 기준을 가둔다.
 */
function ImageZoom({
  alt,
  sub,
  children,
}: {
  alt: string;
  sub: string | null;
  children: ReactNode;
}) {
  const [big, setBig] = useState(false);
  return (
    <>
      <button
        type="button"
        className="nx-dv-imgbtn"
        aria-haspopup="dialog"
        aria-label={L.confluence.imageZoom}
        title={L.confluence.imageZoom}
        onClick={() => setBig(true)}
      >
        {children}
      </button>
      {big &&
        createPortal(
          <ModalFrame className="nx-dv-big" onClose={() => setBig(false)}>
            <ModalHead title={alt} sub={sub ?? undefined} />
            <ModalBody className="nx-dv-big-body">{children}</ModalBody>
          </ModalFrame>,
          document.querySelector(".nx") ?? document.body,
        )}
    </>
  );
}
