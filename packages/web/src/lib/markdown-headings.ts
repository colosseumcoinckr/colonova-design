/** 2026-11-12 UI 조사 U-219 — 문서 안에서 중복되지 않는 제목 주소. */
interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}

function headingText(node: MarkdownNode): string {
  return node.value ?? node.alt ?? node.children?.map(headingText).join("") ?? "";
}

export function markdownHeadings({ prefix }: { prefix: string }) {
  return (tree: MarkdownNode) => {
    const used = new Set<string>();
    const visit = (node: MarkdownNode) => {
      if (node.type === "heading") {
        const base =
          headingText(node)
            .toLowerCase()
            .trim()
            .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
            .replace(/\s/g, "-") || "section";
        let slug = base;
        let suffix = 0;
        while (used.has(slug)) slug = `${base}-${++suffix}`;
        used.add(slug);
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            id: `${prefix}${slug}`,
            "data-md-anchor": slug,
          },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
