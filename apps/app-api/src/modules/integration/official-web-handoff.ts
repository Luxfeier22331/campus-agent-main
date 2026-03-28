import {
  DEFAULT_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS,
  parsePositiveInteger,
  type Env,
} from "../../config";
import type {
  OfficialWebHandoffPublisher,
  OfficialWebIngestionHandoffPayload,
} from "../official-web-projection";

export class OfficialWebHandoffTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    status: number;
  }) {
    super(input.message);
    this.name = "OfficialWebHandoffTransportError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

interface OfficialWebHandoffPublisherInput {
  fetchImplementation?: typeof fetch;
}

function readHandoffRuntimeConfig(
  env: Pick<
    Env,
    | "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS"
    | "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN"
    | "APP_API_OFFICIAL_WEB_HANDOFF_URL"
  >,
): {
  timeoutMs: number;
  token: string;
  url: string;
} {
  const url = env.APP_API_OFFICIAL_WEB_HANDOFF_URL?.trim();
  const token = env.APP_API_OFFICIAL_WEB_HANDOFF_TOKEN?.trim();
  if (!url || !token) {
    throw new OfficialWebHandoffTransportError({
      code: "dependency_not_ready",
      message: "Official web ingestion handoff runtime is not configured.",
      retryable: true,
      status: 503,
    });
  }

  return {
    timeoutMs: parsePositiveInteger(
      env.APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS,
      DEFAULT_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS,
    ),
    token,
    url,
  };
}

export function createOfficialWebHandoffPublisher(
  env: Pick<
    Env,
    | "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS"
    | "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN"
    | "APP_API_OFFICIAL_WEB_HANDOFF_URL"
  >,
  input: OfficialWebHandoffPublisherInput = {},
): OfficialWebHandoffPublisher {
  const fetchImplementation = input.fetchImplementation ?? fetch;

  return {
    async publish(payload: OfficialWebIngestionHandoffPayload): Promise<{ dispatchRef: string }> {
      const runtime = readHandoffRuntimeConfig(env);

      let response: Response;
      try {
        response = await new Promise<Response>((resolve, reject) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
            reject(
              new OfficialWebHandoffTransportError({
                code: "official_web_handoff_timeout",
                message: `Official web handoff exceeded ${runtime.timeoutMs}ms timeout.`,
                retryable: true,
                status: 504,
              }),
            );
          }, runtime.timeoutMs);

          fetchImplementation(runtime.url, {
            body: JSON.stringify(payload),
            headers: {
              authorization: `Bearer ${runtime.token}`,
              "content-type": "application/json",
              "x-official-web-event-id": payload.eventId,
            },
            method: "POST",
            signal: controller.signal,
          })
            .then(resolve)
            .catch((error) => {
              if (error instanceof Error && error.name === "AbortError") {
                reject(
                  new OfficialWebHandoffTransportError({
                    code: "official_web_handoff_timeout",
                    message: `Official web handoff exceeded ${runtime.timeoutMs}ms timeout.`,
                    retryable: true,
                    status: 504,
                  }),
                );
                return;
              }

              reject(error);
            })
            .finally(() => {
              clearTimeout(timeoutId);
            });
        });
      } catch (error) {
        if (error instanceof OfficialWebHandoffTransportError) {
          throw error;
        }

        throw new OfficialWebHandoffTransportError({
          code: "official_web_handoff_unavailable",
          message: error instanceof Error ? error.message : "Official web handoff request failed.",
          retryable: true,
          status: 502,
        });
      }

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = (await response.json()) as Record<string, unknown>;
      } catch {
        if (response.status >= 200 && response.status < 300) {
          throw new OfficialWebHandoffTransportError({
            code: "official_web_handoff_invalid_response",
            message: "Official web handoff receiver returned an invalid JSON response.",
            retryable: true,
            status: 502,
          });
        }
      }

      if (response.status < 200 || response.status >= 300) {
        const errorBody = parsed && typeof parsed.error === "object" && parsed.error ? parsed.error : null;
        throw new OfficialWebHandoffTransportError({
          code:
            errorBody && typeof (errorBody as { code?: unknown }).code === "string"
              ? ((errorBody as { code: string }).code as string)
              : "official_web_handoff_unavailable",
          message:
            errorBody && typeof (errorBody as { message?: unknown }).message === "string"
              ? ((errorBody as { message: string }).message as string)
              : "Official web handoff request failed.",
          retryable:
            errorBody && typeof (errorBody as { retryable?: unknown }).retryable === "boolean"
              ? ((errorBody as { retryable: boolean }).retryable as boolean)
              : response.status >= 500,
          status: response.status,
        });
      }

      const dispatchRef = typeof parsed?.dispatchRef === "string" ? parsed.dispatchRef.trim() : "";
      if (!dispatchRef) {
        throw new OfficialWebHandoffTransportError({
          code: "official_web_handoff_invalid_response",
          message: "Official web handoff receiver did not return a dispatchRef.",
          retryable: true,
          status: 502,
        });
      }

      return {
        dispatchRef,
      };
    },
  };
}
