import assert from "node:assert/strict";
import { test } from "node:test";
import { WeixinTypingIndicator } from "../src/weixin/typing_indicator.js";

test("WeixinTypingIndicator fetches typing ticket once and sends start and stop", async () => {
  const contextRequests: string[] = [];
  const configRequests: Array<{ userId: string; contextToken?: string | null }> = [];
  const typingCalls: Array<{ userId: string; typingTicket: string; status: number }> = [];
  const indicator = new WeixinTypingIndicator({
    api: {
      async getConfig(params) {
        configRequests.push(params);
        return { typing_ticket: "ticket-1" };
      },
      async sendTyping(params) {
        typingCalls.push(params);
      },
    },
    contextStore: {
      async get(userId) {
        contextRequests.push(userId);
        return "ctx-token";
      },
    },
  });

  await indicator.start("user-1");
  await indicator.stop("user-1");

  assert.deepEqual(contextRequests, ["user-1"]);
  assert.deepEqual(configRequests, [{ userId: "user-1", contextToken: "ctx-token" }]);
  assert.deepEqual(typingCalls, [
    { userId: "user-1", typingTicket: "ticket-1", status: 1 },
    { userId: "user-1", typingTicket: "ticket-1", status: 2 },
  ]);
});

test("WeixinTypingIndicator skips sendtyping when getconfig has no ticket", async () => {
  const typingCalls: unknown[] = [];
  const indicator = new WeixinTypingIndicator({
    api: {
      async getConfig() {
        return {};
      },
      async sendTyping(params) {
        typingCalls.push(params);
      },
    },
    contextStore: {
      async get() {
        return null;
      },
    },
  });

  await indicator.start("user-1");

  assert.deepEqual(typingCalls, []);
});

test("WeixinTypingIndicator wraps work with typing start and stop without hiding work result", async () => {
  const typingStatuses: number[] = [];
  const indicator = new WeixinTypingIndicator({
    api: {
      async getConfig() {
        return { typing_ticket: "ticket-1" };
      },
      async sendTyping(params) {
        typingStatuses.push(params.status);
      },
    },
    contextStore: {
      async get() {
        return "ctx-token";
      },
    },
    keepaliveMs: 0,
  });

  const result = await indicator.runWhileTyping({ userId: "user-1" }, async () => "Codex 回复");

  assert.equal(result, "Codex 回复");
  assert.deepEqual(typingStatuses, [1, 2]);
});

test("WeixinTypingIndicator uses inbound context token before reading stored token", async () => {
  const configRequests: Array<{ userId: string; contextToken?: string | null }> = [];
  const indicator = new WeixinTypingIndicator({
    api: {
      async getConfig(params) {
        configRequests.push(params);
        return { typing_ticket: "ticket-1" };
      },
      async sendTyping() {},
    },
    contextStore: {
      async get() {
        throw new Error("不应该读取已保存 token");
      },
    },
  });

  await indicator.start("user-1", "ctx-inbound");

  assert.deepEqual(configRequests, [{ userId: "user-1", contextToken: "ctx-inbound" }]);
});
