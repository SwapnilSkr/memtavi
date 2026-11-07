import { DomainError } from "../middleware/errors";

export const roles = ["viewer", "developer", "admin", "owner"] as const;
export type Role = (typeof roles)[number];

export function requireRole(actual: Role, minimum: Role): void {
  if (roles.indexOf(actual) < roles.indexOf(minimum)) {
    throw new DomainError("ForbiddenError", 403, "Forbidden");
  }
}
