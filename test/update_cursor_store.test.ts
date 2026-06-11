import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WeixinUpdateCursorStore } from "../src/weixin/update_cursor_store.js";

test("WeixinUpdateCursorStore stores getupdates cursor under auth directory", async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-cursor-"));
  const store = new WeixinUpdateCursorStore(stateDir);

  assert.equal(await store.get(), "");
  await store.set("buf-1");

  assert.equal(await store.get(), "buf-1");
  assert.equal(
    await fsp.readFile(path.join(stateDir, "auth", "get-updates-cursor.json"), "utf8")
      .then((content) => JSON.parse(content).getUpdatesBuf),
    "buf-1",
  );
});
