#!/usr/bin/env bash
set -euo pipefail

keep=0
for arg in "$@"; do
  case "$arg" in
    --keep) keep=1 ;;
    -h|--help) printf 'usage: tools/db-rehearsal.sh [--keep]\n'; exit 0 ;;
    *) printf 'db-rehearsal: unknown argument: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

die() {
  printf 'db-rehearsal: %s\n' "$1" >&2
  exit 1
}

source_url="${TEST_DATABASE_URL:-}"
app_url="${TEST_APP_DATABASE_URL:-}"
[[ -n "$source_url" ]] || die "TEST_DATABASE_URL is required"
[[ -n "$app_url" ]] || die "TEST_APP_DATABASE_URL is required"

url_without_query() {
  local base="${1%%\?*}"
  printf '%s' "${base%/}"
}

url_prefix() {
  printf '%s' "${1%/*}"
}

url_database() {
  printf '%s' "${1##*/}"
}

source_db="$(url_database "$(url_without_query "$source_url")")"
app_db="$(url_database "$(url_without_query "$app_url")")"
[[ "$source_db" == memtavi_test* ]] || die "refusing a database that is not named memtavi_test*"
[[ "$app_db" == "$source_db" ]] || die "TEST_APP_DATABASE_URL must point at $source_db"

restore_db="memtavi_restore_test"
[[ "$restore_db" == *_restore_test ]] || die "restore target must end in _restore_test"
[[ "$restore_db" != "$source_db" ]] || die "restore target must differ from the source"
restore_url="$(url_prefix "$(url_without_query "$source_url")")/$restore_db"
app_restore_url="$(url_prefix "$(url_without_query "$app_url")")/$restore_db"

psql_bin="${PSQL:-}"
if [[ -z "$psql_bin" ]]; then
  if command -v psql >/dev/null 2>&1; then
    psql_bin="$(command -v psql)"
  else
    for candidate in \
      /opt/homebrew/opt/postgresql@18/bin \
      /opt/homebrew/opt/postgresql@17/bin \
      /opt/homebrew/opt/postgresql@16/bin \
      /opt/homebrew/opt/postgresql@15/bin \
      /usr/local/opt/postgresql@18/bin \
      /usr/local/opt/postgresql@17/bin \
      /Applications/Postgres.app/Contents/Versions/latest/bin; do
      if [[ -x "$candidate/psql" ]]; then
        psql_bin="$candidate/psql"
        break
      fi
    done
  fi
fi
[[ -n "$psql_bin" ]] || die "psql not found; set PSQL"
bin_dir="$(dirname "$psql_bin")"
pg_dump_bin="${PG_DUMP:-$bin_dir/pg_dump}"
pg_restore_bin="${PG_RESTORE:-$bin_dir/pg_restore}"
[[ -x "$pg_dump_bin" ]] || die "pg_dump not found; set PG_DUMP"
[[ -x "$pg_restore_bin" ]] || die "pg_restore not found; set PG_RESTORE"

server_num="$("$psql_bin" "$source_url" -X -At -v ON_ERROR_STOP=1 -c 'show server_version_num')"
server_major=$((server_num / 10000))
dump_major="$("$pg_dump_bin" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
[[ "$dump_major" -ge "$server_major" ]] || die "pg_dump $dump_major cannot dump a server at major $server_major"

app_role="$("$psql_bin" "$app_url" -X -At -F '|' -v ON_ERROR_STOP=1 -c \
  'SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')"
[[ "$app_role" == "memtavi_app|f|f" ]] || die "TEST_APP_DATABASE_URL must connect as memtavi_app without superuser or bypassrls"

can_create="$("$psql_bin" "$source_url" -X -At -v ON_ERROR_STOP=1 -c \
  'SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user')"
[[ "$can_create" == "t" ]] || die "the owner role needs CREATEDB to build $restore_db"

now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

seconds() {
  awk -v ms="$1" 'BEGIN { printf "%.3f", ms / 1000 }'
}

dump_file="$(mktemp "${TMPDIR:-/tmp}/memtavi-rehearsal.XXXXXX")"
source_verify="$(mktemp "${TMPDIR:-/tmp}/memtavi-source.XXXXXX")"
restore_verify="$(mktemp "${TMPDIR:-/tmp}/memtavi-restore.XXXXXX")"
diff_file="$(mktemp "${TMPDIR:-/tmp}/memtavi-diff.XXXXXX")"
restore_created=0

cleanup() {
  local status=$?
  trap - EXIT
  rm -f "$dump_file" "$source_verify" "$restore_verify" "$diff_file"
  if [[ $keep -eq 0 && $restore_created -eq 1 ]]; then
    "$psql_bin" "$source_url" -X -q -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS $restore_db WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

printf 'db-rehearsal: %s -> %s\n' "$source_db" "$restore_db"

dump_start="$(now_ms)"
"$pg_dump_bin" --format=custom --no-owner --file="$dump_file" "$source_url"
dump_ms=$(( $(now_ms) - dump_start ))

create_start="$(now_ms)"
"$psql_bin" "$source_url" -X -q -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $restore_db WITH (FORCE)" \
  -c "CREATE DATABASE $restore_db"
create_ms=$(( $(now_ms) - create_start ))
restore_created=1

restore_start="$(now_ms)"
"$pg_restore_bin" --no-owner --exit-on-error --dbname="$restore_url" "$dump_file"
restore_ms=$(( $(now_ms) - restore_start ))

verify_db() {
  local url="$1"
  local out="$2"
  "$psql_bin" "$url" -X -A -t -F '|' -v ON_ERROR_STOP=1 >"$out" <<'SQL'
SELECT '#tables';
SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
SELECT '#migrations';
SELECT 'migrations=' || count(*) FROM public.schema_migrations;
SELECT 'migration=' || name FROM public.schema_migrations ORDER BY name;
SELECT '#rls';
SELECT 'rls_tables=' || count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
SELECT 'policies=' || count(*) FROM pg_policies WHERE schemaname = 'public';
SELECT '#extensions';
SELECT 'extension=' || extname FROM pg_extension ORDER BY extname;
SELECT '#grants';
SELECT 'app_grants=' || count(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'memtavi_app';
SELECT 'app_granted_tables=' || count(DISTINCT c.oid)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'memtavi_app';
SQL
}

verify_start="$(now_ms)"
verify_db "$source_url" "$source_verify"
verify_db "$restore_url" "$restore_verify"

mismatches=0
if diff -u "$source_verify" "$restore_verify" >"$diff_file"; then
  mismatches=0
else
  mismatches="$(grep -cE '^[+-][^+-]' "$diff_file" || true)"
fi

smoke_tenant_ids="$("$psql_bin" "$restore_url" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT t.id FROM tenants t WHERE EXISTS (SELECT 1 FROM pages p WHERE p.tenant_id = t.id) ORDER BY t.id LIMIT 2")"
smoke_a="$(printf '%s\n' "$smoke_tenant_ids" | sed -n '1p')"
smoke_b="$(printf '%s\n' "$smoke_tenant_ids" | sed -n '2p')"
smoke_fixture="existing tenant rows"

if [[ ! "$smoke_a" =~ ^[0-9a-f-]{36}$ || ! "$smoke_b" =~ ^[0-9a-f-]{36}$ ]]; then
  seed_stamp="$(date +%s)"
  "$psql_bin" "$restore_url" -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
INSERT INTO tenants (id, name, slug) VALUES
  ('0e5e5a00-0000-4000-8000-00000000000a', 'Rehearsal A', 'rehearsal-a-$seed_stamp'),
  ('0e5e5a00-0000-4000-8000-00000000000b', 'Rehearsal B', 'rehearsal-b-$seed_stamp');
INSERT INTO subject_links (tenant_id, subject_id) VALUES
  ('0e5e5a00-0000-4000-8000-00000000000a', '0e5e5a00-0000-4000-8000-0000000000a1'),
  ('0e5e5a00-0000-4000-8000-00000000000b', '0e5e5a00-0000-4000-8000-0000000000b1');
INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES
  ('brain_rehearsal_a', '0e5e5a00-0000-4000-8000-00000000000a', '0e5e5a00-0000-4000-8000-0000000000a1', 'Rehearsal A', 'rehearsal'),
  ('brain_rehearsal_b', '0e5e5a00-0000-4000-8000-00000000000b', '0e5e5a00-0000-4000-8000-0000000000b1', 'Rehearsal B', 'rehearsal');
INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash) VALUES
  ('page_rehearsal_a', '0e5e5a00-0000-4000-8000-00000000000a', '0e5e5a00-0000-4000-8000-0000000000a1', 'brain_rehearsal_a', 'rehearsal-page', 'Rehearsal A', 'rehearsal-a'),
  ('page_rehearsal_b', '0e5e5a00-0000-4000-8000-00000000000b', '0e5e5a00-0000-4000-8000-0000000000b1', 'brain_rehearsal_b', 'rehearsal-page', 'Rehearsal B', 'rehearsal-b');
COMMIT;
SQL
  smoke_a='0e5e5a00-0000-4000-8000-00000000000a'
  smoke_b='0e5e5a00-0000-4000-8000-00000000000b'
  smoke_fixture="two temporary tenants seeded in $restore_db"
fi

expected_a="$("$psql_bin" "$restore_url" -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pages WHERE tenant_id = '$smoke_a'")"
expected_b="$("$psql_bin" "$restore_url" -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pages WHERE tenant_id = '$smoke_b'")"

smoke_one() {
  local tenant="$1"
  local foreign="$2"
  "$psql_bin" "$app_restore_url" -X -q -At -F '|' -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET ROLE memtavi_app;
SET LOCAL app.tenant_id = '$tenant';
SELECT current_user, (SELECT count(*) FROM pages), (SELECT count(*) FROM pages WHERE tenant_id = '$foreign');
COMMIT;
SQL
}

smoke_failed=0
smoke_summary=""
smoke_separator=""
for pair in "a:$smoke_a:$smoke_b:$expected_a" "b:$smoke_b:$smoke_a:$expected_b"; do
  label="${pair%%:*}"
  rest="${pair#*:}"
  tenant="${rest%%:*}"
  rest="${rest#*:}"
  foreign="${rest%%:*}"
  expected="${rest#*:}"
  if ! result="$(smoke_one "$tenant" "$foreign" | tail -1)"; then
    smoke_failed=1
    smoke_summary="$smoke_summary$smoke_separator tenant $label: query failed"
    smoke_separator=";"
    continue
  fi
  role="${result%%|*}"
  rest="${result#*|}"
  visible="${rest%%|*}"
  foreign_visible="${rest#*|}"
  if [[ "$role" != "memtavi_app" || "$visible" != "$expected" || "$foreign_visible" != "0" ]]; then
    smoke_failed=1
    smoke_summary="$smoke_summary$smoke_separator tenant $label: role=$role visible=$visible expected=$expected foreign=$foreign_visible"
  else
    smoke_summary="$smoke_summary$smoke_separator tenant $label: $visible own, 0 foreign"
  fi
  smoke_separator=";"
done
smoke_ms=$(( $(now_ms) - verify_start ))

dump_bytes="$(wc -c <"$dump_file" | tr -d ' ')"
table_count="$(awk '/^#tables$/{f=1;next} /^#/{f=0} f && /^[a-z0-9_]+=[0-9]+$/{n++} END{print n+0}' "$source_verify")"
metric() {
  sed -n "s/^$1=//p" "$2" | head -1
}
migrations="$(metric migrations "$source_verify")"
rls_tables="$(metric rls_tables "$source_verify")"
policies="$(metric policies "$source_verify")"
app_grants="$(metric app_grants "$source_verify")"
app_granted_tables="$(metric app_granted_tables "$source_verify")"
extensions="$(awk -F= '/^extension=/{printf "%s%s", sep, $2; sep=", "}' "$source_verify")"

create_seconds="$(seconds "$create_ms")"
restore_seconds="$(seconds "$restore_ms")"
dump_seconds="$(seconds "$dump_ms")"
verify_seconds="$(seconds "$smoke_ms")"
rto_seconds="$(awk -v a="$create_ms" -v b="$restore_ms" -v c="$smoke_ms" 'BEGIN { printf "%.3f", (a + b + c) / 1000 }')"

printf '\n'
printf '  source database: %s\n' "$source_db"
printf '  restore database: %s\n' "$restore_db"
printf '  dump bytes: %s\n' "$dump_bytes"
printf '  dump seconds: %s\n' "$dump_seconds"
printf '  drop/create seconds: %s\n' "$create_seconds"
printf '  restore seconds: %s\n' "$restore_seconds"
printf '  verify+smoke seconds: %s\n' "$verify_seconds"
printf '  rto seconds: %s\n' "$rto_seconds"
printf '  tables: %s\n' "$table_count"
printf '  migrations: %s\n' "$migrations"
printf '  rls tables: %s\n' "$rls_tables"
printf '  policies: %s\n' "$policies"
printf '  extensions: %s\n' "$extensions"
printf '  memtavi_app grants: %s across %s tables\n' "$app_grants" "$app_granted_tables"
printf '  mismatches: %s\n' "$mismatches"
if [[ $mismatches -ne 0 ]]; then
  printf '  verification diff:\n'
  sed -n '1,80p' "$diff_file" | sed 's/^/    /'
fi
if [[ $smoke_failed -eq 0 ]]; then
  printf '  rls smoke: pass (%s; %s)\n' "$smoke_fixture" "${smoke_summary# }"
else
  printf '  rls smoke: FAIL (%s; %s)\n' "$smoke_fixture" "${smoke_summary# }"
fi
if [[ $keep -eq 1 ]]; then
  printf '  kept: %s\n' "$restore_db"
fi

[[ $mismatches -eq 0 && $smoke_failed -eq 0 ]]
