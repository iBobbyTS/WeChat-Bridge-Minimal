import path from "node:path";
import { readJsonFile, writeJsonPrivate } from "../util/fs.js";

export class WeixinUpdateCursorStore {
  constructor(private readonly stateDir: string) {}

  async get(): Promise<string> {
    const data = await readJsonFile<Record<string, unknown>>(this.filePath(), {});
    return typeof data.getUpdatesBuf === "string" ? data.getUpdatesBuf : "";
  }

  async set(getUpdatesBuf: string): Promise<void> {
    await writeJsonPrivate(this.filePath(), {
      getUpdatesBuf,
      savedAt: new Date().toISOString(),
    });
  }

  private filePath(): string {
    return path.join(this.stateDir, "auth", "get-updates-cursor.json");
  }
}
