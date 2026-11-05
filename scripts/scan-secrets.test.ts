import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./lib/repo-files.mjs";
import { findSecrets } from "./lib/secret-patterns.mjs";
import { scanRepo, stagedInputs } from "./scan-secrets.mjs";
import { tempGitRepo } from "./test-helpers.ts";

// Fake secrets are assembled at runtime so this file never contains a literal
// that our scanner or gitleaks would flag.
const j = (...parts: string[]) => parts.join("");
const FAKE = {
  "aws-access-key-id": j("AKIA", "QWERTYUIOPASDFGH"),
  "github-token": j("ghp", "_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"),
  "github-fine-grained-pat": j(
    "github_pat",
    "_",
    "11ABCDEFG0",
    "a".repeat(30),
    "_",
    "b".repeat(20),
  ),
  "slack-token": j("xox", "b-", "1234567890-0987654321-AbCdEfGhIjKlMnOp"),
  "slack-webhook": j(
    "https://hooks.slack",
    ".com/services/",
    "T0000/B0000/abcdefghijklmnopqrstuvwx",
  ),
  "google-api-key": j("AI", "za", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"),
  // Short pieces: one long random-looking piece trips gitleaks' generic-api-key rule.
  "anthropic-api-key": j("sk-", "ant-", "api03-", "Zx9Yw8", "Vu7Ts6", "Rq5Po4", "Nm3Lk2"),
  "openai-style-key": j("sk-", "proj-", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7"),
  "stripe-live-key": j("sk", "_live_", "51HqZxYwVuTsRqPoNmLkJiHg"),
  "private-key-block": j("-----BEGIN ", "RSA ", "PRIVATE KEY-----"),
  jwt: j(
    "eyJ",
    "hbGciOiJIUzI1NiJ9",
    ".",
    "eyJ",
    "zdWIiOiIxMjM0NTY3ODkwIn0",
    ".",
    "SflKxwRJSMeKKF2QT4fwpM",
  ),
  "url-with-password": j("postgres://", "admin", ":", "hunter2hunter2", "@db.internal:5432/app"),
  "assigned-secret": j("password", ' = "', "Tr0ub4dor&3xyz", '"'),
} as const;

describe("findSecrets", () => {
  it.each(Object.entries(FAKE))("detects %s", (rule, value) => {
    expect(findSecrets(`line one\n${value}\n`).map((h) => h.rule)).toContain(rule);
  });

  it("never echoes more than 4 characters of the value", () => {
    for (const value of Object.values(FAKE)) {
      const hits = findSecrets(value);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) expect(hit.preview).toMatch(/^.{1,4}\.\.\.$/);
    }
  });

  it("reports the line number", () => {
    expect(findSecrets(`a\nb\n${FAKE["aws-access-key-id"]}`)[0]?.line).toBe(3);
  });

  it.each([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the test input
    'password = "${process.env.DB_PASSWORD}"',
    'token: "<your-token-here>"',
    'api_key = "xxxxxxxxxxxxxxxx"',
    'secret = "changeme-changeme"',
    'token = "short"',
    "const tokenizer = createTokenizer();",
  ])("ignores placeholder or non-secret %j", (line) => {
    expect(findSecrets(line)).toEqual([]);
  });

  it("skips lines with the allow marker", () => {
    expect(findSecrets(`${FAKE["aws-access-key-id"]} // secret-scan-allow: test`)).toEqual([]);
  });
});

describe("scan-secrets on the real repo", () => {
  it("finds nothing", () => {
    expect(scanRepo()).toEqual([]);
  });
});

describe("staged scan and pre-commit hook", () => {
  let repo: ReturnType<typeof tempGitRepo> | undefined;
  afterEach(() => repo?.cleanup());

  it("stagedInputs reads the index, not the working tree", () => {
    repo = tempGitRepo();
    repo.write("a.txt", "staged content\n");
    repo.git(["add", "a.txt"]);
    repo.write("a.txt", `${FAKE["aws-access-key-id"]}\n`);
    expect(stagedInputs(repo.dir)).toEqual([{ file: "a.txt", text: "staged content\n" }]);
  });

  it("the hook blocks a commit containing a secret and allows a clean one", () => {
    repo = tempGitRepo();
    const hooks = path.join(REPO_ROOT, ".githooks");
    repo.git(["config", "core.hooksPath", hooks]);

    repo.write("clean.txt", "nothing to see\n");
    repo.git(["add", "clean.txt"]);
    const ok = repo.git(["commit", "-q", "-m", "clean"]);
    expect(ok.code, ok.stderr).toBe(0);

    repo.write("leak.ts", `const k = "${FAKE["github-token"]}";\n`);
    repo.git(["add", "leak.ts"]);
    const blocked = repo.git(["commit", "-q", "-m", "leak"]);
    expect(blocked.code).not.toBe(0);
    expect(blocked.stderr).toContain("github-token");
    expect(blocked.stderr).not.toContain(FAKE["github-token"]);
    const log = repo.git(["log", "--oneline"]);
    expect(log.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("the CLI exits 1 on explicit files with secrets", () => {
    repo = tempGitRepo();
    repo.write("x.env.sample", `${FAKE["slack-token"]}\n`);
    const res = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "scan-secrets.mjs"), "x.env.sample"],
      {
        cwd: repo.dir,
        encoding: "utf8",
      },
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("slack-token");
  });
});
