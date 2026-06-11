#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(args.rootDir ?? path.join(path.dirname(scriptPath), "..", ".."));
const configDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? ".", ".config"), "wechat-bridge-minimal");
const stateDir = path.resolve(args.stateDir ?? process.env.WECHAT_BRIDGE_STATE_DIR ?? path.join(configDir, "state"));
const envFile = path.resolve(args.envFile ?? path.join(configDir, "service.env"));

await loadEnvFile(envFile);
process.env.WECHAT_BRIDGE_STATE_DIR ||= stateDir;
await fsp.mkdir(path.join(stateDir, "logs"), { recursive: true });

let child = null;
let stopping = false;

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

while (!stopping) {
  const code = await runChild();
  if (stopping) {
    process.exitCode = code ?? 0;
    break;
  }
  await sleep(2000);
}

function runChild() {
  const cliPath = path.join(rootDir, "src", "cli.ts");
  child = spawn(process.execPath, ["--import", "tsx", cliPath, "weixin", "serve"], {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  return new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(error.stack ?? error.message);
      resolve(1);
    });
    child.once("exit", (code) => {
      child = null;
      resolve(code);
    });
  });
}

function stop(signal) {
  stopping = true;
  if (child && !child.killed) {
    child.kill(signal);
  }
}

async function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = await fsp.readFile(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg.startsWith("--") && next && !next.startsWith("--")) {
      parsed[arg.slice(2).replace(/-([a-z])/gu, (_, char) => char.toUpperCase())] = next;
      index += 1;
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
