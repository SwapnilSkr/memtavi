import type { PoolClient } from "pg";
import type { Auth } from "../middleware/auth";
import type { Role } from "./roles";

interface MemberRow {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  createdAt: Date;
}

export async function listMembers(client: PoolClient, auth: Auth, limit: number, offset: number) {
  const total = await client.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM memberships WHERE tenant_id = $1",
    [auth.tenantId],
  );
  const items = await client.query<MemberRow>(
    `SELECT id, email, name, image, role, created_at AS "createdAt"
     FROM public.list_members($1, $2)`,
    [limit, offset],
  );
  return {
    items: items.rows.map((member) => ({ ...member, createdAt: member.createdAt.toISOString() })),
    total: total.rows[0]?.total ?? 0,
    limit,
    offset,
  };
}
