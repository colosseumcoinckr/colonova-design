import { useEffect, useRef, useState } from "react";
import type { InviteImportController } from "../../hooks/use-invite-import";
import { L } from "../labels";
import { INVITE_MAKER_URL } from "../lib/invite-site";
import { Spin } from "../ui/icons";
import { CopyButton } from "./CopyButton";
import { Fold } from "./Fold";
import { Caret, UploadIcon } from "./icons";

/**
 * 파일이 창 어디엔가 끌려 들어와 있는 동안 참 — 초대 파일은 창 어디에 놓아도 받으므로(컨트롤러의
 * 전역 드롭) 놓는 자리가 먼저 알아보고 손짓한다. 끌기의 짝(enter · leave)은 어긋나기 쉬워서 세지
 * 않고, `dragover` 가 이어지는 동안만 참으로 둔다 — 창을 떠나거나 놓거나 멈추면 곧 거짓이다.
 * 파일이 아닌 끌기(글자 · 링크)는 보지 않는다. 관찰만 한다: 기본 동작도 전파도 건드리지 않는다.
 */
function useFileDrag(on: boolean): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!on) {
      setDragging(false);
      return;
    }
    let timer: number | undefined;
    const stop = () => {
      window.clearTimeout(timer);
      setDragging(false);
    };
    const beat = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      setDragging(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(stop, 700);
    };
    // 창 밖으로 나가는 순간(relatedTarget 이 없다)은 곧바로 거둔다.
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) stop();
    };
    window.addEventListener("dragenter", beat, true);
    window.addEventListener("dragover", beat, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", stop, true);
    window.addEventListener("dragend", stop, true);
    return () => {
      stop();
      window.removeEventListener("dragenter", beat, true);
      window.removeEventListener("dragover", beat, true);
      window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("drop", stop, true);
      window.removeEventListener("dragend", stop, true);
    };
  }, [on]);
  return dragging;
}

/**
 * 초대 파일 놓는 자리 — 첫 실행의 셋째 항목과 `프로젝트가 없어요` 화면이 함께 쓴다. 놓는 칸,
 * 여는 중의 칸, 읽지 못한 오류, 그리고 `초대 파일이 아직 없나요?` — 개발자에게 보낼 요청 문장을
 * 펼쳐 복사하는 길(README ③ 의 안내를 앱 안으로 옮겼다). 파일을 못 구한 사람이 가장 막히는 자리라
 * `파일 고르기` 바로 옆 단추로 둔다. 상태와 행동의 주인은 셸의 컨트롤러다.
 */
export function InviteDrop({
  invite,
  importing,
}: {
  invite: InviteImportController;
  importing: boolean;
}) {
  const [over, setOver] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const ask = useRef<HTMLDivElement>(null);
  // 펼친 요청 문장이 창 아래로 넘치면 보이는 자리까지 부드럽게 내려 준다(움직임을 끈 창은 곧바로).
  useEffect(() => {
    if (!askOpen) return;
    const timer = window.setTimeout(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
      ask.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [askOpen]);
  // 끌어옴의 깊이 — 칸 안의 자식을 오갈 때마다 leave 가 섞여도 강조가 버티게 센다.
  const depth = useRef(0);
  const armed = useFileDrag(!importing);
  // 칸 밖에서 끝난 끌기도 강조를 푼다 — 초대 파일의 전역 드롭은 칸의 onDrop 에 닿지 않고
  // 지나가므로(capture 에서 가로막힌다) 창에서 먼저 듣는다.
  useEffect(() => {
    const clear = () => {
      depth.current = 0;
      setOver(false);
    };
    window.addEventListener("drop", clear, true);
    window.addEventListener("dragend", clear, true);
    return () => {
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("dragend", clear, true);
    };
  }, []);

  if (importing) {
    return (
      <div className="nx-drop nx-drop--busy" role="status">
        <Spin />
        <div>{L.onboarding.inviteOpening}</div>
      </div>
    );
  }

  const message = L.onboarding.inviteHelpMessage(INVITE_MAKER_URL);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 드롭은 포인터의 일이다 — 키보드는 안의 `파일 고르기` 단추로 같은 곳에 닿는다. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: 위와 같다. */}
      <div
        className={`nx-drop${over ? " nx-drop--over" : ""}${armed ? " nx-drop--armed" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setOver(false);
          // 초대 파일은 컨트롤러의 전역(capture) 드롭 리스너가 먼저 잡는다 — 여기까지 오는
          // 드롭은 초대 파일이 아니고, 같은 오류 문장으로 답한다.
          const file = event.dataTransfer.files[0];
          if (file) invite.takeFile(file);
        }}
      >
        <span className="nx-drop-ic">
          <UploadIcon />
        </span>
        <p className="nx-drop-t">{L.onboarding.inviteDropName}</p>
        <p className="nx-drop-s">{L.onboarding.inviteDropHow}</p>
        <div className="nx-drop-acts">
          <button type="button" className="nx-btn nx-btn--pri" onClick={invite.openPicker}>
            {L.onboarding.invitePick}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-ob-more"
            aria-expanded={askOpen}
            onClick={() => setAskOpen((open) => !open)}
          >
            <Caret />
            {L.onboarding.inviteHelp}
          </button>
        </div>
      </div>

      {invite.state.phase === "error" && (
        <p className="nx-ob-d nx-ob-d--red" role="alert">
          {invite.state.error}
        </p>
      )}

      {/* 요청 문장 — 펴고 접을 때 높이가 튀지 않는다. */}
      <Fold open={askOpen}>
        <div ref={ask} className="nx-ob-ask">
          <p className="nx-ob-d">{L.onboarding.inviteHelpBody}</p>
          <div className="nx-codebox nx-codebox--ask">{message}</div>
          <div className="nx-ob-acts">
            <CopyButton
              text={message}
              label={L.onboarding.copyText}
              doneLabel={L.onboarding.askCopied}
            />
          </div>
        </div>
      </Fold>
    </>
  );
}
