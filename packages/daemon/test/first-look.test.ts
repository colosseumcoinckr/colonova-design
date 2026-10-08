import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestRouter } from "../dist/dispatch.js";
import { PreviewDrivers } from "../dist/preview-drivers.js";

/**
 * 서비스의 첫 화면 사진(2026-10-07 베타 준비 분석 · 첫 5분) — 준비가 끝난 순간의 한 장. 사진은 있으면 좋은 것이라 모든
 * 실패는 조용한 null 이고(부른 쪽은 사진 없이 그린다 — 깨진 그림을 세우지 않는다), 숨은 창은 어떤 길로 끝나도 닫힌다.
 */

type Open = { ok: boolean; settled?: boolean; blank?: boolean };
interface Shot {
  data: string;
  mediaType: string;
}

/** 가짜 창 — 열기 · 찍기의 답을 정하고, 몇 번 열었고 닫았는지 센다. */
function scene(options: {
  open?: Open | (() => Promise<Open>);
  shot?: Shot;
  noFactory?: boolean;
  cloned?: boolean;
  previewUrl?: string | null;
}) {
  const calls = { opened: [] as string[], destroyed: 0, created: 0 };
  const drivers = new PreviewDrivers({
    factory: () =>
      options.noFactory
        ? undefined
        : {
            forIsolated: () => {
              calls.created += 1;
              return {
                open: async (route: string) => {
                  calls.opened.push(route);
                  const answer = options.open ?? { ok: true, settled: true, blank: false };
                  return typeof answer === "function"
                    ? answer()
                    : { settled: true, blank: false, ...answer };
                },
                screenshot: async () => options.shot ?? { data: "QUJD", mediaType: "image/jpeg" },
                consoleLines: async () => [],
                destroy: async () => {
                  calls.destroyed += 1;
                },
              };
            },
          },
    activeRepo: () =>
      ({
        isCloned: () => options.cloned !== false,
        status: async () => ({
          previewUrl:
            options.previewUrl === undefined ? "http://127.0.0.1:5173/" : options.previewUrl,
        }),
      }) as never,
    session: () => undefined,
    sessions: () => [],
    notice: () => undefined,
  });
  return { drivers, calls };
}

test("찍을 수 있으면 한 장을 돌려주고 숨은 창을 닫는다", async () => {
  const { drivers, calls } = scene({});
  const look = await drivers.captureFirstLook("/members");
  assert.equal(look?.mediaType, "image/jpeg");
  assert.equal(look?.data, "QUJD");
  assert.ok(look && Date.parse(look.at) > 0);
  assert.deepEqual(calls.opened, ["/members"]);
  assert.equal(calls.destroyed, 1, "창은 어떤 길로 끝나도 닫는다");
});

test("드라이버가 없거나 · 클론이 없거나 · 서버가 안 떠 있으면 null — 창을 열지 않는다", async () => {
  for (const options of [{ noFactory: true }, { cloned: false }, { previewUrl: null }]) {
    const { drivers, calls } = scene(options);
    assert.equal(await drivers.captureFirstLook("/"), null);
    assert.equal(calls.created, 0);
  }
});

test("열지 못했거나 · 다 로드되지 않았거나 · 비어 보이는 화면은 사진 없이 간다", async () => {
  for (const open of [
    { ok: false },
    { ok: true, settled: false },
    { ok: true, settled: true, blank: true },
  ]) {
    const { drivers, calls } = scene({ open });
    assert.equal(await drivers.captureFirstLook("/"), null, JSON.stringify(open));
    assert.equal(calls.destroyed, 1);
  }
});

test("그릴 수 없는 사진은 쓰지 않는다 — 형식이 다르거나 비었거나 너무 크면 null", async () => {
  for (const shot of [
    { data: "QUJD", mediaType: "image/gif" },
    { data: "QUJD", mediaType: "text/html" },
    { data: "", mediaType: "image/png" },
    { data: "A".repeat(1024 * 1024 + 1), mediaType: "image/png" },
  ]) {
    const { drivers } = scene({ shot });
    assert.equal(await drivers.captureFirstLook("/"), null, shot.mediaType + shot.data.length);
  }
  const { drivers } = scene({ shot: { data: "A".repeat(1024 * 1024), mediaType: "image/webp" } });
  assert.equal((await drivers.captureFirstLook("/"))?.mediaType, "image/webp", "한도 안은 쓴다");
});

test("창이 던져도 조용히 null 이고 닫는다", async () => {
  const { drivers, calls } = scene({
    open: async () => {
      throw new Error("window crashed");
    },
  });
  assert.equal(await drivers.captureFirstLook("/"), null);
  assert.equal(calls.destroyed, 1);
});

test("겹쳐 부르면 한 장을 나눠 갖는다 — 숨은 창은 하나만 연다", async () => {
  let release: (open: Open) => void = () => undefined;
  let opens = 0;
  const { drivers, calls } = scene({
    // 첫 열기만 붙들어 두고, 끝난 뒤의 새 부름은 곧바로 열린다.
    open: () => {
      opens += 1;
      return opens === 1
        ? new Promise<Open>((resolve) => (release = resolve))
        : Promise.resolve({ ok: true, settled: true, blank: false });
    },
  });
  const first = drivers.captureFirstLook("/");
  const second = drivers.captureFirstLook("/");
  // 이어서 부른 길은 서버 상태를 읽은 뒤에 합류한다 — 한 틱 양보한다.
  await new Promise((resolve) => setImmediate(resolve));
  release({ ok: true, settled: true, blank: false });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls.created, 1);
  assert.ok(a);
  assert.deepEqual(a, b);
  // 끝난 뒤의 새 부름은 새로 찍는다.
  assert.ok(await drivers.captureFirstLook("/"));
  assert.equal(calls.created, 2);
});

test("시간(8초)을 넘기면 사진 없이 가고 숨은 창을 닫는다 — 처음 켠 서버가 컴파일에 붙들려도 오래 기다리지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { drivers, calls } = scene({ open: () => new Promise<Open>(() => undefined) });
  const pending = drivers.captureFirstLook("/");
  // 서버 상태를 읽고 창을 여는 데까지 마이크로태스크를 비운다.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.created, 1);
  assert.equal(calls.destroyed, 0, "아직 기다리는 중이다");
  t.mock.timers.tick(7_999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.destroyed, 0);
  t.mock.timers.tick(1);
  assert.equal(await pending, null);
  assert.equal(calls.destroyed, 1);
});

test("repo.firstLook: 읽어 둔 첫 화면의 주소를 열고, 모르면 루트 · 이상한 주소는 루트로", async () => {
  const opened: string[] = [];
  const answerFor = (path: string | null) =>
    new RequestRouter({
      fleet: {
        requireActive: () => ({ slug: "member", paths: { root: "/x" } }),
        firstScreenOf: () => (path === null ? null : { path, title: "t" }),
      },
      previewDrivers: {
        captureFirstLook: async (route: string) => {
          opened.push(route);
          return { at: "2026-10-07T00:00:00.000Z", mediaType: "image/png", data: "QUJD" };
        },
      },
    } as never);

  const first = await answerFor("/dashboard").dispatch({ id: "a", type: "repo.firstLook" });
  assert.deepEqual(first, {
    route: "/dashboard",
    image: { at: "2026-10-07T00:00:00.000Z", mediaType: "image/png", data: "QUJD" },
  });
  assert.equal(
    (await answerFor(null).dispatch({ id: "b", type: "repo.firstLook" })) !== null,
    true,
  );
  await answerFor("//evil.example/x").dispatch({ id: "c", type: "repo.firstLook" });
  await answerFor("/members?tab=2#top").dispatch({ id: "d", type: "repo.firstLook" });
  assert.deepEqual(opened, ["/dashboard", "/", "/", "/members"]);
});
