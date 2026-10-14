import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeAt,
  fileParts,
  matchCommands,
  triggerAt,
} from "../src/next/lib/composer-suggest.ts";

test("triggerAt: `/` 는 말의 맨 앞에서만 연다", () => {
  assert.deepEqual(triggerAt("/", 1), { kind: "command", start: 0, end: 1, query: "" });
  assert.deepEqual(triggerAt("/com", 4), { kind: "command", start: 0, end: 4, query: "com" });
  // 앞의 빈칸은 데몬도 걷는다 — 같은 자리로 읽는다.
  assert.deepEqual(triggerAt("  /re", 5), { kind: "command", start: 2, end: 5, query: "re" });
  // 말 가운데의 `/` · 주소는 열지 않는다.
  assert.equal(triggerAt("메인 / 상세", 4), null);
  assert.equal(triggerAt("http://a.com", 12), null);
  // 명령 뒤에 빈칸을 치면 닫힌다 — 그 뒤는 인자다.
  assert.equal(triggerAt("/compact 요약", 9), null);
});

test("triggerAt: `@` 는 맨 앞이나 빈칸 뒤에서만 연다", () => {
  assert.deepEqual(triggerAt("@", 1), { kind: "file", start: 0, end: 1, query: "" });
  assert.deepEqual(triggerAt("이 파일 @src/pa", 12), {
    kind: "file",
    start: 5,
    end: 12,
    query: "src/pa",
  });
  assert.deepEqual(triggerAt("줄\n@Home", 7), { kind: "file", start: 2, end: 7, query: "Home" });
  assert.equal(triggerAt("a@b.com", 7), null);
  assert.equal(triggerAt("@src/a.ts 고쳐", 12), null);
});

test("triggerAt: 커서가 조각 가운데면 거르는 말은 커서 앞까지, 바꿀 자리는 조각 끝까지", () => {
  assert.deepEqual(triggerAt("@src/pages 보기", 4), {
    kind: "file",
    start: 0,
    end: 10,
    query: "src",
  });
});

test("completeAt: 명령 · 파일은 빈칸 하나를 두고, 폴더는 안으로 이어 간다", () => {
  const slash = triggerAt("/co", 3);
  assert.ok(slash);
  assert.deepEqual(completeAt("/co", slash, "compact"), { text: "/compact ", caret: 9 });

  const file = triggerAt("여기 @Ho", 6);
  assert.ok(file);
  assert.deepEqual(completeAt("여기 @Ho", file, "src/Home.tsx"), {
    text: "여기 @src/Home.tsx ",
    caret: 17,
  });

  const folder = triggerAt("@sr", 3);
  assert.ok(folder);
  const opened = completeAt("@sr", folder, "src/");
  assert.deepEqual(opened, { text: "@src/", caret: 5 });
  // 폴더 안으로 들어가면 같은 조각이 그 폴더를 거르는 말이 된다.
  assert.deepEqual(triggerAt(opened.text, opened.caret), {
    kind: "file",
    start: 0,
    end: 5,
    query: "src/",
  });
});

test("completeAt: 뒤에 이미 빈칸이 있으면 하나 더 넣지 않고 커서만 그 뒤로", () => {
  const text = "@sr 고쳐 줘";
  const trigger = triggerAt(text, 3);
  assert.ok(trigger);
  assert.deepEqual(completeAt(text, trigger, "src/a.ts"), { text: "@src/a.ts 고쳐 줘", caret: 10 });
  // 커서가 조각 가운데여도 조각 전체를 바꾼다.
  const mid = triggerAt("@src/pa 보기", 2);
  assert.ok(mid);
  assert.equal(completeAt("@src/pa 보기", mid, "src/pages/").text, "@src/pages/ 보기");
});

test("matchCommands: 이름의 앞 → 다른 이름의 앞 → 이름 가운데, 같은 이름은 한 번", () => {
  const rows = [
    { name: "review", aliases: [] },
    { name: "compact", aliases: [] },
    { name: "context", aliases: ["usage"] },
    { name: "pr-comments", aliases: [] },
    { name: "compact", aliases: [] },
  ];
  assert.deepEqual(
    matchCommands(rows, "").map((row) => row.name),
    ["review", "compact", "context", "pr-comments"],
  );
  assert.deepEqual(
    matchCommands(rows, "co").map((row) => row.name),
    ["compact", "context", "pr-comments"],
  );
  assert.deepEqual(
    matchCommands(rows, "US").map((row) => row.name),
    ["context"],
  );
  assert.deepEqual(matchCommands(rows, "zz"), []);
  assert.equal(matchCommands(rows, "", 2).length, 2);
});

test("fileParts: 이름과 위 폴더를 나누고 폴더를 알아본다", () => {
  assert.deepEqual(fileParts("src/pages/Home.tsx"), {
    name: "Home.tsx",
    parent: "src/pages/",
    folder: false,
  });
  assert.deepEqual(fileParts("src/pages/"), { name: "pages", parent: "src/", folder: true });
  assert.deepEqual(fileParts("README.md"), { name: "README.md", parent: "", folder: false });
});
