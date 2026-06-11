import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { CodexRunner, MissingCodexThreadError } from "../src/codex/runner.js";
import { findMatchingNewCodexSessionForCwd, findNewestCodexSessionForCwd, listCodexSessionFiles } from "../src/codex/session_files.js";

test("findNewestCodexSessionForCwd reads Codex session meta", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-session-"));
  const cwd = path.join(dir, "workspace");
  const sessionDir = path.join(dir, "sessions", "2026", "06", "10");
  await fsp.mkdir(sessionDir, { recursive: true });
  const file = path.join(sessionDir, "rollout-thread-1.jsonl");
  await fsp.writeFile(file, `${JSON.stringify({
    type: "session_meta",
    payload: { id: "thread-1", cwd, timestamp: new Date().toISOString() },
  })}\n`);

  const found = findNewestCodexSessionForCwd({ sessionsRoot: path.join(dir, "sessions"), cwd, sinceMs: Date.now() - 1000 });
  assert.equal(found?.threadId, "thread-1");
});

test("findMatchingNewCodexSessionForCwd selects a new session that contains the full prompt", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-session-match-"));
  const cwd = path.join(dir, "workspace");
  const sessionsRoot = path.join(dir, "sessions");
  const sessionDir = path.join(sessionsRoot, "2026", "06", "10");
  await fsp.mkdir(sessionDir, { recursive: true });
  const oldFile = path.join(sessionDir, "rollout-old.jsonl");
  const wrongNewFile = path.join(sessionDir, "rollout-wrong-newer.jsonl");
  const matchedNewFile = path.join(sessionDir, "rollout-matched.jsonl");
  const prompt = "完整用户消息\n第二行";

  await writeSessionFile(oldFile, "old-thread", cwd, "旧消息", "2026-06-10T01:00:00.000Z");
  const knownFiles = listCodexSessionFiles(sessionsRoot);
  await writeSessionFile(matchedNewFile, "matched-thread", cwd, `用户：${prompt}`, "2026-06-10T01:01:00.000Z");
  await writeSessionFile(wrongNewFile, "wrong-thread", cwd, "别的消息", "2026-06-10T01:02:00.000Z");

  const found = findMatchingNewCodexSessionForCwd({
    sessionsRoot,
    cwd,
    knownFiles,
    prompt,
  });

  assert.equal(found?.threadId, "matched-thread");
});

test("CodexRunner creates first thread then resumes it serially", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-runner-"));
  const cwd = path.join(dir, "workspace");
  const sessionsRoot = path.join(dir, "sessions");
  await fsp.mkdir(cwd, { recursive: true });
  const calls: string[][] = [];
  const outputPaths: string[] = [];

  const runner = new CodexRunner({
    stateDir: dir,
    cwd,
    sessionsRoot,
    codexBin: "codex",
    inputSender: "bot@example",
    spawnImpl: ((_cmd: string, args: readonly string[], options?: { cwd?: string }) => {
      calls.push([...args]);
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(async () => {
        const outputIndex = args.indexOf("--output-last-message");
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "";
        outputPaths.push(String(outputPath));
        if (calls.length === 1) {
          const sessionDir = path.join(sessionsRoot, "2026", "06", "10");
          await fsp.mkdir(sessionDir, { recursive: true });
          await writeSessionFile(
            path.join(sessionDir, "rollout-thread-abc.jsonl"),
            "thread-abc",
            String(options?.cwd),
            "one",
          );
        }
        await fsp.writeFile(String(outputPath), `reply-${calls.length}`);
        child.emit("exit", 0);
      });
      return child as never;
    }) as never,
  });

  assert.equal(await runner.ask("one"), "reply-1");
  assert.equal(await runner.ask("two"), "reply-2");
  assert.deepEqual(calls[0]?.slice(0, 7), [
    "exec",
    "-C",
    cwd,
    "--sandbox",
    "read-only",
    "-c",
    "approval_policy=\"never\"",
  ]);
  assert.deepEqual(calls[0]?.slice(-1), ["-"]);
  assert.deepEqual(calls[1]?.slice(-3), ["resume", "thread-abc", "-"]);
  assert.equal(outputPaths.every((filePath) => !path.basename(filePath).startsWith("codex-output-")), true);
  for (const outputPath of outputPaths) {
    await assert.rejects(() => fsp.stat(outputPath), /ENOENT/);
  }
  const transcript = await readJsonLines(path.join(dir, "messages.jsonl"));
  assert.deepEqual(transcript.map((entry) => entry.sender), ["bot@example", "codex", "bot@example", "codex"]);
  assert.deepEqual(transcript.map((entry) => entry.message), ["one", "reply-1", "two", "reply-2"]);
  assert.equal(transcript.every((entry) => typeof entry.ts === "number" && entry.ts > 0), true);
  assert.equal(transcript.every((entry) => Object.keys(entry).sort().join(",") === "message,sender,ts"), true);
});

test("CodexRunner askExisting requires a saved thread and does not create one from user prompt", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-runner-existing-"));
  const cwd = path.join(dir, "workspace");
  let spawnCount = 0;
  const runner = new CodexRunner({
    stateDir: dir,
    cwd,
    spawnImpl: (() => {
      spawnCount += 1;
      throw new Error("spawn should not run");
    }) as never,
  });

  await assert.rejects(
    () => runner.askExisting("用户首条复杂消息"),
    MissingCodexThreadError,
  );
  assert.equal(spawnCount, 0);
});

test("CodexRunner refuses first thread when new sessions do not contain the full prompt", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-runner-mismatch-"));
  const cwd = path.join(dir, "workspace");
  const sessionsRoot = path.join(dir, "sessions");
  await fsp.mkdir(cwd, { recursive: true });

  const runner = new CodexRunner({
    stateDir: dir,
    cwd,
    sessionsRoot,
    codexBin: "codex",
    spawnImpl: ((_cmd: string, args: readonly string[], options?: { cwd?: string }) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(async () => {
        const outputIndex = args.indexOf("--output-last-message");
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "";
        const sessionDir = path.join(sessionsRoot, "2026", "06", "10");
        await fsp.mkdir(sessionDir, { recursive: true });
        await writeSessionFile(
          path.join(sessionDir, "rollout-thread-wrong.jsonl"),
          "thread-wrong",
          String(options?.cwd),
          "只有部分用户消息",
        );
        await fsp.writeFile(String(outputPath), "reply");
        child.emit("exit", 0);
      });
      return child as never;
    }) as never,
  });

  await assert.rejects(
    () => runner.ask("完整用户消息"),
    /新增 session 必须匹配当前工作目录并包含本次完整用户消息/,
  );
});

async function writeSessionFile(
  filePath: string,
  threadId: string,
  cwd: string,
  body: string,
  timestamp = new Date().toISOString(),
): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, [
    JSON.stringify({
      type: "session_meta",
      payload: { id: threadId, cwd, timestamp },
    }),
    JSON.stringify({
      type: "user_message",
      payload: { text: body },
    }),
    "",
  ].join("\n"));
}

async function readJsonLines(filePath: string): Promise<Array<Record<string, unknown>>> {
  const content = await fsp.readFile(filePath, "utf8");
  return content.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
