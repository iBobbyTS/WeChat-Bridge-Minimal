import os from "node:os";
import path from "node:path";

export const APP_NAME = "wechat-bridge-minimal";
export const SERVICE_LABEL = "com.ibobby.wechat-bridge-minimal";

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.WECHAT_BRIDGE_STATE_DIR ?? path.join(defaultConfigDir(env), "state"));
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), APP_NAME);
}

export function defaultServiceEnvFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(defaultConfigDir(env), "service.env");
}

export function defaultTokenStoreFile(stateDir: string): string {
  return path.join(stateDir, "send-api-tokens.json");
}

export function defaultAuthDir(stateDir: string): string {
  return path.join(stateDir, "auth");
}

export function defaultAccountsDir(stateDir: string): string {
  return path.join(defaultAuthDir(stateDir), "accounts");
}

export function parsePositiveInt(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function splitCsv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function requireString(value: unknown, name: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}
