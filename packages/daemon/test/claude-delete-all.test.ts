import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeDriver } from "../dist/agent/drivers/claude/driver.js";
import { claudeProjectKey } from "../dist/environment.js";
import { slugify } from "../dist/projects.js";

/**
 * `대화 모두 지우기` 의 Claude 쪽 (2026-10-07, 베타 준비 분석). Claude 는 클론마다 폴더 하나에 대화를
 * 두고 폴더 이름은 경로의 영숫자 아닌 글자를 `-` 로 접은 것이라(`claudeProjectKey`), 접미 이전의
 * `결제` · `회원` 은 한 폴더를 나눠 썼고 옛 deleteAll 은 그 폴더를 통째로 지워 이웃의 대화까지
 * 지웠다. 프로세스를 띄우지 않고 일회용 설정 폴더에 진짜 SDK(`listSessions` · `deleteSession`)로 돈다.
 */

interface World {
  /** 클론 폴더를 만든다 — 이 경로에서 Claude 의 대화 폴더 이름이 나온다. */
  clone(slug: string): string;
  /** 그 cwd 에서 한 대화가 오간 것처럼 기록 파일(과 하위 에이전트 폴더)을 남기고 id 를 돌려준다. */
  talk(cwd: string, text: string): string;
  /** 그 cwd 의 Claude 대화 폴더. */
  folderOf(cwd: string): string;
  /** SDK 가 그 cwd 의 대화로 돌려주는 제목들. */
  titles(cwd: string): Promise<string[]>;
  done(): void;
}

function world(): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "claude-delete-all-")));
  const config = join(root, "claude-config");
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  const folderOf = (cwd: string) => join(config, "projects", claudeProjectKey(resolve(cwd)));
  return {
    clone(slug) {
      const path = join(root, "home", ".colonova-design", "projects", slug, "repo");
      mkdirSync(path, { recursive: true });
      return realpathSync(path);
    },
    talk(cwd, text) {
      const id = randomUUID();
      const folder = folderOf(cwd);
      mkdirSync(join(folder, id, "subagents"), { recursive: true });
      const line = {
        parentUuid: null,
        isSidechain: false,
        userType: "external",
        cwd,
        sessionId: id,
        version: "2.0.0",
        gitBranch: "main",
        type: "user",
        message: { role: "user", content: text },
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
      };
      writeFileSync(join(folder, `${id}.jsonl`), `${JSON.stringify(line)}\n`);
      writeFileSync(join(folder, id, "subagents", "agent-1.jsonl"), "{}\n");
      return id;
    },
    folderOf,
    async titles(cwd) {
      const found = await listSessions({ dir: cwd, includeWorktrees: false });
      return found.map((info) => info.summary).sort();
    },
    done() {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const driver = () => new ClaudeDriver(() => null);

test("접미가 붙은 새 프로젝트는 폴더가 따로라 하나를 지워도 이웃은 그대로다", async () => {
  const w = world();
  try {
    const pay = w.clone(slugify("결제", new Set()));
    const member = w.clone(slugify("회원", new Set()));
    assert.notEqual(w.folderOf(pay), w.folderOf(member));
    w.talk(pay, "결제 화면을 고쳐 줘");
    w.talk(pay, "버튼을 키워 줘");
    w.talk(member, "회원 화면을 고쳐 줘");
    // 폴더 곁의 메모리 따위도 이 프로젝트의 것이라 함께 간다.
    mkdirSync(join(w.folderOf(pay), "memory"), { recursive: true });
    writeFileSync(join(w.folderOf(pay), "memory", "MEMORY.md"), "x");

    await driver().store.deleteAll?.(pay);

    assert.equal(existsSync(w.folderOf(pay)), false, "지운 프로젝트의 폴더는 통째로 사라진다");
    assert.deepEqual(await w.titles(member), ["회원 화면을 고쳐 줘"]);
  } finally {
    w.done();
  }
});

test("접미 이전의 이웃(`결제` · `회원`, 한 폴더)은 자기 대화만 지운다", async () => {
  const w = world();
  try {
    const pay = w.clone("결제");
    const member = w.clone("회원");
    assert.equal(w.folderOf(pay), w.folderOf(member), "전제: 두 클론이 한 폴더를 쓴다");
    w.talk(pay, "결제 화면을 고쳐 줘");
    w.talk(pay, "버튼을 키워 줘");
    const kept = w.talk(member, "회원 화면을 고쳐 줘");
    mkdirSync(join(w.folderOf(pay), "memory"), { recursive: true });
    // 전제: SDK 는 한 폴더 안에서도 대화에 기록된 cwd 로 각 클론의 것만 돌려준다 —
    // 이 가름이 deleteAll 의 안전의 바탕이라, SDK 가 바뀌어 깨지면 여기서 먼저 알게 된다.
    assert.deepEqual(await w.titles(pay), ["결제 화면을 고쳐 줘", "버튼을 키워 줘"]);
    assert.deepEqual(await w.titles(member), ["회원 화면을 고쳐 줘"]);

    await driver().store.deleteAll?.(pay);

    assert.deepEqual(await w.titles(pay), []);
    assert.deepEqual(await w.titles(member), ["회원 화면을 고쳐 줘"], "이웃의 대화는 남는다");
    const left = readdirSync(w.folderOf(member));
    assert.ok(left.includes(`${kept}.jsonl`), "이웃의 기록 파일이 남는다");
    assert.ok(left.includes(kept), "이웃의 하위 에이전트 폴더가 남는다");
    assert.ok(left.includes("memory"), "이웃이 남은 폴더는 건드리지 않는다");

    // 마지막 이웃을 지우면 그제야 폴더가 거둬진다.
    await driver().store.deleteAll?.(member);
    assert.equal(existsSync(w.folderOf(member)), false);
  } finally {
    w.done();
  }
});

test("클론이 이미 지워진 뒤에도 그 클론의 대화는 지워진다", async () => {
  const w = world();
  try {
    const pay = w.clone(slugify("결제", new Set()));
    w.talk(pay, "결제 화면을 고쳐 줘");
    rmSync(join(pay, ".."), { recursive: true, force: true });
    assert.equal(existsSync(pay), false);

    await driver().store.deleteAll?.(pay);

    assert.equal(existsSync(w.folderOf(pay)), false);
  } finally {
    w.done();
  }
});

test("지울 대화가 없어도 조용히 끝난다", async () => {
  const w = world();
  try {
    const pay = w.clone(slugify("결제", new Set()));
    await driver().store.deleteAll?.(pay);
    assert.equal(existsSync(w.folderOf(pay)), false);
  } finally {
    w.done();
  }
});
