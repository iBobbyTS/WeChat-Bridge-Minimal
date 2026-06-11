import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  askCodexWithInitializedSession,
  CODEX_SESSION_INITIAL_PROMPT,
  createDefaultCodexRunnerOptions,
  initializeCodexSession,
} from "../src/codex/initializer.js";
import { MissingCodexThreadError, type CodexRunnerState } from "../src/codex/runner.js";

test("initializeCodexSession creates a new session with the fixed initial prompt", async () => {
  const calls: string[] = [];
  const infoLogs: string[] = [];
  let state: CodexRunnerState = {};

  const result = await initializeCodexSession({
    stateDir: "/tmp/state",
    logger: {
      info(message) {
        infoLogs.push(message);
      },
      warn() {},
    },
    runner: {
      async getState() {
        return state;
      },
      async startNewSession(prompt) {
        calls.push(prompt);
        state = { threadId: "thread-new" };
        return "hello";
      },
    },
  });

  assert.deepEqual(calls, [CODEX_SESSION_INITIAL_PROMPT]);
  assert.deepEqual(result, { initialized: true, threadId: "thread-new" });
  assert.deepEqual(infoLogs, [
    "正在创建新的 Codex 会话并保存 session id...",
    "Codex 会话已创建并保存 session id：thread-new",
  ]);
});

test("initializeCodexSession skips existing session unless forced", async () => {
  const calls: string[] = [];
  let state: CodexRunnerState = { threadId: "thread-old" };
  const runner = {
    async getState() {
      return state;
    },
    async startNewSession(prompt: string) {
      calls.push(prompt);
      state = { threadId: "thread-new" };
      return "hello";
    },
  };

  assert.deepEqual(await initializeCodexSession({
    stateDir: "/tmp/state",
    runner,
  }), { initialized: false, threadId: "thread-old" });
  assert.deepEqual(calls, []);

  assert.deepEqual(await initializeCodexSession({
    stateDir: "/tmp/state",
    runner,
    forceNew: true,
  }), { initialized: true, threadId: "thread-new" });
  assert.deepEqual(calls, [CODEX_SESSION_INITIAL_PROMPT]);
});

test("askCodexWithInitializedSession creates a new session id before retrying user prompt", async () => {
  const calls: string[] = [];
  let state: CodexRunnerState = {};

  const reply = await askCodexWithInitializedSession({
    stateDir: "/tmp/state",
    prompt: "用户首条复杂消息",
    runner: {
      async getState() {
        return state;
      },
      async startNewSession(prompt) {
        calls.push(`start:${prompt}`);
        state = { threadId: "thread-new" };
        return "hello";
      },
      async askExisting(prompt) {
        calls.push(`ask:${prompt}`);
        if (!state.threadId) {
          throw new MissingCodexThreadError();
        }
        return "reply";
      },
    },
  });

  assert.equal(reply, "reply");
  assert.deepEqual(calls, [
    "ask:用户首条复杂消息",
    `start:${CODEX_SESSION_INITIAL_PROMPT}`,
    "ask:用户首条复杂消息",
  ]);
});

test("askCodexWithInitializedSession replaces unusable saved session id with a new one", async () => {
  const calls: string[] = [];
  let state: CodexRunnerState = { threadId: "thread-old" };

  const reply = await askCodexWithInitializedSession({
    stateDir: "/tmp/state",
    prompt: "继续对话",
    runner: {
      async getState() {
        return state;
      },
      async startNewSession(prompt) {
        calls.push(`start:${prompt}`);
        state = { threadId: "thread-new" };
        return "hello";
      },
      async askExisting(prompt) {
        calls.push(`ask:${prompt}:${state.threadId ?? ""}`);
        if (state.threadId === "thread-old") {
          throw new Error("resume failed");
        }
        return "reply-new";
      },
    },
  });

  assert.equal(reply, "reply-new");
  assert.deepEqual(calls, [
    "ask:继续对话:thread-old",
    `start:${CODEX_SESSION_INITIAL_PROMPT}`,
    "ask:继续对话:thread-new",
  ]);
});

test("createDefaultCodexRunnerOptions reads Codex environment defaults", () => {
  const options = createDefaultCodexRunnerOptions({
    stateDir: "/tmp/state",
    cwd: "/tmp/cwd",
    env: {
      CODEX_BIN: "codex-custom",
      CODEX_CWD: "/tmp/env-cwd",
      CODEX_MODEL: "model-a",
      CODEX_PROFILE: "profile-a",
      CODEX_SANDBOX: "workspace-write",
      CODEX_APPROVAL: "on-request",
    },
  });

  assert.equal(options.stateDir, "/tmp/state");
  assert.equal(options.cwd, path.resolve("/tmp/env-cwd"));
  assert.equal(options.codexBin, "codex-custom");
  assert.equal(options.model, "model-a");
  assert.equal(options.profile, "profile-a");
  assert.equal(options.sandbox, "workspace-write");
  assert.equal(options.approval, "on-request");
});
