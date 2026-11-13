import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { cleanupLegacyPlans, hasLegacyPlans } from "../dist/confluence-legacy.js";

/**
 * 옛 기획서 사본의 정리 (2026-10-23 · 기획서 사본 이동 계획 §5) — 손으로 깐 가짜
 * 클론에서 지우는 대상 · 지우는 조건(흔적) · 지키는 대상 · 순서를 본다. git 을
 * 부르지 않고 프로세스를 띄우지 않는다 — 추적 목록은 `git ls-files` 의 산물과
 * 같은 문자열 집합으로 직접 준다. 준비(bring-up) 시험은
 * confluence-legacy-bringup.test.ts 의 몫이다.
 */

/** 가짜 클론 — `.git/info/exclude` 와 임의의 파일을 손으로 깐다. */
function fakeClone(): {
  root: string;
  exclude: string;
  write: (rel: string, body?: string) => string;
  dispose: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "colonova-legacy-"));
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  const exclude = join(root, ".git", "info", "exclude");
  writeFileSync(exclude, "");
  const write = (rel: string, body = "합성 내용\n") => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return path;
  };
  return { root, exclude, write, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** 원장 몸통 — 지정한 상대 경로의 문서를 아는 것으로 적는다. */
const ledgerBody = (...paths: string[]) =>
  JSON.stringify({
    site: "https://synthetic.atlassian.net",
    roots: [],
    lastSyncAt: null,
    pages: Object.fromEntries(
      paths.map((path, index) => [String(900 + index), { path, title: "합성 제목", version: 1 }]),
    ),
    folders: {},
    unsupported: {},
  });

test("원장의 문서 둘과 원장 · exclude 줄 — 모두 지우고 빈 폴더를 거둔다", () => {
  const fake = fakeClone();
  try {
    fake.write("docs/plans/가이드/시작.storage.xml", "<storage/>");
    fake.write("docs/plans/가이드/시작.md", "# 합성");
    fake.write("docs/plans/confluence.json", ledgerBody("가이드/시작"));
    fake.write("keeper.txt", "추적과 무관한 표시\n");
    appendFileSync(fake.exclude, "*.log\ndocs/plans/\n");

    const result = cleanupLegacyPlans(fake.root, new Set(["keeper.txt"]));

    assert.deepEqual(result, { removedFiles: 3, removedDirs: 2, excludeLine: true });
    assert.equal(
      existsSync(join(fake.root, "docs", "plans")),
      false,
      "빈 폴더는 docs/plans 까지 거둔다",
    );
    assert.equal(existsSync(join(fake.root, "docs")), true, "docs/ 와 그 위는 건드리지 않는다");
    assert.equal(existsSync(join(fake.root, "keeper.txt")), true);
    assert.equal(readFileSync(fake.exclude, "utf8"), "*.log\n", "다른 exclude 줄은 그대로다");
  } finally {
    fake.dispose();
  }
});

test("추적 파일이 함께 있는 폴더 — 추적 파일과 docs/plans 는 남는다", () => {
  const fake = fakeClone();
  try {
    fake.write("docs/plans/2026-10-12-계획.md", "레포가 추적하는 문서\n");
    fake.write("docs/plans/옛문서.storage.xml", "<storage/>");
    fake.write("docs/plans/옛문서.md", "# 합성");
    fake.write("docs/plans/confluence.json", ledgerBody("옛문서"));
    appendFileSync(fake.exclude, "docs/plans/\n");

    const result = cleanupLegacyPlans(fake.root, new Set(["docs/plans/2026-10-12-계획.md"]));

    assert.deepEqual(result, { removedFiles: 3, removedDirs: 0, excludeLine: true });
    assert.equal(existsSync(join(fake.root, "docs", "plans", "2026-10-12-계획.md")), true);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "옛문서.storage.xml")), false);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "confluence.json")), false);
  } finally {
    fake.dispose();
  }
});

test("첫 가져오기가 끊긴 클론 — 원장은 없어도 exclude 줄이 있어 .storage.xml 짝은 지운다", () => {
  const fake = fakeClone();
  try {
    fake.write("docs/plans/가이드/짝.storage.xml", "<storage/>");
    fake.write("docs/plans/가이드/짝.md", "# 합성");
    fake.write("docs/plans/혼자.md", "원장도 짝도 모르는 파일\n");
    appendFileSync(fake.exclude, "docs/plans/\n");

    const result = cleanupLegacyPlans(fake.root, new Set());

    assert.deepEqual(result, { removedFiles: 2, removedDirs: 1, excludeLine: true });
    assert.equal(existsSync(join(fake.root, "docs", "plans", "가이드")), false);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "혼자.md")), true);
    assert.equal(
      existsSync(join(fake.root, "docs", "plans")),
      true,
      "남은 파일이 있으면 폴더도 남는다",
    );
    assert.equal(readFileSync(fake.exclude, "utf8"), "", "흔적 줄은 마지막에 빠진다");
  } finally {
    fake.dispose();
  }
});

test("추적 목록에 든 .storage.xml — 지우지 않는다", () => {
  const fake = fakeClone();
  try {
    fake.write("docs/plans/a.storage.xml", "<storage/>");
    fake.write("docs/plans/a.md", "# 합성");
    appendFileSync(fake.exclude, "docs/plans/\n");

    const result = cleanupLegacyPlans(fake.root, new Set(["docs/plans/a.storage.xml"]));

    assert.deepEqual(result, { removedFiles: 1, removedDirs: 0, excludeLine: true });
    assert.equal(existsSync(join(fake.root, "docs", "plans", "a.storage.xml")), true);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "a.md")), false);
  } finally {
    fake.dispose();
  }
});

test("원장의 경로가 폴더 밖을 가리키면 밖의 파일은 건드리지 않는다", () => {
  const fake = fakeClone();
  try {
    const outside = fake.write("밖문서.storage.xml", "<storage/>");
    fake.write("밖문서.md", "# 합성");
    fake.write("docs/plans/confluence.json", ledgerBody("../../밖문서"));

    const result = cleanupLegacyPlans(fake.root, new Set());

    // 밖의 짝은 살고, 원장 자신만 거둔다.
    assert.deepEqual(result, { removedFiles: 1, removedDirs: 1, excludeLine: false });
    assert.equal(existsSync(outside), true);
    assert.equal(existsSync(join(fake.root, "밖문서.md")), true);
    assert.equal(existsSync(join(fake.root, "docs", "plans")), false);
  } finally {
    fake.dispose();
  }
});

test("심볼릭 링크 — 따라가지 않고 지우지 않는다", () => {
  const fake = fakeClone();
  try {
    const outsideFile = fake.write("밖저장.storage.xml", "<storage/>");
    const outsideDir = dirname(fake.write("밖폴더/깊은.storage.xml", "<storage/>"));
    mkdirSync(join(fake.root, "docs", "plans"), { recursive: true });
    symlinkSync(outsideFile, join(fake.root, "docs", "plans", "링크.storage.xml"));
    symlinkSync(outsideDir, join(fake.root, "docs", "plans", "링크폴더"));
    appendFileSync(fake.exclude, "docs/plans/\n");

    const result = cleanupLegacyPlans(fake.root, new Set());

    // 링크는 후보가 아니고, 링크가 살아 있으니 docs/plans 도 비지 않는다.
    assert.deepEqual(result, { removedFiles: 0, removedDirs: 0, excludeLine: true });
    assert.equal(existsSync(join(fake.root, "docs", "plans", "링크.storage.xml")), true);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "링크폴더")), true);
    assert.equal(readFileSync(outsideFile, "utf8"), "<storage/>");
    assert.equal(existsSync(join(outsideDir, "깊은.storage.xml")), true);
  } finally {
    fake.dispose();
  }
});

test("한글 폴더 · 파일 이름 — 깊은 한글 층도 거둔다", () => {
  const fake = fakeClone();
  try {
    fake.write("docs/plans/기획/2026년/가을/문서.storage.xml", "<storage/>");
    fake.write("docs/plans/기획/2026년/가을/문서.md", "# 합성");
    fake.write("docs/plans/confluence.json", ledgerBody("기획/2026년/가을/문서"));

    const result = cleanupLegacyPlans(fake.root, new Set());

    assert.deepEqual(result, { removedFiles: 3, removedDirs: 4, excludeLine: false });
    assert.equal(existsSync(join(fake.root, "docs", "plans")), false);
  } finally {
    fake.dispose();
  }
});

test("docs/plans 가 없고 exclude 줄만 있으면 줄만 빠진다", () => {
  const fake = fakeClone();
  try {
    appendFileSync(fake.exclude, "*.log\ndocs/plans/\n");

    const result = cleanupLegacyPlans(fake.root, new Set());

    assert.deepEqual(result, { removedFiles: 0, removedDirs: 0, excludeLine: true });
    assert.equal(readFileSync(fake.exclude, "utf8"), "*.log\n");
  } finally {
    fake.dispose();
  }
});

test("둘 다 없으면 아무것도 하지 않는다", () => {
  const fake = fakeClone();
  try {
    const result = cleanupLegacyPlans(fake.root, new Set());
    assert.deepEqual(result, { removedFiles: 0, removedDirs: 0, excludeLine: false });
  } finally {
    fake.dispose();
  }
});

test("흔적이 없는 레포 — 미추적 짝 · 낯선 파일 · 빈 폴더가 있어도 아무것도 걷지 않는다", () => {
  const fake = fakeClone();
  try {
    fake.write("docs/plans/x.storage.xml", "<storage/>");
    fake.write("docs/plans/x.md", "# 합성");
    fake.write("docs/plans/메모.txt", "사람이나 AI 가 만든 파일\n");
    mkdirSync(join(fake.root, "docs", "plans", "빈폴더"), { recursive: true });

    const result = cleanupLegacyPlans(fake.root, new Set());

    assert.deepEqual(result, { removedFiles: 0, removedDirs: 0, excludeLine: false });
    assert.equal(existsSync(join(fake.root, "docs", "plans", "x.storage.xml")), true);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "x.md")), true);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "메모.txt")), true);
    assert.equal(existsSync(join(fake.root, "docs", "plans", "빈폴더")), true);
  } finally {
    fake.dispose();
  }
});

test("docs/plans 가 레포 밖 폴더를 가리키는 링크 — 밖의 파일은 그대로고 줄만 빠진다", () => {
  const fake = fakeClone();
  const outside = mkdtempSync(join(tmpdir(), "colonova-legacy-out-"));
  try {
    const target = join(outside, "문서.storage.xml");
    writeFileSync(target, "<storage/>");
    mkdirSync(join(fake.root, "docs"), { recursive: true });
    symlinkSync(outside, join(fake.root, "docs", "plans"));
    appendFileSync(fake.exclude, "*.log\ndocs/plans/\n");

    const result = cleanupLegacyPlans(fake.root, new Set());

    assert.deepEqual(result, { removedFiles: 0, removedDirs: 0, excludeLine: true });
    assert.equal(
      lstatSync(join(fake.root, "docs", "plans")).isSymbolicLink(),
      true,
      "링크 자신은 남는다",
    );
    assert.equal(readFileSync(target, "utf8"), "<storage/>", "링크 너머는 건드리지 않는다");
    assert.equal(readFileSync(fake.exclude, "utf8"), "*.log\n");
  } finally {
    fake.dispose();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("흔적 판정 — exclude 줄만 · 원장만 · 둘 다 · 둘 다 없음", () => {
  const withLine = fakeClone();
  const withLedger = fakeClone();
  const withBoth = fakeClone();
  const withNone = fakeClone();
  try {
    appendFileSync(withLine.exclude, "docs/plans/\n");
    withLedger.write("docs/plans/confluence.json", ledgerBody("가이드"));
    withBoth.write("docs/plans/confluence.json", ledgerBody("가이드"));
    appendFileSync(withBoth.exclude, "docs/plans/\n");

    assert.equal(hasLegacyPlans(withLine.root), true);
    assert.equal(hasLegacyPlans(withLedger.root), true);
    assert.equal(hasLegacyPlans(withBoth.root), true);
    assert.equal(hasLegacyPlans(withNone.root), false);
  } finally {
    for (const fake of [withLine, withLedger, withBoth, withNone]) fake.dispose();
  }
});

test("CRLF 로 적힌 exclude — 정확히 그 줄만 빼고 줄 끝 모양은 그대로다", () => {
  const fake = fakeClone();
  try {
    writeFileSync(fake.exclude, "*.log\r\ndocs/plans/\r\n");

    const result = cleanupLegacyPlans(fake.root, new Set());

    assert.deepEqual(result, { removedFiles: 0, removedDirs: 0, excludeLine: true });
    assert.equal(readFileSync(fake.exclude, "utf8"), "*.log\r\n");
  } finally {
    fake.dispose();
  }
});

test("두 번 부르면 두 번째는 아무것도 하지 않는다 — 멱등이다", () => {
  const fake = fakeClone();
  try {
    fake.write("docs/plans/가이드/시작.storage.xml", "<storage/>");
    fake.write("docs/plans/가이드/시작.md", "# 합성");
    fake.write("docs/plans/confluence.json", ledgerBody("가이드/시작"));
    appendFileSync(fake.exclude, "docs/plans/\n");

    const first = cleanupLegacyPlans(fake.root, new Set());
    assert.deepEqual(first, { removedFiles: 3, removedDirs: 2, excludeLine: true });

    const second = cleanupLegacyPlans(fake.root, new Set());
    assert.deepEqual(second, { removedFiles: 0, removedDirs: 0, excludeLine: false });
  } finally {
    fake.dispose();
  }
});
