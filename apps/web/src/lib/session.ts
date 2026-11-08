export interface Session {
  baseUrl: string;
  apiKey: string;
  subjectId: string;
}

export type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const sessionKey = "memtavi.inspector.session.v1";

export function readSession(storage?: SessionStorage): Session | null {
  try {
    const raw = (storage ?? sessionStorage).getItem(sessionKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("baseUrl" in value) ||
      typeof value.baseUrl !== "string" ||
      !("apiKey" in value) ||
      typeof value.apiKey !== "string" ||
      !value.apiKey.trim() ||
      !("subjectId" in value) ||
      typeof value.subjectId !== "string" ||
      !value.subjectId.trim()
    ) {
      return null;
    }
    return { baseUrl: value.baseUrl, apiKey: value.apiKey, subjectId: value.subjectId };
  } catch {
    return null;
  }
}

export function saveSession(session: Session, storage: SessionStorage = sessionStorage): void {
  storage.setItem(sessionKey, JSON.stringify(session));
}

export function clearSession(storage: SessionStorage = sessionStorage): void {
  storage.removeItem(sessionKey);
}
