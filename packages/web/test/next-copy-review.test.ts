import assert from "node:assert/strict";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";
import { historyKindOf } from "../src/next/lib/history-kind.ts";

// 2026-11-12 UI 조사 검토 R1·R2·R6·R8·R10·R11 — 이름과 문장에 담긴 뜻을 지킨다.
test("정해 둔 카드 손과 화면 확인 이름을 유지하고, 입력창에 담는 결과를 설명한다", () => {
  assert.equal(L.planSync.skip, "건너뛰기");
  assert.equal(L.compare.decline, "안 받기");
  assert.equal(L.drafts.sendToScreen, "화면에서 확인");
  assert.ok(L.drafts.precheckScreen.includes(`‘${L.drafts.sendToScreen}’`));
  assert.match(L.drafts.precheckScreen, /입력창에 담을 수 있어요/);
});

test("종류가 없는 옛 되돌리기 기록도 실제 문장집으로 분류한다", () => {
  const prefixes = { restore: L.history.restorePrefix, comment: L.history.commentPrefix };
  assert.equal(historyKindOf("되돌리기: 회원 목록", undefined, prefixes), "restore");
  assert.equal(historyKindOf("코멘트 반영 — 검색 조건", undefined, prefixes), "comment");
  assert.equal(historyKindOf("회원 목록", undefined, prefixes), null);
});

test("첫 제출과 추가 제출은 화면 수 뒤에 받침에 맞는 조사를 쓴다", () => {
  for (const n of [0, 1, 3]) {
    assert.match(L.submit.whyReady(n), new RegExp(`화면 ${n}곳을 개발자에게 제출해요`));
    for (const names of ["", "김개발"]) {
      for (const line of [
        L.submitConfirm.summary(n, names),
        L.submitConfirm.summaryMore(n, names),
      ]) {
        assert.ok(line.includes(`화면 ${n}곳을 `));
        assert.equal(line.includes("김개발에게"), names !== "");
      }
    }
    assert.match(L.submitConfirm.summaryOutside(n, ""), new RegExp(`파일 ${n}개를 `));
  }
});

test("개발자 반영 뒤 빈 기록 안내에는 역슬래시 글자 대신 실제 줄바꿈이 있다", () => {
  assert.equal(L.history.emptyMerged.split("\n").length, 2);
  assert.ok(!L.history.emptyMerged.includes("\\n"));
});

test("초대 확인의 이어진 두 문장은 경계를 남긴다", () => {
  assert.match(`${L.invite.mine} ${L.invite.keptNote}`, /둬요\. 초대장.*않아요\.$/);
});

test("모델 지원 안내도 실제 설정 이름을 쓴다", () => {
  assert.ok(L.model.fastMissing.includes(`‘${L.fast.name}’`));
});
