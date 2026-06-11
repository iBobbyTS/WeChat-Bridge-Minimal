import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { CodexRunner } from "../src/codex/runner.js";
import { findNewestCodexSessionForCwd } from "../src/codex/session_files.js";

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

test("CodexRunner creates first thread then resumes it serially", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wcb-runner-"));
  const cwd = path.join(dir, "workspace");
  const sessionsRoot = path.join(dir, "sessions");
  await fsp.mkdir(cwd, { recursive: true });
  const calls: string[][] = [];

  const runner = new CodexRunner({
    stateDir: dir,
    cwd,
    sessionsRoot,
    codexBin: "codex",
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
        if (calls.length === 1) {
          const sessionDir = path.join(sessionsRoot, "2026", "06", "10");
          await fsp.mkdir(sessionDir, { recursive: true });
          await fsp.writeFile(path.join(sessionDir, "rollout-thread-abc.jsonl"), `${JSON.stringify({
            type: "session_meta",
            payload: { id: "thread-abc", cwd: options?.cwd, timestamp: new Date().toISOString() },
          })}\n`);
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
});
