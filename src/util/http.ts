export async function readLimitedBody(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) {
        chunks.push(buffer);
      }
    });
    stream.on("end", () => {
      if (tooLarge) {
        reject(new Error("request_body_too_large"));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    stream.on("error", reject);
  });
}

export function normalizeRequiredString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}
