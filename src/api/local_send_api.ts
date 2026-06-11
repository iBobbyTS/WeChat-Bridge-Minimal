import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { authenticateBearer, readTokenStore } from "./token_store.js";
import { readLimitedBody, normalizeRequiredString } from "../util/http.js";

export interface LocalSendApiOptions {
  host: string;
  port: number;
  tokenStoreFile: string;
  allowedIps: string[];
  targetUserId: string;
  maxBodyBytes?: number;
  sendText: (text: string) => Promise<unknown>;
}

export interface LocalSendApiBinding {
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function startLocalSendApi(options: LocalSendApiOptions): Promise<LocalSendApiBinding> {
  const server = http.createServer((request, response) => {
    void handleLocalSendApiRequest(request, response, options);
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    host: options.host,
    port: typeof address === "object" && address ? address.port : options.port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export async function handleLocalSendApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalSendApiOptions,
): Promise<void> {
  if (!isAllowedRemoteAddress(request.socket.remoteAddress, options.allowedIps)) {
    writeJson(response, 403, { success: false, error: "forbidden_ip" });
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, { success: true });
    return;
  }
  if (request.method !== "POST" || request.url !== "/send") {
    writeJson(response, 404, { success: false, error: "not_found" });
    return;
  }

  const store = await readTokenStore(options.tokenStoreFile);
  const auth = authenticateBearer(request.headers.authorization, store);
  if (!auth) {
    writeJson(response, 401, { success: false, error: "unauthorized" });
    return;
  }

  let payload: { text?: unknown };
  try {
    payload = JSON.parse(await readLimitedBody(request, options.maxBodyBytes ?? 64 * 1024)) as { text?: unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, 400, { success: false, error: message === "request_body_too_large" ? message : "invalid_json" });
    return;
  }

  const text = normalizeRequiredString(payload.text);
  if (!text) {
    writeJson(response, 400, { success: false, error: "text_required" });
    return;
  }

  try {
    const result = await options.sendText(`${auth.name}:\n${text}`);
    writeJson(response, 200, {
      success: true,
      target: options.targetUserId,
      sender: auth.name,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, 502, {
      success: false,
      error: message === "wechat_context_required" ? "wechat_context_required" : "send_failed",
    });
  }
}

export function normalizeAllowedIps(values: string[]): string[] {
  const normalized = values.flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => value === "localhost" ? ["127.0.0.1"] : [normalizeRemoteAddress(value) ?? value]);
  return Array.from(new Set(normalized));
}

function isAllowedRemoteAddress(remoteAddress: string | undefined, allowedIps: string[]): boolean {
  const normalized = normalizeRemoteAddress(remoteAddress);
  return Boolean(normalized && allowedIps.includes(normalized));
}

function normalizeRemoteAddress(remoteAddress: string | undefined): string | null {
  if (!remoteAddress) {
    return null;
  }
  if (remoteAddress.startsWith("::ffff:")) {
    return remoteAddress.slice("::ffff:".length);
  }
  if (remoteAddress === "::1") {
    return "127.0.0.1";
  }
  return remoteAddress;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}
