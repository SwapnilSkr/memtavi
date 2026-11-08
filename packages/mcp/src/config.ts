export interface McpConfig {
  apiUrl: string;
  apiKey: string;
  subjectId: string;
  brainId?: string | undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_API_URL = "http://localhost:3000";

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (value === "") {
    throw new ConfigError(`${name} is required. Set it in the MCP server environment.`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): McpConfig {
  const rawUrl = env.MEMTAVI_API_URL?.trim();
  const apiUrl = (rawUrl === undefined || rawUrl === "" ? DEFAULT_API_URL : rawUrl).replace(
    /\/+$/,
    "",
  );

  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new ConfigError("MEMTAVI_API_URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError("MEMTAVI_API_URL must use http or https.");
  }

  const apiKey = required(env, "MEMTAVI_API_KEY");
  const subjectId = required(env, "MEMTAVI_SUBJECT_ID");
  const brainId = env.MEMTAVI_BRAIN_ID?.trim();

  return {
    apiUrl,
    apiKey,
    subjectId,
    ...(brainId === undefined || brainId === "" ? {} : { brainId }),
  };
}
