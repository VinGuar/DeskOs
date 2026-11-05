import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { type Clock, systemClock } from "../clock.ts";
import { JsonStore } from "../storage/json-store.ts";

/** Fields every operational record carries (SPEC 4.7). */
export const operationalShape = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  workspace_id: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  /** Who or what created it: "user", "capture", a feature id, a connector id. */
  source: z.string().min(1),
};

/** F1 states plus `interrupted` (daemon died mid-run). Allowed transitions live in the job runner. */
export const JOB_STATES = [
  "queued",
  "starting",
  "running",
  "needs_input",
  "review",
  "approved",
  "rejected",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const jobBudgetSchema = z.object({
  max_wall_ms: z.number().int().positive().optional(),
  max_cost_usd: z.number().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  max_files_changed: z.number().int().positive().optional(),
});

/** Where a job works. DeskOS tracks only the provider and path; the provider owns the contents. */
export const sandboxRecordSchema = z.object({
  provider: z.string().min(1),
  path: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
});

export const jobSchema = z.looseObject({
  ...operationalShape,
  title: z.string().min(1),
  instructions: z.string(),
  state: z.enum(JOB_STATES).default("queued"),
  work_item: z.string().min(1).optional(),
  /** Pack-defined target, for example a folder. Meaningful only to the sandbox provider. */
  target: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  budget: jobBudgetSchema.default({}),
  sandbox: sandboxRecordSchema.optional(),
  error: z.string().optional(),
});
export type Job = z.output<typeof jobSchema>;

export interface CreateJobInput {
  title: string;
  instructions: string;
  source: string;
  work_item?: string;
  target?: string;
  model?: string;
  budget?: z.input<typeof jobBudgetSchema>;
}

export type JobPatch = Partial<Omit<Job, "id" | "workspace_id" | "created_at" | "updated_at">>;

export class WorkspaceMismatchError extends Error {
  constructor(id: string, expected: string, actual: string) {
    super(`record ${id} belongs to workspace ${actual}, not ${expected}`);
    this.name = "WorkspaceMismatchError";
  }
}

/** Jobs for one workspace, one JSON file each under `<workspace>/.deskos/jobs/`. */
export class JobRepository {
  readonly workspaceId: string;
  readonly #store: JsonStore<typeof jobSchema>;
  readonly #clock: Clock;
  readonly #newId: () => string;
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(opts: {
    internalDir: string;
    workspaceId: string;
    clock?: Clock;
    newId?: () => string;
  }) {
    this.workspaceId = opts.workspaceId;
    this.#clock = opts.clock ?? systemClock;
    this.#store = new JsonStore(path.join(opts.internalDir, "jobs"), jobSchema, {
      clock: this.#clock,
    });
    this.#newId = opts.newId ?? randomUUID;
  }

  async create(input: CreateJobInput): Promise<Job> {
    const now = this.#now();
    const id = this.#newId();
    return this.#store.put(id, {
      ...input,
      id,
      workspace_id: this.workspaceId,
      created_at: now,
      updated_at: now,
    });
  }

  /** Undefined if absent. Throws WorkspaceMismatchError if the file belongs to another workspace. */
  async get(id: string): Promise<Job | undefined> {
    const job = await this.#store.get(id);
    if (job && job.workspace_id !== this.workspaceId) {
      throw new WorkspaceMismatchError(id, this.workspaceId, job.workspace_id);
    }
    return job;
  }

  /** Read, patch, write, one at a time per job so concurrent updates never lose a write. */
  update(id: string, patch: JobPatch): Promise<Job> {
    return this.#serialized(id, async () => {
      const current = await this.get(id);
      if (!current) throw new Error(`no such job: ${id}`);
      for (const fixed of ["id", "workspace_id", "created_at"] as const) {
        if (fixed in patch) throw new Error(`${fixed} cannot change`);
      }
      return this.#store.put(id, { ...current, ...patch, updated_at: this.#now() });
    });
  }

  async list(filter: { state?: JobState } = {}): Promise<Job[]> {
    const jobs: Job[] = [];
    for (const id of await this.#store.ids()) {
      const job = await this.get(id);
      if (job && (filter.state === undefined || job.state === filter.state)) jobs.push(job);
    }
    return jobs.sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    );
  }

  remove(id: string): Promise<boolean> {
    return this.#serialized(id, () => this.#store.delete(id));
  }

  #now(): string {
    return new Date(this.#clock.now()).toISOString();
  }

  #serialized<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => {});
    this.#locks.set(id, tail);
    void tail.then(() => {
      if (this.#locks.get(id) === tail) this.#locks.delete(id);
    });
    return run;
  }
}
