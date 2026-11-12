import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// 2026-11-12 TAIL — 브라우저 시험은 빈 포트와 개별 캐시를 쓰고 자신이 연 서버만 닫는다.
const require = createRequire(import.meta.url);
export let chromium = null;
try {
  ({ chromium } = require(join(homedir(), ".local/lib/node_modules/playwright")));
} catch {}

export async function startBrowserFixture(port = 0) {
  const cacheRoot = mkdtempSync(join(tmpdir(), "colonova-cold-"));
  const cacheDir = join(cacheRoot, "node_modules/.vite");
  const http = createHttpServer();
  const server = await createServer({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    cacheDir,
    optimizeDeps: { include: ["react", "react-dom/client"] },
    server: {
      host: "127.0.0.1",
      middlewareMode: true,
      hmr: { server: http },
      fs: {
        allow: [
          fileURLToPath(new URL("../../../..", import.meta.url)),
          realpathSync(fileURLToPath(new URL("../../../../node_modules", import.meta.url))),
          cacheDir,
        ],
      },
    },
  });
  http.on("request", server.middlewares);
  const close = async () => {
    await server.close();
    http.closeAllConnections();
    if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    rmSync(cacheRoot, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, "127.0.0.1", resolve);
    });
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("fixture address unavailable");
    return {
      url: `http://127.0.0.1:${address.port}`,
      imports: {
        react: `/@fs${cacheDir}/deps/react.js`,
        dom: `/@fs${cacheDir}/deps/react-dom_client.js`,
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
