import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-key-hint.test.ts 와 같은 모양).
import { capsLabel, groupShortcuts, keyCaps } from "../src/next/lib/shortcut-sheet.ts";

const rows = [
  { id: "find", label: "찾기", keys: "⌘K" },
  { id: "back", label: "뒤로", keys: "⌘[" },
  { id: "pin", label: "핀 찍기", keys: "⌥+클릭 · 끌면 영역" },
  { id: "brand-new", label: "새로 생긴 것", keys: "⌘J" },
];
const layout = [
  { key: "move", ids: ["find"] },
  { key: "preview", ids: ["back", "ghost"] },
  { key: "pin", ids: ["pin"] },
  { key: "more", ids: [] },
] as const;

test("groupShortcuts: 정한 순서와 소속대로 나눈다 — 표에 있어도 행이 없는 id 는 건너뛴다", () => {
  const groups = groupShortcuts(rows, layout, "more");
  assert.deepEqual(
    groups.map((group) => [group.key, group.rows.map((row) => row.id)]),
    [
      ["move", ["find"]],
      ["preview", ["back"]],
      ["pin", ["pin"]],
      ["more", ["brand-new"]],
    ],
  );
});

test("groupShortcuts: 표에 안 적은 새 단축키는 마지막 묶음으로 가서 사라지지 않는다", () => {
  const groups = groupShortcuts(rows, layout, "more");
  assert.ok(groups.at(-1)?.rows.some((row) => row.id === "brand-new"));
});

test("groupShortcuts: 빈 묶음은 그리지 않고, 나머지 묶음이 표에 없으면 끝에 새로 선다", () => {
  const groups = groupShortcuts(
    [{ id: "x", label: "x", keys: "⌘X" }],
    [{ key: "a", ids: ["nothing"] }],
    "more",
  );
  assert.deepEqual(
    groups.map((group) => group.key),
    ["more"],
  );
});

test("keyCaps: mac 글리프는 한 글자씩 캡이 된다", () => {
  assert.deepEqual(keyCaps("⌘K"), [
    [
      { kind: "key", text: "⌘" },
      { kind: "key", text: "K" },
    ],
  ]);
  assert.deepEqual(keyCaps("⌘⇧P"), [
    [
      { kind: "key", text: "⌘" },
      { kind: "key", text: "⇧" },
      { kind: "key", text: "P" },
    ],
  ]);
  assert.deepEqual(keyCaps("⌘,"), [
    [
      { kind: "key", text: "⌘" },
      { kind: "key", text: "," },
    ],
  ]);
});

test("keyCaps: 그 밖의 컴퓨터 표기(Ctrl+Shift+P)는 + 로 갈린다", () => {
  assert.deepEqual(keyCaps("Ctrl+Shift+P"), [
    [
      { kind: "key", text: "Ctrl" },
      { kind: "key", text: "Shift" },
      { kind: "key", text: "P" },
    ],
  ]);
  // `Alt++클릭` — keyHint 가 글리프 뒤에 + 를 한 번 더 붙인 모양도 하나로 뭉쳐 읽는다.
  assert.deepEqual(keyCaps("Alt++클릭 · 끌면 영역"), [
    [
      { kind: "key", text: "Alt" },
      { kind: "word", text: "클릭" },
    ],
    [{ kind: "word", text: "끌면 영역" }],
  ]);
});

test("keyCaps: 대안은 · 로 가르고, 한글만 있는 대안은 설명 낱말 하나다", () => {
  assert.deepEqual(keyCaps("⌥↑ · ⌥↓"), [
    [
      { kind: "key", text: "⌥" },
      { kind: "key", text: "↑" },
    ],
    [
      { kind: "key", text: "⌥" },
      { kind: "key", text: "↓" },
    ],
  ]);
  assert.deepEqual(keyCaps("··· 메뉴"), [[{ kind: "word", text: "··· 메뉴" }]]);
});

test("keyCaps: `-` · `=` · `[` · `/` 같은 기호 키도 캡이다", () => {
  assert.deepEqual(keyCaps("⌘-"), [
    [
      { kind: "key", text: "⌘" },
      { kind: "key", text: "-" },
    ],
  ]);
  assert.deepEqual(
    keyCaps("⌘/")[0]?.map((part) => part.text),
    ["⌘", "/"],
  );
  assert.deepEqual(
    keyCaps("⌘[")[0]?.map((part) => part.text),
    ["⌘", "["],
  );
});

test("capsLabel: 낭독은 조각을 띄어 잇고 대안은 쉼표로 가른다", () => {
  assert.equal(capsLabel(keyCaps("⌘K")), "⌘ K");
  assert.equal(capsLabel(keyCaps("⌥↑ · ⌥↓")), "⌥ ↑, ⌥ ↓");
});
