export interface AssistantDisplayWords {
  heading: string;
  references: string;
  screenCheckTool: string;
  browserFindTool: string;
  browserInspectTool: string;
  screenFilesTool: string;
  diagnosticsTool: string;
  elementReference: string;
  fileReference: string;
}

export interface AssistantDisplay {
  answer: string;
  technical: string | null;
}

const TOOL_WORDS = [
  ["screen_check", "screenCheckTool"],
  ["browser_find", "browserFindTool"],
  ["browser_inspect", "browserInspectTool"],
  ["screen_files", "screenFilesTool"],
  ["repo_diagnostics", "diagnosticsTool"],
] as const;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keep the user-facing answer plain while preserving technical references in a disclosure. */
export function assistantDisplay(text: string, words: AssistantDisplayWords): AssistantDisplay {
  const section = new RegExp(`^#{1,6}[ \\t]*${escapePattern(words.heading)}[ \\t]*$`, "im").exec(
    text,
  );
  const answerSource = section ? text.slice(0, section.index).trimEnd() : text;
  const technicalSection = section ? text.slice(section.index + section[0].length).trim() : "";
  const references = new Set<string>();
  let answer = answerSource;

  for (const [tool, key] of TOOL_WORDS) {
    const pattern = new RegExp("\\x60?\\b" + tool + "\\b\\x60?", "g");
    answer = answer.replace(pattern, () => {
      references.add(tool);
      return words[key];
    });
  }

  answer = answer.replace(/`([A-Za-z][\w-]*(?:\.[A-Za-z_-][\w-]*)+)`/g, (raw) => {
    references.add(raw);
    return words.elementReference;
  });
  answer = answer.replace(/`(<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^`<>]*)?>)`/g, (raw) => {
    references.add(raw);
    return words.elementReference;
  });
  answer = answer.replace(/\bCSS\s+selector\b/gi, (raw) => {
    references.add(raw);
    return words.elementReference;
  });
  answer = answer.replace(/`((?:packages|src|apps|scripts)\/[A-Za-z0-9._/-]+)`/g, (raw) => {
    references.add(raw);
    return words.fileReference;
  });

  const referenceList =
    references.size > 0
      ? `${words.references}\n${[...references].map((value) => `- ${value}`).join("\n")}`
      : "";
  const technical = [technicalSection, referenceList].filter(Boolean).join("\n\n") || null;
  return { answer, technical };
}
