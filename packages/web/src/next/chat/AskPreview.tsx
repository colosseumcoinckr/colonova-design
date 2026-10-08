import { createPortal } from "react-dom";
import { L } from "../labels";
import { ModalBody, ModalFoot, ModalFrame, ModalHead, useModalClose } from "../ui/ModalFrame";
import { CheckIcon, EyeIcon } from "./icons";

/**
 * 질문 카드의 시안 — AI 가 선택지마다 단 작은 화면 그림을 카드로 그린다(2026-10-08 베타 준비
 * 분석 C1 · PLAN D96). 글 세 줄보다 눈으로 비교하는 쪽이 비개발자에게 쉽다.
 *
 * 보안: AI 가 쓴 HTML 을 그리는 곳은 이 파일의 `PreviewFrame` 하나뿐이고, 그 iframe 은 토큰을 하나도
 * 주지 않은 `sandbox=""` 다(스크립트 · 같은 출처 · 폼 · 팝업 · 이동이 없다). 문서는 `lib/ask-preview.ts`
 * 가 CSP 와 함께 지은 것만 받는다. 이 규칙은 `test/next-ask-preview.test.ts` 가 소스로 지킨다 —
 * `sandbox` 에 토큰을 더하거나 `srcDoc` 을 다른 파일에서 쓰면 시험이 깨진다.
 */

/** 시안을 그리는 유일한 iframe — 장식이다(초점 · 포인터가 닿지 않고, 이름은 선택지의 라벨). */
function PreviewFrame({ doc, title }: { doc: string; title: string }) {
  return (
    <iframe
      className="nx-askp-frame"
      title={title}
      srcDoc={doc}
      sandbox=""
      referrerPolicy="no-referrer"
      loading="lazy"
      tabIndex={-1}
    />
  );
}

/** 카드 한 장 — 시안 문서가 없으면(`doc` 이 null) 그림 없는 글 카드로 같은 격자에 선다. */
export interface PreviewChoice {
  label: string;
  description: string;
  doc: string | null;
  on: boolean;
}

/**
 * 시안 카드의 격자 — 카드 어디를 눌러도 `고른 것`이 된다(누르는 즉시 보내지 않는다: 눈으로 비교하다
 * 잘못 눌러 보내는 것을 막는다). 이름이 붙은 단추는 라벨 하나이고, 카드를 덮는 ::after 가 클릭을
 * 받는다. `크게 보기` 는 그 위에 따로 선다.
 */
export function PreviewGrid({
  labelledBy,
  idBase,
  choices,
  disabled,
  onPick,
  onZoom,
}: {
  labelledBy: string;
  idBase: string;
  choices: PreviewChoice[];
  disabled: boolean;
  onPick: (index: number) => void;
  onZoom: (index: number) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 질문 한 줄과 그 선택지 카드들의 묶음 — fieldset 의 테두리 · legend 틀이 필요 없는 자리라 group 으로 읽힌다.
    <div role="group" aria-labelledby={labelledBy} className="nx-askp">
      {choices.map((choice, index) => {
        const descId = `${idBase}-o${index}`;
        return (
          <div
            // 라벨이 겹치는 선택지도 서로 다른 카드다.
            // biome-ignore lint/suspicious/noArrayIndexKey: 선택지의 순서는 요청이 정하고 바뀌지 않는다.
            key={index}
            className={`nx-askp-card${choice.doc ? "" : " nx-askp-card--text"}${
              choice.on ? " nx-askp-card--on" : ""
            }${disabled && !choice.on ? " nx-askp-card--off" : ""}`}
          >
            {choice.doc && (
              <span className="nx-askp-thumb" aria-hidden="true">
                <PreviewFrame doc={choice.doc} title={choice.label} />
              </span>
            )}
            {/* 고른 표시는 색만이 아니라 체크로도 선다 — 낭독은 단추의 눌림 상태가 맡는다. */}
            {choice.on && (
              <span className="nx-askp-ck" aria-hidden="true">
                <CheckIcon />
              </span>
            )}
            <span className="nx-askp-body">
              <button
                type="button"
                className="nx-askp-pick"
                aria-pressed={choice.on}
                aria-describedby={choice.description ? descId : undefined}
                disabled={disabled}
                onClick={() => onPick(index)}
              >
                {choice.label}
              </button>
              {choice.description && (
                <small id={descId} className="nx-askp-desc">
                  {choice.description}
                </small>
              )}
            </span>
            {choice.doc && (
              <button
                type="button"
                className="nx-askp-zoom"
                aria-haspopup="dialog"
                aria-label={L.askPreview.zoomOf(choice.label)}
                onClick={() => onZoom(index)}
              >
                <EyeIcon />
                {L.askPreview.zoom}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 큰 보기의 바닥 — 닫기와 `이걸로 고르기`. 고르면 판은 닫히고, 보내기는 카드의 단추가 맡는다. */
function BigFoot({ on, busy, onChoose }: { on: boolean; busy: boolean; onChoose: () => void }) {
  const close = useModalClose();
  return (
    <>
      <button type="button" className="nx-btn" onClick={close}>
        {L.modal.close}
      </button>
      <button
        type="button"
        className="nx-btn nx-btn--pri"
        disabled={on || busy}
        onClick={() => {
          onChoose();
          close();
        }}
      >
        {on && <CheckIcon />}
        {on ? L.askPreview.chosen : L.askPreview.choose}
      </button>
    </>
  );
}

/**
 * 크게 보기 — 같은 문서를 더 크게 띄운다(작은 그림과 같은 논리 폭이라 모양이 달라지지 않는다). 겹판 뼈대라
 * Esc · 스크림 · 초점 가두기 · 닫는 모션이 같다. 포인터는 그림에 닿지 않는다: 그림 안의 초점이 Esc 를
 * 삼키지 않고, 그림 안의 링크가 누르는 손에 닿지 않는다. 앱 뿌리(`.nx`)로 옮겨 그린다 — 대화 칸은
 * `container-type` 이 fixed 의 기준을 가둔다.
 */
export function PreviewBig({
  title,
  sub,
  doc,
  on,
  busy,
  onChoose,
  onClose,
}: {
  title: string;
  sub: string;
  doc: string;
  on: boolean;
  busy: boolean;
  onChoose: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <ModalFrame onClose={onClose} className="nx-askp-big">
      <ModalHead title={title} sub={sub} />
      <ModalBody>
        <span className="nx-askp-stage">
          <PreviewFrame doc={doc} title={title} />
        </span>
      </ModalBody>
      <ModalFoot>
        <BigFoot on={on} busy={busy} onChoose={onChoose} />
      </ModalFoot>
    </ModalFrame>,
    document.querySelector(".nx") ?? document.body,
  );
}
