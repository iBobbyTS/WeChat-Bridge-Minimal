import type { Logger } from "../util/logger.js";
import type { GetUpdatesResp, WeixinMessage } from "./types.js";

export interface WeixinUpdatesApi {
  getUpdates(params?: {
    getUpdatesBuf?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<GetUpdatesResp>;
}

export interface StartupUpdates {
  getUpdatesBuf: string;
  msgs: WeixinMessage[];
}

export async function readStartupUpdates(options: {
  api: WeixinUpdatesApi;
  logger?: Pick<Logger, "info">;
  startedAtMs?: number;
  signal?: AbortSignal;
}): Promise<StartupUpdates> {
  const startedAtMs = options.startedAtMs ?? Date.now();
  const response = await options.api.getUpdates({
    getUpdatesBuf: "",
    timeoutMs: 1_000,
    signal: options.signal,
  });
  const msgs = response.msgs ?? [];
  const activeMsgs = msgs.filter((message) => isMessageAtOrAfter(message, startedAtMs));
  const droppedCount = msgs.length - activeMsgs.length;
  if (droppedCount > 0) {
    options.logger?.info(`已忽略 serve 启动前的微信历史消息：${droppedCount} 条`);
  }
  return {
    getUpdatesBuf: response.get_updates_buf ?? "",
    msgs: activeMsgs,
  };
}

function isMessageAtOrAfter(message: WeixinMessage, startedAtMs: number): boolean {
  if (typeof message.create_time_ms !== "number") {
    return false;
  }
  const createdAtMs = message.create_time_ms < 1_000_000_000_000
    ? message.create_time_ms * 1_000
    : message.create_time_ms;
  return createdAtMs >= startedAtMs;
}
