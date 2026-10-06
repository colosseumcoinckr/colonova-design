// 오버레이의 진짜 출력이 문지기를 지나가는가(2026-10-06). 문지기 시험은 손으로 쓴 봉투만 먹여서,
// `attrs.classes` 가 문자열 배열인 것을 몰랐다 — 클래스가 하나라도 있는 요소의 핀이 말없이 사라졌다.
// 여기서는 오버레이가 쓰는 함수(`describeElementInPage`)를 그대로 가짜 DOM 위에서 돌려, 나온 값을
// 봉투에 담아 문지기에 먹인다. 오버레이의 출력이 바뀌어도 이 시험이 같은 구멍을 먼저 잡는다.
// 진짜 Electron 창이 아니면 레이아웃이 없으므로 좌표는 고정값이다(a11y-probe.test.ts 와 같은 사정).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { describeElementInPage } from "../src/element-identity.ts";
import { readPinEnvelope } from "../src/pin-envelope.ts";

class FakeNode {
  static readonly ELEMENT_NODE = 1;
  static readonly TEXT_NODE = 3;
  nodeType = 0;
  parentElement: FakeElement | null = null;
  textContent: string | null = null;
}

class FakeText extends FakeNode {
  constructor(text: string) {
    super();
    this.nodeType = 3;
    this.textContent = text;
  }
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly attrs: Record<string, string>;
  readonly computed: Record<string, string>;
  readonly childNodes: FakeNode[] = [];

  // 매개변수 속성(`readonly x`)은 node 의 타입 제거 모드가 못 읽는다 — 필드를 풀어 쓴다.
  constructor(
    tag: string,
    attrs: Record<string, string> = {},
    computed: Record<string, string> = {},
    children: Array<FakeNode | string> = [],
  ) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.computed = computed;
    for (const child of children)
      this.append(typeof child === "string" ? new FakeText(child) : child);
  }

  append(child: FakeNode): void {
    child.parentElement = this;
    this.childNodes.push(child);
  }

  get id(): string {
    return this.attrs.id ?? "";
  }

  get classList(): string[] {
    return (this.attrs.class ?? "").split(/\s+/).filter(Boolean);
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }

  getAttribute(name: string): string | null {
    return name in this.attrs ? (this.attrs[name] ?? null) : null;
  }

  closest(selector: string): FakeElement | null {
    const tags = selector.split(",").map((part) => part.trim().toUpperCase());
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      if (tags.includes(node.tagName)) return node;
    }
    return null;
  }

  get innerText(): string {
    return this.childNodes
      .map((node) => (node instanceof FakeElement ? node.innerText : (node.textContent ?? "")))
      .join(" ");
  }

  cloneNode(): FakeElement {
    return this;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }

  get outerHTML(): string {
    const attrs = Object.entries(this.attrs)
      .map(([key, value]) => ` ${key}="${value}"`)
      .join("");
    const tag = this.tagName.toLowerCase();
    const inner = this.childNodes
      .map((node) => (node instanceof FakeElement ? node.outerHTML : (node.textContent ?? "")))
      .join("");
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }

  getBoundingClientRect(): { x: number; y: number; width: number; height: number } {
    return { x: 10.4, y: 20.6, width: 100.2, height: 40.5 };
  }
}

const body = new FakeElement("body");
const globals = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};

before(() => {
  const fakes = {
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    document: { body },
    window: {
      getComputedStyle: (element: FakeElement) => ({
        getPropertyValue: (key: string) => element.computed[key] ?? "",
      }),
    },
  };
  for (const [key, value] of Object.entries(fakes)) {
    saved[key] = globals[key];
    globals[key] = value;
  }
});

after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
});

/** body > main > section > <target> — 구획 안의 요소 하나를 오버레이가 읽은 그대로 봉투에 담는다. */
function pinOf(target: FakeElement, screen = "회원 관리") {
  const section = new FakeElement("section", {}, {}, ["이름으로 찾기", target]);
  const main = new FakeElement("main", {}, {}, [section]);
  body.childNodes.length = 0;
  body.append(main);
  const element = describeElementInPage(target);
  assert.ok(element, "오버레이가 요소를 읽는다");
  return {
    element,
    envelope: { type: "colonova-design.pin", pin: { id: "b3a9c1e0-1111-4bbb", screen, element } },
  };
}

test("오버레이 출력: 클래스가 있는 요소의 핀이 문지기를 지나간다 — 회귀(2026-10-06)", () => {
  const button = new FakeElement(
    "button",
    {
      class: "inline-flex items-center rounded-md px-4 py-2 text-sm font-medium bg-blue-600",
      "data-testid": "save",
      "aria-label": "저장",
      type: "submit",
    },
    { color: "rgb(255, 255, 255)", "font-size": "14px", display: "inline-flex" },
    ["저장"],
  );
  const { element, envelope } = pinOf(button);
  // 이 시험이 구멍을 겨누는지: 오버레이의 출력에 배열 칸이 실제로 있다.
  assert.ok(Array.isArray(element.attrs?.classes), "attrs.classes 는 문자열 배열이다");
  assert.equal(element.attrs?.classes?.length, 5, "오버레이는 클래스를 다섯 개까지 싣는다");

  const read = readPinEnvelope(envelope);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(read.envelope.pin.element.attrs?.classes, element.attrs?.classes);
  assert.equal(read.envelope.pin.element.attrs?.testId, "save");
  assert.equal(read.envelope.pin.element.a11y?.name, "저장");
});

test("오버레이 출력: 긴 font-family · 긴 title 이 핀을 죽이지 않고 칸만 잘린다", () => {
  const stack = Array.from({ length: 20 }, (_, i) => `"Noto Sans KR Variable ${i}"`).join(", ");
  assert.ok(stack.length > 400, "글꼴 목록이 문지기의 한계(200)를 넘는 만큼 길다");
  const heading = new FakeElement(
    "h2",
    { title: "가".repeat(900) },
    { "font-family": stack, color: "rgb(0, 0, 0)" },
    ["회원 목록"],
  );
  const { envelope } = pinOf(heading);
  const read = readPinEnvelope(envelope);
  assert.equal(read.ok, true, "보강 칸이 커서 핀을 버리면 안 된다");
  if (!read.ok) return;
  const target = read.envelope.pin.element;
  assert.equal(target.styles?.["font-family"]?.length, 200);
  assert.equal(target.a11y?.name?.length, 300);
  assert.equal(target.text, "회원 목록", "핀의 정체(글자)는 그대로다");
});

test("오버레이 출력: 클래스도 속성도 없는 요소와 링크 · 입력 속성이 있는 요소", () => {
  const plain = new FakeElement("div", {}, {}, ["안내"]);
  assert.equal(readPinEnvelope(pinOf(plain).envelope).ok, true);

  const link = new FakeElement(
    "a",
    { href: `/members?${"q=".repeat(200)}`, class: "link", name: "go" },
    {},
    ["더 보기"],
  );
  const read = readPinEnvelope(pinOf(link).envelope);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.envelope.pin.element.attrs?.name, "go");
  assert.equal(read.envelope.pin.element.component, "a");
});
