import type { SQL } from "bun";

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface Queryable {
  query<Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

function arrayLiteral(values: readonly unknown[]): string {
  const parts = values.map((value) => {
    if (value === null || value === undefined) return "NULL";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${parts.join(",")}}`;
}

export function queryable(sql: Pick<SQL, "unsafe">): Queryable {
  return {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      const bound = values.map((value) => (Array.isArray(value) ? arrayLiteral(value) : value));
      const result = await sql.unsafe<Row[]>(text, bound);
      const rows: Row[] = result;
      return { rows, rowCount: result.count };
    },
  };
}

export async function withTenant<T>(
  sql: Pick<SQL, "begin">,
  tenantId: string,
  subjectId: string,
  fn: (client: Queryable) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await tx.unsafe("SELECT set_config('app.subject_id', $1, true)", [subjectId]);
    return fn(queryable(tx));
  });
}

export async function assertTestDatabase(sql: Pick<SQL, "unsafe">, role: string): Promise<void> {
  const rows = await sql.unsafe<{ name: string }[]>("SELECT current_database() AS name", []);
  const name = rows[0]?.name ?? "";
  if (!/^memtavi_test/.test(name)) {
    throw new Error(
      `${role} must point at a disposable memtavi_test* database, received "${name || "<none>"}"`,
    );
  }
}
