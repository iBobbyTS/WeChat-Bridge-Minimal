import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAllowedIpStoreFile, defaultAuthDir } from "../src/config.js";

test("auth-related paths live under state/auth", () => {
  assert.equal(defaultAuthDir("/tmp/state"), "/tmp/state/auth");
});

test("send API allowlist path lives under state", () => {
  assert.equal(defaultAllowedIpStoreFile("/tmp/state"), "/tmp/state/send-api-allowed-ips.json");
});
