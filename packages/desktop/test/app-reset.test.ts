import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { assertResetPaths, finishPendingAppReset, requestAppReset } from "../src/app-reset.ts";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "colonova-reset-")));
  const paths = {
    dataDir: join(root, "home", ".colonova-design"),
    userData: join(root, "desktop"),
    home: join(root, "home"),
    appPath: join(root, "app"),
  };
  const put = (path: string, content = "keep") => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const active = join(paths.dataDir, "projects", "active", "repo");
  const forgotten = join(paths.dataDir, "projects", "forgotten", "repo");
  put(join(active, "screen.tsx"));
  put(join(forgotten, "screen.tsx"));
  put(
    join(paths.dataDir, "config", "projects.json"),
    JSON.stringify({ projects: [{ slug: "active" }] }),
  );
  put(join(paths.dataDir, "logs", "old.log"));
  put(join(paths.userData, "credentials.json"));
  put(join(paths.userData, "desktop-settings.json"));
  put(join(paths.home, ".claude", "credentials"));
  put(join(paths.home, ".codex", "auth.json"));
  return {
    paths,
    active,
    forgotten,
    put,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("초기화 요청 없이는 어떤 데이터도 지우지 않는다", async () => {
  const f = fixture();
  try {
    assert.equal(
      await finishPendingAppReset(
        f.paths,
        {},
        {
          eraseConversations: async () => assert.fail("must not erase"),
          clearBrowserData: async () => assert.fail("must not clear"),
        },
      ),
      false,
    );
    assert.ok(existsSync(f.active));
  } finally {
    f.dispose();
  }
});

test("재시작 전에는 보존하고, 다음 시작에서 잊힌 프로젝트까지 삭제하며 AI 로그인은 보존한다", async () => {
  const f = fixture();
  const erased: string[] = [];
  let cleared = false;
  try {
    requestAppReset(f.paths, {});
    assert.ok(existsSync(f.active), "확인 직후에는 실행 중인 파일을 지우지 않는다");
    assert.equal(
      await finishPendingAppReset(
        f.paths,
        {},
        {
          eraseConversations: async (cwd) => {
            erased.push(cwd);
          },
          clearBrowserData: async () => {
            cleared = true;
          },
        },
      ),
      true,
    );
    assert.ok(erased.includes(f.active));
    assert.ok(erased.includes(f.forgotten));
    assert.ok(cleared);
    assert.equal(existsSync(f.paths.dataDir), false);
    for (const name of ["credentials.json", "desktop-settings.json", "reset-pending"]) {
      assert.equal(existsSync(join(f.paths.userData, name)), false);
    }
    assert.equal(readFileSync(join(f.paths.home, ".claude", "credentials"), "utf8"), "keep");
    assert.equal(readFileSync(join(f.paths.home, ".codex", "auth.json"), "utf8"), "keep");
  } finally {
    f.dispose();
  }
});

test("정리 실패는 초기화 의도를 남기고 다음 실행에서 재시도한다", async () => {
  const f = fixture();
  try {
    requestAppReset(f.paths, {});
    await assert.rejects(
      finishPendingAppReset(
        f.paths,
        {},
        {
          eraseConversations: async () => {
            throw new Error("locked history");
          },
          clearBrowserData: async () => assert.fail("must stop on failure"),
        },
      ),
      /locked history/,
    );
    assert.ok(existsSync(join(f.paths.userData, "reset-pending")));
    assert.ok(existsSync(f.active));
    assert.equal(
      await finishPendingAppReset(
        f.paths,
        {},
        {
          eraseConversations: async () => {},
          clearBrowserData: async () => {},
        },
      ),
      true,
    );
  } finally {
    f.dispose();
  }
});

test("앱 폴더 안의 심볼릭 링크가 가리키는 외부 프로젝트·대화는 지우지 않는다", async () => {
  const f = fixture();
  try {
    const outside = join(f.paths.home, "my-other-project");
    f.put(join(outside, "screen.tsx"));
    symlinkSync(outside, join(f.paths.dataDir, "projects", "external"), "dir");
    mkdirSync(join(f.paths.dataDir, "projects", "linked-clone"));
    symlinkSync(outside, join(f.paths.dataDir, "projects", "linked-clone", "repo"), "dir");
    const erased: string[] = [];
    requestAppReset(f.paths, {});
    await finishPendingAppReset(
      f.paths,
      {},
      {
        eraseConversations: async (cwd) => {
          erased.push(cwd);
        },
        clearBrowserData: async () => {},
      },
    );
    assert.ok(!erased.includes(outside));
    assert.equal(readFileSync(join(outside, "screen.tsx"), "utf8"), "keep");
  } finally {
    f.dispose();
  }
});

test("홈·앱·설정 폴더와 개발용 외부 경로는 초기화 대상으로 허용하지 않는다", () => {
  const f = fixture();
  try {
    for (const dataDir of [
      f.paths.home,
      f.paths.userData,
      f.paths.appPath,
      dirname(f.paths.home),
      join(f.paths.home, ".codex"),
    ]) {
      assert.throws(() => assertResetPaths({ ...f.paths, dataDir }, {}));
    }
    assert.throws(() => requestAppReset(f.paths, { COLONOVA_DESIGN_REPO_DIR: f.paths.home }));
    assert.equal(existsSync(join(f.paths.userData, "reset-pending")), false);
    assert.ok(existsSync(f.active));
  } finally {
    f.dispose();
  }
});

test("재시작 때 데이터 위치가 달라지면 확인하지 않은 폴더를 지우지 않는다", async () => {
  const f = fixture();
  try {
    requestAppReset(f.paths, {});
    const changed = { ...f.paths, dataDir: join(f.paths.home, "other", ".colonova-design") };
    f.put(join(changed.dataDir, "keep"));
    await assert.rejects(
      finishPendingAppReset(
        changed,
        {},
        {
          eraseConversations: async () => assert.fail("unconfirmed path"),
          clearBrowserData: async () => assert.fail("unconfirmed path"),
        },
      ),
      /위치가 달라/,
    );
    assert.ok(existsSync(join(changed.dataDir, "keep")));
    assert.ok(existsSync(f.active));
  } finally {
    f.dispose();
  }
});
