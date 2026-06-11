import net from "node:net";
import { readJsonFile, writeJsonPrivate } from "../util/fs.js";

export const DEFAULT_ALLOWED_IPS = ["127.0.0.1"];

export async function readAllowedIpStore(filePath: string): Promise<string[]> {
  const value = await readJsonFile<unknown>(filePath, DEFAULT_ALLOWED_IPS);
  return Array.isArray(value) ? normalizeAllowedIps(value) : [];
}

export async function writeAllowedIpStore(filePath: string, ips: string[]): Promise<void> {
  await writeJsonPrivate(filePath, normalizeAllowedIps(ips));
}

export async function ensureDefaultAllowedIps(filePath: string): Promise<string[]> {
  const ips = normalizeAllowedIps([...DEFAULT_ALLOWED_IPS, ...await readAllowedIpStore(filePath)]);
  await writeAllowedIpStore(filePath, ips);
  return ips;
}

export async function addAllowedIp(filePath: string, ip: string): Promise<string[]> {
  const normalized = normalizeAllowedIps([ip]);
  if (!normalized.length) {
    throw new Error("ip_required");
  }
  const ips = normalizeAllowedIps([...await readAllowedIpStore(filePath), ...normalized]);
  await writeAllowedIpStore(filePath, ips);
  return ips;
}

export async function removeAllowedIp(filePath: string, ip: string): Promise<boolean> {
  const normalized = normalizeAllowedIps([ip]);
  if (!normalized.length) {
    throw new Error("ip_required");
  }
  const removeSet = new Set(normalized);
  const current = await readAllowedIpStore(filePath);
  const next = current.filter((item) => !removeSet.has(item));
  if (next.length === current.length) {
    return false;
  }
  await writeAllowedIpStore(filePath, next);
  return true;
}

export function normalizeAllowedIps(values: unknown[]): string[] {
  const normalized = values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => normalizeAllowedIp(value))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(normalized));
}

export function normalizeRemoteAddress(remoteAddress: string | undefined): string | null {
  if (!remoteAddress) {
    return null;
  }
  if (remoteAddress.startsWith("::ffff:")) {
    return remoteAddress.slice("::ffff:".length);
  }
  if (remoteAddress === "::1" || remoteAddress.toLowerCase() === "localhost") {
    return "127.0.0.1";
  }
  return remoteAddress;
}

function normalizeAllowedIp(value: unknown): string | null {
  const normalized = normalizeRemoteAddress(String(value ?? "").trim());
  return normalized && net.isIP(normalized) ? normalized : null;
}
