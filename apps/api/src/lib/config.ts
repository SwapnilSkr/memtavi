import type { withTenant } from "@memtavi/db/client";
import type { ObjectStore } from "@memtavi/storage/types";
import type { Pool } from "pg";

export interface AppConfig {
  ownerPool: Pool;
  withTenant: typeof withTenant;
  store: ObjectStore;
  now?: () => Date;
}
