import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  addToken,
  authenticateBearer,
  ensureDefaultTokens,
  readTokenStore,
  removeToken,
} from "../src/api/token_store.js";

test("token store manages defaults, add, remove, and bearer auth", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-token-"));
  const file = path.join(dir, "tokens.json");

  const defaults = await ensureDefaultTokens(file);
  assert.equal(Object.keys(defaults).length, 3);

  const token = await addToken(file, "Laptop", "fixed-token");
  assert.equal(token, "fixed-token");
  const store = await readTokenStore(file);
  assert.equal(store["fixed-token"]?.name, "Laptop");
  assert.equal(authenticateBearer("Bearer fixed-token", store)?.name, "Laptop");
  assert.equal(authenticateBearer("Bearer wrong", store), null);
  assert.equal(authenticateBearer("Basic fixed-token", store), null);

  assert.equal(await removeToken(file, "fixed-token"), true);
  assert.equal(await removeToken(file, "fixed-token"), false);
});
