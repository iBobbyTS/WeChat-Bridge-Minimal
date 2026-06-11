import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAccountsDir, defaultAuthDir } from "../src/config.js";

test("auth-related paths live under state/auth", () => {
  assert.equal(defaultAuthDir("/tmp/state"), "/tmp/state/auth");
  assert.equal(defaultAccountsDir("/tmp/state"), "/tmp/state/auth/accounts");
});
