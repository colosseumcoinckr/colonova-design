import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RequestRouter } from "../dist/dispatch.js";
import { ProjectRegistry } from "../dist/projects.js";

/** 실제 원장과 임시 클론으로 요청 경계를 확인한다. 외부 프로세스는 띄우지 않는다. */
function projectScene(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "colonova-requests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = ProjectRegistry.load({
    COLONOVA_DESIGN_PROJECTS_SETTINGS: join(root, "projects.json"),
    COLONOVA_DESIGN_PROJECTS_DIR: join(root, "projects"),
  });
  const first = registry.create({ name: "first", repoUrl: "https://github.com/org/first.git" });
  const second = registry.create({ name: "second", repoUrl: "https://github.com/org/second.git" });
  const calls: string[] = [];
  const workspaces = new Map(
    [first, second].map((project) => {
      const paths = registry.paths(project.slug);
      mkdirSync(paths.repoRoot, { recursive: true });
      writeFileSync(join(paths.repoRoot, "screen.tsx"), "saved screen");
      return [
        project.slug,
        {
          slug: project.slug,
          paths,
          repo: {
            status: async () => ({ slug: project.slug }),
            stop: async () => calls.push(`stop:${project.slug}`),
            update: async ({ url }: { url: string }) => calls.push(`url:${project.slug}:${url}`),
            setCommandsApproved: (approved: boolean) => calls.push(`approve:${approved}`),
            sync: async () => calls.push(`sync:${project.slug}`),
          },
        },
      ];
    }),
  );
  const manager = {
    closeWhere: async (cwd: string) => {
      assert.equal(cwd, realpathSync(registry.paths(first.slug).repoRoot));
      calls.push("close");
    },
    removeWhere: async (cwd: string) => {
      assert.equal(existsSync(cwd), true, "대화 정리가 끝날 때까지 클론을 남긴다");
      calls.push("remove-transcripts");
    },
  };
  const router = new RequestRouter({
    registry,
    fleet: {
      workspaces,
      projectSummaries: () => registry.list().map(({ slug, name }) => ({ slug, name })),
      requireActive: () => workspaces.get(registry.activeSlug() ?? ""),
      workspacesFor: (slug: string) => workspaces.get(slug),
      activateProject: async (slug: string) => {
        registry.setActive(slug);
        calls.push(`activate:${slug}`);
      },
      announceProjects: () => calls.push("announce"),
    },
    manager,
    afterProjectSwitch: () => calls.push("switched"),
  } as never);
  return { router, registry, first, second, calls, workspaces, manager };
}

test("한 라우터에서 프로젝트를 전환하면 목록과 레포 요청이 새 활성 프로젝트를 읽는다", async (t) => {
  const { router, first, second, calls } = projectScene(t);
  assert.deepEqual(await router.dispatch({ id: "before", type: "repo.status" }), {
    slug: first.slug,
  });
  const activated = await router.dispatch({
    id: "switch",
    type: "project.activate",
    slug: second.slug,
  });
  assert.deepEqual(activated, await router.dispatch({ id: "list", type: "project.list" }));
  assert.deepEqual(await router.dispatch({ id: "after", type: "repo.status" }), {
    slug: second.slug,
  });
  assert.deepEqual(calls, [`activate:${second.slug}`, "switched"]);
});

test("프로젝트 수정은 잘못된 주소를 쓰기 전에 거절하고, 비활성 프로젝트에만 적용한다", async (t) => {
  const { router, registry, first, second, calls } = projectScene(t);
  await assert.rejects(
    router.dispatch({
      id: "bad",
      type: "project.update",
      slug: second.slug,
      repoUrl: "--upload-pack=x",
    }),
  );
  assert.equal(registry.get(second.slug)?.repo.url, second.repo.url);
  assert.deepEqual(calls, []);
  const url = "https://github.com/org/replacement.git";
  await router.dispatch({
    id: "update",
    type: "project.update",
    slug: second.slug,
    repoUrl: url,
    approveCommands: true,
    defaults: null,
  });
  assert.equal(registry.activeSlug(), first.slug);
  assert.equal(registry.get(second.slug)?.repo.url, url);
  assert.equal(registry.get(second.slug)?.commandsApproved, true);
  assert.deepEqual(calls, [
    "approve:true",
    `sync:${second.slug}`,
    `url:${second.slug}:${url}`,
    "announce",
  ]);
});

test("프로젝트 등록 해제는 세션과 서버를 닫고 다음 프로젝트를 열며 파일과 저장 대화는 남긴다", async (t) => {
  const { router, registry, first, second, calls, workspaces } = projectScene(t);
  const paths = registry.paths(first.slug);
  await router.dispatch({ id: "forget", type: "project.remove", slug: first.slug });
  assert.equal(registry.get(first.slug), null);
  assert.equal(workspaces.has(first.slug), false);
  assert.equal(existsSync(join(paths.repoRoot, "screen.tsx")), true);
  assert.equal(registry.activeSlug(), second.slug);
  assert.deepEqual(calls, ["close", `stop:${first.slug}`, `activate:${second.slug}`, "announce"]);
});

test("파일 삭제를 명시하면 저장 대화를 정리한 뒤 해당 프로젝트 폴더만 지운다", async (t) => {
  const { router, registry, first, second, calls } = projectScene(t);
  const removed = registry.paths(first.slug).root;
  const retained = registry.paths(second.slug).repoRoot;
  await router.dispatch({
    id: "delete",
    type: "project.remove",
    slug: first.slug,
    deleteFiles: true,
  });
  assert.equal(existsSync(removed), false);
  assert.equal(existsSync(join(retained, "screen.tsx")), true);
  assert.deepEqual(calls, [
    "close",
    `stop:${first.slug}`,
    "remove-transcripts",
    `activate:${second.slug}`,
    "announce",
  ]);
});

test("세션을 닫지 못하면 프로젝트 등록과 파일을 그대로 남긴다", async (t) => {
  const { router, registry, first, calls, manager } = projectScene(t);
  const paths = registry.paths(first.slug);
  manager.closeWhere = async () => {
    throw new Error("close failed");
  };
  await assert.rejects(
    router.dispatch({ id: "delete", type: "project.remove", slug: first.slug, deleteFiles: true }),
    /close failed/,
  );
  assert.equal(registry.get(first.slug)?.slug, first.slug);
  assert.equal(existsSync(join(paths.repoRoot, "screen.tsx")), true);
  assert.deepEqual(calls, []);
});

test("로그인 요청은 주소를 방송하고 성공한 경우에만 기다리던 작업을 재개한다", async () => {
  const broadcasts: unknown[] = [];
  let done: (ok: boolean, detail: string) => void = () => assert.fail("로그인을 시작하지 않았다");
  let resumed = 0;
  const router = new RequestRouter({
    agentDrivers: {
      get: () => ({ loginCommand: () => ({ command: "claude", args: ["auth", "login"] }) }),
    },
    agentLogin: {
      start: (
        command: string,
        args: string[],
        callbacks: {
          onUrl(url: string, wantsCode: boolean): void;
          onDone(ok: boolean, detail: string): void;
        },
      ) => {
        assert.equal(command, "claude");
        assert.deepEqual(args, ["auth", "login"]);
        callbacks.onUrl("https://example.test/login", false);
        done = callbacks.onDone;
        return { started: true };
      },
    },
    broadcast: (message: unknown) => broadcasts.push(message),
    afterAgentLogin: () => resumed++,
  } as never);
  assert.deepEqual(
    await router.dispatch({ id: "login", type: "onboarding.fix", kind: "login-claude" }),
    { started: true },
  );
  done(false, "failed");
  assert.equal(resumed, 0);
  done(true, "ready");
  assert.equal(resumed, 1);
  assert.deepEqual(broadcasts, [
    { type: "agent.login.url", url: "https://example.test/login", wantsCode: false },
    { type: "agent.login.done", ok: false, detail: "failed" },
    { type: "agent.login.done", ok: true, detail: "ready" },
  ]);
});
