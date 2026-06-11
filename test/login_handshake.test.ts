import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLoginHandshakeReplyText,
  sendLoginHandshakeReply,
  waitForLoginHandshakeMessage,
  type LoginHandshakeIgnoreReason,
} from "../src/weixin/login_handshake.js";
import { MessageItemType, MessageType, type GetUpdatesResp, type SendMessageReq } from "../src/weixin/types.js";

test("buildLoginHandshakeReplyText includes successful connection text and current time", () => {
  assert.equal(
    buildLoginHandshakeReplyText(new Date(2026, 5, 11, 1, 2, 3)),
    "已成功连接。\n当前时间：2026-06-11 01:02:03。",
  );
});

test("waitForLoginHandshakeMessage ignores unrelated messages and saves target context token", async () => {
  const ignored: Array<{ reason: LoginHandshakeIgnoreReason; senderId?: string }> = [];
  const saved: Array<{ userId: string; token: string }> = [];
  const responses: GetUpdatesResp[] = [
    {
      get_updates_buf: "buf-1",
      msgs: [
        {
          from_user_id: "other-user",
          message_type: MessageType.USER,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: "你好" } }],
          context_token: "ctx-other",
          create_time_ms: 2_000_000_000_100,
        },
        {
          from_user_id: "target-user",
          message_type: MessageType.USER,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: "旧消息" } }],
          context_token: "ctx-old",
          create_time_ms: 1_999_999_999_000,
        },
      ],
    },
    {
      get_updates_buf: "buf-2",
      msgs: [
        {
          from_user_id: "target-user",
          message_type: MessageType.USER,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: " 你好 " } }],
          context_token: "ctx-target",
          create_time_ms: 2_000_000_000_200,
        },
      ],
    },
  ];
  const requestedBufs: Array<string | undefined> = [];

  const result = await waitForLoginHandshakeMessage({
    api: {
      async getUpdates(params) {
        requestedBufs.push(params?.getUpdatesBuf);
        return responses.shift() ?? { msgs: [] };
      },
    },
    contextStore: {
      async set(userId, token) {
        saved.push({ userId, token });
      },
    },
    targetUserId: "target-user",
    startedAtMs: 2_000_000_000_000,
    staleGraceMs: 100,
    pollIntervalMs: 0,
    timeoutMs: 1_000,
    onIgnoredMessage(reason, message) {
      ignored.push({ reason, senderId: message?.senderId });
    },
  });

  assert.deepEqual(result, {
    senderId: "target-user",
    text: "你好",
    contextToken: "ctx-target",
  });
  assert.deepEqual(saved, [{ userId: "target-user", token: "ctx-target" }]);
  assert.deepEqual(requestedBufs, ["", "buf-1"]);
  assert.deepEqual(ignored, [
    { reason: "wrong_user", senderId: "other-user" },
    { reason: "stale", senderId: "target-user" },
  ]);
});

test("waitForLoginHandshakeMessage keeps waiting when target message has no context token", async () => {
  const saved: Array<{ userId: string; token: string }> = [];
  const ignored: LoginHandshakeIgnoreReason[] = [];
  const responses: GetUpdatesResp[] = [
    {
      msgs: [
        {
          from_user_id: "target-user",
          message_type: MessageType.USER,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: "没有 token" } }],
        },
      ],
    },
    {
      msgs: [
        {
          from_user_id: "target-user",
          message_type: MessageType.USER,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: "有 token" } }],
          context_token: "ctx-target",
        },
      ],
    },
  ];

  const result = await waitForLoginHandshakeMessage({
    api: {
      async getUpdates() {
        return responses.shift() ?? { msgs: [] };
      },
    },
    contextStore: {
      async set(userId, token) {
        saved.push({ userId, token });
      },
    },
    targetUserId: "target-user",
    pollIntervalMs: 0,
    timeoutMs: 1_000,
    onIgnoredMessage(reason) {
      ignored.push(reason);
    },
  });

  assert.equal(result.contextToken, "ctx-target");
  assert.deepEqual(saved, [{ userId: "target-user", token: "ctx-target" }]);
  assert.deepEqual(ignored, ["missing_context_token"]);
});

test("waitForLoginHandshakeMessage fails with Chinese timeout message", async () => {
  await assert.rejects(
    () => waitForLoginHandshakeMessage({
      api: {
        async getUpdates() {
          return { msgs: [] };
        },
      },
      contextStore: {
        async set() {},
      },
      targetUserId: "target-user",
      timeoutMs: 0,
    }),
    /等待手机微信消息超时/,
  );
});

test("sendLoginHandshakeReply sends reply with context token", async () => {
  const sent: SendMessageReq[] = [];

  await sendLoginHandshakeReply({
    api: {
      async sendMessage(body) {
        sent.push(body);
      },
    },
    targetUserId: "target-user",
    contextToken: "ctx-target",
    date: new Date(2026, 5, 11, 1, 2, 3),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.msg?.to_user_id, "target-user");
  assert.equal(sent[0]?.msg?.context_token, "ctx-target");
  assert.equal(sent[0]?.msg?.item_list?.[0]?.text_item?.text, "已成功连接。\n当前时间：2026-06-11 01:02:03。");
});
