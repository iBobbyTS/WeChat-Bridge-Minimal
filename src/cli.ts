#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";
import qrcode from "qrcode-terminal";
import { defaultAccountsDir, defaultStateDir, defaultTokenStoreFile } from "./config.js";
import { WeixinAccountStore } from "./weixin/account_store.js";
import { loginWithQr } from "./weixin/login.js";
import { createStderrLogger } from "./util/logger.js";
import { addToken, ensureDefaultTokens, readTokenStore, removeToken } from "./api/token_store.js";
import { BridgeRuntime } from "./bridge/runtime.js";

async function main(argv: string[]): Promise<void> {
  const args = argv[0] === "weixin" ? argv.slice(1) : argv;
  const command = args[0] ?? "help";
  switch (command) {
    case "login":
      await loginCommand();
      return;
    case "serve":
      await serveCommand();
      return;
    case "send-api-token":
      await tokenCommand(args.slice(1));
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function loginCommand(): Promise<void> {
  const stateDir = defaultStateDir();
  const accountStore = new WeixinAccountStore(defaultAccountsDir(stateDir));
  const result = await loginWithQr({
    accountStore,
    logger: createStderrLogger(true),
    displayQr: (url) => {
      qrcode.generate(url, { small: true });
      process.stdout.write(`${url}\n`);
    },
    readVerifyCode: (prompt) => readLine(prompt),
  });
  process.stdout.write(`Logged in Weixin account ${result.account.accountId}, user ${result.account.userId}\n`);
}

async function serveCommand(): Promise<void> {
  const runtime = new BridgeRuntime();
  await runtime.start();
  process.once("SIGINT", () => void runtime.stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void runtime.stop().finally(() => process.exit(0)));
  await new Promise(() => {});
}

async function tokenCommand(args: string[]): Promise<void> {
  const tokenFile = process.env.WECHAT_SEND_API_TOKEN_FILE?.trim() || defaultTokenStoreFile(defaultStateDir());
  const subcommand = args[0] ?? "list";
  switch (subcommand) {
    case "ensure-defaults": {
      const store = await ensureDefaultTokens(tokenFile);
      process.stdout.write(`Token file: ${tokenFile}\n`);
      printTokenList(store);
      return;
    }
    case "list": {
      process.stdout.write(`Token file: ${tokenFile}\n`);
      printTokenList(await readTokenStore(tokenFile));
      return;
    }
    case "add": {
      const name = readOption(args, "--name") ?? args[1];
      if (!name) {
        throw new Error("Usage: send-api-token add --name <name> [--token <token>]");
      }
      const token = await addToken(tokenFile, name, readOption(args, "--token") ?? undefined);
      process.stdout.write(`Added token for ${name}: ${token}\n`);
      return;
    }
    case "remove": {
      const token = readOption(args, "--token") ?? args[1];
      if (!token) {
        throw new Error("Usage: send-api-token remove --token <token>");
      }
      const removed = await removeToken(tokenFile, token);
      process.stdout.write(removed ? "Removed token.\n" : "Token not found.\n");
      return;
    }
    default:
      throw new Error(`Unknown send-api-token command: ${subcommand}`);
  }
}

function printTokenList(store: Awaited<ReturnType<typeof readTokenStore>>): void {
  const entries = Object.entries(store);
  if (!entries.length) {
    process.stdout.write("(no tokens)\n");
    return;
  }
  for (const [token, record] of entries) {
    process.stdout.write(`${record.name}\t${token}\t${record.createdAt}\n`);
  }
}

function readOption(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }
  return args[index + 1] ?? null;
}

function readLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  return new Promise((resolve) => {
    const onData = (chunk: string) => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      resolve(chunk.trim());
    };
    process.stdin.on("data", onData);
  });
}

function printHelp(): void {
  process.stdout.write(`Usage:
  wechat-bridge-minimal weixin login
  wechat-bridge-minimal weixin serve
  wechat-bridge-minimal weixin send-api-token ensure-defaults|list|add|remove
`);
}

main(process.argv.slice(2)).catch(async (error) => {
  await fsp.mkdir(path.join(defaultStateDir(), "logs"), { recursive: true }).catch(() => {});
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
