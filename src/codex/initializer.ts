import path from "node:path";
import { CodexRunner, MissingCodexThreadError, type CodexRunnerOptions } from "./runner.js";
import type { Logger } from "../util/logger.js";

export const CODEX_SESSION_INITIAL_PROMPT = "你好";

export interface CodexSessionInitializerOptions {
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  logger?: Pick<Logger, "info" | "warn">;
  runner?: Pick<CodexRunner, "getState" | "startNewSession">;
  forceNew?: boolean;
}

export async function initializeCodexSession(options: CodexSessionInitializerOptions): Promise<{
  initialized: boolean;
  threadId?: string;
}> {
  const runner = options.runner ?? new CodexRunner(createDefaultCodexRunnerOptions({
    stateDir: options.stateDir,
    env: options.env,
    cwd: options.cwd,
  }));
  const before = options.forceNew ? {} : await runner.getState();
  if (!options.forceNew && before.threadId) {
    options.logger?.info(`Codex 会话已存在：${before.threadId}`);
    return { initialized: false, threadId: before.threadId };
  }

  options.logger?.info("正在创建新的 Codex 会话并保存 session id...");
  await runner.startNewSession(CODEX_SESSION_INITIAL_PROMPT);
  const after = await runner.getState();
  if (!after.threadId) {
    throw new Error("Codex 会话创建完成，但没有保存 session id。");
  }
  options.logger?.info(`Codex 会话已创建并保存 session id：${after.threadId}`);
  return { initialized: true, threadId: after.threadId };
}

export async function askCodexWithInitializedSession(options: {
  stateDir: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  logger?: Pick<Logger, "info" | "warn">;
  runner?: Pick<CodexRunner, "askExisting" | "getState" | "startNewSession">;
}): Promise<string> {
  const runner = options.runner ?? new CodexRunner(createDefaultCodexRunnerOptions({
    stateDir: options.stateDir,
    env: options.env,
    cwd: options.cwd,
  }));
  try {
    return await runner.askExisting(options.prompt);
  } catch (error) {
    if (error instanceof MissingCodexThreadError) {
      options.logger?.warn("没有已保存的 Codex session id，将创建新的 Codex 会话并保存 session id。");
    } else {
      options.logger?.warn(`已保存的 Codex session id 不可用，将创建新的 Codex 会话并保存新的 session id：${error instanceof Error ? error.message : String(error)}`);
    }
    await initializeCodexSession({
      stateDir: options.stateDir,
      env: options.env,
      cwd: options.cwd,
      logger: options.logger,
      runner,
      forceNew: true,
    });
    return runner.askExisting(options.prompt);
  }
}

export function createDefaultCodexRunnerOptions(params: {
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): CodexRunnerOptions {
  const env = params.env ?? process.env;
  return {
    stateDir: params.stateDir,
    cwd: path.resolve(env.CODEX_CWD?.trim() || params.cwd || process.cwd()),
    codexBin: env.CODEX_BIN?.trim() || "codex",
    model: env.CODEX_MODEL?.trim() || undefined,
    profile: env.CODEX_PROFILE?.trim() || undefined,
    sandbox: env.CODEX_SANDBOX?.trim() || "read-only",
    approval: env.CODEX_APPROVAL?.trim() || "never",
  };
}
