import {
  DEFAULT_TIMEOUT_MS,
  type FetchImpl,
  isRecord,
  isTokenCount,
  malformedResponse,
  postJson,
  trimmedBaseUrl,
} from "./http";
import type { ChatProvider, ChatRequest, ChatResult } from "./provider";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterChatOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

function parseChatResult(payload: unknown, requestedModel: string): ChatResult {
  if (!isRecord(payload)) throw malformedResponse();

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw malformedResponse();
  const choice: unknown = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) throw malformedResponse();
  const content = choice.message.content;
  if (typeof content !== "string") throw malformedResponse();

  const usage = payload.usage;
  if (!isRecord(usage)) throw malformedResponse();
  if (!isTokenCount(usage.prompt_tokens) || !isTokenCount(usage.completion_tokens)) {
    throw malformedResponse();
  }

  const reported = payload.model;
  const model = typeof reported === "string" && reported.length > 0 ? reported : requestedModel;

  return {
    text: content,
    model,
    usage: {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
    },
  };
}

export function createOpenRouterChat(options: OpenRouterChatOptions): ChatProvider {
  const baseUrl = trimmedBaseUrl(options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async chat(request: ChatRequest): Promise<ChatResult> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        temperature: request.temperature ?? 0,
      };
      if (request.responseFormat === "json") {
        body.response_format = { type: "json_object" };
      }

      const payload = await postJson(`${baseUrl}/chat/completions`, {
        apiKey: options.apiKey,
        body,
        fetchImpl,
        timeoutMs,
      });
      return parseChatResult(payload, request.model);
    },
  };
}
