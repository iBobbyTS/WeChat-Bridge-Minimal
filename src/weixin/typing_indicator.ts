import type { ContextTokenStore } from "./context_store.js";

const TYPING_START = 1;
const TYPING_STOP = 2;
const DEFAULT_TYPING_KEEPALIVE_MS = 8_000;

export interface WeixinTypingApi {
  getConfig(params: {
    userId: string;
    contextToken?: string | null;
    timeoutMs?: number;
  }): Promise<{ typing_ticket?: string }>;
  sendTyping(params: {
    userId: string;
    typingTicket: string;
    status: number;
    timeoutMs?: number;
  }): Promise<unknown>;
}

export interface WeixinTypingIndicatorOptions {
  api: WeixinTypingApi;
  contextStore: Pick<ContextTokenStore, "get">;
  keepaliveMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export class WeixinTypingIndicator {
  private readonly tickets = new Map<string, string>();
  private readonly keepaliveMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  constructor(private readonly options: WeixinTypingIndicatorOptions) {
    this.keepaliveMs = options.keepaliveMs ?? DEFAULT_TYPING_KEEPALIVE_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  async start(userId: string, contextToken?: string | null): Promise<void> {
    await this.send(userId, TYPING_START, contextToken);
  }

  async stop(userId: string): Promise<void> {
    await this.send(userId, TYPING_STOP);
  }

  startKeepalive(userId: string): () => Promise<void> {
    if (this.keepaliveMs <= 0) {
      return async () => {
        await this.safeStop(userId);
      };
    }
    const timer = this.setIntervalFn(() => {
      void this.safeStart(userId);
    }, this.keepaliveMs);
    return async () => {
      this.clearIntervalFn(timer);
      await this.safeStop(userId);
    };
  }

  async runWhileTyping<T>(params: {
    userId: string;
    contextToken?: string | null;
  }, work: () => Promise<T>): Promise<T> {
    const startPromise = this.safeStart(params.userId, params.contextToken);
    const stopKeepalive = this.startKeepalive(params.userId);
    try {
      return await work();
    } finally {
      await startPromise;
      await stopKeepalive();
    }
  }

  private async safeStart(userId: string, contextToken?: string | null): Promise<void> {
    try {
      await this.start(userId, contextToken);
    } catch {
      // 输入状态只是提示能力，失败不能影响消息主流程。
    }
  }

  private async safeStop(userId: string): Promise<void> {
    try {
      await this.stop(userId);
    } catch {
      // 输入状态只是提示能力，失败不能影响消息主流程。
    }
  }

  private async send(userId: string, status: number, contextToken?: string | null): Promise<void> {
    const typingTicket = await this.getTypingTicket(userId, contextToken);
    if (!typingTicket) {
      return;
    }
    await this.options.api.sendTyping({
      userId,
      typingTicket,
      status,
    });
  }

  private async getTypingTicket(userId: string, contextToken?: string | null): Promise<string | null> {
    const cached = this.tickets.get(userId);
    if (cached) {
      return cached;
    }
    const effectiveContextToken = contextToken ?? await this.options.contextStore.get(userId);
    const response = await this.options.api.getConfig({
      userId,
      contextToken: effectiveContextToken,
    });
    const ticket = typeof response.typing_ticket === "string" && response.typing_ticket.trim()
      ? response.typing_ticket.trim()
      : "";
    if (!ticket) {
      return null;
    }
    this.tickets.set(userId, ticket);
    return ticket;
  }
}
