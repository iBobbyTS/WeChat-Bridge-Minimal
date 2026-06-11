import fs from "node:fs";
import path from "node:path";

export interface CodexSessionSummary {
  threadId: string;
  filePath: string;
  updatedAtMs: number;
}

export function listCodexSessionFiles(root: string): string[] {
  return listJsonlFiles(root);
}

export function findNewestCodexSessionForCwd(params: {
  sessionsRoot: string;
  cwd: string;
  sinceMs: number;
}): CodexSessionSummary | null {
  const files = listJsonlFiles(params.sessionsRoot);
  let best: CodexSessionSummary | null = null;
  for (const filePath of files) {
    const meta = readSessionMeta(filePath);
    if (!meta?.id || !meta.cwd) {
      continue;
    }
    if (normalizePath(meta.cwd) !== normalizePath(params.cwd)) {
      continue;
    }
    const updatedAtMs = sessionUpdatedAtMs(filePath, meta.timestamp);
    if (updatedAtMs < params.sinceMs - 5_000) {
      continue;
    }
    if (!best || updatedAtMs > best.updatedAtMs) {
      best = {
        threadId: meta.id,
        filePath,
        updatedAtMs,
      };
    }
  }
  return best;
}

export function findMatchingNewCodexSessionForCwd(params: {
  sessionsRoot: string;
  cwd: string;
  knownFiles: Iterable<string>;
  prompt: string;
}): CodexSessionSummary | null {
  const known = new Set(Array.from(params.knownFiles, normalizePath));
  const candidates = listJsonlFiles(params.sessionsRoot)
    .filter((filePath) => !known.has(normalizePath(filePath)))
    .map((filePath) => {
      const meta = readSessionMeta(filePath);
      if (!meta?.id || !meta.cwd || normalizePath(meta.cwd) !== normalizePath(params.cwd)) {
        return null;
      }
      return {
        threadId: meta.id,
        filePath,
        updatedAtMs: sessionUpdatedAtMs(filePath, meta.timestamp),
      };
    })
    .filter((value): value is CodexSessionSummary => value !== null)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  for (const candidate of candidates) {
    // 这不是完整保护，只是简化的相对完整确认：新增 session 文件必须包含本次完整用户消息。
    if (sessionFileContainsPrompt(candidate.filePath, params.prompt)) {
      return candidate;
    }
  }
  return null;
}

export function defaultCodexSessionsRoot(home = process.env.HOME ?? process.env.USERPROFILE ?? ""): string {
  return path.join(home, ".codex", "sessions");
}

function listJsonlFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(filePath);
      }
    }
  }
  return files;
}

function readSessionMeta(filePath: string): { id?: string; cwd?: string; timestamp?: string } | null {
  try {
    const firstLine = fs.readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine) {
      return null;
    }
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { id?: string; cwd?: string; timestamp?: string };
    };
    return parsed.type === "session_meta" ? parsed.payload ?? null : null;
  } catch {
    return null;
  }
}

function sessionUpdatedAtMs(filePath: string, timestamp: string | undefined): number {
  const stat = fs.statSync(filePath);
  const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Math.max(stat.mtimeMs, Number.isFinite(timestampMs) ? timestampMs : 0);
}

function sessionFileContainsPrompt(filePath: string, prompt: string): boolean {
  if (!prompt) {
    return false;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (content.includes(prompt)) {
      return true;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        if (jsonValueContainsPrompt(JSON.parse(trimmed) as unknown, prompt)) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function jsonValueContainsPrompt(value: unknown, prompt: string): boolean {
  if (typeof value === "string") {
    return value.includes(prompt);
  }
  if (Array.isArray(value)) {
    return value.some((item) => jsonValueContainsPrompt(item, prompt));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => jsonValueContainsPrompt(item, prompt));
  }
  return false;
}

function normalizePath(value: string): string {
  return path.resolve(value);
}
