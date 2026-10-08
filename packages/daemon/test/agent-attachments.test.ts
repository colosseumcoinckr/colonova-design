import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { markTurn } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: attachments 는 protocol 을 부르고 드라이버가 형제 `.js` 지정자로 읽는다 — 다른 데몬 시험과 같다.
import {
  composeTurnText,
  prepareAttachments,
  pruneStagedAttachments,
} from "../dist/agent/attachments.js";
import { COMMON_INSTRUCTIONS, meaningfulFirstLine } from "../src/common-instructions.ts";

/**
 * 첨부의 드라이버 공통 준비(2026-10-07 베타 준비 분석): 이미지는 비전 블록으로 남으면서 디스크에도 놓여 경로가 말의
 * 첨부 섹션에 실린다 — `이 로고를 넣어 주세요` 가 되게. 텍스트 · 바이너리의 기존 동작은 그대로다.
 */

/** 클론 하나 — `.git` 폴더가 있어 첨부는 `.git` 안에 놓인다(git status 가 보지 않는 자리). */
function clone(): { dir: string; staged: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "colonova-attach-"));
  mkdirSync(join(dir, ".git"));
  return {
    dir,
    staged: join(dir, ".git", "colonova-design-attachments"),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const PNG = (name = "logo.png", body = "PNG-BYTES") => ({
  name,
  mediaType: "image/png",
  data: b64(body),
});
const pathOf = (section: string) => /path="([^"]+)"/.exec(section)?.[1] ?? "";

test("이미지는 비전 블록으로 남고 디스크에도 놓여 경로 섹션이 선다", () => {
  const { dir, staged, done } = clone();
  try {
    const image = PNG();
    const prepared = prepareAttachments(dir, [image]);
    assert.deepEqual(prepared.images, [image], "비전 블록은 그대로 — 보기는 보기대로");
    assert.equal(prepared.sections.length, 1);
    const section = prepared.sections[0] ?? "";
    assert.match(section, /^<attachment name="logo\.png" type="image\/png" path="/);
    assert.match(
      section,
      /이 이미지는 이 경로에 저장됐어요 — 사용자가 화면에 넣어 달라고 하면 이 파일을 레포의 에셋 자리로 복사해 쓰세요\.<\/attachment>$/,
    );
    const path = pathOf(section);
    assert.ok(path.startsWith(staged), "클론의 .git 안에 놓인다 — git status 에 올라가지 않는다");
    assert.equal(readFileSync(path, "utf8"), "PNG-BYTES", "받은 바이트 그대로");
  } finally {
    done();
  }
});

test("텍스트 · 바이너리 첨부의 기존 동작은 그대로다", () => {
  const { dir, done } = clone();
  try {
    const prepared = prepareAttachments(dir, [
      { name: "memo.txt", mediaType: "text/plain", data: b64("안녕") },
      {
        name: "spec.pdf",
        mediaType: "application/pdf",
        data: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]).toString("base64"),
      },
    ]);
    assert.deepEqual(prepared.images, []);
    assert.equal(
      prepared.sections[0],
      '<attachment name="memo.txt" type="text/plain">\n안녕\n</attachment>',
    );
    const pdf = prepared.sections[1] ?? "";
    assert.match(
      pdf,
      /^<attachment name="spec\.pdf" type="application\/pdf" path="[^"]+">첨부 파일이 이 경로에 저장됐습니다 — 파일 도구로 읽어 주세요\.<\/attachment>$/,
    );
    assert.ok(existsSync(pathOf(pdf)));
  } finally {
    done();
  }
});

test("섹션은 붙인 순서대로 서고 비전 블록도 붙인 순서다", () => {
  const { dir, done } = clone();
  try {
    const first = PNG("first.png", "one");
    const second = PNG("second.png", "two");
    const prepared = prepareAttachments(dir, [
      first,
      { name: "memo.txt", mediaType: "text/plain", data: b64("본문") },
      second,
    ]);
    assert.deepEqual(prepared.images, [first, second]);
    assert.equal(prepared.sections.length, 3);
    assert.match(prepared.sections[0] ?? "", /name="first\.png"/);
    assert.match(prepared.sections[1] ?? "", /name="memo\.txt"/);
    assert.match(prepared.sections[2] ?? "", /name="second\.png"/);
  } finally {
    done();
  }
});

test("같은 이름의 그림 둘(붙여넣기는 모두 image.png)이 서로를 덮어쓰지 않는다", () => {
  const { dir, done } = clone();
  try {
    const prepared = prepareAttachments(dir, [PNG("image.png", "첫째"), PNG("image.png", "둘째")]);
    const [one, two] = prepared.sections.map(pathOf);
    assert.notEqual(one, two);
    assert.equal(readFileSync(one ?? "", "utf8"), "첫째");
    assert.equal(readFileSync(two ?? "", "utf8"), "둘째");
  } finally {
    done();
  }
});

test("composeTurnText — 말 뒤에 섹션이 붙고, 그림만 보낸 턴도 말이 비지 않는다", () => {
  const { dir, done } = clone();
  try {
    const prepared = prepareAttachments(dir, [PNG()]);
    const section = prepared.sections[0] ?? "";
    assert.equal(composeTurnText("이 로고로 바꿔 줘", prepared), `이 로고로 바꿔 줘\n\n${section}`);
    assert.equal(composeTurnText("  ", prepared), section);
    assert.equal(composeTurnText("말만", { images: [], sections: [] }), "말만");
  } finally {
    done();
  }
});

test("기계가 쓴 턴이 실은 그림(화면 사진)은 보기만 한다 — 디스크에 놓지 않는다", () => {
  const { dir, staged, done } = clone();
  try {
    const gate = markTurn({ kind: "gate", step: "화면 확인" }, "화면을 고쳐 주세요");
    const look = markTurn({ kind: "error", route: "/", errorKind: "look" }, "화면이 이상해요");
    for (const turn of [gate, look]) {
      const prepared = prepareAttachments(dir, [PNG("화면.png")], turn);
      assert.equal(prepared.images.length, 1, "보는 길은 그대로");
      assert.deepEqual(prepared.sections, [], "경로 섹션이 없다");
    }
    assert.equal(existsSync(staged), false, "아무것도 적히지 않았다");
  } finally {
    done();
  }
});

test("핀 턴에서는 핀의 크롭은 보기만 하고 사용자가 고른 그림은 놓인다", () => {
  const { dir, done } = clone();
  try {
    const turn = markTurn(
      { kind: "comments", screen: "회원 목록", items: [{ label: "로고", comment: "이걸로" }] },
      "여기를 이 로고로",
    );
    const crop = { name: "pin-3f2a-91.jpg", mediaType: "image/jpeg", data: b64("crop") };
    const prepared = prepareAttachments(dir, [crop, PNG("brand.png")], turn);
    assert.equal(prepared.images.length, 2, "둘 다 비전 블록으로 간다");
    assert.equal(prepared.sections.length, 1, "크롭은 경로 섹션이 없다");
    assert.match(prepared.sections[0] ?? "", /name="brand\.png"/);
  } finally {
    done();
  }
});

test("디스크에 못 놓아도 그림은 비전 블록으로 간다 — 턴을 막지 않는다", () => {
  const { dir, done } = clone();
  try {
    const blocker = join(dir, "file");
    writeFileSync(blocker, "파일이다");
    const prepared = prepareAttachments(join(blocker, "inside"), [PNG()]);
    assert.equal(prepared.images.length, 1);
    assert.deepEqual(prepared.sections, []);
  } finally {
    done();
  }
});

test("바이트가 없는 그림 · 따옴표가 든 이름도 경로 섹션이 깨지지 않는다", () => {
  const { dir, done } = clone();
  try {
    assert.deepEqual(
      prepareAttachments(dir, [{ name: "빈.png", mediaType: "image/png", data: "" }]).sections,
      [],
    );
    const section = prepareAttachments(dir, [PNG('a"b\n.png')]).sections[0] ?? "";
    assert.match(section, /^<attachment name="a_b_\.png" /);
  } finally {
    done();
  }
});

test("지난 첨부는 그림도 거둔다 — 다음 적기 때와 위생 청소 모두", () => {
  const { dir, staged, done } = clone();
  try {
    const first = prepareAttachments(dir, [PNG("old.png")]);
    const oldPath = pathOf(first.sections[0] ?? "");
    const eightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(oldPath, eightDays, eightDays);
    // 위생 청소: 첨부가 더 오지 않는 클론에서도 7일이 지난 그림은 지워진다.
    pruneStagedAttachments(dir);
    assert.equal(existsSync(oldPath), false);
    // 다음 적기: 다시 낡힌 그림은 새 그림을 적는 길에 함께 거둔다.
    const second = prepareAttachments(dir, [PNG("older.png")]);
    const olderPath = pathOf(second.sections[0] ?? "");
    utimesSync(olderPath, eightDays, eightDays);
    prepareAttachments(dir, [PNG("fresh.png")]);
    assert.equal(existsSync(olderPath), false);
    assert.equal(readdirSync(staged).length, 1, "새 그림 하나만 남는다");
  } finally {
    done();
  }
});

test("그림만 보낸 턴의 글(경로 섹션뿐)은 제목 파생의 눈에 말이 없는 글이다", () => {
  const { dir, done } = clone();
  try {
    const prepared = prepareAttachments(dir, [PNG()]);
    const turn = composeTurnText("", prepared);
    assert.ok(turn.startsWith("<attachment "), "그림만 보내도 글이 비지 않는다");
    assert.equal(meaningfulFirstLine(turn), "", "첨부 섹션의 여는 줄이 제목이 되지 않는다");
    assert.equal(
      meaningfulFirstLine(composeTurnText("이 로고로 바꿔 줘", prepared)),
      "이 로고로 바꿔 줘",
    );
  } finally {
    done();
  }
});

test("공통 규칙 — 문서는 읽기 전용, 그림은 사용자가 화면에 넣어 달라고 한 것만 복사한다(새 불릿 없이 한 불릿에)", () => {
  const bullet = COMMON_INSTRUCTIONS.split("\n").find((row) =>
    row.startsWith("- 사용자가 보낸 문서 파일은"),
  );
  assert.ok(bullet !== undefined);
  assert.ok(bullet.includes("읽는 용도로만 쓴다 — 레포에 복사해 남기지 않는다."), "문서는 그대로");
  assert.ok(
    bullet.includes(
      "그림은 사용자가 화면에 넣어 달라고 한 것만 저장된 경로에서 레포의 에셋 자리로 복사한다",
    ),
    "그림은 조건부 복사",
  );
  // 경로 섹션이 AI 에게 건네는 안내도 같은 조건을 말한다 — 규칙과 섹션이 어긋나지 않는다.
  const { dir, done } = clone();
  try {
    const section = prepareAttachments(dir, [PNG()]).sections[0] ?? "";
    assert.ok(section.includes("사용자가 화면에 넣어 달라고 하면"));
  } finally {
    done();
  }
});
