import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ContextTokenStore } from "../src/weixin/context_store.js";

test("ContextTokenStore stores context tokens under auth directory", async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-context-"));
  const store = new ContextTokenStore(stateDir);

  await store.set("user-1", "ctx-1");

  assert.equal(await store.get("user-1"), "ctx-1");
  assert.equal(
    await fsp.readFile(path.join(stateDir, "auth", "context-tokens.json"), "utf8")
      .then((content) => JSON.parse(content)["user-1"]),
    "ctx-1",
  );
});
