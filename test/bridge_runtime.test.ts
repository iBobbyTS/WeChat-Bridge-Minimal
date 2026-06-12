import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultAuthDir } from "../src/config.js";
import { BridgeRuntime } from "../src/bridge/runtime.js";
import { WeixinAccountStore } from "../src/weixin/account_store.js";
import { ContextTokenStore } from "../src/weixin/context_store.js";
import { MessageItemType, MessageType, type GetUpdatesResp, type SendMessageReq } from "../src/weixin/types.js";
import { WeixinApiResponseError } from "../src/weixin/api.js";
import { silentLogger } from "../src/util/logger.js";

test("BridgeRuntime wraps Codex turn with Weixin typing indicator", async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-runtime-"));
  const accountStore = new WeixinAccountStore(defaultAuthDir(stateDir));
  await accountStore.save({
    accountId: "bot@example",
    token: "secret",
    baseUrl: "https://example.invalid",
    userId: "user-1",
  });
  const realContextStore = new ContextTokenStore(stateDir);
  await realContextStore.set("user-1", "ctx-token");

  const events: string[] = [];
  const sentMessages: SendMessageReq[] = [];
  const responses: GetUpdatesResp[] = [
    {
      get_updates_buf: "startup-cursor",
      msgs: [],
    },
    {
      get_updates_buf: "cursor-1",
      msgs: [
        {
          from_user_id: "user-1",
          message_type: MessageType.USER,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: "你好" } }],
          context_token: "ctx-new",
        },
      ],
    },
  ];
  const runtime = new BridgeRuntime({
    stateDir,
    logger: silentLogger,
    contextStore: {
      async get(userId) {
        return realContextStore.get(userId);
      },
      async set(userId, token) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push("context-saved");
        await realContextStore.set(userId, token);
      },
    },
    sendApiPort: 0,
    apiFactory: () => ({
      async getUpdates(params) {
        if (params?.signal?.aborted) {
          return { msgs: [], get_updates_buf: params.getUpdatesBuf };
        }
        return responses.shift() ?? new Promise<GetUpdatesResp>((resolve) => {
          params?.signal?.addEventListener("abort", () => {
            resolve({ msgs: [], get_updates_buf: params.getUpdatesBuf });
          }, { once: true });
        });
      },
      async sendMessage(body) {
        events.push("send");
        sentMessages.push(body);
      },
      async getConfig() {
        return { typing_ticket: "ticket-1" };
      },
      async sendTyping() {
        return {};
      },
    }),
    typingIndicatorFactory: () => ({
      async runWhileTyping(params, work) {
        assert.deepEqual(params, { userId: "user-1", contextToken: "ctx-new" });
        events.push("typing-start");
        try {
          return await work();
        } finally {
          events.push("typing-stop");
        }
      },
    }),
    async askCodex(params) {
      events.push(`codex:${params.prompt}`);
      return "Codex 回复";
    },
  });

  await runtime.start();
  await waitFor(() => events.includes("send"));
  await runtime.stop();

  assert.deepEqual(events, ["typing-start", "codex:你好", "typing-stop", "context-saved", "send"]);
  assert.equal(sentMessages[0]?.msg?.item_list?.[0]?.text_item?.text, "Codex 回复");
  assert.equal(sentMessages[0]?.msg?.context_token, "ctx-new");
  assert.equal(await new ContextTokenStore(stateDir).get("user-1"), "ctx-new");
});

test("BridgeRuntime notifies Weixin start and stop", async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-runtime-"));
  const accountStore = new WeixinAccountStore(defaultAuthDir(stateDir));
  await accountStore.save({
    accountId: "bot@example",
    token: "secret",
    baseUrl: "https://example.invalid",
    userId: "user-1",
  });
  const events: string[] = [];
  const runtime = new BridgeRuntime({
    stateDir,
    logger: silentLogger,
    sendApiPort: 0,
    apiFactory: () => ({
      async notifyStart() {
        events.push("notify-start");
        return { ret: 0 };
      },
      async notifyStop() {
        events.push("notify-stop");
        return { ret: 0 };
      },
      async getUpdates(params) {
        return new Promise<GetUpdatesResp>((resolve) => {
          params?.signal?.addEventListener("abort", () => {
            resolve({ msgs: [], get_updates_buf: params.getUpdatesBuf });
          }, { once: true });
        });
      },
      async sendMessage() {},
      async getConfig() {
        return {};
      },
      async sendTyping() {
        return {};
      },
    }),
  });

  await runtime.start();
  await runtime.stop();

  assert.deepEqual(events, ["notify-start", "notify-stop"]);
});

test("BridgeRuntime retries outbound send without stale stored context token", async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-runtime-"));
  const accountStore = new WeixinAccountStore(defaultAuthDir(stateDir));
  await accountStore.save({
    accountId: "bot@example",
    token: "secret",
    baseUrl: "https://example.invalid",
    userId: "user-1",
  });
  const realContextStore = new ContextTokenStore(stateDir);
  await realContextStore.set("user-1", "ctx-old");
  const sentMessages: SendMessageReq[] = [];
  const runtime = new BridgeRuntime({
    stateDir,
    logger: silentLogger,
    contextStore: realContextStore,
    sendApiPort: 0,
    apiFactory: () => ({
      async getUpdates(params) {
        return new Promise<GetUpdatesResp>((resolve) => {
          params?.signal?.addEventListener("abort", () => {
            resolve({ msgs: [], get_updates_buf: params.getUpdatesBuf });
          }, { once: true });
        });
      },
      async sendMessage(body) {
        sentMessages.push(body);
        if (body.msg?.context_token) {
          throw new WeixinApiResponseError("sendMessage", { ret: -2 });
        }
      },
      async getConfig() {
        return {};
      },
      async sendTyping() {
        return {};
      },
    }),
  });

  await runtime.start();
  const result = await runtime.sendTextToWeixin("user-1", "hello");
  await runtime.stop();

  assert.deepEqual(result, { delivered: true, context: "none" });
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0]?.msg?.context_token, "ctx-old");
  assert.equal(sentMessages[1]?.msg?.context_token, undefined);
  assert.equal(await realContextStore.get("user-1"), null);
});

async function waitFor(assertion: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待条件超时。");
}
