import { percentile, roundTo } from "./percentile";

interface Options {
  pages: number;
  queries: number;
  warmup: number;
  keep: boolean;
}

interface Summary {
  count: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

interface DatabaseInfo {
  db: string;
  usr: string;
  super: boolean;
  bypass: boolean;
}

interface SizeInfo {
  pagesTotal: number | string;
  pagesIndex: number | string;
  embeddingsTotal: number | string;
  embeddingsIndex: number | string;
}

const DATABASE_PATTERN = /^memtavi_test/;
const EMBEDDING_MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;
const RESULT_LIMIT = 20;

const FTS_QUERY = `SELECT p.id, p.slug, ts_rank(p.search_tsv, websearch_to_tsquery('english', $4)) AS rank
   FROM pages p
   WHERE p.tenant_id = $1 AND p.subject_id = $2 AND p.brain_id = $3
     AND p.deletion_state = 'active'
     AND p.search_tsv @@ websearch_to_tsquery('english', $4)
   ORDER BY rank DESC, p.slug, p.id
   LIMIT ${RESULT_LIMIT}`;

const VECTOR_QUERY = `SELECT p.id, (e.embedding <=> $4::vector) AS distance
   FROM pages p
   JOIN page_embeddings e ON e.tenant_id = p.tenant_id AND e.page_id = p.id
   WHERE p.tenant_id = $1 AND p.subject_id = $2 AND p.brain_id = $3
     AND p.deletion_state = 'active' AND e.model = $5
   ORDER BY e.embedding <=> $4::vector, p.slug, p.id
   LIMIT ${RESULT_LIMIT}`;

class SetupError extends Error {}

function parseCount(raw: string, name: string, minimum: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new SetupError(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = { pages: 10_000, queries: 30, warmup: 5, keep: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || !arg.startsWith("--")) {
      throw new SetupError(`unexpected argument: ${arg ?? ""}`);
    }
    if (arg === "--keep") {
      options.keep = true;
      continue;
    }
    const body = arg.slice(2);
    const separator = body.indexOf("=");
    const name = separator === -1 ? body : body.slice(0, separator);
    let value = separator === -1 ? undefined : body.slice(separator + 1);
    if (value === undefined) {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        index += 1;
      }
    }
    if (value === undefined) throw new SetupError(`missing value for --${name}`);
    if (name === "pages") options.pages = parseCount(value, "pages", 1);
    else if (name === "queries") options.queries = parseCount(value, "queries", 1);
    else if (name === "warmup") options.warmup = parseCount(value, "warmup", 0);
    else throw new SetupError(`unknown flag --${name}`);
  }
  return options;
}

function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) {
    return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    count: samples.length,
    meanMs: roundTo(total / samples.length, 3),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: roundTo(Math.max(...samples), 3),
  };
}

function formatSummary(label: string, summary: Summary): string {
  return `${label}: count=${summary.count} mean=${summary.meanMs}ms p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms max=${summary.maxMs}ms`;
}

async function measure(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(options: Options): Promise<void> {
  const ownerUrl = process.env.TEST_DATABASE_URL;
  const appUrl = process.env.TEST_APP_DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    throw new SetupError("TEST_DATABASE_URL and TEST_APP_DATABASE_URL are required");
  }

  const previousAppUrl = process.env.APP_DATABASE_URL;
  process.env.APP_DATABASE_URL = appUrl;

  const owner = new Bun.SQL(ownerUrl);
  let db: typeof import("../../packages/db/src/client") | null = null;
  let tenantId: string | null = null;

  try {
    const ownerInfo = (
      await owner.unsafe<DatabaseInfo[]>(
        `SELECT current_database() AS db, current_user AS usr,
         (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
         (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`,
      )
    )[0];
    if (!ownerInfo || !DATABASE_PATTERN.test(ownerInfo.db)) {
      throw new SetupError("refusing to seed a database that is not named memtavi_test*");
    }

    const dbClient = await import("../../packages/db/src/client");
    db = dbClient;
    const appInfo = (
      await dbClient.withTenant(crypto.randomUUID(), (client) =>
        client.query<DatabaseInfo>(
          `SELECT current_database() AS db, current_user AS usr,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`,
        ),
      )
    ).rows[0];
    if (!appInfo || !DATABASE_PATTERN.test(appInfo.db)) {
      throw new SetupError("refusing to query a database that is not named memtavi_test*");
    }
    if (appInfo.db !== ownerInfo.db) {
      throw new SetupError(
        "TEST_DATABASE_URL and TEST_APP_DATABASE_URL must name the same database",
      );
    }
    if (appInfo.usr === ownerInfo.usr) {
      throw new SetupError("the app role must differ from the owner role");
    }
    if (appInfo.super || appInfo.bypass) {
      throw new SetupError("the app role must not be superuser or bypass RLS");
    }
    const rls = (
      await owner.unsafe<{ rls: boolean }[]>(
        `SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'pages'::regclass`,
      )
    )[0];
    if (!rls?.rls) throw new SetupError("pages must have row level security enabled");
    await owner.unsafe("VACUUM (FULL, ANALYZE) pages, page_embeddings");

    const version = (
      await owner.unsafe<{ version: string }[]>(
        `SELECT current_setting('server_version') AS version`,
      )
    )[0]?.version;

    const slug = `bench-${crypto.randomUUID()}`;
    const subjectId = crypto.randomUUID();
    const tenant = (
      await owner.unsafe<{ id: string }[]>(
        `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
        ["bench", slug],
      )
    )[0];
    if (!tenant) throw new SetupError("tenant insert returned no row");
    const tenantKey = tenant.id;
    const brainKey = `brn_${crypto.randomUUID().replaceAll("-", "")}`;
    tenantId = tenantKey;

    await owner.unsafe(`INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1, $2)`, [
      tenantKey,
      subjectId,
    ]);
    await owner.unsafe(
      `INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, $4, $5)`,
      [brainKey, tenantKey, subjectId, "bench", slug],
    );

    await owner.unsafe(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, summary, body, content_hash)
       SELECT 'pg_' || md5($3::text || '-page-' || n), $1::uuid, $2::uuid, $3, 'synthetic-' || n,
         'Synthetic page ' || n, 'alpha' || (n % 100), md5(n::text), md5('content-' || n)
       FROM generate_series(1, $4::int) AS n`,
      [tenantKey, subjectId, brainKey, options.pages],
    );

    const vector = `[${Array.from({ length: DIMENSIONS }, (_, index) => ((index * 37) % 101) / 100).join(",")}]`;
    await owner.unsafe(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       SELECT $1::uuid, p.id, $2, $3::int, $4::vector, p.content_hash
       FROM pages p WHERE p.tenant_id = $1::uuid AND p.brain_id = $5`,
      [tenantKey, EMBEDDING_MODEL, DIMENSIONS, vector, brainKey],
    );
    await owner.unsafe("ANALYZE pages, page_embeddings");

    const pageCount = (
      await owner.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pages WHERE tenant_id = $1::uuid`,
        [tenantKey],
      )
    )[0]?.n;
    const embeddingCount = (
      await owner.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM page_embeddings WHERE tenant_id = $1::uuid`,
        [tenantKey],
      )
    )[0]?.n;
    if (pageCount !== options.pages || embeddingCount !== options.pages) {
      throw new SetupError(
        `seeded ${pageCount ?? 0} pages and ${embeddingCount ?? 0} embeddings, expected ${options.pages}`,
      );
    }

    const visible = (
      await dbClient.withTenant(
        tenantKey,
        (client) => client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pages`),
        subjectId,
      )
    ).rows[0]?.n;
    if (visible !== options.pages) {
      throw new SetupError(`the app role sees ${visible ?? 0} of ${options.pages} pages`);
    }

    const sizes = (
      await owner.unsafe<SizeInfo[]>(
        `SELECT pg_total_relation_size('pages'::regclass) AS "pagesTotal",
         pg_indexes_size('pages'::regclass) AS "pagesIndex",
         pg_total_relation_size('page_embeddings'::regclass) AS "embeddingsTotal",
         pg_indexes_size('page_embeddings'::regclass) AS "embeddingsIndex"`,
      )
    )[0];
    if (!sizes) throw new SetupError("relation sizes are unavailable");

    const runFts = (phrase: string) =>
      dbClient.withTenant(
        tenantKey,
        (client) => client.query(FTS_QUERY, [tenantKey, subjectId, brainKey, phrase]),
        subjectId,
      );
    const runVector = () =>
      dbClient.withTenant(
        tenantKey,
        (client) =>
          client.query(VECTOR_QUERY, [tenantKey, subjectId, brainKey, vector, EMBEDDING_MODEL]),
        subjectId,
      );

    for (let index = 0; index < options.warmup; index += 1) {
      await runFts(`alpha${index % 100}`);
      await runVector();
    }

    const ftsSamples: number[] = [];
    const vectorSamples: number[] = [];
    const failures: string[] = [];
    for (let index = 0; index < options.queries; index += 1) {
      try {
        ftsSamples.push(await measure(() => runFts(`alpha${index % 100}`)));
      } catch (error) {
        failures.push(`fts[${index}]: ${messageOf(error)}`);
      }
      try {
        vectorSamples.push(await measure(runVector));
      } catch (error) {
        failures.push(`vector[${index}]: ${messageOf(error)}`);
      }
    }

    const fts = summarize(ftsSamples);
    const vectorSummary = summarize(vectorSamples);
    process.stdout.write(
      `${[
        "search benchmark",
        `pages=${options.pages} queries=${options.queries} warmup=${options.warmup}`,
        `postgres=${version ?? "unknown"}`,
        `sizes: pages_total=${Number(sizes.pagesTotal)} pages_index=${Number(sizes.pagesIndex)} embeddings_total=${Number(sizes.embeddingsTotal)} embeddings_index=${Number(sizes.embeddingsIndex)}`,
        formatSummary("fts", fts),
        formatSummary("vector", vectorSummary),
        ...(options.keep
          ? [`kept tenant=${tenantKey} subject=${subjectId} brain=${brainKey}`]
          : []),
        ...failures.map((failure) => `failed ${failure}`),
      ].join("\n")}\n`,
    );
    for (const failure of failures) process.stderr.write(`bench:search ${failure}\n`);
  } finally {
    if (tenantId && !options.keep) {
      try {
        await owner.unsafe(`DELETE FROM tenants WHERE id = $1::uuid`, [tenantId]);
      } catch (error) {
        process.stderr.write(`bench:search cleanup failed: ${messageOf(error)}\n`);
      }
    }
    if (db) await db.pool.end().catch(() => {});
    await owner.close().catch(() => {});
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  }
}

try {
  await main(parseOptions(Bun.argv.slice(2)));
} catch (error) {
  process.stderr.write(`bench:search failed: ${messageOf(error)}\n`);
  process.exitCode = 1;
}
