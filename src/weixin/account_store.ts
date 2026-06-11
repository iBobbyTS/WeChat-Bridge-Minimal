import path from "node:path";
import fsp from "node:fs/promises";
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
    let data: Partial<WeixinAccountData> | null;
    try {
      data = await readJsonFile<Partial<WeixinAccountData> | null>(this.accountPath(resolvedId), null);
    } catch {
      return null;
    }
    if (!data?.accountId || !data.token || !data.baseUrl || !data.userId) {
      return null;
    }
    return data as WeixinAccountData;
  }

  async defaultAccountId(): Promise<string | null> {
    const ids = await readJsonFile<string[]>(this.indexPath(), []);
    return ids.find((id) => typeof id === "string" && id.trim()) ?? null;
  }

  async hasAnyCredentials(): Promise<boolean> {
    try {
      const entries = await fsp.readdir(this.accountsDir, { withFileTypes: true });
      return entries.some((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async clearAll(): Promise<void> {
    await fsp.rm(path.dirname(this.accountsDir), { recursive: true, force: true });
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
