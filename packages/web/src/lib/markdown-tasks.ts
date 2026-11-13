/** 2026-11-12 UI 조사 U-224 — 체크 이름은 같은 항목의 본문만 읽는다. */
interface TaskNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: TaskNode[];
}

function ownText(node: TaskNode): string {
  if (node.tagName === "ul" || node.tagName === "ol") return "";
  if (node.tagName === "img") return String(node.properties?.alt ?? "");
  return node.value ?? node.children?.map(ownText).join("") ?? "";
}

export function markdownTasks() {
  return (tree: TaskNode) => {
    const visit = (node: TaskNode) => {
      if (node.tagName === "li") {
        const name = ownText(node).trim();
        const label = (child: TaskNode) => {
          if (child.tagName === "ul" || child.tagName === "ol") return;
          if (child.tagName === "input" && child.properties?.type === "checkbox") {
            child.properties["aria-label"] = name;
          }
          child.children?.forEach(label);
        };
        label(node);
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
