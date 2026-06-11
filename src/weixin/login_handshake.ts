import type { ContextTokenStore } from "./context_store.js";
import { buildTextMessage, normalizeInboundMessage, type InboundTextMessage } from "./message.js";
import type { GetUpdatesResp, SendMessageReq } from "./types.js";
import { formatLocalDateTime } from "../util/time.js";

export interface LoginHandshakeApi {
  getUpdates(params?: {
    getUpdatesBuf?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<GetUpdatesResp>;
  sendMessage(body: SendMessageReq, timeoutMs?: number): Promise<void>;
}

export interface LoginHandshakeMessage {
  senderId: string;
  text: string;
  contextToken: string;
}

export type LoginHandshakeIgnoreReason =
  | "not_text"
  | "wrong_user"
  | "stale"
  | "missing_context_token";

export interface LoginHandshakeWaitOptions {
  api: Pick<LoginHandshakeApi, "getUpdates">;
  contextStore: Pick<ContextTokenStore, "set">;
  updateCursorStore?: { get(): Promise<string>; set(getUpdatesBuf: string): Promise<void> };
  targetUserId: string;
  timeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  startedAtMs?: number;
  staleGraceMs?: number;
  signal?: AbortSignal;
  onIgnoredMessage?: (reason: LoginHandshakeIgnoreReason, message: InboundTextMessage | null) => void;
}

export async function waitForLoginHandshakeMessage(options: LoginHandshakeWaitOptions): Promise<LoginHandshakeMessage> {
  const targetUserId = options.targetUserId.trim();
  if (!targetUserId) {
    throw new Error("缺少微信目标用户 ID，无法完成登录握手。");
  }
  const timeoutMs = options.timeoutMs ?? 480_000;
  if (timeoutMs <= 0) {
    throw new Error("等待手机微信消息超时，请重新运行登录命令后再试。");
  }

  const startedAtMs = options.startedAtMs ?? Date.now();
  const staleGraceMs = options.staleGraceMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let getUpdatesBuf = await options.updateCursorStore?.get() ?? "";

  while (Date.now() < deadline) {
    throwIfAborted(options.signal);
    const remainingMs = Math.max(1, deadline - Date.now());
    const response = await options.api.getUpdates({
      getUpdatesBuf,
      timeoutMs: Math.min(options.pollTimeoutMs ?? 35_000, remainingMs),
      signal: options.signal,
    });
    getUpdatesBuf = response.get_updates_buf ?? getUpdatesBuf;
    if (response.get_updates_buf !== undefined) {
      await options.updateCursorStore?.set(getUpdatesBuf);
    }

    for (const raw of response.msgs ?? []) {
      const inbound = normalizeInboundMessage(raw);
      if (!inbound) {
        options.onIgnoredMessage?.("not_text", null);
        continue;
      }
      if (inbound.senderId !== targetUserId) {
        options.onIgnoredMessage?.("wrong_user", inbound);
        continue;
      }
      if (isStale(inbound, startedAtMs, staleGraceMs)) {
        options.onIgnoredMessage?.("stale", inbound);
        continue;
      }
      if (!inbound.contextToken) {
        options.onIgnoredMessage?.("missing_context_token", inbound);
        continue;
      }
      await options.contextStore.set(inbound.senderId, inbound.contextToken);
      return {
        senderId: inbound.senderId,
        text: inbound.text,
        contextToken: inbound.contextToken,
      };
    }

    await sleep(Math.min(options.pollIntervalMs ?? 1_000, Math.max(0, deadline - Date.now())));
  }

  throw new Error("等待手机微信消息超时，请重新运行登录命令后再试。");
}

export async function sendLoginHandshakeReply(options: {
  api: Pick<LoginHandshakeApi, "sendMessage">;
  targetUserId: string;
  contextToken: string;
  date?: Date;
}): Promise<void> {
  await options.api.sendMessage(buildTextMessage({
    toUserId: options.targetUserId,
    text: buildLoginHandshakeReplyText(options.date),
    contextToken: options.contextToken,
  }));
}

export function buildLoginHandshakeReplyText(date = new Date()): string {
  return `已成功连接。\n当前时间：${formatLocalDateTime(date)}。`;
}

function isStale(message: InboundTextMessage, startedAtMs: number, staleGraceMs: number): boolean {
  if (typeof message.createdAtMs !== "number") {
    return false;
  }
  const createdAtMs = message.createdAtMs < 1_000_000_000_000
    ? message.createdAtMs * 1_000
    : message.createdAtMs;
  return createdAtMs + staleGraceMs < startedAtMs;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("登录握手已取消。");
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
