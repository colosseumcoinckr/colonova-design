import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inlineText,
  mentionAccountIds,
  nameMentions,
  storageView,
  viewHeadings,
} from "../dist/confluence-view.js";

/**
 * 저장 포맷 → 보기 블록 시험(2026-10-30 사용자 요청 — 기획서 칸에서 Confluence 기능을 가능한 한 온전히).
 * 합성 저장 포맷만 쓴다.
 */

test("정보 상자 · 패널 · 주의 — 몸의 문단이 그대로 산다", () => {
  const view = storageView(
    '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>알림 <strong>굵게</strong></p></ac:rich-text-body></ac:structured-macro>' +
      '<ac:structured-macro ac:name="panel"><ac:parameter ac:name="title">제목</ac:parameter><ac:rich-text-body><p>패널 몸</p></ac:rich-text-body></ac:structured-macro>' +
      '<ac:structured-macro ac:name="warning"><ac:rich-text-body><ul><li>하나</li></ul></ac:rich-text-body></ac:structured-macro>',
  );
  assert.equal(view.length, 3);
  const [info, panel, warning] = view;
  assert.equal(info?.t, "panel");
  assert.ok(info?.t === "panel" && info.tone === "info" && info.title === null);
  assert.deepEqual(info?.t === "panel" ? info.blocks : null, [
    {
      t: "p",
      children: [
        { t: "text", text: "알림 " },
        { t: "mark", mark: "b", children: [{ t: "text", text: "굵게" }] },
      ],
    },
  ]);
  assert.ok(panel?.t === "panel" && panel.tone === "panel" && panel.title === "제목");
  assert.ok(warning?.t === "panel" && warning.tone === "warning");
  assert.equal(warning?.t === "panel" ? warning.blocks[0]?.t : null, "list");
});

test("상태 알약은 글 속에 선다 — 색 · 옅음을 읽는다", () => {
  const view = storageView(
    '<p>진행 <ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">완료</ac:parameter><ac:parameter ac:name="subtle">true</ac:parameter></ac:structured-macro> 끝</p>',
  );
  assert.deepEqual(view, [
    {
      t: "p",
      children: [
        { t: "text", text: "진행 " },
        { t: "status", text: "완료", color: "green", subtle: true },
        { t: "text", text: " 끝" },
      ],
    },
  ]);
});

test("펼치기 · 코드 · 모르는 매크로 — 코드는 몸을 그대로, 모르는 것은 자리만", () => {
  const view = storageView(
    '<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">자세히</ac:parameter><ac:rich-text-body><p>숨은 글</p></ac:rich-text-body></ac:structured-macro>' +
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">json</ac:parameter><ac:plain-text-body><![CDATA[{ "a": 1 }]]></ac:plain-text-body></ac:structured-macro>' +
      '<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">ABC-1</ac:parameter></ac:structured-macro>' +
      '<p>글 속 <ac:structured-macro ac:name="roadmap"/> 자리</p>',
  );
  assert.deepEqual(view[0], {
    t: "expand",
    title: "자세히",
    blocks: [{ t: "p", children: [{ t: "text", text: "숨은 글" }] }],
  });
  assert.deepEqual(view[1], { t: "code", language: "json", title: null, text: '{ "a": 1 }' });
  // jira 는 글 속 매크로라 블록 자리에서도 문단 조각이 된다.
  assert.deepEqual(view[2], { t: "p", children: [{ t: "macro", name: "jira" }] });
  assert.deepEqual(view[3], {
    t: "p",
    children: [
      { t: "text", text: "글 속 " },
      { t: "macro", name: "roadmap" },
      { t: "text", text: " 자리" },
    ],
  });
});

test("목차는 문서의 제목으로 채워지고 minLevel · maxLevel 을 지킨다 — 문단 안의 목차도 뗀다", () => {
  const view = storageView(
    '<p><ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">2</ac:parameter></ac:structured-macro></p>' +
      "<h1>하나</h1><h2>둘</h2><h3>셋</h3>" +
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><h2>상자 속</h2></ac:rich-text-body></ac:structured-macro>',
  );
  assert.deepEqual(view[0], {
    t: "toc",
    entries: [
      { level: 1, text: "하나" },
      { level: 2, text: "둘" },
      { level: 2, text: "상자 속" },
    ],
  });
  assert.deepEqual(
    viewHeadings(view).map((one) => one.text),
    ["하나", "둘", "셋", "상자 속"],
  );
});

test("그림 — 이 문서의 첨부 · 다른 문서의 첨부 · 바깥 주소, 홀로 선 그림 문단은 그림 블록이다", () => {
  const view = storageView(
    '<p><ac:image ac:width="300" ac:alt="흐름"><ri:attachment ri:filename="flow.png"/></ac:image></p>' +
      '<p>앞 <ac:image><ri:attachment ri:filename="x.png"><ri:page ri:content-title="다른"/></ri:attachment></ac:image></p>' +
      '<ac:image><ri:url ri:value="https://example.com/a.png"/></ac:image>' +
      '<ac:image><ri:url ri:value="javascript:alert(1)"/></ac:image>',
  );
  assert.deepEqual(view[0], {
    t: "image",
    image: { source: { kind: "attachment", filename: "flow.png" }, alt: "흐름", width: 300 },
  });
  assert.deepEqual(view[1], {
    t: "p",
    children: [
      { t: "text", text: "앞 " },
      {
        t: "image",
        image: {
          source: { kind: "attachment", filename: "x.png", other: true },
          alt: null,
          width: null,
        },
      },
    ],
  });
  assert.deepEqual(view[2], {
    t: "image",
    image: { source: { kind: "url", url: "https://example.com/a.png" }, alt: null, width: null },
  });
  // javascript: 주소의 그림은 서지 않는다.
  assert.equal(view.length, 3);
});

test("링크 — 바깥 주소는 http(s)만, 문서 링크는 제목, 첨부 링크는 칩, 위험한 주소는 글로만", () => {
  const view = storageView(
    '<p><a href="https://a.example/x">밖</a> <a href="javascript:alert(1)">위험</a> ' +
      '<ac:link><ri:page ri:content-title="정책서"/><ac:plain-text-link-body><![CDATA[정책 보기]]></ac:plain-text-link-body></ac:link> ' +
      '<ac:link><ri:attachment ri:filename="표.xlsx"/></ac:link></p>',
  );
  const children = view[0]?.t === "p" ? view[0].children : [];
  assert.deepEqual(children[0], {
    t: "link",
    href: "https://a.example/x",
    children: [{ t: "text", text: "밖" }],
  });
  assert.deepEqual(children[1], { t: "text", text: " 위험 " });
  assert.deepEqual(children[2], {
    t: "page",
    title: "정책서",
    children: [{ t: "text", text: "정책 보기" }],
  });
  assert.deepEqual(children[4], { t: "attachment", filename: "표.xlsx" });
});

test("병합 셀 · 단 나눔 · 할 일 목록", () => {
  const view = storageView(
    '<table><tbody><tr><th colspan="2">머리</th></tr><tr><td rowspan="2"><p>가</p></td><td>나</td></tr></tbody></table>' +
      "<ac:layout><ac:layout-section><ac:layout-cell><p>왼</p></ac:layout-cell><ac:layout-cell><p>오</p></ac:layout-cell></ac:layout-section></ac:layout>" +
      "<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>끝낸 일</ac:task-body></ac:task><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>할 일</ac:task-body></ac:task></ac:task-list>",
  );
  assert.deepEqual(view[0], {
    t: "table",
    rows: [
      {
        cells: [
          {
            header: true,
            colspan: 2,
            blocks: [{ t: "p", children: [{ t: "text", text: "머리" }] }],
          },
        ],
      },
      {
        cells: [
          {
            header: false,
            rowspan: 2,
            blocks: [{ t: "p", children: [{ t: "text", text: "가" }] }],
          },
          { header: false, blocks: [{ t: "p", children: [{ t: "text", text: "나" }] }] },
        ],
      },
    ],
  });
  assert.deepEqual(view[1], {
    t: "columns",
    columns: [
      [{ t: "p", children: [{ t: "text", text: "왼" }] }],
      [{ t: "p", children: [{ t: "text", text: "오" }] }],
    ],
  });
  assert.deepEqual(view[2], {
    t: "tasks",
    items: [
      { done: true, children: [{ t: "text", text: "끝낸 일" }] },
      { done: false, children: [{ t: "text", text: "할 일" }] },
    ],
  });
});

test("새 편집기의 패널(adf-extension) — panel-type 이 결을 정한다", () => {
  const view = storageView(
    '<ac:adf-extension><ac:adf-node type="panel"><ac:adf-attribute key="panel-type">success</ac:adf-attribute><ac:adf-content><p>잘 됨</p></ac:adf-content></ac:adf-node><ac:adf-fallback><div>옛 모양</div></ac:adf-fallback></ac:adf-extension>',
  );
  assert.deepEqual(view, [
    {
      t: "panel",
      tone: "success",
      title: null,
      blocks: [{ t: "p", children: [{ t: "text", text: "잘 됨" }] }],
    },
  ]);
});

test("멘션 — 계정 id 를 모으고, 이름을 실은 뒤 id 를 걷는다", () => {
  const view = storageView(
    '<p>담당 <ac:link><ri:user ri:account-id="acc-1"/></ac:link>, <ac:link><ri:user ri:account-id="acc-2"/></ac:link></p>',
  );
  assert.deepEqual(mentionAccountIds(view), ["acc-1", "acc-2"]);
  nameMentions(view, new Map([["acc-1", "김기획"]]));
  const children = view[0]?.t === "p" ? view[0].children : [];
  assert.deepEqual(children[1], { t: "mention", name: "김기획" });
  assert.deepEqual(children[3], { t: "mention", name: null });
  assert.equal(inlineText(children), "담당 , ");
});

test("빈 문서는 빈 줄 — 아주 큰 문서는 상한에서 멈추고 끝에 이름 없는 자리를 남긴다", () => {
  assert.deepEqual(storageView(""), []);
  const huge = "<p>줄</p>".repeat(25_000);
  const view = storageView(huge);
  assert.ok(view.length < 25_000);
  assert.deepEqual(view[view.length - 1], { t: "macro", name: "" });
});
