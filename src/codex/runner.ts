import { spawn as defaultSpawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonPrivate } from "../util/fs.js";
import {
  defaultCodexSessionsRoot,
  findMatchingNewCodexSessionForCwd,
  listCodexSessionFiles,
} from "./session_files.js";

export type SpawnLike = typeof defaultSpawn;

export interface CodexRunnerOptions {
  stateDir: string;
  cwd: string;
  codexBin?: string;
  model?: string;
  profile?: string;
  sandbox?: string;
  approval?: string;
  sessionsRoot?: string;
  spawnImpl?: SpawnLike;
  outputDir?: string;
  inputSender?: string;
  transcriptFile?: string;
}

export interface CodexRunnerState {
  threadId?: string;
}

export class MissingCodexThreadError extends Error {
  constructor() {
    super("Codex session record does not exist.");
    this.name = "MissingCodexThreadError";
  }
}

export class CodexRunner {
  private queue = Promise.resolve();

  constructor(private readonly options: CodexRunnerOptions) {}

  async ask(prompt: string): Promise<string> {
    return this.enqueue(() => this.askOnce(prompt));
  }

  async askExisting(prompt: string): Promise<string> {
    return this.enqueue(() => this.askOnce(prompt, { requireExistingThread: true }));
  }

  async startNewSession(prompt: string): Promise<string> {
    return this.enqueue(() => this.askOnce(prompt, { forceNewSession: true }));
  }

  async getState(): Promise<CodexRunnerState> {
    return readJsonFile<CodexRunnerState>(this.statePath(), {});
  }

  private async askOnce(prompt: string, behavior: {
    forceNewSession?: boolean;
    requireExistingThread?: boolean;
  } = {}): Promise<string> {
    const state = behavior.forceNewSession ? {} : await this.getState();
    if (behavior.requireExistingThread && !state.threadId) {
      throw new MissingCodexThreadError();
    }
    const startedAtMs = Date.now();
    const outputFile = this.outputPath(startedAtMs);
    const sessionsRoot = this.options.sessionsRoot ?? defaultCodexSessionsRoot();
    const knownSessionFiles = state.threadId ? null : listCodexSessionFiles(sessionsRoot);
    const args = this.buildArgs(state.threadId, outputFile);
    let stdout = "";
    let stderr = "";
    let finalText = "";
    try {
      const result = await this.spawnCodex(args, prompt, outputFile);
      stdout = result.stdout;
      stderr = result.stderr;
      finalText = readOutputFile(outputFile) || stdout.trim();
    } finally {
      removeFileIfExists(outputFile);
    }
    if (!finalText) {
      throw new Error(`Codex returned an empty response.${stderr.trim() ? ` stderr: ${stderr.trim()}` : ""}`);
    }

    if (!state.threadId) {
      const session = findMatchingNewCodexSessionForCwd({
        sessionsRoot,
        cwd: this.options.cwd,
        knownFiles: knownSessionFiles ?? [],
        prompt,
      });
      if (!session?.threadId) {
        throw new Error("Codex 没有创建可确认的新 session 文件。当前只做简化的相对完整确认：新增 session 必须匹配当前工作目录并包含本次完整用户消息。");
      }
      await writeJsonPrivate(this.statePath(), { threadId: session.threadId });
    }
    await this.appendTranscript(prompt, finalText, startedAtMs);
    return finalText;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private buildArgs(threadId: string | undefined, outputFile: string): string[] {
    const args = ["exec"];
    args.push("-C", this.options.cwd);
    args.push("--sandbox", this.options.sandbox ?? "read-only");
    args.push("-c", `approval_policy="${this.options.approval ?? "never"}"`);
    args.push("--output-last-message", outputFile);
    if (this.options.model) {
      args.push("--model", this.options.model);
    }
    if (this.options.profile) {
      args.push("--profile", this.options.profile);
    }
    if (threadId) {
      args.push("resume", threadId);
    }
    args.push("-");
    return args;
  }

  private spawnCodex(args: string[], prompt: string, outputFile: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      const spawnImpl = this.options.spawnImpl ?? defaultSpawn;
      const child = spawnImpl(this.options.codexBin ?? "codex", args, {
        cwd: this.options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      }) as ChildProcessWithoutNullStreams;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Codex exited with code ${code ?? "unknown"}: ${stderr.trim() || stdout.trim()}`));
        }
      });
      child.stdin.end(prompt);
    });
  }

  private statePath(): string {
    return path.join(this.options.stateDir, "codex-thread.json");
  }

  private outputPath(startedAtMs: number): string {
    const dir = this.options.outputDir ?? path.join(this.options.stateDir, "tmp");
    return path.join(dir, `codex-last-message-${startedAtMs}-${crypto.randomUUID()}.txt`);
  }

  private async appendTranscript(prompt: string, finalText: string, startedAtMs: number): Promise<void> {
    const filePath = this.options.transcriptFile ?? path.join(this.options.stateDir, "messages.jsonl");
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const inputSender = normalizeInputSender(this.options.inputSender);
    const lines = [
      JSON.stringify({ ts: startedAtMs, sender: inputSender, message: prompt }),
      JSON.stringify({ ts: Date.now(), sender: "codex", message: finalText }),
      "",
    ].join("\n");
    await fsp.appendFile(filePath, lines, { encoding: "utf8", mode: 0o600 });
    await fsp.chmod(filePath, 0o600).catch(() => {});
  }
}

function readOutputFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function removeFileIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // 临时输出文件删除失败不影响主流程；文件名不再作为持久记录使用。
  }
}

function normalizeInputSender(inputSender: string | undefined): string {
  const normalized = inputSender?.trim();
  if (!normalized) {
    throw new Error("缺少 Codex 对话消息发送者 accountId，无法写入 messages.jsonl。");
  }
  return normalized;
}
