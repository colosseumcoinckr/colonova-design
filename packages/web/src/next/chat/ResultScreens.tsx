import { L } from "../labels";
import { EditIcon, EyeIcon, FwdIcon } from "./icons";

/** 고친 화면의 제목과 현재 화면 열기·추가 수정을 제공한다. */
export function ResultScreen({
  title,
  onOpen,
  onEdit,
}: {
  title: string;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="nx-result-screen">
      <button
        type="button"
        className="nx-result-open"
        onClick={onOpen}
        aria-label={`${title} · ${L.transcript.shotGo}`}
      >
        <b>{title}</b>
        <span className="nx-result-go">
          <EyeIcon />
          {L.requestResult.latest}
          <FwdIcon />
        </span>
      </button>
      {onEdit && (
        <div className="nx-result-acts">
          <button
            type="button"
            className="nx-result-act"
            onClick={onEdit}
            aria-label={`${title} · ${L.requestResult.edit}`}
          >
            <EditIcon />
            <span className="nx-result-act-label">{L.requestResult.edit}</span>
          </button>
        </div>
      )}
    </div>
  );
}
