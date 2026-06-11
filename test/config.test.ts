import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAuthDir } from "../src/config.js";

test("auth-related paths live under state/auth", () => {
  assert.equal(defaultAuthDir("/tmp/state"), "/tmp/state/auth");
});
