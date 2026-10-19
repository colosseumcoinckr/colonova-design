import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { probePreviewUrl } from "../dist/preview-claim.js";
import { detectPreview } from "../dist/preview-detection.js";

const address = "http://127.0.0.1:43123/app";
const timing = { timeoutMs: 1_000, pollMs: 5, scanIntervalMs: 20 };

test("느린 프로세스 조회 중 출력된 주소로 준비를 끝내고 조회를 취소한다", async () => {
  let candidates: string[] = [];
  let aborted = false;
  let scans = 0;
  const result = await detectPreview({
    ...timing,
    candidates: () => candidates,
    active: () => true,
    scan: (signal) => {
      scans += 1;
      candidates = [address];
      return new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve([]);
          },
          { once: true },
        );
      });
    },
    probe: async () => "html",
  });
  assert.equal(result.url, address);
  assert.equal(result.metrics.source, "printed");
  assert.equal(scans, 1);
  assert.equal(aborted, true);
  assert.equal(typeof result.metrics.firstAddressMs, "number");
  assert.equal(typeof result.metrics.firstResponseMs, "number");
  assert.doesNotMatch(JSON.stringify(result.metrics), /http|app/);
});

test("주소가 없는 서버도 조회로 찾고 API 포트보다 HTML 포트를 고른다", async () => {
  const result = await detectPreview({
    ...timing,
    candidates: () => [],
    active: () => true,
    scan: async () => [43122, 43123],
    probe: async (url) => (url.includes(":43123/") ? "html" : "ok"),
  });
  assert.equal(result.url, "http://127.0.0.1:43123/");
  assert.equal(result.metrics.source, "scan");
});

test("스캔이 먼저 응답해도 출력된 하위 경로를 보존한다", async () => {
  const result = await detectPreview({
    ...timing,
    candidates: () => [address],
    active: () => true,
    scan: async () => [43123],
    probe: async () => "html",
  });
  assert.equal(result.url, address);
});

test("조회 실패 뒤 재시도는 겹치지 않고 완료 후 간격을 둔다", async () => {
  let scans = 0;
  let running = 0;
  let ended = 0;
  const result = await detectPreview({
    ...timing,
    candidates: () => [],
    active: () => true,
    scan: async () => {
      assert.equal(running++, 0);
      if (ended) assert.ok(performance.now() - ended >= timing.scanIntervalMs);
      await sleep(15);
      running -= 1;
      ended = performance.now();
      if (++scans === 1) throw new Error("temporary");
      return [43123];
    },
    probe: async () => "html",
  });
  assert.equal(result.metrics.source, "scan");
  assert.equal(scans, 2);
});

test("준비 전 출력한 주소는 다시 확인하고 다른 패밀리의 응답을 기다리지 않는다", async () => {
  let attempts = 0;
  const result = await detectPreview({
    ...timing,
    candidates: () => [address, "http://[::1]:43123/app"],
    active: () => true,
    scan: async () => [],
    probe: async (url, signal) => {
      if (url === address) {
        await sleep(1_000, undefined, { signal }).catch(() => {});
        return null;
      }
      attempts += 1;
      return "html";
    },
  });
  assert.equal(result.url, "http://[::1]:43123/app");
  assert.equal(attempts, 1);
});

test("출력 주소의 일시적인 실패는 영구 제외하지 않는다", async () => {
  let attempts = 0;
  const result = await detectPreview({
    ...timing,
    candidates: () => [address],
    active: () => true,
    scan: async () => [],
    probe: async () => (++attempts < 3 ? null : "html"),
  });
  assert.equal(result.url, address);
  assert.equal(attempts, 3);
});

test("프로젝트가 바뀌면 늦게 끝난 조회로 다음 검사를 시작하지 않는다", async () => {
  let active = true;
  let finish!: (ports: number[]) => void;
  let probes = 0;
  const result = await detectPreview({
    ...timing,
    candidates: () => [],
    active: () => active,
    scan: async () => {
      active = false;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    probe: async () => {
      probes += 1;
      return "html";
    },
  });
  assert.equal(result.metrics.source, "stopped");
  finish([43123]);
  await sleep(10);
  assert.equal(probes, 0);
});

test("기한에는 비 HTML 응답을 대신 쓰고 응답도 없으면 실패한다", async () => {
  for (const verdict of ["ok", null] as const) {
    const result = await detectPreview({
      ...timing,
      timeoutMs: 40,
      candidates: () => [],
      active: () => true,
      scan: async () => [43123],
      probe: async () => verdict,
    });
    assert.equal(result.metrics.source, verdict ? "fallback" : "timeout");
    assert.equal(result.url, verdict ? "http://127.0.0.1:43123/" : null);
  }
});

test("실제 HTTP 응답으로 준비를 판정하고 응답 없는 요청을 취소한다", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/slow") return;
    response.setHeader("content-type", "text/html");
    response.end("<html></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  const base = `http://127.0.0.1:${bound.port}`;
  let slow: Promise<"html" | "ok" | null> | undefined;
  try {
    const result = await detectPreview({
      ...timing,
      candidates: () => [`${base}/slow`, `${base}/app`],
      active: () => true,
      scan: async () => [],
      probe: (url, signal) => {
        const pending = probePreviewUrl(url, signal);
        if (url.endsWith("/slow")) slow = pending;
        return pending;
      },
    });
    assert.equal(result.url, `${base}/app`);
    assert.equal(await slow, null);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("첫 렌더가 2초보다 느린 서버도 한 요청으로 기다려 찾는다 — 끊고 다시 찌르지 않는다(Windows 실측 2026-10-19)", async () => {
  // Windows 의 Next dev 첫 화면은 5~10초 걸렸다. 2초에 끊고 다시 찌르면 서버는 버려진
  // 요청까지 렌더해 줄이 길어지고, 끝내 2초 안에 답하지 못했다(firstResponseMs:null).
  let requests = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    setTimeout(() => {
      inFlight -= 1;
      response.setHeader("content-type", "text/html");
      response.end("<html></html>");
    }, 2_500);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  const url = `http://127.0.0.1:${bound.port}/`;
  let scans = 0;
  try {
    const result = await detectPreview({
      ...timing,
      timeoutMs: 8_000,
      candidates: () => [url],
      active: () => true,
      scan: async () => {
        scans += 1;
        return [];
      },
      probe: probePreviewUrl,
    });
    assert.equal(result.url, url);
    assert.equal(result.metrics.source, "printed");
    assert.equal(requests, 1);
    assert.equal(maxInFlight, 1);
    // 출력된 주소를 기다리는 동안에는 무거운 프로세스 조회를 되풀이하지 않는다.
    assert.ok(scans <= 1, `scans=${scans}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("주소를 출력한 서버는 기본 기한을 넘겨도 컴파일 몫만큼 더 기다린다 — 출력 없는 서버는 그대로 끝난다", async () => {
  const started = performance.now();
  const printed = await detectPreview({
    ...timing,
    timeoutMs: 200,
    printedGraceMs: 1_000,
    candidates: () => [address],
    active: () => true,
    scan: async () => [],
    // 첫 컴파일처럼 기본 기한(200ms)을 넘겨 답한다.
    probe: async () => (performance.now() - started > 500 ? "html" : null),
  });
  assert.equal(printed.url, address);
  assert.ok(printed.metrics.elapsedMs >= 500);

  const silent = await detectPreview({
    ...timing,
    timeoutMs: 200,
    printedGraceMs: 1_000,
    candidates: () => [],
    active: () => true,
    scan: async () => [],
    probe: async () => "html",
  });
  assert.equal(silent.metrics.source, "timeout");
  assert.ok(silent.metrics.elapsedMs < 500, `elapsed=${silent.metrics.elapsedMs}`);
});

test("조회가 끝나지 않아도 기한에 끝나고 취소한다", async () => {
  let aborted = false;
  const result = await detectPreview({
    ...timing,
    timeoutMs: 40,
    candidates: () => [],
    active: () => true,
    scan: (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve([]);
          },
          { once: true },
        );
      }),
    probe: async () => null,
  });
  assert.equal(result.metrics.source, "timeout");
  assert.equal(aborted, true);
});
