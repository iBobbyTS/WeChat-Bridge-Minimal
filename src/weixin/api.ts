import crypto from "node:crypto";
import type {
  GetConfigResp,
  GetUpdatesResp,
  QrCodeResponse,
  QrStatusResponse,
  SendMessageReq,
  SendTypingResp,
} from "./types.js";

export type FetchLike = typeof fetch;

export interface WeixinApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: FetchLike;
  channelVersion?: string;
  appId?: string;
  appClientVersion?: number;
  botAgent?: string;
}

export interface WeixinRequestRecord {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export const DEFAULT_WEIXIN_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_CHANNEL_VERSION = "0.1.0";
const DEFAULT_APP_ID = "bot";
const DEFAULT_APP_CLIENT_VERSION = 1;
const DEFAULT_BOT_AGENT = "WeChatBridgeMinimal/0.1.0";

export class WeixinHttpError extends Error {
  constructor(
    readonly label: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${label} failed with HTTP ${status}: ${body}`);
    this.name = "WeixinHttpError";
  }
}

export class WeixinApiResponseError extends Error {
  constructor(
    readonly label: string,
    readonly body: Record<string, unknown>,
  ) {
    super(`${label} 返回失败：ret=${String(body.ret ?? "")} errcode=${String(body.errcode ?? "")} errmsg=${String(body.errmsg ?? "")}`);
    this.name = "WeixinApiResponseError";
  }
}

export class WeixinApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly channelVersion: string;
  private readonly appId: string;
  private readonly appClientVersion: number;
  private readonly botAgent: string;

  constructor(options: WeixinApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_WEIXIN_BASE_URL;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.channelVersion = options.channelVersion ?? DEFAULT_CHANNEL_VERSION;
    this.appId = options.appId ?? DEFAULT_APP_ID;
    this.appClientVersion = options.appClientVersion ?? DEFAULT_APP_CLIENT_VERSION;
    this.botAgent = options.botAgent ?? DEFAULT_BOT_AGENT;
  }

  buildBaseInfo() {
    return {
      channel_version: this.channelVersion,
      bot_agent: this.botAgent,
    };
  }

  async fetchQrCode(botType = "3", localTokenList: string[] = []): Promise<QrCodeResponse> {
    return this.postJson<QrCodeResponse>({
      endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
      body: { local_token_list: localTokenList },
      label: "fetchQrCode",
      auth: false,
      baseUrl: DEFAULT_WEIXIN_BASE_URL,
    });
  }

  async fetchQrStatus(params: {
    qrcode: string;
    verifyCode?: string;
    baseUrl?: string;
    timeoutMs?: number;
  }): Promise<QrStatusResponse> {
    const query = new URLSearchParams({ qrcode: params.qrcode });
    if (params.verifyCode) {
      query.set("verify_code", params.verifyCode);
    }
    return this.getJson<QrStatusResponse>({
      endpoint: `ilink/bot/get_qrcode_status?${query.toString()}`,
      label: "fetchQrStatus",
      baseUrl: params.baseUrl ?? DEFAULT_WEIXIN_BASE_URL,
      timeoutMs: params.timeoutMs,
    });
  }

  async getUpdates(params: {
    getUpdatesBuf?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}): Promise<GetUpdatesResp> {
    try {
      return await this.postJson<GetUpdatesResp>({
        endpoint: "ilink/bot/getupdates",
        label: "getUpdates",
        body: {
          get_updates_buf: params.getUpdatesBuf ?? "",
          base_info: this.buildBaseInfo(),
        },
        timeoutMs: params.timeoutMs ?? 35_000,
        signal: params.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
      }
      throw error;
    }
  }

  async sendMessage(body: SendMessageReq, timeoutMs = 15_000): Promise<void> {
    await this.postJson<unknown>({
      endpoint: "ilink/bot/sendmessage",
      label: "sendMessage",
      body: {
        ...body,
        base_info: this.buildBaseInfo(),
      },
      timeoutMs,
    });
  }

  async getConfig(params: {
    userId: string;
    contextToken?: string | null;
    timeoutMs?: number;
  }): Promise<GetConfigResp> {
    return this.postJson<GetConfigResp>({
      endpoint: "ilink/bot/getconfig",
      label: "getConfig",
      body: {
        ilink_user_id: params.userId,
        ...(params.contextToken ? { context_token: params.contextToken } : {}),
      },
      timeoutMs: params.timeoutMs ?? 15_000,
    });
  }

  async sendTyping(params: {
    userId: string;
    typingTicket: string;
    status: number;
    timeoutMs?: number;
  }): Promise<SendTypingResp> {
    return this.postJson<SendTypingResp>({
      endpoint: "ilink/bot/sendtyping",
      label: "sendTyping",
      body: {
        ilink_user_id: params.userId,
        typing_ticket: params.typingTicket,
        status: params.status,
      },
      timeoutMs: params.timeoutMs ?? 15_000,
    });
  }

  buildRequestForTest(params: {
    method: "GET" | "POST";
    endpoint: string;
    body?: unknown;
    auth?: boolean;
    baseUrl?: string;
  }): WeixinRequestRecord {
    const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl ?? this.baseUrl));
    return {
      method: params.method,
      url: url.toString(),
      headers: this.buildHeaders(params.auth !== false),
      body: params.body,
    };
  }

  private async getJson<T>(params: {
    endpoint: string;
    label: string;
    baseUrl?: string;
    timeoutMs?: number;
  }): Promise<T> {
    const req = this.buildRequestForTest({
      method: "GET",
      endpoint: params.endpoint,
      auth: false,
      baseUrl: params.baseUrl,
    });
    const response = await this.fetchWithTimeout(req.url, {
      method: "GET",
      headers: req.headers,
      timeoutMs: params.timeoutMs,
    });
    return parseJsonResponse<T>(params.label, response);
  }

  private async postJson<T>(params: {
    endpoint: string;
    body: unknown;
    label: string;
    auth?: boolean;
    baseUrl?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<T> {
    const req = this.buildRequestForTest({
      method: "POST",
      endpoint: params.endpoint,
      body: params.body,
      auth: params.auth,
      baseUrl: params.baseUrl,
    });
    const response = await this.fetchWithTimeout(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    });
    return parseJsonResponse<T>(params.label, response);
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit & { timeoutMs?: number },
  ): Promise<Response> {
    const timeoutMs = init.timeoutMs;
    const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const signal = combineSignals(controller?.signal, init.signal);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal,
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private buildHeaders(auth: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": randomWechatUin(),
      "iLink-App-Id": this.appId,
      "iLink-App-ClientVersion": String(this.appClientVersion),
    };
    if (auth && this.token?.trim()) {
      headers.Authorization = `Bearer ${this.token.trim()}`;
    }
    return headers;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf8").toString("base64");
}

async function parseJsonResponse<T>(label: string, response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new WeixinHttpError(label, response.status, text);
  }
  const parsed = JSON.parse(text) as T;
  if (isFailedWeixinResponse(parsed)) {
    throw new WeixinApiResponseError(label, parsed);
  }
  return parsed;
}

function isFailedWeixinResponse(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  const ret = numericField(body.ret);
  const errcode = numericField(body.errcode);
  return (ret !== null && ret !== 0) || (errcode !== null && errcode !== 0);
}

function numericField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function combineSignals(left?: AbortSignal, right?: AbortSignal | null): AbortSignal | undefined {
  if (!left) {
    return right ?? undefined;
  }
  if (!right) {
    return left;
  }
  if (left.aborted || right.aborted) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  left.addEventListener("abort", abort, { once: true });
  right.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
