import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScreenComparison } from "@colonova-design/protocol";
import { screenPathOf } from "./cycle-screens.js";
import type { PreviewDriverFactory } from "./preview-driver.js";

type Picture = NonNullable<ScreenComparison["before"]>;
interface Pending {
  requestId: string;
  sessionId: string;
  head: string | null;
  root: string;
  before: Map<string, Picture>;
}
const MAX_ROUTES = 4;
const MAX_REQUESTS = 40;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
const CAPTURE_BUDGET_MS = 6_000;
const folder = (root: string) => join(root, "screen-comparisons");
const fileOf = (root: string, requestId: string, route: string) =>
  join(folder(root), `${createHash("sha256").update(`${requestId}\0${route}`).digest("hex")}.json`);

/** Pictures are local project data, outside the working copy. A failed capture never blocks a request. */
async function pictures(
  factory: PreviewDriverFactory | undefined,
  url: string | null,
  routes: string[],
): Promise<Map<string, Picture>> {
  const result = new Map<string, Picture>();
  if (!factory || !url) return result;
  const driver = factory.forIsolated(url);
  let cancelled = false;
  let timer: NodeJS.Timeout | undefined;
  const job = (async () => {
    for (const route of routes.slice(0, MAX_ROUTES)) {
      if (cancelled) break;
      const opened = await driver.open(route, { viewport: "desktop", colorScheme: "light" });
      if (cancelled || !opened.ok || !opened.settled || opened.blank) continue;
      const shot = await driver.screenshot({ longEdge: 1200 });
      if (
        !cancelled &&
        /^image\/(png|jpeg|webp)$/.test(shot.mediaType) &&
        shot.data.length <= MAX_PICTURE_BYTES
      ) {
        result.set(route, { ...shot, at: new Date().toISOString() });
      }
    }
  })().catch(() => undefined);
  try {
    await Promise.race([
      job,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CAPTURE_BUDGET_MS);
      }),
    ]);
  } finally {
    cancelled = true;
    clearTimeout(timer);
    void driver.destroy().catch(() => undefined);
  }
  return result;
}

/**
 * 수정 전 사진을 찍을 길의 차례(2026-10-06). 사진은 앞 `MAX_ROUTES` 장까지라 차례가 곧 우선순위다 —
 * 사용자가 가리킨 화면(핀) · 지금 보던 화면(`viewing`) · 최근에 고쳐진 화면(관찰 지도) · 루트. 예전에는
 * 보던 화면이 없어서, 처음 만지는 화면을 말로만 부탁하면 그 화면의 수정 전 사진이 비었다. 같은 화면을
 * 한 번만 세는 일은 `begin` 이 한다(표기가 달라도 같은 경로면 같은 화면이다).
 *
 * 보던 경로는 쿼리와 해시를 뗀다 — `finish` 는 바뀐 화면의 경로(쿼리 없음)와 같은 열쇠로만 수정 전 사진을
 * 짝짓는다. `/members?tab=2` 로 찍으면 사진은 있어도 짝을 못 찾는다.
 */
export function beforeRoutes(input: {
  pins: ReadonlyArray<{ screen: string }>;
  viewing?: { path: string } | undefined;
  known: readonly string[];
}): string[] {
  const viewing = input.viewing?.path.split(/[?#]/, 1)[0] ?? "";
  return [
    ...input.pins.map((pin) => pin.screen),
    ...(viewing !== "" ? [viewing] : []),
    ...input.known,
    "/",
  ];
}

export class ScreenComparisons {
  private pending = new Map<string, Pending>();
  private key(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }
  async begin(input: {
    root: string;
    sessionId: string;
    requestId: string;
    head: string | null;
    routes: string[];
    url: string | null;
    factory?: PreviewDriverFactory;
  }): Promise<void> {
    const state: Pending = { ...input, before: new Map() };
    // Keep only recent requests; a new queued request must not replace the save still finishing.
    if (this.pending.size >= 16) this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(this.key(input.sessionId, input.requestId), state);
    const routes = [
      ...new Set(
        input.routes
          .map((route) => screenPathOf(route, input.url ? new URL(input.url).origin : null))
          .filter((route): route is string => route !== null),
      ),
    ];
    state.before = await pictures(input.factory, input.url, routes);
  }
  cancel(sessionId: string): void {
    for (const [key, item] of this.pending)
      if (item.sessionId === sessionId) this.pending.delete(key);
  }
  async finish(input: {
    sessionId: string;
    requestId: string;
    sha: string | null;
    screens: Array<{ route: string; title: string }>;
    url: string | null;
    factory?: PreviewDriverFactory;
  }): Promise<void> {
    const key = this.key(input.sessionId, input.requestId);
    const state = this.pending.get(key);
    this.pending.delete(key);
    if (!state || !input.sha || input.sha === state.head || input.screens.length === 0) return;
    const screens = input.screens.slice(0, MAX_ROUTES);
    const after = await pictures(
      input.factory,
      input.url,
      screens.map((screen) => screen.route),
    );
    await mkdir(folder(state.root), { recursive: true, mode: 0o700 });
    for (const screen of screens) {
      const record: ScreenComparison = {
        requestId: state.requestId,
        sessionId: state.sessionId,
        sha: input.sha,
        route: screen.route,
        title: screen.title,
        viewport: "desktop",
        before: state.before.get(screen.route) ?? null,
        after: after.get(screen.route) ?? null,
      };
      const file = fileOf(state.root, state.requestId, screen.route);
      await writeFile(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    }
    await pruneComparisons(state.root);
  }
}

export async function readComparison(
  root: string,
  input: { route: string; requestId?: string; sha?: string },
): Promise<ScreenComparison | null> {
  const route = screenPathOf(input.route, null);
  if (!route || (!input.requestId && !input.sha)) return null;
  const files = input.requestId
    ? [fileOf(root, input.requestId, route)]
    : (await readdir(folder(root)).catch(() => []))
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(folder(root), file));
  for (const file of files) {
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as ScreenComparison;
      if (
        data.route === route &&
        (!input.requestId || data.requestId === input.requestId) &&
        (!input.sha || data.sha === input.sha)
      )
        return data;
    } catch {
      /* A missing, pruned or interrupted picture is not an error. */
    }
  }
  return null;
}

export async function pruneComparisons(root: string): Promise<void> {
  const dir = folder(root);
  const records = (
    await Promise.all(
      (
        await readdir(dir).catch(() => [])
      )
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const path = join(dir, file);
          try {
            const [info, text] = await Promise.all([stat(path), readFile(path, "utf8")]);
            return {
              path,
              size: info.size,
              at: info.mtimeMs,
              request: (JSON.parse(text) as ScreenComparison).requestId,
            };
          } catch {
            await rm(path, { force: true });
            return null;
          }
        }),
    )
  ).filter(
    (item): item is { path: string; size: number; at: number; request: string } => item !== null,
  );
  records.sort((a, b) => b.at - a.at);
  const kept = new Set<string>();
  const removed = new Set<string>();
  let bytes = 0;
  for (const item of records) {
    if (
      removed.has(item.request) ||
      (!kept.has(item.request) && kept.size >= MAX_REQUESTS) ||
      bytes + item.size > MAX_BYTES
    ) {
      removed.add(item.request);
    } else {
      kept.add(item.request);
      bytes += item.size;
    }
  }
  await Promise.all(
    records
      .filter((item) => removed.has(item.request))
      .map((item) => rm(item.path, { force: true })),
  );
}
