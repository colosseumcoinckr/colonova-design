/** 2026-11-12 의미 단위 보관의 계약. 패치는 데몬만 만들고 모델은 ID만 고른다. */
export interface AtomicUnit {
  id: string;
  path: string;
  patch: string;
  kind: "hunk" | "file" | "binary";
  summary?: string;
}
export interface AtomicGroup {
  message: string;
  unitIds: string[];
}
export interface AtomicPlan {
  groups: AtomicGroup[];
}
export interface AtomicSnapshot {
  base: string;
  baseTree: string;
  targetTree: string;
  ref: string;
  paths: string[];
  units: AtomicUnit[];
  directory: string;
  indexPath: string;
  indexHash: string;
  targetIndex: string;
}
export interface PreparedAtomicCommits {
  commits: Array<{ sha: string; message: string; files: string[] }>;
  trees: string[];
}
