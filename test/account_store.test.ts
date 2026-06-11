import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultAuthDir } from "../src/config.js";
import { WeixinAccountStore } from "../src/weixin/account_store.js";

test("WeixinAccountStore detects and clears auth directory regardless of account file validity", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-account-"));
  const authDir = defaultAuthDir(dir);
  const store = new WeixinAccountStore(authDir);

  assert.equal(await store.hasAnyCredentials(), false);

  await fsp.mkdir(authDir, { recursive: true });
  await fsp.writeFile(path.join(authDir, "account.json"), "{");
  await fsp.writeFile(path.join(authDir, "context-tokens.json"), "{}");
  await fsp.writeFile(path.join(authDir, "get-updates-cursor.json"), "{}");
  assert.equal(await store.hasAnyCredentials(), true);
  assert.equal(await store.load(), null);

  await store.clearAll();
  assert.equal(await store.hasAnyCredentials(), false);
  await assert.rejects(() => fsp.stat(path.join(dir, "auth")), /ENOENT/);
});

test("WeixinAccountStore treats existing auth directory as logged-in state", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-account-"));
  const authDir = defaultAuthDir(dir);
  const store = new WeixinAccountStore(authDir);

  await fsp.mkdir(authDir, { recursive: true });

  assert.equal(await store.hasAnyCredentials(), true);
  assert.equal(await store.load(), null);
});

test("WeixinAccountStore saves single account credentials directly under auth directory", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-account-"));
  const authDir = defaultAuthDir(dir);
  const store = new WeixinAccountStore(authDir);

  await store.save({
    accountId: "bot@example",
    token: "token",
    baseUrl: "https://example.invalid",
    userId: "user",
  });

  assert.equal(await store.hasAnyCredentials(), true);
  assert.equal((await store.load())?.accountId, "bot@example");
  assert.equal(
    await fsp.readFile(path.join(authDir, "account.json"), "utf8")
      .then((content) => JSON.parse(content).accountId),
    "bot@example",
  );
  await assert.rejects(() => fsp.stat(path.join(authDir, "accounts", "account.json")), /ENOENT/);
  await assert.rejects(() => fsp.stat(path.join(authDir, "accounts", "index.json")), /ENOENT/);
  await assert.rejects(() => fsp.stat(path.join(authDir, "accounts", "bot@example.json")), /ENOENT/);
});

test("WeixinAccountStore ignores obsolete accounts directory without compatibility fallback", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-account-"));
  const authDir = defaultAuthDir(dir);
  const store = new WeixinAccountStore(authDir);
  const obsoleteAccountsDir = path.join(authDir, "accounts");

  await fsp.mkdir(obsoleteAccountsDir, { recursive: true });
  await fsp.writeFile(path.join(obsoleteAccountsDir, "account.json"), JSON.stringify({
    accountId: "bot@example",
    token: "token",
    baseUrl: "https://example.invalid",
    userId: "user",
    savedAt: "2026-06-11T00:00:00.000Z",
  }));
  await fsp.writeFile(path.join(obsoleteAccountsDir, "bot@example.json"), JSON.stringify({
    accountId: "bot@example",
    token: "token",
    baseUrl: "https://example.invalid",
    userId: "user",
    savedAt: "2026-06-11T00:00:00.000Z",
  }));
  await fsp.writeFile(path.join(obsoleteAccountsDir, "index.json"), JSON.stringify(["bot@example"]));

  assert.equal(await store.hasAnyCredentials(), true);
  assert.equal(await store.load(), null);
});
