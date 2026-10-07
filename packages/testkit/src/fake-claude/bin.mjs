#!/usr/bin/env node
// Scriptable stand-in for the `claude` CLI. Plays back a scenario file so
// agent runner tests are fast, free, and deterministic.
//
// Env:
//   FAKE_CLAUDE_SCENARIO  path to a scenario JSON (see scenario.ts). Required.
//   FAKE_CLAUDE_RECORD    optional path; argv, cwd, stdin, and env keys are written here.
//
// Plain JS on purpose: it must run under bare `node` on every OS with no loader.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const scenarioPath = process.env.FAKE_CLAUDE_SCENARIO;
if (!scenarioPath) {
  process.stderr.write("fake-claude: FAKE_CLAUDE_SCENARIO is not set\n");
  process.exit(64);
}

/** @type {{ steps: Array<Record<string, any>>, exitCode?: number, readStdin?: boolean }} */
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));

/** @returns {Promise<string>} */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** @param {NodeJS.WritableStream} stream @param {string} text */
function write(stream, text) {
  return new Promise((resolve) => {
    if (stream.write(text)) resolve(undefined);
    else stream.once("drain", () => resolve(undefined));
  });
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const stdin = scenario.readStdin ? await readStdin() : null;

  const recordPath = process.env.FAKE_CLAUDE_RECORD;
  if (recordPath) {
    const record = {
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      stdin,
      envKeys: Object.keys(process.env).sort(),
    };
    writeFileSync(recordPath, JSON.stringify(record, null, 2));
  }

  for (const step of scenario.steps) {
    if ("emit" in step) {
      await write(process.stdout, `${JSON.stringify(step.emit)}\n`);
    } else if ("stdout" in step) {
      await write(process.stdout, `${step.stdout}\n`);
    } else if ("stderr" in step) {
      await write(process.stderr, `${step.stderr}\n`);
    } else if ("repeat" in step) {
      for (let i = 0; i < step.repeat.times; i++) {
        await write(process.stdout, `${JSON.stringify(step.repeat.emit)}\n`);
      }
    } else if ("sleep" in step) {
      await sleep(step.sleep);
    } else if ("writeFile" in step) {
      const target = path.resolve(process.cwd(), step.writeFile.path);
      try {
        writeFileSync(target, step.writeFile.content);
        await write(
          process.stdout,
          `${JSON.stringify({ type: "fake_write", path: target, ok: true })}\n`,
        );
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "UNKNOWN";
        await write(
          process.stdout,
          `${JSON.stringify({ type: "fake_write", path: target, ok: false, code })}\n`,
        );
      }
    } else if ("hang" in step) {
      // Keep the event loop alive until the parent kills us.
      setInterval(() => {}, 1 << 30);
      await new Promise(() => {});
    } else if ("crash" in step) {
      throw new Error(step.crash);
    } else {
      throw new Error(`fake-claude: unknown step ${JSON.stringify(step)}`);
    }
  }

  // Let stdio flush naturally instead of process.exit, which can truncate pipes.
  process.exitCode = scenario.exitCode ?? 0;
}

main().catch((err) => {
  process.stderr.write(
    `fake-claude crashed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = 70;
});
