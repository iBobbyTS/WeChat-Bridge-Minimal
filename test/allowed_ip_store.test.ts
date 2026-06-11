import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  addAllowedIp,
  ensureDefaultAllowedIps,
  normalizeAllowedIps,
  readAllowedIpStore,
  removeAllowedIp,
} from "../src/api/allowed_ip_store.js";

test("allowed IP store manages defaults, add, remove, and normalization", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-ips-"));
  const file = path.join(dir, "allowed-ips.json");

  assert.deepEqual(await readAllowedIpStore(file), ["127.0.0.1"]);
  assert.deepEqual(await ensureDefaultAllowedIps(file), ["127.0.0.1"]);

  assert.deepEqual(await addAllowedIp(file, "192.168.1.31"), ["127.0.0.1", "192.168.1.31"]);
  assert.deepEqual(await addAllowedIp(file, "localhost"), ["127.0.0.1", "192.168.1.31"]);
  assert.deepEqual(await readAllowedIpStore(file), ["127.0.0.1", "192.168.1.31"]);

  assert.equal(await removeAllowedIp(file, "localhost"), true);
  assert.deepEqual(await readAllowedIpStore(file), ["192.168.1.31"]);
  assert.equal(await removeAllowedIp(file, "127.0.0.1"), false);
});

test("normalizeAllowedIps accepts only concrete IP addresses", () => {
  assert.deepEqual(
    normalizeAllowedIps(["localhost", "::1", "::ffff:192.168.1.10", "bad", "10.0.0.1,10.0.0.1"]),
    ["127.0.0.1", "192.168.1.10", "10.0.0.1"],
  );
});
