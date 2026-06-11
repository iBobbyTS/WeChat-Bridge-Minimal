import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLaunchdPlist, defaultServiceEnvContent } from "../src/service/launchd.js";
import { defaultServiceEnvFile, defaultStateDir } from "../src/config.js";

test("buildLaunchdPlist includes service runner, logs, and launchd keys", () => {
  const plist = buildLaunchdPlist({
    rootDir: "/tmp/wechat bridge",
    nodeBin: "/usr/bin/node",
    stateDir: "/tmp/state",
    envFile: "/tmp/env",
  });
  assert.match(plist, /com\.ibobby\.wechat-bridge-minimal/);
  assert.match(plist, /run-service\.mjs/);
  assert.match(plist, /RunAtLoad/);
  assert.match(plist, /KeepAlive/);
  assert.match(plist, /\/tmp\/state\/logs\/service\.out\.log/);
  assert.match(plist, /\/tmp\/env/);
});

test("defaultServiceEnvContent documents secure defaults", () => {
  const content = defaultServiceEnvContent();
  assert.match(content, /WECHAT_SEND_API_HOST=127\.0\.0\.1/);
  assert.match(content, /CODEX_SANDBOX=read-only/);
  assert.match(content, /CODEX_APPROVAL=never/);
});

test("default paths live under XDG config directory", () => {
  const env = {
    XDG_CONFIG_HOME: "/tmp/config",
  } as NodeJS.ProcessEnv;
  assert.equal(defaultStateDir(env), "/tmp/config/wechat-bridge-minimal/state");
  assert.equal(defaultServiceEnvFile(env), "/tmp/config/wechat-bridge-minimal/service.env");
});
