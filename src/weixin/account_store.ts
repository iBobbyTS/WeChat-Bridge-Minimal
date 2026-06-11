import path from "node:path";
import { readJsonFile, writeJsonPrivate } from "../util/fs.js";

export interface WeixinAccountData {
  accountId: string;
  token: string;
  baseUrl: string;
  userId: string;
  savedAt: string;
}

export class WeixinAccountStore {
  constructor(private readonly accountsDir: string) {}

  async save(data: Omit<WeixinAccountData, "savedAt">): Promise<WeixinAccountData> {
    const saved: WeixinAccountData = {
      ...data,
      savedAt: new Date().toISOString(),
    };
    await writeJsonPrivate(this.accountPath(data.accountId), saved);
    await writeJsonPrivate(this.indexPath(), [data.accountId]);
    return saved;
  }

  async load(accountId?: string | null): Promise<WeixinAccountData | null> {
    const resolvedId = accountId?.trim() || (await this.defaultAccountId());
    if (!resolvedId) {
      return null;
    }
    const data = await readJsonFile<Partial<WeixinAccountData> | null>(this.accountPath(resolvedId), null);
    if (!data?.accountId || !data.token || !data.baseUrl || !data.userId) {
      return null;
    }
    return data as WeixinAccountData;
  }

  async defaultAccountId(): Promise<string | null> {
    const ids = await readJsonFile<string[]>(this.indexPath(), []);
    return ids.find((id) => typeof id === "string" && id.trim()) ?? null;
  }

  private accountPath(accountId: string): string {
    return path.join(this.accountsDir, `${safeFileName(accountId)}.json`);
  }

  private indexPath(): string {
    return path.join(this.accountsDir, "index.json");
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.@-]/g, "_");
}
