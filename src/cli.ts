#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";
import { defaultAllowedIpStoreFile, defaultAuthDir, defaultStateDir, defaultTokenStoreFile } from "./config.js";
import { WeixinAccountStore } from "./weixin/account_store.js";
import { ContextTokenStore } from "./weixin/context_store.js";
import { loginWithQr } from "./weixin/login.js";
import {
  sendLoginHandshakeReply,
  waitForLoginHandshakeMessage,
} from "./weixin/login_handshake.js";
import { WeixinApiClient } from "./weixin/api.js";
import { buildTextMessage } from "./weixin/message.js";
import { createStderrLogger } from "./util/logger.js";
import { formatLocalDateTime } from "./util/time.js";
import { addToken, ensureDefaultTokens, readTokenStore, removeToken } from "./api/token_store.js";
import {
  addAllowedIp,
  ensureDefaultAllowedIps,
  readAllowedIpStore,
  removeAllowedIp,
} from "./api/allowed_ip_store.js";
import { BridgeRuntime } from "./bridge/runtime.js";
import { initializeCodexSession } from "./codex/initializer.js";

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
    case "test-message":
      await testMessageCommand();
      return;
    case "send-api-token":
      await tokenCommand(args.slice(1));
      return;
    case "send-api-allowed-ip":
      await allowedIpCommand(args.slice(1));
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
  const accountStore = new WeixinAccountStore(defaultAuthDir(stateDir));
  const contextStore = new ContextTokenStore(stateDir);
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
  process.stdout.write(`微信登录成功：账号 ${result.account.accountId}，用户 ${result.account.userId}\n`);
  const api = new WeixinApiClient({
    baseUrl: result.account.baseUrl,
    token: result.account.token,
  });
  process.stdout.write("请在手机微信里给这台电脑发送任意消息，例如“你好”。这条消息只用于完成连接，不会发送给 Codex。\n");
  const handshake = await waitForLoginHandshakeMessage({
    api,
    contextStore,
    targetUserId: result.account.userId,
    onIgnoredMessage: (reason, message) => {
      if (reason === "wrong_user" && message) {
        logger.debug(`登录握手已忽略非目标用户消息：${message.senderId}`);
      }
    },
  });
  process.stdout.write(`已收到手机微信消息并保存上下文令牌：${handshake.senderId}\n`);
  try {
    await sendLoginHandshakeReply({
      api,
      targetUserId: result.account.userId,
      contextToken: handshake.contextToken,
    });
    process.stdout.write("连接成功回执已发送到手机。\n");
  } catch (error) {
    process.stderr.write(`连接成功回执发送失败：${error instanceof Error ? error.message : String(error)}\n`);
  }
  try {
    process.stdout.write("正在创建 Codex 会话并保存 session id...\n");
    const codexSession = await initializeCodexSession({
      stateDir,
      cwd: process.cwd(),
      inputSender: result.account.accountId,
      logger,
      forceNew: true,
    });
    process.stdout.write(`Codex 会话已创建并保存 session id：${codexSession.threadId ?? ""}\n`);
  } catch (error) {
    process.stderr.write(`Codex 会话创建失败：${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function testMessageCommand(): Promise<void> {
  const stateDir = defaultStateDir();
  const accountStore = new WeixinAccountStore(defaultAuthDir(stateDir));
  const contextStore = new ContextTokenStore(stateDir);
  const account = await accountStore.load();
  if (!account) {
    throw new Error("没有可用的微信登录凭证，请先运行 npm run weixin:login。");
  }
  const text = buildTestMessageText();
  const contextToken = await contextStore.get(account.userId);
  assertContextToken(contextToken);
  const api = new WeixinApiClient({
    baseUrl: account.baseUrl,
    token: account.token,
  });
  await api.sendMessage(buildTextMessage({
    toUserId: account.userId,
    text,
    contextToken,
  }));
  process.stdout.write(`测试消息已发送到手机：${account.userId}\n`);
}

function assertContextToken(contextToken: string | null): asserts contextToken is string {
  if (!contextToken) {
    throw new Error("没有可用的微信上下文令牌。请先在手机微信里给桥接账号发送任意一条消息，然后再重试。");
  }
}

export function buildTestMessageText(date = new Date()): string {
  return `测试消息。\n发送时间: ${formatLocalDateTime(date)}`;
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
      process.stdout.write(`令牌文件：${tokenFile}\n`);
      printTokenList(store);
      return;
    }
    case "list": {
      process.stdout.write(`令牌文件：${tokenFile}\n`);
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

async function allowedIpCommand(args: string[]): Promise<void> {
  const allowedIpFile = defaultAllowedIpStoreFile(defaultStateDir());
  const subcommand = args[0] ?? "list";
  switch (subcommand) {
    case "ensure-defaults": {
      const ips = await ensureDefaultAllowedIps(allowedIpFile);
      process.stdout.write(`IP 白名单文件：${allowedIpFile}\n`);
      printAllowedIpList(ips);
      return;
    }
    case "list": {
      process.stdout.write(`IP 白名单文件：${allowedIpFile}\n`);
      printAllowedIpList(await readAllowedIpStore(allowedIpFile));
      return;
    }
    case "add": {
      const ip = readOption(args, "--ip") ?? args[1];
      if (!ip) {
        throw new Error("用法：send-api-allowed-ip add --ip <IP>");
      }
      const ips = await addAllowedIp(allowedIpFile, ip);
      process.stdout.write(`已添加 IP 白名单：${ip}\n`);
      printAllowedIpList(ips);
      return;
    }
    case "remove": {
      const ip = readOption(args, "--ip") ?? args[1];
      if (!ip) {
        throw new Error("用法：send-api-allowed-ip remove --ip <IP>");
      }
      const removed = await removeAllowedIp(allowedIpFile, ip);
      process.stdout.write(removed ? "已删除 IP 白名单。\n" : "未找到 IP 白名单。\n");
      return;
    }
    default:
      throw new Error(`未知 send-api-allowed-ip 命令：${subcommand}`);
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

function printAllowedIpList(ips: string[]): void {
  if (!ips.length) {
    process.stdout.write("（没有 IP 白名单）\n");
    return;
  }
  for (const ip of ips) {
    process.stdout.write(`${ip}\n`);
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
  wechat-bridge-minimal weixin test-message
  wechat-bridge-minimal weixin serve
  wechat-bridge-minimal weixin send-api-token ensure-defaults|list|add|remove
  wechat-bridge-minimal weixin send-api-allowed-ip ensure-defaults|list|add|remove
`);
}

if (isCliEntrypoint()) {
  main(process.argv.slice(2)).catch(async (error) => {
    await fsp.mkdir(path.join(defaultStateDir(), "logs"), { recursive: true }).catch(() => {});
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

function isCliEntrypoint(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && path.resolve(entry) === fileURLToPath(import.meta.url));
}
