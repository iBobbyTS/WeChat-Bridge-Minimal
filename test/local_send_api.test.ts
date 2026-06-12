import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { writeAllowedIpStore } from "../src/api/allowed_ip_store.js";
import { addToken } from "../src/api/token_store.js";
import { startLocalSendApi } from "../src/api/local_send_api.js";

test("local send API enforces token and forwards name-prefixed text", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-api-"));
  const tokenFile = path.join(dir, "tokens.json");
  const allowedIpFile = path.join(dir, "allowed-ips.json");
  await addToken(tokenFile, "Laptop", "tok");
  await writeAllowedIpStore(allowedIpFile, ["127.0.0.1"]);
  const sent: string[] = [];
  const server = await startLocalSendApi({
    host: "127.0.0.1",
    port: 0,
    tokenStoreFile: tokenFile,
    allowedIpStoreFile: allowedIpFile,
    targetUserId: "user-1",
    sendText: async (text) => {
      sent.push(text);
      return { ok: true };
    },
  });
  try {
    assert.deepEqual(await request(server.port, "GET", "/health"), { status: 200, body: { success: true } });
    assert.deepEqual(
      await request(server.port, "POST", "/send", { text: "hello" }),
      { status: 401, body: { success: false, error: "unauthorized" } },
    );
    const ok = await request(server.port, "POST", "/send", { text: "hello" }, "Bearer tok");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.sender, "Laptop");
    assert.deepEqual(sent, ["Laptop:\nhello"]);

    await addToken(tokenFile, "Desktop", "tok2");
    await request(server.port, "POST", "/send", { text: "second" }, "Bearer tok2");
    assert.deepEqual(sent, ["Laptop:\nhello", "Desktop:\nsecond"]);
  } finally {
    await server.close();
  }
});

test("local send API returns fixed validation errors", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-api-"));
  const tokenFile = path.join(dir, "tokens.json");
  const allowedIpFile = path.join(dir, "allowed-ips.json");
  await addToken(tokenFile, "Laptop", "tok");
  await writeAllowedIpStore(allowedIpFile, ["127.0.0.1"]);
  const server = await startLocalSendApi({
    host: "127.0.0.1",
    port: 0,
    tokenStoreFile: tokenFile,
    allowedIpStoreFile: allowedIpFile,
    targetUserId: "user-1",
    maxBodyBytes: 64 * 1024,
    sendText: async () => {
      throw new Error("wechat_context_expired");
    },
  });
  try {
    assert.equal((await rawRequest(server.port, "POST", "/send", "{", "Bearer tok")).body.error, "invalid_json");
    assert.equal((await request(server.port, "POST", "/send", { text: "ok" }, "Bearer tok")).body.error, "wechat_context_expired");
  } finally {
    await server.close();
  }
});

test("local send API returns request_body_too_large before parsing JSON", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-api-"));
  const tokenFile = path.join(dir, "tokens.json");
  const allowedIpFile = path.join(dir, "allowed-ips.json");
  await addToken(tokenFile, "Laptop", "tok");
  await writeAllowedIpStore(allowedIpFile, ["127.0.0.1"]);
  const server = await startLocalSendApi({
    host: "127.0.0.1",
    port: 0,
    tokenStoreFile: tokenFile,
    allowedIpStoreFile: allowedIpFile,
    targetUserId: "user-1",
    maxBodyBytes: 4,
    sendText: async () => ({ ok: true }),
  });
  try {
    assert.equal((await request(server.port, "POST", "/send", { text: "" }, "Bearer tok")).body.error, "request_body_too_large");
  } finally {
    await server.close();
  }
});

test("local send API reloads IP allowlist from state file on each request", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-api-"));
  const tokenFile = path.join(dir, "tokens.json");
  const allowedIpFile = path.join(dir, "allowed-ips.json");
  await addToken(tokenFile, "Laptop", "tok");
  await writeAllowedIpStore(allowedIpFile, []);
  const server = await startLocalSendApi({
    host: "127.0.0.1",
    port: 0,
    tokenStoreFile: tokenFile,
    allowedIpStoreFile: allowedIpFile,
    targetUserId: "user-1",
    sendText: async () => ({ ok: true }),
  });
  try {
    assert.deepEqual(
      await request(server.port, "GET", "/health"),
      { status: 403, body: { success: false, error: "forbidden_ip" } },
    );

    await writeAllowedIpStore(allowedIpFile, ["127.0.0.1"]);
    assert.deepEqual(await request(server.port, "GET", "/health"), { status: 200, body: { success: true } });
  } finally {
    await server.close();
  }
});

function request(port: number, method: string, route: string, body?: unknown, auth?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return rawRequest(port, method, route, body === undefined ? undefined : JSON.stringify(body), auth);
}

function rawRequest(port: number, method: string, route: string, body?: string, auth?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: route,
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk.toString("utf8");
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as Record<string, unknown> }));
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}
