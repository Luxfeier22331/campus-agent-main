import {
  AppApiRouteError,
  errorEnvelope,
  jsonResponse,
  routeErrorResponse,
} from "../http";

export function dependencyNotReadyResponse() {
  return jsonResponse(
    errorEnvelope({
      code: "dependency_not_ready",
      message: "Runtime configuration is incomplete.",
      retryable: true,
    }),
    { status: 503 },
  );
}

export function sessionRequiredResponse() {
  return jsonResponse(
    errorEnvelope({
      code: "session_required",
      message: "Sign in required.",
      retryable: false,
    }),
    { status: 401 },
  );
}

export function serviceCredentialRequiredResponse() {
  return jsonResponse(
    errorEnvelope({
      code: "service_credential_required",
      message: "Collector service credential required.",
      retryable: false,
    }),
    { status: 401 },
  );
}

export function internalAuthRequiredResponse() {
  return jsonResponse(
    errorEnvelope({
      code: "internal_auth_required",
      message: "Trusted internal shared secret required.",
      retryable: false,
    }),
    { status: 401 },
  );
}

export function operatorAccessForbiddenResponse() {
  return routeErrorResponse(
    new AppApiRouteError({
      code: "forbidden",
      message: "Operator access is not available for this principal.",
      retryable: false,
      status: 403,
    }),
  );
}

export function routeErrorResponseWithFallbackCorrelation(
  error: AppApiRouteError,
  correlation: {
    requestId: string;
    traceId: string;
  },
): Response {
  return routeErrorResponse(
    new AppApiRouteError({
      code: error.code,
      details: error.details,
      message: error.message,
      requestId: error.requestId ?? correlation.requestId,
      retryable: error.retryable,
      status: error.status,
      traceId: error.traceId ?? correlation.traceId,
    }),
  );
}
