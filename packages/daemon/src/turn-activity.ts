import { relative, resolve, sep } from "node:path";
import type { ChatEvent } from "@colonova-design/protocol";
import { STATS_EDIT_TOOLS, STATS_EXEC_TOOLS } from "./tool-names.js";
import { editPathsOf } from "./tool-paths.js";

/** 2026-10-20 응답 지연 개선: 보내기 전 파일 읽기 대신 도구의 성공 기록을 모은다. */
export class TurnActivity {
  private readonly tools = new Map<string, { input: unknown; edit: boolean }>();
  private readonly paths = new Set<string>();
  private executed = false;
  private edited = false;

  observe(event: ChatEvent): void {
    if (event.kind === "tool.start") {
      const edit = STATS_EDIT_TOOLS[event.name] === true;
      if (edit || STATS_EXEC_TOOLS[event.name]) {
        this.tools.set(event.toolUseId, { input: event.input, edit });
      }
    } else if (event.kind === "tool.end") {
      const tool = this.tools.get(event.toolUseId);
      this.tools.delete(event.toolUseId);
      if (!tool || event.isError) return;
      if (!tool.edit) this.executed = true;
      else {
        this.edited = true;
        for (const path of [
          ...editPathsOf(tool.input),
          ...editPathsOf({ changes: event.content }),
        ]) {
          this.paths.add(path);
        }
      }
    }
  }

  get mayHaveChanged(): boolean {
    return this.executed || this.edited;
  }

  /** 명령으로 쓴 파일은 도구가 알려 주지 않으므로 완료 뒤의 미보관 목록을 쓴다. */
  changedFiles(root: string, pending: string[]): string[] {
    if (this.executed || (this.edited && this.paths.size === 0)) return pending;
    const paths = new Set(
      [...this.paths].map((path) => relative(root, resolve(root, path)).split(sep).join("/")),
    );
    return pending.filter((path) => paths.has(path));
  }
}
