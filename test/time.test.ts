import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTestMessageText } from "../src/cli.js";
import { formatLocalDateTime } from "../src/util/time.js";

test("formatLocalDateTime formats local time as YYYY-MM-DD HH:MM:SS", () => {
  assert.equal(
    formatLocalDateTime(new Date(2026, 0, 2, 3, 4, 5)),
    "2026-01-02 03:04:05",
  );
});

test("buildTestMessageText includes requested message and timestamp", () => {
  assert.equal(
    buildTestMessageText(new Date(2026, 5, 11, 1, 2, 3)),
    "测试消息。\n发送时间: 2026-06-11 01:02:03",
  );
});
