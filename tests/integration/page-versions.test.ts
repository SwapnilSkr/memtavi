import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@memtavi/shared/ids";
import { type Contract, createContract, readSpec } from "../support/contract";
import { createHarness, type Harness, hasTestDatabase } from "../support/harness";

interface VersionSummary {
  version: number;
  title: string;
  summary: string;
  actor: string;
  ingestSourceId: string | null;
  createdAt: string;
}

interface VersionDetail extends VersionSummary {
  body: string;
}

interface DiffLine {
  op: string;
  text: string;
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffBody {
  from: number;
  to: number;
  title: { from: string; to: string };
  summary: { from: string; to: string };
  hunks: DiffHunk[];
}

interface ListBody<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const VERSIONS = "/v1/brains/{brainId}/pages/{slug}/versions";
const VERSION = "/v1/brains/{brainId}/pages/{slug}/versions/{version}";
const DIFF = "/v1/brains/{brainId}/pages/{slug}/diff";

const BODY_V1 = "line one\nline two\nline three\nline four\nline five\nline six\nline seven\n";
const BODY_V2 =
  "line one\nline two changed\nline three\nline four\nline five\nline six\nline seven\n";
const BODY_V3 = `${BODY_V2}line eight\n`;

const CHANGE_HUNK: DiffHunk = {
  oldStart: 1,
  oldLines: 5,
  newStart: 1,
  newLines: 5,
  lines: [
    { op: "context", text: "line one" },
    { op: "remove", text: "line two" },
    { op: "add", text: "line two changed" },
    { op: "context", text: "line three" },
    { op: "context", text: "line four" },
    { op: "context", text: "line five" },
  ],
};

const APPEND_HUNK: DiffHunk = {
  oldStart: 5,
  oldLines: 3,
  newStart: 5,
  newLines: 4,
  lines: [
    { op: "context", text: "line five" },
    { op: "context", text: "line six" },
    { op: "context", text: "line seven" },
    { op: "add", text: "line eight" },
  ],
};

const REFERENCED_AT = "2026-01-02T03:04:05.000Z";

describe.skipIf(!hasTestDatabase)("page versions and diffs over the wire", () => {
  let harness: Harness;
  let contract: Contract;
  let brainId = "";
  let otherBrainId = "";
  let pageId = "";
  let viewerKey = "";

  function request(path: string, options: Parameters<Harness["request"]>[1] = {}) {
    return harness.request(path, options);
  }

  async function bodyOf<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  async function stampOf(): Promise<string> {
    const result = await harness.owner.query<{ stamp: string }>(
      "SELECT last_referenced_at::text AS stamp FROM pages WHERE id = $1",
      [pageId],
    );
    return result.rows[0]?.stamp ?? "";
  }

  async function expectStatus(response: Response, status: number, template: string) {
    const body = await bodyOf<unknown>(response);
    expect({ status: response.status, path: template }).toEqual({ status, path: template });
    contract.expectContract(response, body, { method: "GET", path: template });
    return body;
  }

  beforeAll(async () => {
    harness = await createHarness();
    contract = createContract(readSpec());

    const created = await request("/v1/brains", {
      method: "POST",
      body: { name: "Versions", slug: `versions-${crypto.randomUUID()}` },
    });
    expect(created.status).toBe(201);
    brainId = ((await created.json()) as { id: string }).id;

    const other = await request("/v1/brains", {
      method: "POST",
      body: { name: "Other", slug: `other-${crypto.randomUUID()}` },
    });
    expect(other.status).toBe(201);
    otherBrainId = ((await other.json()) as { id: string }).id;

    pageId = newId("page");
    await harness.owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type,
          content_hash, version, last_referenced_at)
       VALUES ($1, $2, $3, $4, 'history', 'Version three', 'Third summary', $5, 'topic',
               'hash-history', 3, $6)`,
      [pageId, harness.tenants.a, harness.subjects.a, brainId, BODY_V3, REFERENCED_AT],
    );

    const versions = [
      {
        version: 1,
        title: "Version one",
        summary: "First summary",
        body: BODY_V1,
        actor: "compiler",
      },
      { version: 2, title: "Version two", summary: "Second summary", body: BODY_V2, actor: "user" },
      {
        version: 3,
        title: "Version three",
        summary: "Third summary",
        body: BODY_V3,
        actor: "compiler",
      },
    ];
    const values: string[] = [];
    const parameters: unknown[] = [harness.tenants.a, pageId];
    for (const entry of versions) {
      const base = parameters.length;
      values.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      parameters.push(entry.version, entry.title, entry.summary, entry.body, entry.actor);
    }
    await harness.owner.query(
      `INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor)
       VALUES ${values.join(", ")}`,
      parameters,
    );

    await harness.owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type,
          content_hash, version, deletion_state)
       VALUES ($1, $2, $3, $4, 'other', 'Other page', '', '', 'topic', 'hash-other', 1, 'active')`,
      [newId("page"), harness.tenants.a, harness.subjects.a, otherBrainId],
    );
    await harness.owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type,
          content_hash, version, deletion_state)
       VALUES ($1, $2, $3, $4, 'gone', 'Deleted page', '', '', 'topic', 'hash-gone', 1, 'deleted')`,
      [newId("page"), harness.tenants.a, harness.subjects.a, brainId],
    );

    const viewer = await request("/v1/api-keys", {
      method: "POST",
      body: { name: "Version viewer", role: "viewer" },
    });
    expect(viewer.status).toBe(201);
    viewerKey = ((await viewer.json()) as { key: string }).key;
  });

  afterAll(async () => {
    await harness?.close();
  });

  test("versions list newest first without bodies and paginates", async () => {
    const response = await request(`/v1/brains/${brainId}/pages/history/versions`);
    const body = (await expectStatus(response, 200, VERSIONS)) as ListBody<VersionSummary>;
    expect(body.items.map((item) => item.version)).toEqual([3, 2, 1]);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    for (const item of body.items) {
      expect("body" in item).toBe(false);
      expect(typeof item.actor).toBe("string");
      expect(typeof item.createdAt).toBe("string");
      expect(item.ingestSourceId).toBeNull();
    }
    expect(body.items[2]).toMatchObject({
      version: 1,
      title: "Version one",
      summary: "First summary",
      actor: "compiler",
    });

    const paged = await request(`/v1/brains/${brainId}/pages/history/versions?limit=1&offset=1`);
    const pagedBody = (await expectStatus(paged, 200, VERSIONS)) as ListBody<VersionSummary>;
    expect(pagedBody.items.map((item) => item.version)).toEqual([2]);
    expect(pagedBody.total).toBe(3);
    expect(pagedBody.limit).toBe(1);
    expect(pagedBody.offset).toBe(1);

    const invalid = await request(`/v1/brains/${brainId}/pages/history/versions?limit=201`);
    await expectStatus(invalid, 400, VERSIONS);
  });

  test("one version returns its body and rejects an unknown or malformed version", async () => {
    const response = await request(`/v1/brains/${brainId}/pages/history/versions/2`);
    const body = (await expectStatus(response, 200, VERSION)) as VersionDetail;
    expect(body).toMatchObject({
      version: 2,
      title: "Version two",
      summary: "Second summary",
      body: BODY_V2,
      actor: "user",
      ingestSourceId: null,
    });
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await expectStatus(
      await request(`/v1/brains/${brainId}/pages/history/versions/99`),
      404,
      VERSION,
    );
    await expectStatus(
      await request(`/v1/brains/${brainId}/pages/history/versions/abc`),
      400,
      VERSION,
    );
    await expectStatus(
      await request(`/v1/brains/${brainId}/pages/history/versions/0`),
      400,
      VERSION,
    );
  });

  test("a diff between two versions yields the expected hunks", async () => {
    const response = await request(`/v1/brains/${brainId}/pages/history/diff?from=1&to=2`);
    const body = (await expectStatus(response, 200, DIFF)) as DiffBody;
    expect(body.from).toBe(1);
    expect(body.to).toBe(2);
    expect(body.title).toEqual({ from: "Version one", to: "Version two" });
    expect(body.summary).toEqual({ from: "First summary", to: "Second summary" });
    expect(body.hunks).toEqual([CHANGE_HUNK]);

    const appended = await request(`/v1/brains/${brainId}/pages/history/diff?from=2&to=3`);
    const appendedBody = (await expectStatus(appended, 200, DIFF)) as DiffBody;
    expect(appendedBody.hunks).toEqual([APPEND_HUNK]);
  });

  test("to defaults to the page's current version", async () => {
    const implicit = await request(`/v1/brains/${brainId}/pages/history/diff?from=2`);
    const implicitBody = (await expectStatus(implicit, 200, DIFF)) as DiffBody;
    expect(implicitBody.to).toBe(3);
    expect(implicitBody.hunks).toEqual([APPEND_HUNK]);

    const explicit = await request(`/v1/brains/${brainId}/pages/history/diff?from=2&to=3`);
    const explicitBody = (await expectStatus(explicit, 200, DIFF)) as DiffBody;
    expect(explicitBody).toEqual(implicitBody);
  });

  test("invalid ranges are 400 and unknown versions are 404", async () => {
    for (const query of [
      "",
      "?from=0&to=2",
      "?from=3&to=2",
      "?from=3",
      "?from=abc&to=2",
      "?from=1&to=0",
    ]) {
      const response = await request(`/v1/brains/${brainId}/pages/history/diff${query}`);
      await expectStatus(response, 400, DIFF);
    }
    for (const query of ["?from=2&to=99", "?from=4&to=5"]) {
      const response = await request(`/v1/brains/${brainId}/pages/history/diff${query}`);
      await expectStatus(response, 404, DIFF);
    }
  });

  test("reading versions does not bump lastReferencedAt", async () => {
    const before = await stampOf();
    await expectStatus(
      await request(`/v1/brains/${brainId}/pages/history/versions`),
      200,
      VERSIONS,
    );
    await expectStatus(
      await request(`/v1/brains/${brainId}/pages/history/versions/1`),
      200,
      VERSION,
    );
    await expectStatus(
      await request(`/v1/brains/${brainId}/pages/history/diff?from=1&to=2`),
      200,
      DIFF,
    );
    expect(await stampOf()).toBe(before);
    expect(new Date(before).toISOString()).toBe(REFERENCED_AT);
  });

  test("a viewer key may read versions", async () => {
    for (const [path, template] of [
      [`/v1/brains/${brainId}/pages/history/versions`, VERSIONS],
      [`/v1/brains/${brainId}/pages/history/versions/1`, VERSION],
      [`/v1/brains/${brainId}/pages/history/diff?from=1&to=2`, DIFF],
    ] as const) {
      await expectStatus(await request(path, { key: viewerKey }), 200, template);
    }
  });

  test("foreign tenants, subjects, brains and deleted pages are 404", async () => {
    const suffixes = [
      { path: "versions", template: VERSIONS },
      { path: "versions/1", template: VERSION },
      { path: "diff?from=1&to=2", template: DIFF },
    ];
    for (const suffix of suffixes) {
      await expectStatus(
        await request(`/v1/brains/${brainId}/pages/history/${suffix.path}`, {
          key: harness.keys.b,
        }),
        404,
        suffix.template,
      );
      await expectStatus(
        await request(`/v1/brains/${brainId}/pages/history/${suffix.path}`, {
          subject: harness.subjects.b,
        }),
        404,
        suffix.template,
      );
      await expectStatus(
        await request(`/v1/brains/${otherBrainId}/pages/history/${suffix.path}`),
        404,
        suffix.template,
      );
      await expectStatus(
        await request(`/v1/brains/${brainId}/pages/gone/${suffix.path}`),
        404,
        suffix.template,
      );
    }
  });
});
