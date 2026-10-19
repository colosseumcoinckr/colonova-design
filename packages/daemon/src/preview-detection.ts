import { setTimeout as sleep } from "node:timers/promises";

interface DetectionOptions {
  candidates(): string[];
  scan(signal: AbortSignal): Promise<number[]>;
  probe(url: string, signal: AbortSignal, timeoutMs: number): Promise<"html" | "ok" | null>;
  active(): boolean;
  timeoutMs: number;
  pollMs?: number;
  scanIntervalMs?: number;
  /** 출력된 주소 한 번의 요청이 응답을 기다리는 상한. 기본 45초 — 첫 화면 컴파일을 기다린다. */
  probeTimeoutMs?: number;
  /** 조회로 찾은 포트의 요청 상한. 기본 15초 — HTTP 가 아닌 포트에 오래 붙잡히지 않는다. */
  scanProbeTimeoutMs?: number;
  /**
   * 서버가 주소를 출력한 뒤 첫 응답까지 더 주는 시간. 기본 180초. 기한은 출력 시각 + 이 값과
   * timeoutMs 중 늦은 쪽이다. 새 클론의 Windows 첫 컴파일은 출력 뒤 81초가 걸려 120초 기한에
   * 10초 남기고 겨우 통과했다(2026-10-19 실측). 주소를 못 찍는 서버는 그대로 timeoutMs 에 끝난다.
   */
  printedGraceMs?: number;
}

/**
 * 준비 판정의 요청은 끊고 다시 찌르지 않는다(2026-10-19 Windows 실측).
 * Next dev 의 첫 화면은 Windows 에서 5~10초 걸렸다. 옛 판정은 2초에 끊고 0.25초 뒤 다시 보냈다.
 * 서버는 버려진 요청까지 렌더해 도착률(주소 3개 × 초당 0.4) × 렌더 시간(5초 이상) > 1 이 되었고,
 * 줄이 끝없이 길어져 끝내 2초 안에 답하지 못했다(firstResponseMs:null, 준비 실패).
 * 그래서 주소마다 요청은 한 번에 하나이고, 남은 기한(상한 45초)까지 응답을 기다린다.
 */

/** 출력 주소 확인은 느린 Windows 조회를 기다리지 않는다(2026-10-19, 준비 지연 제보). */
export async function detectPreview(options: DetectionOptions) {
  const started = performance.now();
  const controller = new AbortController();
  const { signal } = controller;
  const pollMs = options.pollMs ?? 250;
  const scanIntervalMs = options.scanIntervalMs ?? 2_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 45_000;
  const scanProbeTimeoutMs = options.scanProbeTimeoutMs ?? 15_000;
  const printedGraceMs = options.printedGraceMs ?? 180_000;
  /** 지금의 기한(시작부터 ms) — 주소가 출력되면 컴파일 몫만큼 늘어난다. */
  const deadline = () =>
    firstAddressMs === null
      ? options.timeoutMs
      : Math.max(options.timeoutMs, firstAddressMs + printedGraceMs);
  /** 남은 기한 안에서의 요청 상한 — 기한을 넘겨 붙잡지 않는다. */
  const budget = (cap: number) =>
    Math.max(1, Math.min(cap, deadline() - (performance.now() - started)));
  let firstAddressMs: number | null = null;
  let firstResponseMs: number | null = null;
  let scans = 0;
  let scanMs = 0;
  let nextScan = started;
  let scanning = false;
  const probing = new Set<string>();
  let printed: string | null = null;
  let scanned: string | null = null;
  let fallback: string | null = null;
  const active = () => !signal.aborted && options.active();
  const probe = async (url: string, cap: number) => {
    try {
      const verdict = await options.probe(url, signal, budget(cap));
      if (active() && verdict !== null) firstResponseMs ??= Math.round(performance.now() - started);
      return verdict;
    } catch {
      return null;
    }
  };
  const result = (
    url: string | null,
    source: "printed" | "scan" | "fallback" | "timeout" | "stopped",
  ) => ({
    url,
    metrics: {
      source,
      elapsedMs: Math.round(performance.now() - started),
      firstAddressMs,
      firstResponseMs,
      scans,
      scanMs,
    },
  });
  const scan = async () => {
    scanning = true;
    scans += 1;
    const before = performance.now();
    try {
      const ports = await options.scan(signal);
      scanMs += Math.round(performance.now() - before);
      for (const port of ports) {
        for (const scheme of ["http", "https"]) {
          for (const host of ["127.0.0.1", "[::1]"]) {
            if (!active()) return;
            const url = `${scheme}://${host}:${port}/`;
            const verdict = await probe(url, scanProbeTimeoutMs);
            if (!active()) return;
            if (verdict === "html") {
              // 서버가 출력한 하위 경로가 응답하면 그 주소를 우선한다.
              for (const candidate of options.candidates()) {
                const parsed = new URL(candidate);
                const candidatePort = Number(
                  parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                );
                if (candidatePort !== port) continue;
                const response = await probe(candidate, scanProbeTimeoutMs);
                if (!active()) return;
                if (response !== null) {
                  scanned = candidate;
                  return;
                }
              }
              scanned = url;
              return;
            }
            if (verdict === "ok" && fallback === null) fallback = url;
          }
        }
      }
    } catch {
      // 보조 조회 실패는 다음 조회에서 다시 확인한다.
    } finally {
      scanning = false;
      nextScan = performance.now() + scanIntervalMs;
    }
  };
  const probePrinted = async (url: string) => {
    probing.add(url);
    try {
      const verdict = await probe(url, probeTimeoutMs);
      if (active() && verdict !== null && printed === null) printed = url;
    } finally {
      probing.delete(url);
    }
  };
  try {
    while (performance.now() - started < deadline()) {
      if (!active()) return result(null, "stopped");
      if (printed !== null) return result(printed, "printed");
      if (scanned !== null) return result(scanned, "scan");
      const candidates = options.candidates();
      if (candidates.length > 0) {
        firstAddressMs ??= Math.round(performance.now() - started);
        // 한 주소의 응답 지연이 다른 패밀리나 새 주소를 붙잡지 않는다.
        for (const url of candidates) {
          if (!probing.has(url)) void probePrinted(url);
        }
      }
      // 출력된 주소의 응답을 기다리는 동안에는 조회를 쉰다. Windows 의 PowerShell · netstat
      // 조회는 한 번에 수 초의 CPU 를 써 첫 화면 컴파일과 다펐다(120초 중 89초가 조회).
      if (!scanning && probing.size === 0 && performance.now() >= nextScan) void scan();
      await sleep(Math.min(pollMs, Math.max(1, deadline() - (performance.now() - started))));
    }
    if (!active()) return result(null, "stopped");
    if (printed !== null) return result(printed, "printed");
    if (scanned !== null) return result(scanned, "scan");
    return result(fallback, fallback === null ? "timeout" : "fallback");
  } finally {
    // 성공 뒤에 남은 PowerShell · netstat · HTTP 요청도 거둔다.
    controller.abort();
  }
}
