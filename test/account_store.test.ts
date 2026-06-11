import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultAccountsDir } from "../src/config.js";
import { WeixinAccountStore } from "../src/weixin/account_store.js";

test("WeixinAccountStore detects and clears credential files regardless of validity", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-account-"));
  const accountsDir = defaultAccountsDir(dir);
  const store = new WeixinAccountStore(accountsDir);

  assert.equal(await store.hasAnyCredentials(), false);

  await fsp.mkdir(accountsDir, { recursive: true });
  await fsp.writeFile(path.join(accountsDir, "broken.json"), "{");
  await fsp.writeFile(path.join(dir, "auth", "context-tokens.json"), "{}");
  assert.equal(await store.hasAnyCredentials(), true);
  assert.equal(await store.load("broken"), null);

  await store.clearAll();
  assert.equal(await store.hasAnyCredentials(), false);
  await assert.rejects(() => fsp.stat(path.join(dir, "auth")), /ENOENT/);
});

test("WeixinAccountStore saves valid credentials and reports they exist", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-account-"));
  const store = new WeixinAccountStore(defaultAccountsDir(dir));

  await store.save({
    accountId: "bot@example",
    token: "token",
    baseUrl: "https://example.invalid",
    userId: "user",
  });

  assert.equal(await store.hasAnyCredentials(), true);
  assert.equal((await store.load())?.accountId, "bot@example");
});
