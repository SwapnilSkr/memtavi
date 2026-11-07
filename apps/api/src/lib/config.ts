import type { withTenant } from "@memtavi/db/client";
import type { Pool } from "pg";

export interface AppConfig {
  ownerPool: Pool;
  withTenant: typeof withTenant;
  now?: () => Date;
}
