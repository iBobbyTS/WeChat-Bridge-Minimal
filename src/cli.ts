#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";
import qrcode from "qrcode-terminal";
import { defaultAccountsDir, defaultStateDir, defaultTokenStoreFile } from "./config.js";
import { WeixinAccountStore } from "./weixin/account_store.js";
import { loginWithQr } from "./weixin/login.js";
import { WeixinApiClient } from "./weixin/api.js";
import { buildTextMessage } from "./weixin/message.js";
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
      throw new Error(`未知命令：${command}`);
  }
}

async function loginCommand(): Promise<void> {
  const stateDir = defaultStateDir();
  const accountStore = new WeixinAccountStore(defaultAccountsDir(stateDir));
  const logger = createStderrLogger(true);
  if (await accountStore.hasAnyCredentials()) {
    const answer = await readLine("检测到已有微信登录凭证。是否删除已有凭证并重新登录？输入 y 删除并继续，其他输入退出：");
    if (!isAffirmative(answer)) {
      process.stdout.write("已保留现有凭证，取消登录。\n");
      return;
    }
    await accountStore.clearAll();
    process.stdout.write("已删除现有微信登录凭证，继续登录。\n");
  }
  const result = await loginWithQr({
    accountStore,
    logger,
    displayQr: (url) => {
      qrcode.generate(url, { small: true });
      process.stdout.write(`${url}\n`);
    },
    readVerifyCode: (prompt) => readLine(prompt),
  });
  await sendLoginSuccessNotice(result.account).catch((error) => {
    logger.warn(`微信登录已成功，但连接成功回执发送失败：${error instanceof Error ? error.message : String(error)}`);
  });
  process.stdout.write(`微信登录成功：账号 ${result.account.accountId}，用户 ${result.account.userId}\n`);
}

async function sendLoginSuccessNotice(account: {
  baseUrl: string;
  token: string;
  userId: string;
}): Promise<void> {
  const api = new WeixinApiClient({
    baseUrl: account.baseUrl,
    token: account.token,
  });
  await api.sendMessage(buildTextMessage({
    toUserId: account.userId,
    text: "微信桥接已成功连接。",
  }));
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
        throw new Error("用法：send-api-token add --name <名称> [--token <令牌>]");
      }
      const token = await addToken(tokenFile, name, readOption(args, "--token") ?? undefined);
      process.stdout.write(`已为 ${name} 添加令牌：${token}\n`);
      return;
    }
    case "remove": {
      const token = readOption(args, "--token") ?? args[1];
      if (!token) {
        throw new Error("用法：send-api-token remove --token <令牌>");
      }
      const removed = await removeToken(tokenFile, token);
      process.stdout.write(removed ? "已删除令牌。\n" : "未找到令牌。\n");
      return;
    }
    default:
      throw new Error(`未知 send-api-token 命令：${subcommand}`);
  }
}

function printTokenList(store: Awaited<ReturnType<typeof readTokenStore>>): void {
  const entries = Object.entries(store);
  if (!entries.length) {
    process.stdout.write("（没有令牌）\n");
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

function isAffirmative(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y";
}

function printHelp(): void {
  process.stdout.write(`用法：
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
