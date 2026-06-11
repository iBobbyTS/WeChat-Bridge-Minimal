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
  constructor(private readonly authDir: string) {}

  async save(data: Omit<WeixinAccountData, "savedAt">): Promise<WeixinAccountData> {
    const saved: WeixinAccountData = {
      ...data,
      savedAt: new Date().toISOString(),
    };
    await writeJsonPrivate(this.accountPath(), saved);
    return saved;
  }

  async load(): Promise<WeixinAccountData | null> {
    let data: Partial<WeixinAccountData> | null;
    try {
      data = await readJsonFile<Partial<WeixinAccountData> | null>(this.accountPath(), null);
    } catch {
      return null;
    }
    if (!data?.accountId || !data.token || !data.baseUrl || !data.userId) {
      return null;
    }
    return data as WeixinAccountData;
  }

  async hasAnyCredentials(): Promise<boolean> {
    try {
      const stat = await fsp.stat(this.authDir);
      return stat.isDirectory();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async clearAll(): Promise<void> {
    await fsp.rm(this.authDir, { recursive: true, force: true });
  }

  private accountPath(): string {
    return path.join(this.authDir, "account.json");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
