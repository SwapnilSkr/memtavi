import type { FetchedDocument } from "@memtavi/fetch";
import type { ObjectStore } from "@memtavi/storage/types";
import type { PoolClient } from "pg";

export interface ClaimedJob {
  id: string;
  tenantId: string;
  brainId: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface JobContext {
  job: ClaimedJob;
  client: PoolClient;
  store: ObjectStore;
  fetchDocument: (url: string) => Promise<FetchedDocument>;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export class JobError extends Error {
  constructor(
    readonly kind: "transient" | "permanent",
    message: string,
  ) {
    super(message);
    this.name = "JobError";
  }
}
