import path from "node:path";
import { defaultAuthDir, defaultStateDir, defaultTokenStoreFile, parsePositiveInt, splitCsv } from "../config.js";
import { WeixinAccountStore, type WeixinAccountData } from "../weixin/account_store.js";
import { ContextTokenStore } from "../weixin/context_store.js";
import { WeixinApiClient } from "../weixin/api.js";
import { buildTextMessage, normalizeInboundMessage } from "../weixin/message.js";
import { WeixinTypingIndicator } from "../weixin/typing_indicator.js";
import { readStartupUpdates } from "../weixin/update_stream.js";
import type { WeixinMessage } from "../weixin/types.js";
import { CodexRunner } from "../codex/runner.js";
import { askCodexWithInitializedSession, createDefaultCodexRunnerOptions } from "../codex/initializer.js";
import { normalizeAllowedIps, startLocalSendApi, type LocalSendApiBinding } from "../api/local_send_api.js";
import type { Logger } from "../util/logger.js";
import { createStderrLogger } from "../util/logger.js";

export interface BridgeRuntimeOptions {
  stateDir?: string;
  logger?: Logger;
  contextStore?: Pick<ContextTokenStore, "get" | "set">;
  sendApiPort?: number;
  apiFactory?: (account: WeixinAccountData) => BridgeWeixinApi;
  askCodex?: (params: {
    stateDir: string;
    cwd: string;
    inputSender?: string;
    logger: Logger;
    runner: CodexRunner;
    prompt: string;
  }) => Promise<string>;
  typingIndicatorFactory?: (params: {
    api: BridgeWeixinApi;
    contextStore: Pick<ContextTokenStore, "get" | "set">;
  }) => Pick<WeixinTypingIndicator, "runWhileTyping">;
}

type BridgeWeixinApi = Pick<WeixinApiClient, "getUpdates" | "sendMessage" | "getConfig" | "sendTyping">;

export class BridgeRuntime {
  private readonly stateDir: string;
  private readonly accountStore: WeixinAccountStore;
  private readonly contextStore: Pick<ContextTokenStore, "get" | "set">;
  private readonly logger: Logger;
  private readonly sendApiPort?: number;
  private readonly apiFactory?: BridgeRuntimeOptions["apiFactory"];
  private readonly askCodex: NonNullable<BridgeRuntimeOptions["askCodex"]>;
  private readonly typingIndicatorFactory?: BridgeRuntimeOptions["typingIndicatorFactory"];
  private account: WeixinAccountData | null = null;
  private api: BridgeWeixinApi | null = null;
  private typingIndicator: Pick<WeixinTypingIndicator, "runWhileTyping"> | null = null;
  private sendApi: LocalSendApiBinding | null = null;
  private stopController: AbortController | null = null;

  constructor(options: BridgeRuntimeOptions = {}) {
    this.stateDir = path.resolve(options.stateDir ?? defaultStateDir());
    this.accountStore = new WeixinAccountStore(defaultAuthDir(this.stateDir));
    this.contextStore = options.contextStore ?? new ContextTokenStore(this.stateDir);
    this.logger = options.logger ?? createStderrLogger(process.env.WECHAT_BRIDGE_DEBUG === "1");
    this.sendApiPort = options.sendApiPort;
    this.apiFactory = options.apiFactory;
    this.askCodex = options.askCodex ?? askCodexWithInitializedSession;
    this.typingIndicatorFactory = options.typingIndicatorFactory;
  }

  getAccountStore(): WeixinAccountStore {
    return this.accountStore;
  }

  async start(): Promise<void> {
    this.account = await this.accountStore.load();
    if (!this.account) {
      throw new Error("No Weixin credentials found. Run npm run weixin:login first.");
    }
    this.api = this.apiFactory?.(this.account) ?? new WeixinApiClient({
      baseUrl: this.account.baseUrl,
      token: this.account.token,
    });
    this.typingIndicator = this.createTypingIndicator(this.api);
    const targetUserId = process.env.WECHAT_TARGET_USER_ID?.trim() || this.account.userId;
    this.sendApi = await startLocalSendApi({
      host: process.env.WECHAT_SEND_API_HOST?.trim() || "127.0.0.1",
      port: this.sendApiPort ?? parsePositiveInt(process.env.WECHAT_SEND_API_PORT) ?? 55523,
      tokenStoreFile: process.env.WECHAT_SEND_API_TOKEN_FILE?.trim() || defaultTokenStoreFile(this.stateDir),
      allowedIps: normalizeAllowedIps(splitCsv(process.env.WECHAT_SEND_API_ALLOWED_IPS).length > 0
        ? splitCsv(process.env.WECHAT_SEND_API_ALLOWED_IPS)
        : ["127.0.0.1", "localhost"]),
      targetUserId,
      sendText: (text) => this.sendTextToWeixin(targetUserId, text),
    });
    this.logger.info(`Local send API listening on ${this.sendApi.host}:${this.sendApi.port}`);
    this.stopController = new AbortController();
    void this.pollLoop(this.stopController.signal);
  }

  async stop(): Promise<void> {
    this.stopController?.abort();
    if (this.sendApi) {
      await this.sendApi.close();
      this.sendApi = null;
    }
  }

  async sendTextToWeixin(userId: string, text: string): Promise<{ delivered: true }> {
    const api = this.requireApi();
    const contextToken = await this.contextStore.get(userId);
    if (!contextToken) {
      throw new Error("wechat_context_required");
    }
    await api.sendMessage(buildTextMessage({
      toUserId: userId,
      text,
      contextToken,
    }));
    return { delivered: true };
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    const codex = this.createCodexRunner();
    let failureCount = 0;
    let getUpdatesBuf = "";

    while (!signal.aborted) {
      try {
        const startupUpdates = await readStartupUpdates({
          api: this.requireApi(),
          logger: this.logger,
          signal,
        });
        getUpdatesBuf = startupUpdates.getUpdatesBuf;
        failureCount = 0;
        this.handleIncomingMessages(startupUpdates.msgs, codex);
        break;
      } catch (error) {
        failureCount += 1;
        this.logger.warn(`微信消息启动基线获取失败：${error instanceof Error ? error.message : String(error)}`);
        await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(failureCount, 5)));
      }
    }

    while (!signal.aborted) {
      try {
        const response = await this.requireApi().getUpdates({
          getUpdatesBuf,
          signal,
        });
        failureCount = 0;
        getUpdatesBuf = response.get_updates_buf ?? getUpdatesBuf;
        this.handleIncomingMessages(response.msgs ?? [], codex);
      } catch (error) {
        failureCount += 1;
        this.logger.warn(`微信消息轮询失败：${error instanceof Error ? error.message : String(error)}`);
        await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(failureCount, 5)));
      }
    }
  }

  private handleIncomingMessages(messages: WeixinMessage[], codex: CodexRunner): void {
    for (const raw of messages) {
      const inbound = normalizeInboundMessage(raw);
      if (!inbound || inbound.senderId !== this.account?.userId) {
        continue;
      }
      void (async () => {
        let contextTokenSaveError: unknown = null;
        const contextTokenSave = inbound.contextToken
          ? this.contextStore.set(inbound.senderId, inbound.contextToken).catch((error) => {
            contextTokenSaveError = error;
          })
          : Promise.resolve();
        const reply = await this.requireTypingIndicator().runWhileTyping({
          userId: inbound.senderId,
          contextToken: inbound.contextToken,
        }, () => (
          this.askCodex({
            stateDir: this.stateDir,
            cwd: process.cwd(),
            inputSender: this.account?.accountId,
            logger: this.logger,
            runner: codex,
            prompt: inbound.text,
          })
        ));
        await contextTokenSave;
        if (contextTokenSaveError) {
          throw new Error(`微信上下文令牌保存失败：${contextTokenSaveError instanceof Error ? contextTokenSaveError.message : String(contextTokenSaveError)}`);
        }
        await this.sendTextToWeixin(inbound.senderId, reply);
      })().catch((error) => {
        this.logger.error(`Codex 对话处理失败：${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  private createCodexRunner(): CodexRunner {
    return new CodexRunner(createDefaultCodexRunnerOptions({
      stateDir: this.stateDir,
      cwd: process.cwd(),
      inputSender: this.account?.accountId,
    }));
  }

  private createTypingIndicator(api: BridgeWeixinApi): Pick<WeixinTypingIndicator, "runWhileTyping"> {
    if (this.typingIndicatorFactory) {
      return this.typingIndicatorFactory({
        api,
        contextStore: this.contextStore,
      });
    }
    return new WeixinTypingIndicator({
      api,
      contextStore: this.contextStore,
      keepaliveMs: parsePositiveInt(process.env.WECHAT_TYPING_KEEPALIVE_MS) ?? undefined,
    });
  }

  private requireApi(): BridgeWeixinApi {
    if (!this.api) {
      throw new Error("Weixin API client is not started.");
    }
    return this.api;
  }

  private requireTypingIndicator(): Pick<WeixinTypingIndicator, "runWhileTyping"> {
    if (!this.typingIndicator) {
      throw new Error("微信输入状态客户端尚未启动。");
    }
    return this.typingIndicator;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
