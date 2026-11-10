import { insertScoreSnapshot } from "@memtavi/db/health";
import { type JobContext, JobError } from "./types";

export async function snapshotScore({ job, client }: JobContext): Promise<void> {
  const brainId = job.payload.brainId;
  if (typeof brainId !== "string" || brainId === "" || brainId !== job.brainId) {
    throw new JobError("permanent", "Invalid job payload");
  }
  const brain = await client.query(
    `SELECT id FROM brains WHERE tenant_id = $1 AND id = $2
     AND deletion_state = 'active' FOR SHARE`,
    [job.tenantId, brainId],
  );
  if (!brain.rowCount) return;
  await insertScoreSnapshot(client, job.tenantId, brainId);
}
