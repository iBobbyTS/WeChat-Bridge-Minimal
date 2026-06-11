import fs from "node:fs";
import path from "node:path";

export interface CodexSessionSummary {
  threadId: string;
  filePath: string;
  updatedAtMs: number;
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
    const stat = fs.statSync(filePath);
    const timestampMs = meta.timestamp ? Date.parse(meta.timestamp) : Number.NaN;
    const updatedAtMs = Math.max(stat.mtimeMs, Number.isFinite(timestampMs) ? timestampMs : 0);
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

function normalizePath(value: string): string {
  return path.resolve(value);
}
