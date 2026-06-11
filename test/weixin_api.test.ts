import assert from "node:assert/strict";
import { test } from "node:test";
import { WeixinApiClient } from "../src/weixin/api.js";
import { buildTextMessage, extractTextFromItems, normalizeInboundMessage } from "../src/weixin/message.js";
import { MessageItemType, MessageType, type SendMessageReq } from "../src/weixin/types.js";

test("WeixinApiClient builds official sendmessage request headers and body", () => {
  const client = new WeixinApiClient({
    baseUrl: "https://example.invalid",
    token: "secret",
    channelVersion: "9.8.7",
    appId: "bot",
    appClientVersion: 123,
  });
  const request = client.buildRequestForTest({
    method: "POST",
    endpoint: "ilink/bot/sendmessage",
    body: buildTextMessage({
      toUserId: "user-1",
      text: "hello",
      contextToken: "ctx",
      clientId: "client-1",
    }),
  });

  assert.equal(request.url, "https://example.invalid/ilink/bot/sendmessage");
  assert.equal(request.headers.Authorization, "Bearer secret");
  assert.equal(request.headers.AuthorizationType, "ilink_bot_token");
  assert.equal(request.headers["iLink-App-Id"], "bot");
  assert.equal(request.headers["iLink-App-ClientVersion"], "123");
  const body = request.body as SendMessageReq;
  assert.equal(body.msg?.to_user_id, "user-1");
  assert.equal(body.msg?.context_token, "ctx");
  assert.equal(body.msg?.item_list?.[0]?.text_item?.text, "hello");
});

test("extractTextFromItems handles text, quote, and voice text", () => {
  assert.equal(
    extractTextFromItems([{ type: MessageItemType.TEXT, text_item: { text: "plain" } }]),
    "plain",
  );
  assert.equal(
    extractTextFromItems([
      {
        type: MessageItemType.TEXT,
        text_item: { text: "reply" },
        ref_msg: {
          title: "quoted title",
          message_item: { type: MessageItemType.TEXT, text_item: { text: "quoted body" } },
        },
      },
    ]),
    "[引用: quoted title | quoted body]\nreply",
  );
  assert.equal(
    extractTextFromItems([{ type: MessageItemType.VOICE, voice_item: { text: "voice text" } }]),
    "voice text",
  );
});

test("normalizeInboundMessage accepts direct user text and ignores bot or group messages", () => {
  const direct = normalizeInboundMessage({
    from_user_id: "user-1",
    message_type: MessageType.USER,
    item_list: [{ type: MessageItemType.TEXT, text_item: { text: " hello " } }],
    context_token: "ctx",
  });
  assert.deepEqual(direct, {
    senderId: "user-1",
    text: "hello",
    contextToken: "ctx",
    createdAtMs: undefined,
  });

  assert.equal(normalizeInboundMessage({
    from_user_id: "user-1",
    group_id: "group",
    item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hello" } }],
  }), null);
  assert.equal(normalizeInboundMessage({
    from_user_id: "user-1",
    message_type: MessageType.BOT,
    item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hello" } }],
  }), null);
});
