import path from "node:path";
import { readJsonFile, writeJsonPrivate } from "../util/fs.js";

export class ContextTokenStore {
  constructor(private readonly stateDir: string) {}

  async get(userId: string): Promise<string | null> {
    const data = await this.read();
    return typeof data[userId] === "string" && data[userId] ? data[userId] : null;
  }

  async set(userId: string, token: string): Promise<void> {
    if (!userId || !token) {
      return;
    }
    const data = await this.read();
    data[userId] = token;
    await writeJsonPrivate(this.filePath(), data);
  }

  private async read(): Promise<Record<string, string>> {
    const parsed = await readJsonFile<Record<string, unknown>>(this.filePath(), {});
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) {
        normalized[key] = value;
      }
    }
    return normalized;
  }

  private filePath(): string {
    return path.join(this.stateDir, "auth", "context-tokens.json");
  }
}
