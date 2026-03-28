export function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export class AppApiRouteError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly status: number;
  readonly traceId: string | null;

  constructor(input: {
    code: string;
    details?: unknown;
    message: string;
    requestId?: string | null;
    retryable: boolean;
    status: number;
    traceId?: string | null;
  }) {
    super(input.message);
    this.name = "AppApiRouteError";
    this.code = input.code;
    this.details = input.details ?? null;
    this.requestId = input.requestId ?? null;
    this.retryable = input.retryable;
    this.status = input.status;
    this.traceId = input.traceId ?? null;
  }
}

export function errorEnvelope(input: {
  code: string;
  message: string;
  retryable: boolean;
  traceId?: string | null;
  requestId?: string | null;
  details?: unknown;
}) {
  return {
    error: {
      code: input.code,
      message: input.message,
      retryable: input.retryable,
      traceId: input.traceId ?? null,
      requestId: input.requestId ?? null,
      details: input.details ?? null,
    },
  };
}

export function routeErrorResponse(error: AppApiRouteError): Response {
  return jsonResponse(
    errorEnvelope({
      code: error.code,
      details: error.details,
      message: error.message,
      requestId: error.requestId,
      retryable: error.retryable,
      traceId: error.traceId,
    }),
    { status: error.status },
  );
}
