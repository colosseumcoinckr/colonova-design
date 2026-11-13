import { FileText, Folder } from "lucide-react";
import { useId } from "react";
import type { PlanListRow } from "../plans-list";
import "./draft.css";

/** 들어갈 자리를 문서 트리와 같은 줄로 고른다(2026-10-23 화면 전면 재설계 §4 D). */
export function ParentPicker({
  rows,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  rows: readonly PlanListRow[];
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className="nx-field nx-dr-place" disabled={disabled}>
      <legend className="nx-field-label">{label}</legend>
      {value === "" && <p className="nx-field-help">{placeholder}</p>}
      <div className="nx-dr-place-list">
        {rows
          .filter((row) => row.kind !== "unsupported")
          .map((row) => {
            // 문서 줄의 doc 은 발행 계약의 page 로 보낸다.
            const key = `${row.kind === "folder" ? "folder" : "page"}:${row.pageId}`;
            const Icon = row.kind === "folder" ? Folder : FileText;
            return (
              <label
                key={key}
                className="nx-dr-place-row"
                data-selected={value === key || undefined}
                style={{ paddingInlineStart: `calc(var(--sp-2) + ${row.depth} * var(--sp-3))` }}
                title={row.title}
              >
                <input
                  type="radio"
                  name={name}
                  value={key}
                  checked={value === key}
                  onChange={() => onChange(key)}
                />
                <Icon className="nx-i" size={16} aria-hidden="true" />
                <span>{row.title}</span>
              </label>
            );
          })}
      </div>
    </fieldset>
  );
}
