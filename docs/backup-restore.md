# Backup and restore

## Rehearsal — 2026-11-09

Command:

```bash
TEST_DATABASE_URL=postgres://memtavi:memtavi@localhost:5434/memtavi_test \
TEST_APP_DATABASE_URL=postgres://memtavi_app:memtavi_app@localhost:5434/memtavi_test \
bun run backup:rehearsal
```

`tools/db-rehearsal.sh` refuses any source database not named `memtavi_test*`, derives `memtavi_restore_test` from the same URL without printing either URL, dumps to a private temp file, drops and recreates the restore database, restores, compares both databases, runs an RLS smoke against the restored copy as `memtavi_app`, and drops the restore database unless `--keep` is passed. It never runs `set -x` and never echoes a connection string.

Environment:

- Hardware: MacBook Pro (Mac16,8), Apple M4 Pro, 12 cores (8 performance, 4 efficiency), 24 GB RAM, macOS 15.7.9.
- PostgreSQL 18.6 (Homebrew), local TCP on port 5434, default configuration.
- Client: `pg_dump`/`pg_restore` 18 from `/opt/homebrew/opt/postgresql@18/bin`; the script resolves the binaries beside `psql` or from a versioned Homebrew prefix, and refuses a `pg_dump` older than the server major.
- Data: the current `memtavi_test` schema, 9 migrations, no tenant data. Dump size 108,868 B (106.3 KiB).
- Date: 2026-11-09.

Three consecutive runs plus the final verification run:

| Phase | Run 1 | Run 2 | Run 3 | Final |
|---|---|---|---|---|
| Dump (`pg_dump -Fc --no-owner`) | 0.099 s | 0.099 s | 0.084 s | 0.100 s |
| Drop/create restore database | 0.097 s | 0.074 s | 0.079 s | 0.095 s |
| Restore (`pg_restore --no-owner --exit-on-error`) | 0.162 s | 0.143 s | 0.156 s | 0.150 s |
| Verification + RLS smoke | 0.161 s | 0.156 s | 0.160 s | 0.195 s |
| RTO (create + restore + verify) | 0.420 s | 0.373 s | 0.395 s | 0.440 s |

Dump size was 108,868 B on every run. Dump seconds ranged **0.084–0.100 s**, restore seconds **0.143–0.162 s**, and the full RTO **0.373–0.440 s**.

What the restored copy had to match, and did:

| Check | Result |
|---|---|
| Public base tables | 30 / 30, identical per-table row counts |
| Applied migrations | 9 / 9, same names in `schema_migrations` |
| RLS-enabled tables | 27 / 27 |
| RLS policies | 27 / 27 |
| Extensions | `citext`, `pg_trgm`, `plpgsql`, `unaccent`, `vector` on both |
| Grants to `memtavi_app` | 106 privileges across 27 tables on both |
| Mismatches | 0 |

RLS smoke, after restore, through `TEST_APP_DATABASE_URL` with `SET ROLE memtavi_app` and `SET LOCAL app.tenant_id` inside the transaction:

```
memtavi_app|A own pages|1
memtavi_app|A sees B tenant rows|0
memtavi_app|B own pages|1
memtavi_app|B sees A tenant rows|0
memtavi_app|no tenant set|0
```

The test database has no tenants, so the rehearsal created two temporary tenants (with one brain and one page each) in the **restore** database only. The source database was not modified. The restore database is dropped at the end, so the fixtures disappear with it.

### What these numbers mean

They prove fidelity: schema, row counts, migration ledger, RLS enablement, policy count, extension set, app-role grants and tenant isolation all survive a custom-format dump and restore. They do **not** measure a production-sized restore. The test database is schema-only (108 KiB), so treat 0.37–0.44 s as a floor, not a production RTO. Re-run the rehearsal against a seeded copy with production-shaped page and embedding counts before promising a number; the search benchmark's 10k-page shape is roughly 100 MB and is the cheapest realistic stand-in available.

### Rehearsal preconditions

The role in `TEST_DATABASE_URL` needs `CREATEDB` to build the restore database, and enough privilege to install every extension in the dump. On this cluster `vector` is **not a trusted extension**, so `CREATE EXTENSION vector` requires superuser. The local disposable owner role therefore needed:

```sql
ALTER ROLE memtavi CREATEDB;
ALTER ROLE memtavi SUPERUSER;
```

Both were executed locally as the cluster superuser on 2026-11-09. `memtavi_app` remains `rolsuper = false` and `rolbypassrls = false`; the script refuses to run the smoke with any other role. Do not copy the superuser grant to production: use a dedicated restore role that can create the database and install the four extensions, or have the platform administrator pre-create them in the target before `pg_restore`.

## Production backup

### Nightly dump

Run from the platform's scheduler with an IAM role, never static keys in a cron environment file.

```bash
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
size="$(psql "$PRODUCTION_DATABASE_URL" -X -At -c 'select pg_database_size(current_database())')"
pg_dump --format=custom --no-owner "$PRODUCTION_DATABASE_URL" \
  | aws s3 cp - "s3://memtavi-backups-prod/postgres/nightly/memtavi-$stamp.dump" \
      --sse aws:kms --sse-kms-key-id "$BACKUP_KMS_KEY_ID" \
      --expected-size "$size" \
      --no-progress
```

- Private prefix. Block Public Access on, bucket policy denies non-TLS, no ACLs, versioning on.
- SSE-KMS with a backup-only key. The key policy allows the backup role and the restore role only.
- The dump contains api-key hashes, webhook signing material and tenant data. Treat every object as production secret material: no downloads to laptops, no object copies into personal accounts, no bucket listing for application roles.
- After upload, record the object key, SHA-256 of the local dump, dump size and `pg_restore --list` entry count in the backup ledger; alert if the size drops more than 20% from the trailing median or the dump fails.
- The dump is taken from a read replica where one exists, to keep the primary's I/O predictable, and `--no-owner` keeps it restorable by a different role and cluster.

Terraform-equivalent lifecycle rules on `postgres/`:

| Rule | Prefix | Transition | Expiration |
|---|---|---|---|
| Nightly | `postgres/nightly/` | — | 35 days |
| Weekly | `postgres/weekly/` | — | 12 weeks |
| Monthly | `postgres/monthly/` | Glacier Instant Retrieval after 90 days | 12 months |

Keep one object per day in `nightly/`, copy Sunday's object to `weekly/`, and the first of the month to `monthly/`. A separate scheduled job performs that promotion; do not rely on the dump job also being the rotation job.

### Off-account copy

Enable S3 Cross-Region Replication from `memtavi-backups-prod` to `memtavi-backups-dr` in a **different AWS account and region**. Replicate the whole `postgres/` prefix with destination-side SSE-KMS and a destination key in the DR account. Keep the source and destination bucket policies narrow: the backup writer writes only under `postgres/`, the restore role reads only under `postgres/`.

Replication is asynchronous. Record `s3:ReplicationLatency` or compare object counts daily; an off-account copy that silently lags is worse than no copy because it is assumed to exist.

### Restore runbook

Never restore over the live database. Restore into a new database, verify it, and switch traffic.

1. **Pick the object.** From the backup ledger, choose the newest dump that passed its size and `pg_restore --list` checks. Download it to the restore host, or stream it from S3, as the restore role. Record its SHA-256 and compare it with the ledger before restoring.
2. **Create the target.** Provision an empty database on a server of the same PostgreSQL major version with at least the source's storage headroom:

   ```bash
   createdb --owner memtavi_restore memtavi_restore_YYYYMMDD
   ```

   The restore role must be allowed to `CREATE EXTENSION` for `vector`, `pg_trgm`, `unaccent` and `citext`. If the managed platform forbids that, pre-create the four extensions in the empty database first, then restore.
3. **Restore.**

   ```bash
   pg_restore --no-owner --exit-on-error \
     --dbname "$RESTORE_DATABASE_URL" \
     memtavi-YYYYMMDDTHHMMSSZ.dump
   ```

   Stop on the first error. A partially restored database is not a candidate; drop it and fix the cause. Common causes are a missing extension, a role that cannot grant to `memtavi_app`, or a `pg_restore` older than the dump.
4. **Verify counts and structure.** Run the same queries the rehearsal runs, against the restored database:

   ```sql
   SELECT table_name || '=' ||
     (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
   FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
   ORDER BY table_name;

   SELECT count(*) FROM public.schema_migrations;

   SELECT count(*)
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;

   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';

   SELECT extname FROM pg_extension ORDER BY extname;

   SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'memtavi_app';
   ```

   Compare with the backup ledger and the last known-good snapshot. Row counts that should be non-zero must be non-zero, `schema_migrations` must end at the expected migration, and the RLS, policy, extension and grant counts must match.
5. **RLS smoke.** Connect with the app role, not the owner, and confirm that two tenants cannot see each other:

   ```sql
   BEGIN;
   SET ROLE memtavi_app;
   SET LOCAL app.tenant_id = '<tenant_a>';
   SELECT count(*) FROM pages;                                  -- tenant A pages only
   SELECT count(*) FROM pages WHERE tenant_id = '<tenant_b>';   -- must be 0
   COMMIT;

   BEGIN;
   SET ROLE memtavi_app;
   SET LOCAL app.tenant_id = '<tenant_b>';
   SELECT count(*) FROM pages;
   SELECT count(*) FROM pages WHERE tenant_id = '<tenant_a>';   -- must be 0
   COMMIT;

   BEGIN;
   SET ROLE memtavi_app;
   SELECT count(*) FROM pages;                                  -- no tenant set: must be 0
   COMMIT;
   ```

   Pick two tenants that the operator is authorized to read. A non-zero cross-tenant count, or a non-zero count with no tenant set, aborts the restore.
6. **Switch traffic.** Put the application in maintenance or drain the write path. Point the API and worker at the restored database, run the isolation suite against it, then restart the API and worker. Confirm health, then re-enable writes. Keep the previous database intact and reachable for rollback until a full business cycle has passed; do not drop it in the same change window.
7. **Record.** Write the object key, SHA-256, restore duration, verification output, smoke result and the switch time into the incident or drill record. A rehearsal that is not recorded does not count.

## Honest RPO and RTO

- **RPO: 24 hours.** The nightly dump is the only recovery point. A failure at 23:59 can lose the day's writes. There is no WAL archiving and no PITR, so there is no smaller recovery point today. The weekly and monthly copies improve retention, not RPO.
- **RTO: measured at 0.373–0.420 s for a 108 KiB schema-only database on the machine above.** That is the rehearsal's create + restore + verify + smoke path, and it is not a production figure. A production RTO also includes choosing and downloading the dump, provisioning a database large enough, restoring a production-sized data set, verification, the RLS smoke, and the traffic switch. Until the rehearsal is repeated against production-shaped data, the production RTO is **unmeasured**; do not publish a number.

Not covered:

- **PITR / WAL archiving.** No `archive_command`, no WAL shipping, no `pg_basebackup`. A logical corruption discovered after a dump is in place cannot be rolled back to a point between dumps.
- **Cross-region failover.** The off-account copy is a cold copy, not a running standby. RTO in the DR account includes provisioning a cluster, restoring, and changing DNS or connection strings.
- **Restore drills at production size.** Only the schema-only rehearsal has been run. Add a scheduled drill against a seeded copy and record its numbers; otherwise the first real restore is the test.
- **Media objects.** Source bodies and exports live in S3, not in Postgres. Their recovery depends on bucket versioning and the lifecycle rules in `infra/README.md`, not on this dump.
- **Secrets.** The backup role's credentials, the KMS key policy and the ability to install extensions are out of band. A restore that cannot get those is not a restore.
- **Encryption keys.** Losing the backup KMS key loses every object even though the bytes are present. Pin the key policy and test a decrypt in the DR account.

## Reproducing

The rehearsal is deliberately not wired into CI. It needs a disposable `memtavi_test*` database, a second database name it can create and drop, and an app role that cannot bypass RLS. Run it before changing a migration, before changing RLS or grants, and after any change to the dump or restore procedure. Pass `--keep` to inspect the restore database; drop it yourself afterwards.
