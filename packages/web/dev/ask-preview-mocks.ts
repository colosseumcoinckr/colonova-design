/**
 * 질문 카드 시안의 견본 — `overlay-fixture.html?case=ask&preview=…` 가 읽는다(2026-10-08 C1).
 * AI 가 `previewFormat: "html"` 로 보내는 모양을 흉내 낸다: 조각(`<html>`/`<body>` 없음) · 인라인 스타일만 ·
 * 스크립트 없음. `bad` 는 반대로 악의가 든 시안이다 — 아무것도 실행되지 않고 아무 주소도 불리지 않아야 한다
 * (`beacon` 은 시험용 수신 서버, 닿으면 그 요청이 곧 증거다).
 *
 *   ?preview=1      세 질문 중 하나(`&set=search|button|card`, 기본 search)
 *   ?preview=mixed  search 질문에서 둘째 선택지만 시안이 없다
 *   ?preview=bad    악성 시안 셋 + 상한을 넘는 하나(`&beacon=http://127.0.0.1:포트`)
 */

interface Option {
  label: string;
  description: string;
  preview?: string;
}

interface Question {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Option[];
}

const GRADE = ["일반", "우수", "최우수"];
const NAMES = ["김하늘", "이도윤", "박서연", "최민준", "정유진"];

const rows = (count: number) =>
  NAMES.slice(0, count)
    .map(
      (name, at) =>
        `<tr style="background:${at % 2 ? "#f9fafb" : "#fff"}"><td style="padding:7px 10px">${name}</td><td style="padding:7px 10px;color:#6b7280">010-12${at}4-56${at}8</td><td style="padding:7px 10px"><span style="background:#eef2ff;color:#4338ca;border-radius:999px;padding:1px 8px;font-size:11px">${GRADE[at % 3]}</span></td></tr>`,
    )
    .join("");

const table = (count: number) =>
  `<table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb"><thead><tr style="background:#f3f4f6;text-align:left"><th style="padding:7px 10px">이름</th><th style="padding:7px 10px">연락처</th><th style="padding:7px 10px">등급</th></tr></thead><tbody>${rows(count)}</tbody></table>`;

const magnifier =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

const searchBox = (width: string) =>
  `<div style="display:flex;align-items:center;gap:7px;width:${width};padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#94a3b8;font-size:13px">${magnifier}<span>이름 · 연락처로 찾기</span></div>`;

const shell = (parts: { header?: string; side?: string; top?: string }) =>
  `<div style="color:#1f2937"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid #e5e7eb"><b style="font-size:15px">회원 목록</b>${parts.header ?? '<span style="font-size:12px;color:#9ca3af">총 128명</span>'}</div><div style="display:flex">${parts.side ?? ""}<div style="flex:1;min-width:0;padding:12px 14px">${parts.top ?? ""}${table(4)}</div></div></div>`;

const side = `<div style="width:118px;padding:12px;border-right:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#4b5563">${searchBox("100%")}<div style="margin-top:14px;display:grid;gap:7px"><span><b>전체</b></span><span>일반</span><span>우수</span><span>최우수</span></div></div>`;

const search: Question = {
  question: "회원 목록의 검색창을 어디에 둘까요?",
  header: "위치",
  multiSelect: false,
  options: [
    {
      label: "표 위에",
      description: "표 바로 위 한 줄에 둬요. 가장 눈에 잘 띄어요.",
      preview: shell({ top: `<div style="margin-bottom:10px">${searchBox("70%")}</div>` }),
    },
    {
      label: "화면 위쪽 머리에",
      description: "제목 오른쪽에 작게 둬요. 자리를 덜 차지해요.",
      preview: shell({ header: searchBox("46%") }),
    },
    {
      label: "왼쪽 옆 칸에",
      description: "옆 칸의 맨 위에 둬요. 걸러 보기와 함께 쓰기 좋아요.",
      preview: shell({ side }),
    },
  ],
};

const solid =
  'style="padding:8px 16px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:13px;font-weight:600"';
const outline =
  'style="padding:7px 15px;border:1.5px solid #2563eb;border-radius:8px;background:#fff;color:#2563eb;font-size:13px;font-weight:600"';
const text =
  'style="padding:8px 10px;border:0;background:transparent;color:#2563eb;font-size:13px;font-weight:600"';

const buttons = (primary: string, secondary: string) =>
  `<div style="color:#1f2937"><div style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;max-width:340px;margin:18px auto"><b style="font-size:15px">회원을 삭제할까요?</b><p style="margin:6px 0 16px;font-size:13px;color:#6b7280">삭제하면 되돌릴 수 없어요.</p><div style="display:flex;justify-content:flex-end;gap:8px"><button ${secondary}>취소</button><button ${primary}>삭제</button></div></div></div>`;

const button: Question = {
  question: "확인 창의 단추를 어떤 모양으로 할까요?",
  header: "단추",
  multiSelect: false,
  options: [
    {
      label: "색을 채운 단추",
      description: "가장 눈에 띄어요.",
      preview: buttons(solid, text),
    },
    {
      label: "테두리만 있는 단추",
      description: "차분하고 가벼워요.",
      preview: buttons(outline, text),
    },
    {
      label: "글자만 있는 단추",
      description: "가장 조용해요.",
      preview: buttons(text, text),
    },
  ],
};

const tile = (name: string) =>
  `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden"><div style="height:62px;background:linear-gradient(135deg,#c7d2fe,#fbcfe8)"></div><div style="padding:8px 10px"><b style="font-size:13px">${name}</b><div style="font-size:11px;color:#9ca3af">일반 · 2024.03</div></div></div>`;

const line = (name: string) =>
  `<div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid #e5e7eb"><div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#c7d2fe,#fbcfe8)"></div><div style="flex:1"><b style="font-size:13px">${name}</b><div style="font-size:11px;color:#9ca3af">일반 · 2024.03</div></div><span style="color:#9ca3af">›</span></div>`;

const card: Question = {
  question: "회원 카드는 어떻게 늘어놓을까요?",
  header: "배치",
  multiSelect: false,
  options: [
    {
      label: "사진을 위에 둔 격자",
      description: "한 줄에 셋씩. 사진이 먼저 눈에 들어와요.",
      preview: `<div style="padding:4px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${NAMES.slice(0, 3).map(tile).join("")}${NAMES.slice(2, 5).map(tile).join("")}</div>`,
    },
    {
      label: "한 줄에 하나씩 목록",
      description: "이름과 날짜를 나란히 읽기 좋아요.",
      preview: `<div style="border:1px solid #e5e7eb;border-radius:10px">${NAMES.map(line).join("")}</div>`,
    },
  ],
};

/** 악성 시안 — 실행 · 불러오기 · 이동을 시도하는 모든 길. `beacon` 에 닿는 요청이 하나라도 있으면 실패다. */
function evil(beacon: string): Question {
  const hit = (name: string) => `${beacon}/hit?via=${name}`;
  const nasty = [
    `<div style="padding:14px"><b>첫째 시안</b><p>스크립트와 외부 그림</p>`,
    `<script>window.parent.__askpPwn = "script"; fetch("${hit("fetch")}"); new Image().src = "${hit("image")}";</script>`,
    `<img src="${hit("img")}" onerror="window.parent.__askpPwn='onerror'" alt="">`,
    `<img src="x" onerror="fetch('${hit("onerror")}')" onload="fetch('${hit("onload")}')">`,
    `<base href="${beacon}/base/">`,
    `<link rel="stylesheet" href="${hit("link")}">`,
    `<meta http-equiv="refresh" content="0;url=${hit("refresh")}">`,
    `<style>@import url("${hit("import")}"); body{background:url(${hit("bodybg")})}</style>`,
    `<div style="width:60px;height:30px;background:url(${hit("cssbg")})">배경</div>`,
    `<iframe src="${hit("iframe")}"></iframe>`,
    `<object data="${hit("object")}"></object><embed src="${hit("embed")}">`,
    `<video poster="${hit("poster")}" src="${hit("video")}"></video>`,
    `<svg width="30" height="30" onload="fetch('${hit("svgload")}')"><image href="${hit("svgimage")}" width="30" height="30"/></svg>`,
    `<a href="javascript:window.parent.__askpPwn='href'">눌러 보세요</a>`,
    `<a href="${hit("anchor")}">바깥 링크</a>`,
    `<form action="${hit("form")}" method="post"><input name="x" value="1"><input type="submit" value="보내기" formaction="${hit("formaction")}"></form>`,
    `<details open ontoggle="fetch('${hit("toggle")}')"><summary>펼침</summary>안쪽</details>`,
    `<input autofocus onfocus="fetch('${hit("focus")}')" value="입력칸">`,
    `<p style="color:red">이 줄은 보여야 해요</p></div>`,
  ].join("");
  // 상한 안의 거대한 속성 — 카드가 깨지지 않아야 한다.
  const giant = `<div title="${"긴".repeat(18000)}" style="padding:14px"><b>둘째 시안</b><p>아주 긴 속성이 든 시안</p></div>`;
  // 상한(24,000자)을 넘는 시안 — 글 카드로 물러난다.
  const huge = `<div style="padding:14px"><b>셋째 시안</b>${"<p>많아요</p>".repeat(3000)}</div>`;
  return {
    question: "어느 시안으로 할까요? (악성 견본)",
    header: "견본",
    multiSelect: false,
    options: [
      {
        label: "스크립트와 외부 불러오기",
        description: "아무것도 실행되지 않아야 해요.",
        preview: nasty,
      },
      { label: "아주 긴 속성", description: "카드가 깨지지 않아야 해요.", preview: giant },
      { label: "너무 큰 시안", description: "상한을 넘어 글 카드로 서요.", preview: huge },
    ],
  };
}

/** `?preview=` 가 고르는 질문 — 값이 없으면 null(글 선택지 질문 그대로). */
export function askPreviewQuestion(
  mode: string | null,
  set: string | null,
  beacon: string,
): Question | null {
  if (!mode) return null;
  if (mode === "bad") return evil(beacon);
  const base = set === "button" ? button : set === "card" ? card : search;
  if (mode !== "mixed") return base;
  // 일부만 시안 — 둘째 선택지는 글 카드로 선다.
  return {
    ...base,
    options: base.options.map((option, at) =>
      at === 1 ? { ...option, preview: undefined } : option,
    ),
  };
}
