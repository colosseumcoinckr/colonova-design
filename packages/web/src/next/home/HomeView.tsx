import type { ThreadSummary } from "@colonova-design/protocol";
import { useCallback, useRef, useState } from "react";
import type { Sessions } from "../../hooks/useSessions";
import type { Daemon } from "../../lib/daemon-client";
import type { ComposerHandle } from "../chat/Composer";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { SparkIcon } from "../ui/icons";
import { HomeComposer } from "./HomeComposer";
import { HomeInbox } from "./HomeInbox";

/** 끌고 온 것에 파일이 들었는가 — 글이나 링크를 끄는 손에는 덮개를 펴지 않는다. */
function carriesFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * 홈(U6) — `<이름>님, 무엇을 만들까요?` · 큰 입력창과 시작점 · 받은 편지함.
 *
 * 파일은 홈 어디에 놓아도 입력창의 첨부가 된다(2026-10-06) — 대화 칸이 칸 전체를 놓는 자리로 삼는
 * 것과 같다. 입력창만 받던 때는 안내 문장이 「끌어다 놓아도 돼요」 라 해도 입력창 밖에 놓은 파일이
 * 아무 일도 없이 사라졌다. 끄는 동안은 입력창이 덮개를 입어 놓을 자리를 말한다.
 */
export function HomeView({
  daemon,
  sessions,
  nav,
  titleFor,
}: {
  daemon: Daemon;
  sessions: Sessions;
  nav: ShellNav;
  /** 대화의 표시 이름 — 사용자가 바꾼 이름을 따른다(사이드바와 같은 이름). */
  titleFor?: (thread: ThreadSummary) => string;
}) {
  const active = daemon.projects.find((project) => project.slug === daemon.activeSlug) ?? null;
  const author = daemon.status?.authorName?.trim();

  const composer = useRef<ComposerHandle | null>(null);
  const registerHandle = useCallback((handle: ComposerHandle | null) => {
    composer.current = handle;
  }, []);
  // 들어온 · 나간 짝을 세어 덮개를 편다 — 자식 위를 지날 때마다 enter/leave 가 번갈아 오므로 깊이로 센다.
  const [dragDepth, setDragDepth] = useState(0);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 홈 전체가 파일을 놓는 자리다 — 드롭은 포인터의 일이고, 키보드는 입력창의 첨부 단추로 닿는다.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 위와 같다.
    <div
      className="nx-home"
      onDragOver={(event) => {
        if (carriesFiles(event)) event.preventDefault();
      }}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        setDragDepth((depth) => Math.max(0, depth - 1));
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragDepth(0);
        if (event.dataTransfer.files.length > 0) composer.current?.attach(event.dataTransfer.files);
      }}
    >
      <div className="nx-home-inner">
        <h1 className="nx-greet">
          <SparkIcon />
          <span>{author ? L.home.greet(author) : L.transcript.emptyTitle}</span>
        </h1>
        <HomeComposer
          daemon={daemon}
          sessions={sessions}
          projects={daemon.projects}
          active={active}
          dropping={dragDepth > 0}
          registerHandle={registerHandle}
          onSwitch={nav.switchProject}
          onOpened={nav.showThread}
          onToast={nav.toast}
        />
        <HomeInbox
          daemon={daemon}
          titleFor={titleFor}
          onOpenThread={nav.openThread}
          onSwitch={nav.switchProject}
        />
      </div>
    </div>
  );
}
