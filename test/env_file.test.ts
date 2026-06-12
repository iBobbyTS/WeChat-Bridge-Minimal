import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadEnvFile, parseEnvFileContent } from "../src/util/env_file.js";

test("parseEnvFileContent reads shell-like key value lines", () => {
  assert.deepEqual(
    parseEnvFileContent(`
# comment
WECHAT_SEND_API_HOST=0.0.0.0
QUOTED="hello world"
SINGLE='value'
bad-key=ignored
NO_VALUE
`),
    [
      ["WECHAT_SEND_API_HOST", "0.0.0.0"],
      ["QUOTED", "hello world"],
      ["SINGLE", "value"],
    ],
  );
});

test("loadEnvFile keeps explicit environment values by default", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-env-"));
  const file = path.join(dir, "service.env");
  await fsp.writeFile(file, "WECHAT_SEND_API_HOST=0.0.0.0\nWECHAT_SEND_API_PORT=55523\n", "utf8");
  const env = {
    WECHAT_SEND_API_HOST: "127.0.0.1",
  } as NodeJS.ProcessEnv;

  assert.equal(await loadEnvFile(file, { env }), true);
  assert.equal(env.WECHAT_SEND_API_HOST, "127.0.0.1");
  assert.equal(env.WECHAT_SEND_API_PORT, "55523");
});

test("loadEnvFile can override environment values", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-env-"));
  const file = path.join(dir, "service.env");
  await fsp.writeFile(file, "WECHAT_SEND_API_HOST=0.0.0.0\n", "utf8");
  const env = {
    WECHAT_SEND_API_HOST: "127.0.0.1",
  } as NodeJS.ProcessEnv;

  assert.equal(await loadEnvFile(file, { env, override: true }), true);
  assert.equal(env.WECHAT_SEND_API_HOST, "0.0.0.0");
});
