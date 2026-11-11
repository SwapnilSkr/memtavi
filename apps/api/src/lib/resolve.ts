import type { EmbeddingProvider } from "@memtavi/llm/provider";
import { contentHash } from "@memtavi/storage/keys";
import type { Static } from "elysia";
import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import {
  enqueueWebhooks,
  insertChangeEvent,
  insertPageVersion,
  lockPageBySlug,
  pageColumns,
  refreshPageEmbedding,
  requireBrain,
} from "./pages";
import type { pageResolve } from "./schemas";

export async function resolvePage(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
  resolution: Static<typeof pageResolve>,
  embeddings: EmbeddingProvider | null,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const page = await lockPageBySlug(client, tenantId, subjectId, brainId, slug);
  if (page.status !== "contested") {
    throw new DomainError("ConflictError", 409, "Page is not contested");
  }

  const changed =
    resolution.title !== undefined ||
    resolution.summary !== undefined ||
    resolution.body !== undefined;
  const version = changed ? page.version + 1 : page.version;
  let resolved: unknown;

  if (changed) {
    const title = resolution.title ?? page.title;
    const summary = resolution.summary ?? page.summary;
    const body = resolution.body ?? page.body;
    const embeddingText = `${title}\n${summary}\n${body}`;
    const hash = contentHash(embeddingText);
    const updated = await client.query(
      `UPDATE pages SET title = $5, summary = $6, body = $7, status = 'active',
         content_hash = $8, version = $9, user_edited_at = now()
       WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
       RETURNING ${pageColumns}`,
      [tenantId, subjectId, brainId, page.id, title, summary, body, hash, version],
    );
    await insertPageVersion(client, tenantId, page.id, version, title, summary, body);
    resolved = updated.rows[0];
    if (embeddings) {
      const embeddedPage = await refreshPageEmbedding(
        client,
        tenantId,
        subjectId,
        brainId,
        page.id,
        embeddingText,
        hash,
        embeddings,
      );
      if (embeddedPage) resolved = embeddedPage;
    }
  } else {
    const updated = await client.query(
      `UPDATE pages SET status = 'active'
       WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
       RETURNING ${pageColumns}`,
      [tenantId, subjectId, brainId, page.id],
    );
    resolved = updated.rows[0];
  }

  const eventId = await insertChangeEvent(
    client,
    tenantId,
    brainId,
    page.id,
    "updated",
    resolution.note,
    page.version,
    version,
  );
  await enqueueWebhooks(client, tenantId, brainId, eventId, subjectId, "updated");
  return resolved;
}
