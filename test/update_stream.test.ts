import assert from "node:assert/strict";
import { test } from "node:test";
import { readStartupUpdates } from "../src/weixin/update_stream.js";
import { MessageItemType, MessageType, type GetUpdatesResp } from "../src/weixin/types.js";

test("readStartupUpdates drops pre-serve messages and returns in-memory cursor", async () => {
  const infoLogs: string[] = [];
  const requests: Array<{ getUpdatesBuf?: string; timeoutMs?: number }> = [];

  const result = await readStartupUpdates({
    api: {
      async getUpdates(params) {
        requests.push({
          getUpdatesBuf: params?.getUpdatesBuf,
          timeoutMs: params?.timeoutMs,
        });
        return {
          get_updates_buf: "startup-cursor",
          msgs: [
            {
              from_user_id: "user-1",
              message_type: MessageType.USER,
              item_list: [{ type: MessageItemType.TEXT, text_item: { text: "serve 启动前的消息" } }],
              create_time_ms: 1_999_999_999_000,
            },
          ],
        } satisfies GetUpdatesResp;
      },
    },
    logger: {
      info(message) {
        infoLogs.push(message);
      },
    },
    startedAtMs: 2_000_000_000_000,
  });

  assert.equal(result.getUpdatesBuf, "startup-cursor");
  assert.deepEqual(result.msgs, []);
  assert.deepEqual(requests, [{ getUpdatesBuf: "", timeoutMs: 1_000 }]);
  assert.deepEqual(infoLogs, ["已忽略 serve 启动前的微信历史消息：1 条"]);
});

test("readStartupUpdates keeps messages received after serve starts", async () => {
  const result = await readStartupUpdates({
    api: {
      async getUpdates() {
        return {
          get_updates_buf: "startup-cursor",
          msgs: [
            {
              from_user_id: "user-1",
              message_type: MessageType.USER,
              item_list: [{ type: MessageItemType.TEXT, text_item: { text: "旧消息" } }],
              create_time_ms: 1_999_999_999_000,
            },
            {
              from_user_id: "user-1",
              message_type: MessageType.USER,
              item_list: [{ type: MessageItemType.TEXT, text_item: { text: "serve 启动后的消息" } }],
              create_time_ms: 2_000_000_000_001,
            },
          ],
        } satisfies GetUpdatesResp;
      },
    },
    startedAtMs: 2_000_000_000_000,
  });

  assert.equal(result.getUpdatesBuf, "startup-cursor");
  assert.equal(result.msgs.length, 1);
  assert.equal(result.msgs[0]?.item_list?.[0]?.text_item?.text, "serve 启动后的消息");
});
