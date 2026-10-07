// SPEC 10.4: fixtures carry no secret-like strings and no real domains or
// emails outside the allow-list in scripts/lib/hosts.mjs.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDisallowedHosts } from "./lib/hosts.mjs";
import { listRepoFiles, REPO_ROOT, readTextFile } from "./lib/repo-files.mjs";
import { findSecrets } from "./lib/secret-patterns.mjs";

const fixtureFiles = () => listRepoFiles().filter((f) => f.split("/").includes("fixtures"));

describe("findDisallowedHosts", () => {
  it("allows reserved example domains and localhost", () => {
    expect(
      findDisallowedHosts(
        "http://localhost:3000 dev@example.com https://api.example.org x@team.test",
      ),
    ).toEqual([]);
  });

  it("flags real-looking hosts and emails", () => {
    expect(findDisallowedHosts("see https://corp.acme.io and mail bob@realcompany.com")).toEqual([
      "corp.acme.io",
      "realcompany.com",
    ]);
  });
});

describe("fixture hygiene", () => {
  it("there are fixtures to check", () => {
    expect(fixtureFiles().length).toBeGreaterThan(0);
  });

  it("no fixture contains a secret-like string", () => {
    const hits = fixtureFiles().flatMap((f) => {
      const text = readTextFile(path.join(REPO_ROOT, f));
      return text === null ? [] : findSecrets(text).map((h) => `${f}:${h.line} ${h.rule}`);
    });
    expect(hits).toEqual([]);
  });

  it("no fixture names a real domain or email", () => {
    const hits = fixtureFiles().flatMap((f) => {
      const text = readTextFile(path.join(REPO_ROOT, f));
      return text === null ? [] : findDisallowedHosts(text).map((h) => `${f}: ${h}`);
    });
    expect(hits).toEqual([]);
  });
});
