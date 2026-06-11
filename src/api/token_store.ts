import crypto from "node:crypto";
import { readJsonFile, writeJsonPrivate } from "../util/fs.js";

export interface SendApiTokenRecord {
  name: string;
  createdAt: string;
}

export type SendApiTokenStore = Record<string, SendApiTokenRecord>;

export const DEFAULT_TOKEN_NAMES = ["MacBook Pro", "PC-4070", "PC-4060"];

export async function readTokenStore(filePath: string): Promise<SendApiTokenStore> {
  return normalizeTokenStore(await readJsonFile<Record<string, unknown>>(filePath, {}));
}

export async function writeTokenStore(filePath: string, store: SendApiTokenStore): Promise<void> {
  await writeJsonPrivate(filePath, store);
}

export async function ensureDefaultTokens(filePath: string): Promise<SendApiTokenStore> {
  let store = await readTokenStore(filePath);
  let changed = false;
  for (const name of DEFAULT_TOKEN_NAMES) {
    if (Object.values(store).some((record) => record.name === name)) {
      continue;
    }
    store = addTokenRecord(store, name, generateToken());
    changed = true;
  }
  if (changed) {
    await writeTokenStore(filePath, store);
  }
  return store;
}

export async function addToken(filePath: string, name: string, token = generateToken()): Promise<string> {
  const store = await readTokenStore(filePath);
  await writeTokenStore(filePath, addTokenRecord(store, name, token));
  return token;
}

export async function removeToken(filePath: string, token: string): Promise<boolean> {
  const store = await readTokenStore(filePath);
  if (!store[token]) {
    return false;
  }
  const next = { ...store };
  delete next[token];
  await writeTokenStore(filePath, next);
  return true;
}

export function authenticateBearer(headerValue: unknown, store: SendApiTokenStore): SendApiTokenRecord | null {
  if (typeof headerValue !== "string") {
    return null;
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/iu);
  const provided = match?.[1]?.trim();
  if (!provided) {
    return null;
  }
  for (const [token, record] of Object.entries(store)) {
    if (safeEqual(provided, token)) {
      return record;
    }
  }
  return null;
}

function addTokenRecord(store: SendApiTokenStore, name: string, token: string): SendApiTokenStore {
  const normalizedName = name.trim();
  const normalizedToken = token.trim();
  if (!normalizedName || !normalizedToken) {
    throw new Error("token_and_name_required");
  }
  return {
    ...store,
    [normalizedToken]: {
      name: normalizedName,
      createdAt: store[normalizedToken]?.createdAt ?? new Date().toISOString(),
    },
  };
}

function normalizeTokenStore(value: Record<string, unknown>): SendApiTokenStore {
  const store: SendApiTokenStore = {};
  for (const [token, record] of Object.entries(value)) {
    if (!token.trim() || !record || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }
    const name = (record as Record<string, unknown>).name;
    const createdAt = (record as Record<string, unknown>).createdAt;
    if (typeof name !== "string" || !name.trim()) {
      continue;
    }
    store[token] = {
      name: name.trim(),
      createdAt: typeof createdAt === "string" && createdAt.trim() ? createdAt : new Date().toISOString(),
    };
  }
  return store;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
