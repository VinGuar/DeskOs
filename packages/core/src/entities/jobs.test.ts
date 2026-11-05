import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FakeClock, makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { JobRepository, WorkspaceMismatchError } from "./jobs.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function setup(workspaceId = "ws-1") {
  const t = makeTempDir();
  cleanups.push(t.cleanup);
  const internalDir = path.join(t.dir, ".deskos");
  const clock = new FakeClock();
  let n = 0;
  const jobs = new JobRepository({ internalDir, workspaceId, clock, newId: () => `job-${++n}` });
  return { internalDir, clock, jobs };
}

describe("JobRepository", () => {
  it("creates a queued job with operational fields, stored as JSON under .deskos/jobs", async () => {
    const { internalDir, jobs } = setup();
    const job = await jobs.create({ title: "Tidy notes", instructions: "Do it", source: "user" });
    expect(job).toEqual({
      id: "job-1",
      workspace_id: "ws-1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      source: "user",
      title: "Tidy notes",
      instructions: "Do it",
      state: "queued",
      budget: {},
    });
    const onDisk = JSON.parse(readFileSync(path.join(internalDir, "jobs", "job-1.json"), "utf8"));
    expect(onDisk).toEqual(job);
  });

  it("updates state and sandbox, bumping updated_at only", async () => {
    const { clock, jobs } = setup();
    await jobs.create({ title: "t", instructions: "", source: "user" });
    clock.advance(5000);
    const next = await jobs.update("job-1", {
      state: "running",
      sandbox: { provider: "scratch", path: "/tmp/x", created_at: "2026-01-01T00:00:05.000Z" },
    });
    expect(next).toMatchObject({
      state: "running",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:05.000Z",
      sandbox: { provider: "scratch" },
    });
  });

  it("serializes concurrent updates so none are lost", async () => {
    const { jobs } = setup();
    await jobs.create({ title: "t", instructions: "", source: "user" });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        jobs.update("job-1", { [`note_${i}`]: i } as Record<string, unknown>),
      ),
    );
    const job = await jobs.get("job-1");
    for (let i = 0; i < 20; i++) expect(job).toHaveProperty(`note_${i}`, i);
  });

  it.each(["id", "workspace_id", "created_at"])("refuses to change %s", async (field) => {
    const { jobs } = setup();
    await jobs.create({ title: "t", instructions: "", source: "user" });
    await expect(jobs.update("job-1", { [field]: "x" } as never)).rejects.toThrow(/cannot change/);
  });

  it("rejects bad states and budgets", async () => {
    const { jobs } = setup();
    await jobs.create({ title: "t", instructions: "", source: "user" });
    await expect(jobs.update("job-1", { state: "paused" as never })).rejects.toThrow();
    await expect(
      jobs.create({ title: "t", instructions: "", source: "user", budget: { max_cost_usd: -1 } }),
    ).rejects.toThrow();
  });

  it("lists by creation time and filters by state", async () => {
    const { clock, jobs } = setup();
    await jobs.create({ title: "a", instructions: "", source: "user" });
    clock.advance(1);
    await jobs.create({ title: "b", instructions: "", source: "user" });
    await jobs.update("job-1", { state: "failed", error: "boom" });
    expect((await jobs.list()).map((j) => j.title)).toEqual(["a", "b"]);
    expect((await jobs.list({ state: "queued" })).map((j) => j.title)).toEqual(["b"]);
  });

  it("refuses a job file that belongs to another workspace", async () => {
    const { internalDir, jobs } = setup("ws-1");
    const other = await setup("ws-2").jobs.create({ title: "x", instructions: "", source: "user" });
    mkdirSync(path.join(internalDir, "jobs"), { recursive: true });
    writeFileSync(
      path.join(internalDir, "jobs", "job-9.json"),
      JSON.stringify({ ...other, id: "job-9" }),
    );
    await expect(jobs.get("job-9")).rejects.toBeInstanceOf(WorkspaceMismatchError);
    await expect(jobs.list()).rejects.toBeInstanceOf(WorkspaceMismatchError);
  });

  it("removes", async () => {
    const { jobs } = setup();
    await jobs.create({ title: "t", instructions: "", source: "user" });
    expect(await jobs.remove("job-1")).toBe(true);
    expect(await jobs.get("job-1")).toBeUndefined();
  });
});
