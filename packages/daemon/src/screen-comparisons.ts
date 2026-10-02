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
