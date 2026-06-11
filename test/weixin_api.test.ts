import assert from "node:assert/strict";
import { test } from "node:test";
import { WeixinApiClient, WeixinApiResponseError } from "../src/weixin/api.js";
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

test("WeixinApiClient sends login handshake reply with context token", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new WeixinApiClient({
    baseUrl: "https://example.invalid",
    token: "secret",
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });

  await client.sendMessage(buildTextMessage({
    toUserId: "user-1",
    text: "已成功连接。\n当前时间：2026-06-11 01:02:03。",
    contextToken: "ctx-token",
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://example.invalid/ilink/bot/sendmessage");
  const body = JSON.parse(String(calls[0]?.init.body)) as { msg: { to_user_id: string; context_token?: string; item_list: Array<{ text_item?: { text?: string } }> } };
  assert.equal(body.msg.to_user_id, "user-1");
  assert.equal(body.msg.context_token, "ctx-token");
  assert.equal(body.msg.item_list[0]?.text_item?.text, "已成功连接。\n当前时间：2026-06-11 01:02:03。");
});

test("WeixinApiClient builds getconfig and sendtyping payloads", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new WeixinApiClient({
    baseUrl: "https://example.invalid",
    token: "secret",
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ typing_ticket: "ticket-1" }), { status: 200 });
    }) as typeof fetch,
  });

  await client.getConfig({
    userId: "user-1",
    contextToken: "ctx-token",
  });
  await client.sendTyping({
    userId: "user-1",
    typingTicket: "ticket-1",
    status: 1,
  });

  assert.equal(calls[0]?.url, "https://example.invalid/ilink/bot/getconfig");
  assert.equal(calls[0]?.body.ilink_user_id, "user-1");
  assert.equal(calls[0]?.body.context_token, "ctx-token");
  assert.equal(calls[1]?.url, "https://example.invalid/ilink/bot/sendtyping");
  assert.equal(calls[1]?.body.ilink_user_id, "user-1");
  assert.equal(calls[1]?.body.typing_ticket, "ticket-1");
  assert.equal(calls[1]?.body.status, 1);
});

test("WeixinApiClient treats non-zero Weixin ret as failure", async () => {
  const client = new WeixinApiClient({
    baseUrl: "https://example.invalid",
    token: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({
      ret: -2,
      errmsg: "context token required",
    }), { status: 200 })) as typeof fetch,
  });

  await assert.rejects(
    () => client.sendMessage(buildTextMessage({
      toUserId: "user-1",
      text: "已成功连接。\n当前时间：2026-06-11 01:02:03。",
    })),
    WeixinApiResponseError,
  );
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
