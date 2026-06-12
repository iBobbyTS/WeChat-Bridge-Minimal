import fsp from "node:fs/promises";

export interface LoadEnvFileOptions {
  env?: NodeJS.ProcessEnv;
  override?: boolean;
}

export async function loadEnvFile(filePath: string, options: LoadEnvFileOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  let content: string;
  try {
    content = await fsp.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  for (const [key, value] of parseEnvFileContent(content)) {
    if (!options.override && Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) {
      continue;
    }
    env[key] = value;
  }
  return true;
}

export function parseEnvFileContent(content: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
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
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    entries.push([key, unquoteEnvValue(line.slice(index + 1).trim())]);
  }
  return entries;
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
